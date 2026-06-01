import { NestedStack, NestedStackProps, Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Role } from "aws-cdk-lib/aws-iam";
import { Queue } from "aws-cdk-lib/aws-sqs";
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import * as path from "path";
import { ILambdaConfig } from "./types/services.types";
import { nameBuilder } from "../../config/base.config";

/**
 * CR-001 — Metrics emit DLQ pipeline.
 *
 * Pipeline:
 *   leads lambda  --(SendMessage on failure)-->  main DLQ
 *   main DLQ      --(SQS event source)-------->  retry consumer lambda
 *   main DLQ      --(maxReceiveCount=5)------->  terminal parking queue
 *
 * CloudWatch alarms cover DLQ depth, DLQ age-of-oldest-message, and parking
 * queue depth. No SNS topic is wired because no shared alarm topic exists in
 * this repo yet — alarms are surfaced via CloudWatch and can be subscribed
 * later without infra changes.
 */
export interface IMetricsDlqStackProps extends NestedStackProps {
  lambdaConfig: ILambdaConfig;
  roleName: string;
  logicalIdPrefix: string;
  dlqVisibilityTimeoutSeconds: number;
  retentionDays: number;
  maxReceiveCount: number;
  batchSize: number;
  maxBatchingWindowSeconds: number;
}

export class MetricsDlqStack extends NestedStack {
  public readonly dlq: Queue;
  public readonly parkingQueue: Queue;
  public readonly retryLambda: NodejsFunction;
  public readonly dlqDepthAlarm: Alarm;
  public readonly dlqAgeAlarm: Alarm;
  public readonly parkingDepthAlarm: Alarm;
  public readonly metricsTableGsi2ThrottleAlarm: Alarm;

  constructor(scope: Construct, id: string, props: IMetricsDlqStackProps) {
    super(scope, id, props);

    const {
      lambdaConfig,
      roleName,
      logicalIdPrefix,
      dlqVisibilityTimeoutSeconds,
      retentionDays,
      maxReceiveCount,
      batchSize,
      maxBatchingWindowSeconds,
    } = props;

    // Terminal parking queue — no redrive. Messages here require manual triage.
    this.parkingQueue = new Queue(
      this,
      `${logicalIdPrefix}-MetricsDlqParkingQueue`,
      {
        queueName: nameBuilder.queue("metrics-dlq-parking"),
        retentionPeriod: Duration.days(retentionDays),
      },
    );

    // Main DLQ. After maxReceiveCount failed processing attempts, messages
    // redrive to the terminal parking queue.
    this.dlq = new Queue(this, `${logicalIdPrefix}-MetricsDlq`, {
      queueName: nameBuilder.queue("metrics-dlq"),
      visibilityTimeout: Duration.seconds(dlqVisibilityTimeoutSeconds),
      retentionPeriod: Duration.days(retentionDays),
      deadLetterQueue: {
        maxReceiveCount,
        queue: this.parkingQueue,
      },
    });

    const role = Role.fromRoleName(
      this,
      `${logicalIdPrefix}-MetricsDlqRetryRole`,
      roleName,
    );

    this.retryLambda = new NodejsFunction(
      this,
      `${logicalIdPrefix}-MetricsDlqRetryFunction`,
      {
        functionName: lambdaConfig.functionName,
        entry: lambdaConfig.entry,
        handler: lambdaConfig.handler,
        runtime: Runtime.NODEJS_22_X,
        role,
        memorySize: lambdaConfig.memorySize || 512,
        timeout: Duration.seconds(lambdaConfig.timeout || 30),
        environment: lambdaConfig.environment,
        bundling: {
          minify: true,
          sourceMap: true,
          target: "node22",
          keepNames: true,
          sourcesContent: false,
          tsconfig: path.join(
            __dirname,
            "../../../handlers/leads/tsconfig.build.json",
          ),
          externalModules: ["@aws-sdk/*", "js-yaml"],
        },
      },
    );

    this.retryLambda.addEventSource(
      new SqsEventSource(this.dlq, {
        batchSize,
        maxBatchingWindow: Duration.seconds(maxBatchingWindowSeconds),
        reportBatchItemFailures: true,
      }),
    );

    // ── CloudWatch alarms ────────────────────────────────────────────────────
    this.dlqDepthAlarm = new Alarm(
      this,
      `${logicalIdPrefix}-MetricsDlqDepthAlarm`,
      {
        alarmName: `${nameBuilder.queue("metrics-dlq")}-depth-alarm`,
        alarmDescription:
          "CR-001: messages visible in the metrics emit DLQ (warn).",
        metric: this.dlq.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
          statistic: "Maximum",
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );

    this.dlqAgeAlarm = new Alarm(
      this,
      `${logicalIdPrefix}-MetricsDlqAgeAlarm`,
      {
        alarmName: `${nameBuilder.queue("metrics-dlq")}-age-alarm`,
        alarmDescription:
          "CR-001: oldest message in the metrics emit DLQ has been stuck >= 15 min (warn).",
        metric: this.dlq.metricApproximateAgeOfOldestMessage({
          period: Duration.minutes(5),
          statistic: "Maximum",
        }),
        threshold: 900,
        evaluationPeriods: 1,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );

    this.parkingDepthAlarm = new Alarm(
      this,
      `${logicalIdPrefix}-MetricsDlqParkingDepthAlarm`,
      {
        alarmName: `${nameBuilder.queue("metrics-dlq-parking")}-depth-alarm`,
        alarmDescription:
          "CR-001: messages landed in the terminal parking queue (page).",
        metric: this.parkingQueue.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
          statistic: "Maximum",
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );

    // CR-001: GSI2 throttle alarm on the existing metrics table. Placed here
    // (no peer alarms live in metrics-data.stack.ts) per brief fallback.
    const metricsTableName = nameBuilder.table("metrics");
    const metricsGsi2Name = `${metricsTableName}-affiliate-id-bucket-start-composite-index`;
    this.metricsTableGsi2ThrottleAlarm = new Alarm(
      this,
      `${logicalIdPrefix}-MetricsTableGsi2ThrottleAlarm`,
      {
        alarmName: `${metricsGsi2Name}-throttled-requests-alarm`,
        alarmDescription:
          "CR-001: throttled requests on metrics GSI2 (affiliate_id pivot).",
        metric: new Metric({
          namespace: "AWS/DynamoDB",
          metricName: "ThrottledRequests",
          dimensionsMap: {
            TableName: metricsTableName,
            GlobalSecondaryIndexName: metricsGsi2Name,
          },
          period: Duration.minutes(5),
          statistic: "Sum",
        }),
        threshold: 0,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
  }
}
