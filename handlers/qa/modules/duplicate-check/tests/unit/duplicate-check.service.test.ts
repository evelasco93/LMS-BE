import { beforeEach, describe, expect, it } from "vitest";
import { DuplicateCheckService } from "../../services/duplicate-check.service";
import { getMockDynamoDBUtil, getTestContainer } from "../setup";

describe("DuplicateCheckService", () => {
  let service: DuplicateCheckService;
  let mockDynamoDBUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("DuplicateCheckService").to(DuplicateCheckService);
    service = container.get<DuplicateCheckService>("DuplicateCheckService");
    mockDynamoDBUtil = getMockDynamoDBUtil();
  });

  it("returns not duplicate when incoming data has no comparable values", async () => {
    const result = await service.execute({
      campaign_id: "CM1",
      payload: {},
    });

    expect(result.result).toBe(true);
    expect(result.data?.duplicate).toBe(false);
    expect(mockDynamoDBUtil.scanAll).not.toHaveBeenCalled();
  });

  it("returns duplicate when matching lead ids found", async () => {
    mockDynamoDBUtil.scanAll.mockResolvedValueOnce([
      {
        id: "LD1",
        campaign_id: "CM1",
        payload: {
          email: "match@test.com",
        },
      },
    ]);

    const result = await service.execute({
      campaign_id: "CM1",
      payload: {
        email: "match@test.com",
      },
      criteria: ["email"],
    });

    expect(result.result).toBe(true);
    expect(result.data?.duplicate).toBe(true);
    expect(result.data?.duplicate_matches.lead_ids).toEqual(["LD1"]);
    expect(mockDynamoDBUtil.scanAll).toHaveBeenCalledTimes(1);
  });
});
