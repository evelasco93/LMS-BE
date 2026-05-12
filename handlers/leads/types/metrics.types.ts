import { ILead } from "../interfaces/ILead.interface";

export type MetricsCounterKey =
  | "received"
  | "accepted"
  | "sold"
  | "accepted_not_sold"
  | "rejected";

export type MetricsCounters = Record<MetricsCounterKey, number>;

export type MetricsQuery = {
  from_date: string;
  to_date: string;
  campaign_id?: string;
  source?: string;
};

export type MetricsTimePoint = {
  bucket_start: string;
  counters: MetricsCounters;
};

export type MetricsSummaryData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    campaign_id?: string;
    source?: string;
  };
  totals: MetricsCounters;
};

export type MetricsTimeseriesData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    campaign_id?: string;
    source?: string;
  };
  points: MetricsTimePoint[];
};

export type MetricsBreakdownEntry = {
  key: string;
  counters: MetricsCounters;
};

export type MetricsBreakdownData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    campaign_id?: string;
    source?: string;
  };
  campaigns: MetricsBreakdownEntry[];
  sources: MetricsBreakdownEntry[];
};

export type MetricsContractsEntry = {
  contract_id: string;
  counters: MetricsCounters;
};

export type MetricsContractsData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    campaign_id?: string;
  };
  contracts: MetricsContractsEntry[];
};

export type MetricsHealthData = {
  status: "ok" | "degraded";
  range: {
    from_date: string;
    to_date: string;
  };
  totals: MetricsCounters;
  checks: {
    received_equals_accepted_plus_rejected: boolean;
    accepted_equals_sold_plus_accepted_not_sold: boolean;
  };
  issues: string[];
};

export type MetricsLeadSnapshot = Pick<
  ILead,
  "id" | "campaign_id" | "original_source" | "rejected" | "sold" | "sold_to_contract_id" | "created_at"
>;
