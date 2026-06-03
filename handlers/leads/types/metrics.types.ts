import { ILead } from "../interfaces/ILead.interface";

export type MetricsCounterKey =
  | "received"
  | "accepted"
  | "sold"
  | "accepted_not_sold"
  | "rejected"
  | "cherry_picked";

export type MetricsCounters = Record<MetricsCounterKey, number>;

/**
 * Rejection-cause split of `rejected` into three mutually-exclusive primary
 * classifications. Each rejected lead increments exactly one bucket at write
 * time, so the invariant
 *   rejected_dnq + rejected_spam + rejected_duplicates === rejected
 * holds for any aggregation window.
 *
 * Primary classification rules (see `MetricsService.computeExtendedAttrs`):
 *   1. duplicate bucket present                       → rejected_duplicates
 *   2. else any IPQS / trusted_form bucket present    → rejected_spam
 *   3. else (validation, logic_rules,
 *           affiliate_disabled, other)                → rejected_dnq
 */
export type RejectionSplits = {
  rejected_dnq: number;
  rejected_spam: number;
  rejected_duplicates: number;
};

export type MetricsCountersWithSplits = MetricsCounters & RejectionSplits;

/**
 * Per-check IPQS rollup. `avg_fraud_score` is computed at read time from
 * `score_sum / score_count` (null when no scores observed).
 */
export type IpqsCheckRollup = {
  pass: number;
  fail: number;
  score_sum: number;
  score_count: number;
  avg_fraud_score: number | null;
};

export type IpqsRollup = {
  phone: IpqsCheckRollup;
  email: IpqsCheckRollup;
  ip: IpqsCheckRollup;
  /**
   * CR-001 trusted_score_pct
   *   = (phone.pass + email.pass + ip.pass)
   *     / (phone.pass + phone.fail + email.pass + email.fail + ip.pass + ip.fail)
   *     × 100
   * Null when no IPQS checks ran for the window (denominator == 0).
   */
  trusted_score_pct: number | null;
};

/**
 * Quality rollup derived from extended counters at read time.
 * `source_quality_score = accepted / (received − duplicate_count) × 100`.
 */
export type QualityRollup = {
  duplicate_count: number;
  rejection_buckets: {
    duplicate: number;
    validation: number;
    logic_rules: number;
    trusted_form: number;
    ipqs_phone: number;
    ipqs_email: number;
    ipqs_ip: number;
    affiliate_disabled: number;
    other: number;
  };
  source_quality_score: number | null;
  /**
   * CR-001 duplicate_pct = duplicate_count / received × 100.
   * Null when received == 0.
   */
  duplicate_pct: number | null;
};

export type MetricsQuery = {
  from_date: string;
  to_date: string;
  time_preset?:
    | "year_to_date"
    | "this_month"
    | "last_30_days"
    | "last_7_days"
    | "yesterday"
    | "today"
    | "all_time";
  campaign_id?: string;
  campaign_key?: string;
  affiliate_id?: string;
};

export type MetricsTimePoint = {
  bucket_start: string;
  counters: MetricsCounters;
  ipqs?: IpqsRollup;
  quality?: QualityRollup;
};

export type MetricsSummaryData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    campaign_id?: string;
    campaign_key?: string;
    affiliate_id?: string;
  };
  totals: MetricsCountersWithSplits;
  ipqs?: IpqsRollup;
  quality?: QualityRollup;
  peak_lead_window: {
    start: string;
    end: string;
    label: string;
    received: number;
    total_received: number;
    share_percent: number;
  } | null;
};

export type MetricsDashboardData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    campaign_id?: string;
    campaign_key?: string;
    affiliate_id?: string;
  };
  summary: MetricsSummaryData;
  timeseries: MetricsTimeseriesData;
  campaign_by_source: MetricsBreakdownData;
  contracts: MetricsContractsData;
  timeseries_by_source: MetricsTimeseriesBySourceData;
  hourly: MetricsHourlyData;
  ipqs: {
    range: {
      from_date: string;
      to_date: string;
    };
    filters: MetricsSummaryData["filters"];
    ipqs: IpqsRollup;
  };
  quality: {
    range: {
      from_date: string;
      to_date: string;
    };
    filters: MetricsSummaryData["filters"];
    quality: QualityRollup;
  };
};

export type MetricsTimeseriesData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    campaign_id?: string;
    campaign_key?: string;
    affiliate_id?: string;
  };
  points: MetricsTimePoint[];
};

