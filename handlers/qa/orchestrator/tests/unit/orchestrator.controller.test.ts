import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorController } from "../../controllers/orchestrator.controller";

describe("OrchestratorController status and correlation", () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let controller: OrchestratorController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      validateTrustedFormCert: vi.fn(),
      resolveDefaultCredentialsId: vi.fn(),
      runIpqsCheck: vi.fn(),
    };
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    controller = new OrchestratorController(service as never, logger as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        "x-correlation-id": "corr-qa-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("returns 400 for missing cert_id", async () => {
    const result = await controller.validateTrustedFormCert({ cert_id: "" });

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-qa-1");
  });

  it("returns 404 when no default IPQS credential exists", async () => {
    service.resolveDefaultCredentialsId.mockResolvedValue(undefined);

    const result = await controller.checkIpqs({ phone: "1112223333" });

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-qa-1");
  });

  it("logs and returns 500 on TrustedForm exception", async () => {
    service.validateTrustedFormCert.mockRejectedValue(
      new Error("trustedform down"),
    );

    const result = await controller.validateTrustedFormCert({
      cert_id: "cert-1",
    });

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-qa-1");
    expect(logger.error).toHaveBeenCalled();
  });
});
