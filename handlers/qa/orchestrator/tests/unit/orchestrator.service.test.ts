import { beforeEach, describe, expect, it } from "vitest";
import { OrchestratorService } from "../../services/orchestrator.service";
import {
  getMockDynamoDBUtil,
  getMockLambdaInvokeUtil,
  getTestContainer,
} from "../setup";
import {
  buildIpqsRejectionMessage,
  REJECTION_DUPLICATE,
  REJECTION_IPQS_EMAIL,
  REJECTION_IPQS_PHONE,
  REJECTION_TRUSTED_FORM_ALREADY_CLAIMED,
  REJECTION_TRUSTED_FORM_EXPIRED,
  REJECTION_TRUSTED_FORM_INVALID,
} from "@shared/constants/rejection-messages.constants";

describe("OrchestratorService", () => {
  let service: OrchestratorService;
  let mockLambdaInvokeUtil: any;
  let mockDynamoDBUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("OrchestratorService").to(OrchestratorService);
    service = container.get<OrchestratorService>("OrchestratorService");
    mockLambdaInvokeUtil = getMockLambdaInvokeUtil();
    mockDynamoDBUtil = getMockDynamoDBUtil();
  });

  /**
   * Sets up DynamoDB queryAll so that resolveDefaultCredentialsId() returns a
   * valid credentials_id for any provider. Uses mockImplementation so the
   * response is correct regardless of call order (needed for parallel stages).
   */
  function setupCredentialsMock(credentialsId = "cred-1") {
    mockDynamoDBUtil.queryAll.mockImplementation((params: any) => {
      if (params.IndexName?.includes("type-provider-index")) {
        const provider = params.ExpressionAttributeValues?.[":provider"] ?? "unknown";
        return Promise.resolve([{ id: `schema-${provider}`, type: "credential_schema" }]);
      }
      if (params.IndexName?.includes("schema-id-index")) {
        return Promise.resolve([
          { id: "ps-1", credentials_id: credentialsId, enabled: true },
        ]);
      }
      return Promise.resolve([]);
    });
  }

  // ── Stage 1: duplicate_check ─────────────────────────────────────────────────

  describe("Stage 1 — duplicate_check", () => {
    it("does not call any lambda when duplicate_check is disabled", async () => {
      const result = await service.execute({
        campaign_id: "CM1",
        plugins: { duplicate_check: { enabled: false, criteria: ["email"] } },
      });

      expect(result.result).toBe(true);
      expect(result.data?.duplicate).toBe(false);
      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).not.toHaveBeenCalled();
    });

    it("invokes duplicate check and continues pipeline when no duplicate", async () => {
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: false,
        duplicate_matches: { lead_ids: [] },
      });

      const result = await service.execute({
        campaign_id: "CM1",
        payload: { email: "a@a.com" },
        plugins: { duplicate_check: { enabled: true, criteria: ["email"] } },
      });

      expect(result.result).toBe(true);
      expect(result.data?.duplicate).toBe(false);
      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(1);
    });

    it("halts pipeline at stage 1 with correct halt fields when duplicate found", async () => {
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: true,
        duplicate_matches: { lead_ids: ["LD-existing"] },
      });

      const result = await service.execute({
        campaign_id: "CM1",
        payload: { email: "dup@test.com" },
        plugins: { duplicate_check: { enabled: true, criteria: ["email"] } },
      });

      expect(result.data?.duplicate).toBe(true);
      expect(result.data?.pipeline_halted).toBe(true);
      expect(result.data?.halt_stage).toBe(1);
      expect(result.data?.halt_plugin).toBe("duplicate_check");
      expect(result.data?.halt_reason).toBe(REJECTION_DUPLICATE);
      expect(result.data?.duplicate_matches.lead_ids).toEqual(["LD-existing"]);
      // Only the dup-check lambda — no stage 2+ lambdas invoked
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(1);
    });

    it("invokes duplicate check lambda with correct payload", async () => {
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: false,
        duplicate_matches: { lead_ids: [] },
      });

      await service.execute({
        campaign_id: "CM-ABC",
        payload: { email: "test@test.com", phone: "5551234567" },
        plugins: {
          duplicate_check: { enabled: true, criteria: ["email", "phone"] },
        },
      });

      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "test-qa-duplicate-check",
          payload: expect.objectContaining({
            campaign_id: "CM-ABC",
            criteria: ["email", "phone"],
          }),
        }),
      );
    });
  });

  // ── TrustedForm plugin ───────────────────────────────────────────────────────

  describe("TrustedForm plugin", () => {
    it("halts pipeline at stage 2 when TF fails and gate=true", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson
        .mockResolvedValueOnce({ duplicate: false, duplicate_matches: { lead_ids: [] } })
        .mockResolvedValueOnce({ success: false, cert_id: "abc", error: "cert not found" });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: true, criteria: ["email"] },
          trusted_form: { enabled: true, stage: 2, gate: true },
        },
      });

      expect(result.data?.pipeline_halted).toBe(true);
      expect(result.data?.halt_stage).toBe(2);
      expect(result.data?.halt_plugin).toBe("trusted_form");
      expect(result.data?.halt_reason).toBe(REJECTION_TRUSTED_FORM_INVALID);
    });

    it("does NOT halt pipeline when TF fails and gate=false", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson
        .mockResolvedValueOnce({ duplicate: false, duplicate_matches: { lead_ids: [] } })
        .mockResolvedValueOnce({ success: false, cert_id: "abc", error: "cert not found" });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: true, criteria: ["email"] },
          trusted_form: { enabled: true, stage: 2, gate: false },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(result.data?.trusted_form_result?.success).toBe(false);
    });

    it("maps 'expired' TF error to REJECTION_TRUSTED_FORM_EXPIRED", async () => {
      setupCredentialsMock();
      // dup_check disabled — first invokeJson call is TF
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: false,
        cert_id: "abc",
        error: "certificate has expired",
      });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true },
        },
      });

      expect(result.data?.halt_reason).toBe(REJECTION_TRUSTED_FORM_EXPIRED);
    });

    it("maps 'claimed/retained' TF error to REJECTION_TRUSTED_FORM_ALREADY_CLAIMED", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: false,
        cert_id: "abc",
        error: "cert has already been claimed",
      });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true },
        },
      });

      expect(result.data?.halt_reason).toBe(REJECTION_TRUSTED_FORM_ALREADY_CLAIMED);
    });

    it("uses REJECTION_TRUSTED_FORM_INVALID for unknown TF errors", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: false,
        cert_id: "abc",
        error: "some unknown error",
      });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true },
        },
      });

      expect(result.data?.halt_reason).toBe(REJECTION_TRUSTED_FORM_INVALID);
    });

    it("calls TrustedForm lambda with claim=false when plugin.claim is false", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: true,
        cert_id: "abc",
        outcome: "pass",
      });

      await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true, claim: false },
        },
      });

      const tfCall = mockLambdaInvokeUtil.invokeJson.mock.calls[0][0];
      expect(tfCall.functionName).toBe("test-qa-trusted-form");
      expect(tfCall.payload.claim).toBe(false);
    });

    it("calls TrustedForm lambda with claim=true when plugin.claim is true", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: true,
        cert_id: "abc",
        outcome: "pass",
      });

      await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true, claim: true },
        },
      });

      const tfCall = mockLambdaInvokeUtil.invokeJson.mock.calls[0][0];
      expect(tfCall.payload.claim).toBe(true);
    });

    it("passes vendor field through to TrustedForm lambda when set", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: true,
        cert_id: "abc",
        outcome: "pass",
      });

      await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true, vendor: "acme-vendor" },
        },
      });

      const tfCall = mockLambdaInvokeUtil.invokeJson.mock.calls[0][0];
      expect(tfCall.payload.vendor).toBe("acme-vendor");
    });

    it("skips TrustedForm plugin entirely when no cert_id is on the event", async () => {
      const result = await service.execute({
        campaign_id: "CM1",
        // cert_id intentionally omitted
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).not.toHaveBeenCalled();
    });

    it("skips TrustedForm gracefully when no credentials are configured", async () => {
      // DynamoDB returns empty — no schema found
      mockDynamoDBUtil.queryAll.mockResolvedValue([]);

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).not.toHaveBeenCalled();
    });

    it("does not halt when TF succeeds with gate=true", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: true,
        cert_id: "abc",
        outcome: "pass",
      });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(result.data?.trusted_form_result?.success).toBe(true);
    });
  });

  // ── IPQS plugin ──────────────────────────────────────────────────────────────

  describe("IPQS plugin", () => {
    it("halts pipeline when phone and email both fail and gate=true", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: false,
        phone: { success: false },
        email: { success: false },
      });

      const result = await service.execute({
        campaign_id: "CM1",
        phone: "5555555555",
        email: "spam@test.com",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          ipqs: {
            enabled: true,
            stage: 2,
            gate: true,
            phone: { enabled: true },
            email: { enabled: true },
          },
        },
      });

      expect(result.data?.pipeline_halted).toBe(true);
      expect(result.data?.halt_stage).toBe(2);
      expect(result.data?.halt_plugin).toBe("ipqs");
      expect(result.data?.halt_reason).toBe(
        buildIpqsRejectionMessage([REJECTION_IPQS_PHONE, REJECTION_IPQS_EMAIL]),
      );
    });

    it("does NOT halt when only phone fails and gate=false", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: false,
        phone: { success: false },
      });

      const result = await service.execute({
        campaign_id: "CM1",
        phone: "5555555555",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          ipqs: {
            enabled: true,
            stage: 2,
            gate: false,
            phone: { enabled: true },
          },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(result.data?.ipqs_result?.success).toBe(false);
    });

    it("skips IPQS plugin entirely when no phone/email/ip on event", async () => {
      const result = await service.execute({
        campaign_id: "CM1",
        // no phone, email, or ip_address
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          ipqs: {
            enabled: true,
            stage: 2,
            gate: true,
            phone: { enabled: true },
          },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).not.toHaveBeenCalled();
    });

    it("skips IPQS gracefully when no credentials are configured", async () => {
      mockDynamoDBUtil.queryAll.mockResolvedValue([]);

      const result = await service.execute({
        campaign_id: "CM1",
        phone: "5555555555",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          ipqs: {
            enabled: true,
            stage: 2,
            gate: true,
            phone: { enabled: true },
          },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).not.toHaveBeenCalled();
    });

    it("includes ip check label in rejection message when IP fails", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: false,
        ip: { success: false },
      });

      const result = await service.execute({
        campaign_id: "CM1",
        ip_address: "1.2.3.4",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          ipqs: {
            enabled: true,
            stage: 2,
            gate: true,
            ip: { enabled: true },
          },
        },
      });

      expect(result.data?.halt_reason).toContain("IP address");
    });

    it("does not halt when IPQS passes with gate=true", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: true,
        phone: { success: true },
      });

      const result = await service.execute({
        campaign_id: "CM1",
        phone: "5555555555",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          ipqs: {
            enabled: true,
            stage: 2,
            gate: true,
            phone: { enabled: true },
          },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(result.data?.ipqs_result?.success).toBe(true);
    });
  });

  // ── Stage ordering ───────────────────────────────────────────────────────────

  describe("Stage ordering", () => {
    it("TF stage 2, IPQS stage 3: TF gate failure at stage 2 prevents IPQS from running", async () => {
      setupCredentialsMock();
      // Only TF lambda invoked — IPQS must never fire
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: false,
        cert_id: "abc",
        error: "cert not found",
      });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        phone: "5555555555",
        email: "test@test.com",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true },
          ipqs: { enabled: true, stage: 3, gate: true, phone: { enabled: true } },
        },
      });

      expect(result.data?.pipeline_halted).toBe(true);
      expect(result.data?.halt_stage).toBe(2);
      expect(result.data?.halt_plugin).toBe("trusted_form");
      // IPQS was never invoked — only the one TF call
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(1);
      expect(mockLambdaInvokeUtil.invokeJson.mock.calls[0][0].functionName).toBe(
        "test-qa-trusted-form",
      );
    });

    it("IPQS stage 2, TF stage 3: IPQS runs first; TF runs second when IPQS passes", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson
        // stage 2: IPQS
        .mockResolvedValueOnce({ success: true, phone: { success: true } })
        // stage 3: TrustedForm
        .mockResolvedValueOnce({ success: true, cert_id: "abc", outcome: "pass" });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        phone: "5555555555",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          ipqs: { enabled: true, stage: 2, gate: true, phone: { enabled: true } },
          trusted_form: { enabled: true, stage: 3, gate: true },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(2);
      // First call must be IPQS (lower stage), second must be TrustedForm
      expect(mockLambdaInvokeUtil.invokeJson.mock.calls[0][0].functionName).toBe(
        "test-qa-ipqs",
      );
      expect(mockLambdaInvokeUtil.invokeJson.mock.calls[1][0].functionName).toBe(
        "test-qa-trusted-form",
      );
    });

    it("IPQS stage 2, TF stage 3: TF is skipped when IPQS halts at stage 2", async () => {
      setupCredentialsMock();
      // Only IPQS fires — TF should be skipped
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        success: false,
        phone: { success: false },
      });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        phone: "5555555555",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          ipqs: { enabled: true, stage: 2, gate: true, phone: { enabled: true } },
          trusted_form: { enabled: true, stage: 3, gate: true },
        },
      });

      expect(result.data?.pipeline_halted).toBe(true);
      expect(result.data?.halt_stage).toBe(2);
      expect(result.data?.halt_plugin).toBe("ipqs");
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(1);
      expect(mockLambdaInvokeUtil.invokeJson.mock.calls[0][0].functionName).toBe(
        "test-qa-ipqs",
      );
    });

    it("both plugins at the same stage run in parallel (both lambdas invoked)", async () => {
      setupCredentialsMock();
      // Both tasks share stage 2 — both should be called regardless of which finishes first
      mockLambdaInvokeUtil.invokeJson.mockResolvedValue({
        success: true,
        cert_id: "abc",
        outcome: "pass",
        phone: { success: true },
      });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        phone: "5555555555",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: true },
          ipqs: { enabled: true, stage: 2, gate: true, phone: { enabled: true } },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(2);
      const calledFunctions = mockLambdaInvokeUtil.invokeJson.mock.calls.map(
        (c: any) => c[0].functionName,
      );
      expect(calledFunctions).toContain("test-qa-trusted-form");
      expect(calledFunctions).toContain("test-qa-ipqs");
    });

    it("gate=false plugin failure does not prevent later stages from running", async () => {
      setupCredentialsMock();
      mockLambdaInvokeUtil.invokeJson
        // stage 2: TF fails but gate=false → pipeline continues
        .mockResolvedValueOnce({ success: false, cert_id: "abc", error: "cert not found" })
        // stage 3: IPQS succeeds
        .mockResolvedValueOnce({ success: true, phone: { success: true } });

      const result = await service.execute({
        campaign_id: "CM1",
        cert_id: "abc",
        phone: "5555555555",
        plugins: {
          duplicate_check: { enabled: false, criteria: [] },
          trusted_form: { enabled: true, stage: 2, gate: false },
          ipqs: { enabled: true, stage: 3, gate: true, phone: { enabled: true } },
        },
      });

      expect(result.data?.pipeline_halted).toBeUndefined();
      // Both stage 2 (TF) and stage 3 (IPQS) must have been called
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(2);
    });
  });

  // ── Rejection message constants ──────────────────────────────────────────────

  describe("Rejection message constants", () => {
    it("REJECTION_DUPLICATE is human-readable (no technical prefixes)", () => {
      expect(REJECTION_DUPLICATE).not.toMatch(/^[A-Z_]+:/);
      expect(REJECTION_DUPLICATE).toMatch(/lead/i);
    });

    it("buildIpqsRejectionMessage with a single failed check", () => {
      const msg = buildIpqsRejectionMessage([REJECTION_IPQS_PHONE]);
      expect(msg).toContain("phone number");
      expect(msg).toMatch(/quality checks/i);
    });

    it("buildIpqsRejectionMessage with multiple failed checks joins them correctly", () => {
      const msg = buildIpqsRejectionMessage([REJECTION_IPQS_PHONE, REJECTION_IPQS_EMAIL]);
      expect(msg).toContain("phone number");
      expect(msg).toContain("email address");
    });

    it("buildIpqsRejectionMessage with empty list returns a fallback string", () => {
      const msg = buildIpqsRejectionMessage([]);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    });

    it("REJECTION_TRUSTED_FORM_INVALID, EXPIRED, and ALREADY_CLAIMED are all distinct strings", () => {
      const messages = new Set([
        REJECTION_TRUSTED_FORM_INVALID,
        REJECTION_TRUSTED_FORM_EXPIRED,
        REJECTION_TRUSTED_FORM_ALREADY_CLAIMED,
      ]);
      expect(messages.size).toBe(3);
    });
  });
});
