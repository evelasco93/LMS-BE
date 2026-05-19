import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = process.env;

describe("CDK infrastructure guardrails", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("requires CREDENTIALS_ENCRYPTION_KEY for staging/prod", async () => {
    process.env.ENVIRONMENT = "staging";
    process.env.TENANT = "acme";
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;

    await expect(import("../config/base.config")).rejects.toThrow(
      /CREDENTIALS_ENCRYPTION_KEY/,
    );
  });

  it("uses environment-provided encryption key in service lambda config", async () => {
    process.env.ENVIRONMENT = "staging";
    process.env.TENANT = "acme";
    process.env.CREDENTIALS_ENCRYPTION_KEY = "test-key";

    const { servicesConfig } =
      await import("../stacks/services/config/services.config");

    expect(
      servicesConfig.tenantConfig.lambda.environment
        ?.CREDENTIALS_ENCRYPTION_KEY,
    ).toBe("test-key");
    expect(
      servicesConfig.qaOrchestrator.lambda.environment
        ?.CREDENTIALS_ENCRYPTION_KEY,
    ).toBe("test-key");
    expect(
      servicesConfig.qaTrustedForm.lambda.environment
        ?.CREDENTIALS_ENCRYPTION_KEY,
    ).toBe("test-key");
    expect(
      servicesConfig.qaIpqs.lambda.environment?.CREDENTIALS_ENCRYPTION_KEY,
    ).toBe("test-key");
  });

  it("enables deletion protection and PITR safeguards for prod data tables", async () => {
    process.env.ENVIRONMENT = "prod";
    process.env.TENANT = "acme";
    process.env.CREDENTIALS_ENCRYPTION_KEY = "test-key";

    const { dataConfig } = await import("../stacks/data/config/data.config");

    Object.values(dataConfig.tables).forEach((table) => {
      expect(table.deletionProtection).toBe(true);
    });

    expect(dataConfig.tables.leadIntakeLogs.pointInTimeRecovery).toBe(true);
    expect(dataConfig.tables.userTablePreferences.pointInTimeRecovery).toBe(
      true,
    );
  });

  it("configures external leads API stage throttling", async () => {
    const { ExternalLeadsApiStack } =
      await import("../stacks/api/external-leads-api.stack");

    const app = new App();
    const stack = new Stack(app, "TestApiStack");

    const leadsLambda = new Function(stack, "LeadsLambda", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline(
        "exports.handler = async () => ({ statusCode: 200 });",
      ),
    });

    new ExternalLeadsApiStack(stack, "ExternalLeadsApi", {
      leadsLambda,
      logicalIdPrefix: "acme-lms-prod",
      apiConfig: {
        name: "acme-external-leads-api",
        description: "External leads intake API",
        stageName: "prod",
        rateLimitPerSecond: 42,
        burstLimit: 84,
      },
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          ThrottlingRateLimit: 42,
          ThrottlingBurstLimit: 84,
        }),
      ]),
    });
  });
});
