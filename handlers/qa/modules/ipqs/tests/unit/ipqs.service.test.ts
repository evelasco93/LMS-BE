import { describe, it, expect, vi, beforeEach } from "vitest";
import { IpqsService } from "../../services/ipqs.service";

describe("IpqsService", () => {
  let dynamoDBUtil: { get: ReturnType<typeof vi.fn> };
  let logger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let constants: {
    TENANT_SETTINGS_TABLE_NAME: string;
    CREDENTIALS_ENCRYPTION_KEY: string;
  };
  let service: IpqsService;

  beforeEach(() => {
    dynamoDBUtil = {
      get: vi.fn().mockResolvedValue({
        id: "CRIPQS1",
        credentials: { apiKey: "plain-api-key" },
      }),
    };

    logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    constants = {
      TENANT_SETTINGS_TABLE_NAME: "tenant_settings",
      CREDENTIALS_ENCRYPTION_KEY: "",
    };

    service = new IpqsService(
      dynamoDBUtil as any,
      logger as any,
      constants as any,
    );
  });

  it("handles partial phone/email criteria without runtime failures", async () => {
    vi.spyOn(service as any, "httpsGet")
      .mockResolvedValueOnce({
        success: true,
        valid: true,
        fraud_score: 5,
        country: "US",
      })
      .mockResolvedValueOnce({
        success: true,
        valid: true,
        fraud_score: 10,
      });

    const result = await service.execute({
      campaign_id: "CM123",
      credentials_id: "CRIPQS1",
      phone: "+15551234567",
      email: "test@example.com",
      config: {
        phone: {
          enabled: true,
          criteria: {
            valid: { enabled: true, required: true },
          } as any,
        },
        email: {
          enabled: true,
          criteria: {
            valid: { enabled: true, required: true },
          } as any,
        },
      },
    });

    expect(result.result).toBe(true);
    if (!result.result) {
      return;
    }

    expect(result.data.success).toBe(true);
    expect(result.data.phone?.success).toBe(true);
    expect(result.data.email?.success).toBe(true);
    expect(dynamoDBUtil.get).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
