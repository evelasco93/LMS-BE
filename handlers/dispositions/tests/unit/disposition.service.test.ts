import { beforeEach, describe, expect, it } from "vitest";
import { DispositionService } from "../../services/disposition.service";
import { getMockDynamoDBUtil, getTestContainer } from "../setup";

describe("DispositionService", () => {
  let service: DispositionService;
  let mockDynamoDBUtil: ReturnType<typeof getMockDynamoDBUtil>;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("DispositionService").to(DispositionService);
    service = container.get<DispositionService>("DispositionService");
    mockDynamoDBUtil = getMockDynamoDBUtil();

    mockDynamoDBUtil.get.mockImplementation(async ({ TableName }: any) => {
      if (TableName === "test-campaigns-table") {
        return {
          id: "CMP-1",
          status: "ACTIVE",
          affiliates: [
            { campaign_key: "facebook_ads", status: "LIVE" },
            { campaign_key: "google_search", status: "LIVE" },
          ],
        };
      }

      return undefined;
    });
  });

  it("enforces effective_status precedence override_status ?? derived_status", async () => {
    mockDynamoDBUtil.get.mockImplementation(async ({ TableName }: any) => {
      if (TableName === "test-campaigns-table") {
        return {
          id: "CMP-1",
          status: "ACTIVE",
          affiliates: [{ campaign_key: "facebook_ads", status: "LIVE" }],
        };
      }

      return {
        id: "DP-1",
        name: "Disposition A",
        name_key: "disposition a",
        dispo_type: "CPA",
        campaign_id: "CMP-1",
        source_keys: ["facebook_ads"],
        status_mapping: [{ from_status: "approved", to_status: "signed" }],
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
        is_deleted: false,
      };
    });
    mockDynamoDBUtil.scan.mockResolvedValue({ items: [], count: 0 });
    mockDynamoDBUtil.put.mockResolvedValue(undefined);

    await service.putRows("DP-1", {
      rows: [
        {
          lead_id: "L-1",
          source_key: "Facebook Ads",
          included: true,
          derived_status: "approved",
          override_status: "funded",
        },
      ],
    });

    const saved = mockDynamoDBUtil.put.mock.calls[0][0].Item;
    expect(saved.derived_status).toBe("signed");
    expect(saved.effective_status).toBe("funded");
  });

  it("enforces source_key canonical naming and source-scoped uniqueness", async () => {
    mockDynamoDBUtil.scan.mockResolvedValue({
      items: [
        {
          id: "DP-existing",
          name: "Daily Performance",
          name_key: "daily performance",
          dispo_type: "CPA",
          campaign_id: "CMP-1",
          source_keys: ["facebook_ads"],
          status_mapping: [],
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
          is_deleted: false,
        },
      ],
      count: 1,
    });

    const collision = await service.createDisposition({
      name: "Daily Performance",
      dispo_type: "CPA",
      campaign_id: "CMP-1",
      source_keys: ["Facebook Ads"],
    });

    expect(collision.result).toBe(false);
    expect(collision.error).toContain("already exists");

    mockDynamoDBUtil.scan.mockResolvedValue({ items: [], count: 0 });
    mockDynamoDBUtil.put.mockResolvedValue(undefined);

    const created = await service.createDisposition({
      name: "Daily Performance",
      dispo_type: "CPA",
      campaign_id: "CMP-1",
      source_keys: ["Google Search", "google   search"],
    });

    expect(created.result).toBe(true);
    expect(created.data?.source_keys).toEqual(["google_search"]);
  });

  it("supports candidate-leads included filter", async () => {
    mockDynamoDBUtil.get.mockResolvedValue({
      id: "DP-3",
      name: "Disposition C",
      name_key: "disposition c",
      dispo_type: "CPA",
      source_keys: ["facebook"],
      status_mapping: [],
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      is_deleted: false,
    });

    mockDynamoDBUtil.scan.mockResolvedValue({
      items: [
        {
          disposition_id: "DP-3",
          lead_id: "L-1",
          source_key: "facebook",
          included: true,
          derived_status: "signed",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
        {
          disposition_id: "DP-3",
          lead_id: "L-2",
          source_key: "facebook",
          included: false,
          derived_status: "webform",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
      count: 2,
    });

    const included = await service.getCandidateLeads("DP-3", {
      included: true,
    });
    const excluded = await service.getCandidateLeads("DP-3", {
      included: false,
    });

    expect(included.result).toBe(true);
    expect(included.data?.items).toHaveLength(1);
    expect(included.data?.items[0].lead_id).toBe("L-1");

    expect(excluded.result).toBe(true);
    expect(excluded.data?.items).toHaveLength(1);
    expect(excluded.data?.items[0].lead_id).toBe("L-2");
  });

  it("computes summary aggregation and CPA formulas", async () => {
    mockDynamoDBUtil.get.mockResolvedValue({
      id: "DP-2",
      name: "Disposition B",
      name_key: "disposition b",
      dispo_type: "CPA",
      source_keys: ["facebook"],
      status_mapping: [],
      spend_inputs: { total: 300, by_source_key: { facebook: 200 } },
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      is_deleted: false,
    });

    mockDynamoDBUtil.scan.mockResolvedValue({
      items: [
        {
          disposition_id: "DP-2",
          lead_id: "L-1",
          source_key: "facebook",
          included: true,
          derived_status: "signed",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
        {
          disposition_id: "DP-2",
          lead_id: "L-2",
          source_key: "facebook",
          included: true,
          derived_status: "webform",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
      count: 2,
    });

    const result = await service.getSummary("DP-2");

    expect(result.result).toBe(true);
    expect(result.data?.total).toBe(2);
    expect(result.data?.signed).toBe(1);
    expect(result.data?.conversion_percent).toBe(50);
    expect(result.data?.total_spend).toBe(500);
    expect(result.data?.cost_per_signed).toBe(500);
    expect(result.data?.cost_per_lead).toBe(250);
  });

  it("masks public identifiers and denylists raw transaction_id", async () => {
    mockDynamoDBUtil.scan
      .mockResolvedValueOnce({
        items: [
          {
            disposition_id: "DP-4",
            uuid: "public-uuid-1",
            is_published: true,
            layout: { tabs: [] },
            updated_at: "2026-06-01T00:00:00.000Z",
          },
        ],
        count: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            disposition_id: "DP-4",
            lead_id: "LEAD-123456",
            source_key: "facebook",
            included: true,
            derived_status: "signed",
            transaction_id: "TX-998877",
            updated_at: "2026-06-01T00:00:00.000Z",
          },
        ],
        count: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            disposition_id: "DP-4",
            lead_id: "LEAD-123456",
            source_key: "facebook",
            included: true,
            derived_status: "signed",
            transaction_id: "TX-998877",
            updated_at: "2026-06-01T00:00:00.000Z",
          },
        ],
        count: 1,
      });

    mockDynamoDBUtil.get.mockResolvedValue({
      id: "DP-4",
      name: "Disposition D",
      name_key: "disposition d",
      dispo_type: "CPA",
      source_keys: ["facebook"],
      status_mapping: [],
      spend_inputs: { total: 0 },
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      is_deleted: false,
    });

    const result = await service.getPublicDispositionByUuid("public-uuid-1");

    expect(result.result).toBe(true);
    const firstRow = result.data?.rows[0] as Record<string, unknown>;
    expect(firstRow.transaction_id).toBeUndefined();
    expect(firstRow.lead_id).toBe("***3456");
  });

  it("soft deletes disposition successfully", async () => {
    mockDynamoDBUtil.get.mockResolvedValue({
      id: "DP-7",
      name: "Disposition E",
      name_key: "disposition e",
      dispo_type: "CPA",
      source_keys: ["facebook_ads"],
      status_mapping: [],
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      is_deleted: false,
    });
    mockDynamoDBUtil.put.mockResolvedValue(undefined);

    const result = await service.deleteDisposition("DP-7");

    expect(result.result).toBe(true);
    expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    const saved = mockDynamoDBUtil.put.mock.calls[0][0].Item;
    expect(saved.id).toBe("DP-7");
    expect(saved.is_deleted).toBe(true);
  });

  it("returns not found when deleting unknown disposition", async () => {
    mockDynamoDBUtil.get.mockResolvedValue(undefined);

    const result = await service.deleteDisposition("DP-missing");

    expect(result.result).toBe(false);
    expect(result.error).toContain("not found");
    expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
  });

  it("excludes soft-deleted dispositions from list by default", async () => {
    mockDynamoDBUtil.scan.mockResolvedValue({
      items: [
        {
          id: "DP-live",
          name: "Live Disposition",
          name_key: "live disposition",
          dispo_type: "CPA",
          source_keys: ["facebook_ads"],
          status_mapping: [],
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
          is_deleted: false,
        },
        {
          id: "DP-deleted",
          name: "Deleted Disposition",
          name_key: "deleted disposition",
          dispo_type: "CPA",
          source_keys: ["facebook_ads"],
          status_mapping: [],
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
          is_deleted: true,
        },
      ],
      count: 2,
    });

    const result = await service.listDispositions();

    expect(result.result).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].id).toBe("DP-live");
  });

  it("keeps unpublish idempotent and successful", async () => {
    mockDynamoDBUtil.get
      .mockResolvedValueOnce({
        disposition_id: "DP-6",
        uuid: "uuid-6",
        is_published: true,
        layout: { tabs: [] },
        updated_at: "2026-06-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        disposition_id: "DP-6",
        uuid: "uuid-6",
        is_published: false,
        revoked_at: "2026-06-10T00:00:00.000Z",
        layout: { tabs: [] },
        updated_at: "2026-06-10T00:00:00.000Z",
      });
    mockDynamoDBUtil.put.mockResolvedValue(undefined);

    const first = await service.unpublishDisposition("DP-6");
    const second = await service.unpublishDisposition("DP-6");

    expect(first.result).toBe(true);
    expect(second.result).toBe(true);
  });

  it("returns not found for unknown and revoked public UUID", async () => {
    mockDynamoDBUtil.scan.mockResolvedValue({
      items: [
        {
          disposition_id: "DP-5",
          uuid: "revoked-uuid",
          is_published: true,
          revoked_at: "2026-06-10T00:00:00.000Z",
          layout: { tabs: [] },
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
      count: 1,
    });

    const revoked = await service.getPublicDispositionByUuid("revoked-uuid");
    const unknown = await service.getPublicDispositionByUuid("unknown-uuid");

    expect(revoked.result).toBe(false);
    expect(revoked.error).toContain("not found");
    expect(unknown.result).toBe(false);
    expect(unknown.error).toContain("not found");
  });
});
