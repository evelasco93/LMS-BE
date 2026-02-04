// Lead Intake Types

export interface LeadPayload {
  // Core fields
  id?: string;
  date?: string;
  time?: string;
  marketing_source?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  state?: string;
  message?: string;
  
  // Rideshare specific
  rideshare_abuse?: string;
  rideshare_company?: string;
  abuse_state?: string;
  gender?: string;
  assault_type?: string;
  has_ride_receipt?: string;
  has_attorney?: string;
  
  // Marketing
  test?: string;
  utm_campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_content?: string;
  utm_term?: string;
  pub_id?: string;
  
  // Technical
  ip_address?: string;
  page_url?: string;
  referrer_url?: string;
  trusted_form_cert_id?: string;
  
  // Campaign
  order_number?: string;
  campaign_id?: string;
  campaign_key?: string;
  consent?: string;
  
  // Validation results
  passed_duplicate_check?: boolean;
  passed_tf_check?: boolean;
  passed_phone_check?: boolean;
  passed_email_check?: boolean;
  passed_ip_check?: boolean;
  ipqs_raw_data?: any;
  
  // Sales
  sellable?: boolean;
  sold?: boolean;
  cherry_picked?: boolean;
  
  // Additional flexible fields
  [key: string]: any;
}

export interface LeadRequestBody extends LeadPayload {
  // Request body can have any additional fields
  body?: LeadPayload;
}

export interface LeadRecord extends LeadPayload {
  // DynamoDB specific fields
  id: string;
  timestamp: string;
  created_at: string;
}