export type MetricsBreakdownEntry = {
  key: string;
  counters: MetricsCountersWithSplits;
  ipqs?: IpqsRollup;
  quality?: QualityRollup;
};

export type MetricsBreakdownData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    campaign_id?: string;
    campaign_key?: string;
    affiliate_id?: string;
  };
  campaign_summary: {
    campaign_id: string;
    counters: MetricsCountersWithSplits;
    ipqs?: IpqsRollup;
    quality?: QualityRollup;
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
    affiliate_id?: string;
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
  | "id"
  | "campaign_id"
  | "campaign_key"
  | "affiliate_id"
  | "original_source"
  | "rejected"
  | "sold"
  | "sold_to_contract_id"
  | "created_at"
>;

/**
 * Extended (non-counter) attributes that ride along on day-granularity
 * metrics counter items. Optional because hour items omit them.
 */
export type MetricsExtendedAttrs = {
  ipqs_phone_pass?: number;
  ipqs_phone_fail?: number;
  ipqs_email_pass?: number;
  ipqs_email_fail?: number;
  ipqs_ip_pass?: number;
  ipqs_ip_fail?: number;
  ipqs_phone_score_sum?: number;
  ipqs_phone_score_count?: number;
  ipqs_email_score_sum?: number;
  ipqs_email_score_count?: number;
  ipqs_ip_score_sum?: number;
  ipqs_ip_score_count?: number;
  dup_count?: number;
  rej_duplicate?: number;
  rej_validation?: number;
  rej_logic_rules?: number;
  rej_trusted_form?: number;
  rej_ipqs_phone?: number;
  rej_ipqs_email?: number;
  rej_ipqs_ip?: number;
  rej_affiliate_disabled?: number;
  rej_other?: number;
  /**
   * Primary-classification rejection splits (item 5). Mutually exclusive per
   * rejected event, so summing these across items reproduces `rejected`.
   */
  rej_split_dnq?: number;
  rej_split_spam?: number;
  rej_split_duplicates?: number;
};

/**
 * Shape of a metrics counter item as stored in DynamoDB. Counters are
 * optional because read paths may project subsets of them.
 */
export type MetricsCounterItem = {
  item_type?: string;
  bucket_start?: string;
  campaign_id?: string;
  source?: string;
  contract_id?: string;
  affiliate_id?: string;
  received?: number;
  accepted?: number;
  sold?: number;
  accepted_not_sold?: number;
  rejected?: number;
  cherry_picked?: number;
} & MetricsExtendedAttrs;

// ── Multi-source timeseries (item 3) ────────────────────────────────────────
// One series per affiliate over the requested date range; each series carries
// a fully padded `points[]` (zero-filled missing buckets). `affiliate_name`
// falls back to `affiliate_id` when no name source is available.
export type MetricsBySourceSeriesPoint = {
  bucket_start: string;
  received: number;
};

export type MetricsBySourceLine = {
  affiliate_id: string;
  affiliate_name: string;
  points: MetricsBySourceSeriesPoint[];
};

export type MetricsTimeseriesBySourceData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters?: {
    campaign_id?: string;
    affiliate_id?: string;
  };
  series: MetricsBySourceLine[];
};

// ── Hourly / day-night rollup (item 4) ──────────────────────────────────────
// `hour` is UTC hour-of-day (0..23). `day_night.bucket` partitions every
// observed hour into one of:
//   weekday_day   = Mon–Fri, 06:00–17:59 UTC
//   weekday_night = Mon–Fri, 18:00–05:59 UTC
//   weekend_day   = Sat–Sun, 06:00–17:59 UTC
//   weekend_night = Sat–Sun, 18:00–05:59 UTC
// Note: UTC is used throughout for parity with `bucket_start` storage.
export type DayNightBucket =
  | "weekday_day"
  | "weekday_night"
  | "weekend_day"
  | "weekend_night";

export type MetricsHourlyPoint = {
  /** ISO date "YYYY-MM-DD" — day this hour belongs to (UTC). */
  date: string;
  /** 0..23 UTC hour-of-day. */
  hour: number;
  /** 0=Sunday..6=Saturday (UTC). */
  weekday: number;
  counters: MetricsCounters;
};

export type MetricsHourlyData = {
  range: {
    from_date: string;
    to_date: string;
  };
  filters?: {
    campaign_id?: string;
    affiliate_id?: string;
  };
  points: MetricsHourlyPoint[];
};
