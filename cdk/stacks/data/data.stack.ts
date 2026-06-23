import { Stack, CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { IDataStackProps } from "./types/data.types";
import { ClientsDataStack } from "./clients-data.stack";
import { AffiliatesDataStack } from "./affiliates-data.stack";
import { CampaignsDataStack } from "./campaigns-data.stack";
import { LeadsDataStack } from "./leads-data.stack";
import { TenantSettingsDataStack } from "./tenant-settings-data.stack";
import { AuditLogsDataStack } from "./audit-logs-data.stack";
import { LeadIntakeLogsDataStack } from "./lead-intake-logs-data.stack";
import { MetricsDataStack } from "./metrics-data.stack";
import { PresetsDataStack } from "./presets-data.stack";
import { UserTablePreferencesDataStack } from "./user-table-preferences-data.stack";
import { PlatformPresetsDataStack } from "./platform-presets-data.stack";
import { DispositionsDataStack } from "./dispositions-data.stack";

/**
 * Main Data Stack
 */
export class DataStack extends Stack {
  public readonly clientsTable: Table;
  public readonly affiliatesTable: Table;
  public readonly campaignsTable: Table;
  /** Campaign dashboard widget definitions */
  public readonly campaignDashboardWidgetsTable: Table;
  public readonly leadsTable: Table;
  /** Metrics domain single table */
  public readonly metricsTable: Table;
  /** Consolidated single table for credentials, credential schemas, and plugin settings */
  public readonly tenantSettingsTable: Table;
  /** Centralized audit log table */
  public readonly auditLogsTable: Table;
  /** S3 bucket for daily audit log NDJSON exports */
  public readonly auditLogsBucket: Bucket;
  /** Raw HTTP intake log — one record per POST /leads submission attempt */
  public readonly leadIntakeLogsTable: Table;
  /** Versioned presets (criteria catalog, logic catalog, tenant presets) */
  public readonly presetsTable: Table;
  /** Per-user, per-table UI configuration */
  public readonly userTablePreferencesTable: Table;
  /** Platform-level preset definitions (US States, Yes/No, etc.) */
  public readonly platformPresetsTable: Table;
  /** Disposition definitions */
  public readonly dispositionsTable: Table;
  /** Materialized lead rows for each disposition */
  public readonly dispositionRowsTable: Table;
  /** Public dashboard publish records */
  public readonly publicDashboardsTable: Table;

  constructor(scope: Construct, id: string, props: IDataStackProps) {
    super(scope, id, props);

    const { config, dataConfig } = props;
    const statefulRemovalPolicy = ["prod", "production"].includes(
      config.environment,
    )
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    const clientsDataStack = new ClientsDataStack(
      this,
      `${config.appPrefix}-ClientsData`,
      {
        tableConfig: dataConfig.tables.clients,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const affiliatesDataStack = new AffiliatesDataStack(
      this,
      `${config.appPrefix}-AffiliatesData`,
      {
        tableConfig: dataConfig.tables.affiliates,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const campaignsDataStack = new CampaignsDataStack(
      this,
      `${config.appPrefix}-CampaignsData`,
      {
        tableConfig: dataConfig.tables.campaigns,
        dashboardWidgetsTableConfig: dataConfig.tables.campaignDashboardWidgets,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const leadsDataStack = new LeadsDataStack(
      this,
      `${config.appPrefix}-LeadsData`,
      {
        tableConfig: dataConfig.tables.leads,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const tenantSettingsDataStack = new TenantSettingsDataStack(
      this,
      `${config.appPrefix}-TenantSettingsData`,
      {
        tableConfig: dataConfig.tables.tenantSettings,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );

    this.clientsTable = clientsDataStack.table;
    this.affiliatesTable = affiliatesDataStack.table;
    this.campaignsTable = campaignsDataStack.table;
    this.campaignDashboardWidgetsTable =
      campaignsDataStack.dashboardWidgetsTable;
    this.leadsTable = leadsDataStack.table;

    const metricsDataStack = new MetricsDataStack(
      this,
      `${config.appPrefix}-MetricsData`,
      {
        tableConfig: dataConfig.tables.metrics,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.metricsTable = metricsDataStack.table;

    this.tenantSettingsTable = tenantSettingsDataStack.table;

    const auditLogsDataStack = new AuditLogsDataStack(
      this,
      `${config.appPrefix}-AuditLogsData`,
      {
        tableConfig: dataConfig.tables.auditLogs,
        s3BucketName: dataConfig.auditLogsBucketName,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.auditLogsTable = auditLogsDataStack.table;
    this.auditLogsBucket = auditLogsDataStack.bucket;

    const leadIntakeLogsDataStack = new LeadIntakeLogsDataStack(
      this,
      `${config.appPrefix}-LeadIntakeLogsData`,
      {
        tableConfig: dataConfig.tables.leadIntakeLogs,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.leadIntakeLogsTable = leadIntakeLogsDataStack.table;

    const presetsDataStack = new PresetsDataStack(
      this,
      `${config.appPrefix}-PresetsData`,
      {
        tableConfig: dataConfig.tables.presets,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.presetsTable = presetsDataStack.table;

    const userTablePreferencesDataStack = new UserTablePreferencesDataStack(
      this,
      `${config.appPrefix}-UserTablePreferencesData`,
      {
        tableConfig: dataConfig.tables.userTablePreferences,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.userTablePreferencesTable = userTablePreferencesDataStack.table;

    const platformPresetsDataStack = new PlatformPresetsDataStack(
      this,
      `${config.appPrefix}-PlatformPresetsData`,
      {
        tableConfig: dataConfig.tables.platformPresets,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.platformPresetsTable = platformPresetsDataStack.table;

    const dispositionsDataStack = new DispositionsDataStack(
      this,
      `${config.appPrefix}-DispositionsData`,
      {
        dispositionsTableConfig: dataConfig.tables.dispositions,
        dispositionRowsTableConfig: dataConfig.tables.dispositionRows,
        publicDashboardsTableConfig: dataConfig.tables.publicDashboards,
        removalPolicy: statefulRemovalPolicy,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.dispositionsTable = dispositionsDataStack.dispositionsTable;
    this.dispositionRowsTable = dispositionsDataStack.dispositionRowsTable;
    this.publicDashboardsTable = dispositionsDataStack.publicDashboardsTable;

    new CfnOutput(this, `${config.appPrefix}-TenantSettingsTableName`, {
      value: this.tenantSettingsTable.tableName,
      description:
        "Tenant Settings DynamoDB table name (credentials, schemas, plugin settings)",
      exportName: `${config.appPrefix}-tenant-settings-table-name`,
    });

    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
