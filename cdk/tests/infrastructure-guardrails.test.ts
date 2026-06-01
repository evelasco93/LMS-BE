import { App, NestedStack, Stack } from "aws-cdk-lib";
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

  // ── CR-001 guardrails ───────────────────────────────────────────────────────

  it("CR-001: metrics table declares exactly two GSIs with expected keys", async () => {
    process.env.ENVIRONMENT = "staging";
    process.env.TENANT = "acme";
    process.env.CREDENTIALS_ENCRYPTION_KEY = "test-key";

    const { dataConfig } = await import("../stacks/data/config/data.config");
    const metrics = dataConfig.tables.metrics;

    expect(metrics.gsi).toBeDefined();
    expect(metrics.gsi).toHaveLength(2);

    const itemTypeIndex = metrics.gsi![0];
    expect(itemTypeIndex.indexName).toMatch(
      /-metrics-.*-item-type-bucket-start-index$/,
    );
    expect(itemTypeIndex.partitionKey).toEqual({
      name: "item_type",
      type: "S",
    });
    expect(itemTypeIndex.sortKey).toEqual({ name: "bucket_start", type: "S" });
    expect(itemTypeIndex.projectionType).toBe("ALL");

    const affiliateIndex = metrics.gsi![1];
    expect(affiliateIndex.indexName).toMatch(
      /-metrics-.*-affiliate-id-bucket-start-composite-index$/,
    );
    expect(affiliateIndex.partitionKey).toEqual({
      name: "affiliate_id",
      type: "S",
    });
    expect(affiliateIndex.sortKey).toEqual({
      name: "bucket_start_composite",
      type: "S",
    });
    expect(affiliateIndex.projectionType).toBe("ALL");
  });

  it("CR-001: leads lambda env exposes affiliate-id GSI metadata", async () => {
    process.env.ENVIRONMENT = "staging";
    process.env.TENANT = "acme";
    process.env.CREDENTIALS_ENCRYPTION_KEY = "test-key";

    const { servicesConfig } =
      await import("../stacks/services/config/services.config");
    const env = servicesConfig.leads.lambda.environment ?? {};
    expect(env.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_NAME).toMatch(
      /-metrics-.*-affiliate-id-bucket-start-composite-index$/,
    );
    expect(
      env.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_PARTITION_KEY,
    ).toBe("affiliate_id");
    expect(env.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_SORT_KEY).toBe(
      "bucket_start_composite",
    );
  });

  describe("CR-001: services stack metrics DLQ wiring", () => {
    const synthServicesTemplates = async (): Promise<Template[]> => {
      process.env.ENVIRONMENT = "staging";
      process.env.TENANT = "acme";
      process.env.CREDENTIALS_ENCRYPTION_KEY = "test-key";

      const { ServicesStack } =
        await import("../stacks/services/services.stack");
      const { servicesConfig } =
        await import("../stacks/services/config/services.config");
      const { baseConfig } = await import("../config/base.config");

      const app = new App();
      const stack = new ServicesStack(app, "TestServicesStack", {
        config: baseConfig,
        servicesConfig,
      });
      // CR-001 DLQ resources live inside a NestedStack child of ServicesStack,
      // so we must synth and inspect every stack/nested stack in the tree.
      const templates: Template[] = [Template.fromStack(stack)];
      for (const child of stack.node.findAll()) {
        if (child instanceof NestedStack && child !== stack) {
          templates.push(Template.fromStack(child));
        }
      }
      return templates;
    };

    const findResources = (templates: Template[], type: string) => {
      const out: Record<string, any> = {};
      for (const t of templates) {
        Object.assign(out, t.findResources(type));
      }
      return out;
    };

    it("creates main DLQ with redrive maxReceiveCount=5 to parking queue", async () => {
      const templates = await synthServicesTemplates();
      const queues = findResources(templates, "AWS::SQS::Queue");
      const main = Object.values(queues).find((q: any) => {
        const name = String(q.Properties?.QueueName ?? "");
        return (
          name.includes("metrics-dlq") &&
          !name.includes("metrics-dlq-parking") &&
          q.Properties?.RedrivePolicy?.maxReceiveCount === 5
        );
      });
      expect(main).toBeDefined();
    });

    it("parking queue exists and has no redrive policy", async () => {
      const templates = await synthServicesTemplates();
      const queues = findResources(templates, "AWS::SQS::Queue");
      const parking = Object.values(queues).find((q: any) =>
        String(q.Properties?.QueueName ?? "").includes("metrics-dlq-parking"),
      ) as any;
      expect(parking).toBeDefined();
      expect(parking.Properties.RedrivePolicy).toBeUndefined();
    });

    it("retry consumer lambda has an SQS event source from the main DLQ", async () => {
      const templates = await synthServicesTemplates();
      const mappings = findResources(
        templates,
        "AWS::Lambda::EventSourceMapping",
      );
      const dlqMapping = Object.values(mappings).find(
        (m: any) =>
          m.Properties?.BatchSize === 10 &&
          (m.Properties?.FunctionResponseTypes ?? []).includes(
            "ReportBatchItemFailures",
          ),
      );
      expect(dlqMapping).toBeDefined();
    });

    it("leads lambda receives METRICS_DLQ_URL env var", async () => {
      const templates = await synthServicesTemplates();
      const fns = findResources(templates, "AWS::Lambda::Function");
      const leads = Object.values(fns).find((fn: any) =>
        String(fn.Properties?.FunctionName ?? "").endsWith("-leads-staging"),
      ) as any;
      expect(leads).toBeDefined();
      const vars = leads.Properties.Environment?.Variables ?? {};
      expect(vars.METRICS_DLQ_URL).toBeDefined();
    });

    it("does not introduce S3, Firehose, Glue, or Athena resources", async () => {
      const templates = await synthServicesTemplates();
      // The services stack is compute/queue scope only; pre-existing audit /
      // credentials buckets live in the DataStack, not here. So the services
      // stack must contain zero S3 buckets after CR-001.
      expect(
        Object.keys(findResources(templates, "AWS::S3::Bucket")),
      ).toHaveLength(0);
      expect(
        Object.keys(
          findResources(templates, "AWS::KinesisFirehose::DeliveryStream"),
        ),
      ).toHaveLength(0);
      // Glue & Athena: zero of any kind across all stacks/nested stacks.
      const allTypes: string[] = [];
      for (const t of templates) {
        const resources = t.toJSON().Resources ?? {};
        for (const r of Object.values(resources)) {
          allTypes.push((r as any).Type);
        }
      }
      expect(allTypes.filter((t) => t.startsWith("AWS::Glue::"))).toHaveLength(
        0,
      );
      expect(
        allTypes.filter((t) => t.startsWith("AWS::Athena::")),
      ).toHaveLength(0);
    });
  });
});
