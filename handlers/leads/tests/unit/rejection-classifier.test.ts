import { describe, expect, it } from "vitest";
import { classifyRejection } from "../../services/rejection-classifier";
import type { ILead } from "../../interfaces/ILead.interface";
import {
  REJECTION_DUPLICATE,
  REJECTION_AFFILIATE_DISABLED,
  REJECTION_CRITERIA_VALIDATION,
  REJECTION_LOGIC_RULES,
  REJECTION_TRUSTED_FORM_INVALID,
  REJECTION_TRUSTED_FORM_EXPIRED,
  REJECTION_TRUSTED_FORM_ALREADY_CLAIMED,
} from "@shared/constants/rejection-messages.constants";

type Ipqs = ILead["ipqs_result"];

const noIpqs: Ipqs = undefined;

describe("classifyRejection", () => {
  it("returns empty when reason is undefined", () => {
    expect(classifyRejection(undefined, noIpqs)).toEqual([]);
  });

  it("classifies duplicate via exact constant", () => {
    expect(classifyRejection(REJECTION_DUPLICATE, noIpqs)).toEqual([
      "duplicate",
    ]);
  });

  it("classifies affiliate_disabled via exact constant", () => {
    expect(classifyRejection(REJECTION_AFFILIATE_DISABLED, noIpqs)).toEqual([
      "affiliate_disabled",
    ]);
  });

  it("classifies validation via exact constant", () => {
    expect(classifyRejection(REJECTION_CRITERIA_VALIDATION, noIpqs)).toEqual([
      "validation",
    ]);
  });

  it("classifies validation via prefix", () => {
    expect(
      classifyRejection("Missing required fields: First Name, Phone", noIpqs),
    ).toEqual(["validation"]);
  });

  it("classifies logic_rules via exact constant", () => {
    expect(classifyRejection(REJECTION_LOGIC_RULES, noIpqs)).toEqual([
      "logic_rules",
    ]);
  });

  it("classifies logic_rules via prefix", () => {
    expect(
      classifyRejection(
        "Lead does not meet campaign requirements: Age >= 18",
        noIpqs,
      ),
    ).toEqual(["logic_rules"]);
  });

  it.each([
    REJECTION_TRUSTED_FORM_INVALID,
    REJECTION_TRUSTED_FORM_EXPIRED,
    REJECTION_TRUSTED_FORM_ALREADY_CLAIMED,
  ])("classifies trusted_form constant %s", (constant) => {
    expect(classifyRejection(constant, noIpqs)).toEqual(["trusted_form"]);
  });

  it("classifies trusted_form via prefix", () => {
    expect(
      classifyRejection("The form certificate is malformed: xyz", noIpqs),
    ).toEqual(["trusted_form"]);
  });

  it("emits per-failed IPQS check bucket", () => {
    const ipqs = {
      success: false,
      phone: { success: false },
      email: { success: true },
      ip: { success: false },
    } as unknown as NonNullable<Ipqs>;
    expect(classifyRejection("ipqs failed", ipqs)).toEqual([
      "ipqs_phone",
      "ipqs_ip",
    ]);
  });

  it("falls back to 'other' when reason present but no match", () => {
    expect(classifyRejection("Something weird happened", noIpqs)).toEqual([
      "other",
    ]);
  });

  it("combines validation prefix with ipqs failures (multi-bucket)", () => {
    const ipqs = {
      success: false,
      email: { success: false },
    } as unknown as NonNullable<Ipqs>;
    expect(classifyRejection("Missing required fields: Phone", ipqs)).toEqual([
      "validation",
      "ipqs_email",
    ]);
  });
});
