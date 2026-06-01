import { describe, expect, it } from "vitest";
import { buildLeadOutcomeEvent } from "../../services/lead-outcome-event.builder";
import type { ILead } from "../../interfaces/ILead.interface";
import { REJECTION_DUPLICATE } from "@shared/constants/rejection-messages.constants";

const baseLead = (overrides: Partial<ILead> = {}): ILead =>
  ({
    id: "L1",
    campaign_id: "CM1",
    campaign_key: "K1",
    affiliate_id: "AF1",
    test: false,
    created_at: "2026-05-01T12:00:00.000Z",
    ...overrides,
  }) as ILead;

describe("buildLeadOutcomeEvent", () => {
  it("maps an accepted, sold lead", () => {
    const e = buildLeadOutcomeEvent(
      baseLead({
        rejected: false,
        sold: true,
        sold_to_contract_id: "CT1",
      }),
    );
    expect(e).toEqual({
      lead_id: "L1",
      campaign_id: "CM1",
      campaign_key: "K1",
      affiliate_id: "AF1",
      contract_id: "CT1",
      created_at: "2026-05-01T12:00:00.000Z",
      received: 1,
      accepted: 1,
      sold: 1,
      accepted_not_sold: 0,
      rejected: 0,
      duplicate: false,
      rejection_buckets: [],
      ipqs: {
        phone: { ran: false },
        email: { ran: false },
        ip: { ran: false },
      },
    });
  });

  it("maps an accepted-not-sold lead", () => {
    const e = buildLeadOutcomeEvent(baseLead({ rejected: false, sold: false }));
    expect(e.accepted).toBe(1);
    expect(e.sold).toBe(0);
    expect(e.accepted_not_sold).toBe(1);
    expect(e.rejected).toBe(0);
  });

  it("maps a duplicate-rejected lead with classifier buckets", () => {
    const e = buildLeadOutcomeEvent(
      baseLead({
        rejected: true,
        duplicate: true,
        rejection_reason: REJECTION_DUPLICATE,
      }),
    );
    expect(e.rejected).toBe(1);
    expect(e.accepted).toBe(0);
    expect(e.duplicate).toBe(true);
    expect(e.rejection_buckets).toEqual(["duplicate"]);
  });

  it("extracts ipqs check outcomes including fraud_score", () => {
    const e = buildLeadOutcomeEvent(
      baseLead({
        ipqs_result: {
          success: true,
          phone: { success: true, fraud_score: 12 },
          email: { success: false, fraud_score: 90 },
          ip: { success: true },
        },
      } as Partial<ILead>),
    );
    expect(e.ipqs).toEqual({
      phone: { ran: true, pass: true, fraud_score: 12 },
      email: { ran: true, pass: false, fraud_score: 90 },
      ip: { ran: true, pass: true },
    });
  });

  it("falls back to raw.fraud_score when typed field missing", () => {
    const e = buildLeadOutcomeEvent(
      baseLead({
        ipqs_result: {
          success: true,
          phone: {
            success: true,
            raw: { fraud_score: 33 },
          },
        },
      } as Partial<ILead>),
    );
    expect(e.ipqs.phone).toEqual({ ran: true, pass: true, fraud_score: 33 });
  });

  it("omits affiliate_id, campaign_key, contract_id when absent", () => {
    const e = buildLeadOutcomeEvent({
      id: "L2",
      campaign_id: "CM2",
      campaign_key: "",
      test: false,
      created_at: "2026-05-02T00:00:00.000Z",
    } as ILead);
    expect(e.affiliate_id).toBeUndefined();
    expect(e.contract_id).toBeUndefined();
    expect(e.campaign_key).toBeUndefined();
  });
});
