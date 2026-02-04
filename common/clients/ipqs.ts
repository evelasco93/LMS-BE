import axios, { AxiosInstance } from 'axios';

export interface IpqsConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface IpqsQueryParams {
  strictness?: number;
  allow_public_access_points?: boolean;
  lighter_penalties?: boolean;
}

// IP Check Types
export interface IpCheckResponse {
  success: boolean;
  message: string;
  fraud_score: number;
  country_code: string;
  region: string;
  city: string;
  ISP: string;
  ASN: number;
  organization: string;
  is_crawler: boolean;
  timezone: string;
  mobile: boolean;
  host: string;
  proxy: boolean;
  vpn: boolean;
  tor: boolean;
  active_vpn: boolean;
  active_tor: boolean;
  recent_abuse: boolean;
  bot_status: boolean;
  connection_type: string;
  abuse_velocity: string;
  zip_code: string;
  latitude: number;
  longitude: number;
  abuse_events: string[];
  request_id: string;
}

// Phone Check Types
export interface PhoneCheckResponse {
  message: string;
  success: boolean;
  formatted: string;
  local_format: string;
  valid: boolean;
  fraud_score: number;
  recent_abuse: boolean;
  VOIP: boolean;
  prepaid: boolean;
  risky: boolean;
  active: boolean;
  carrier: string;
  line_type: string;
  country: string;
  city: string;
  zip_code: string;
  region: string;
  dialing_code: number;
  active_status: string;
  sms_domain: string;
  associated_email_addresses: Record<string, any>;
  user_activity: string;
  mnc: string;
  mcc: string;
  leaked: boolean;
  spammer: boolean;
  request_id: string;
  name?: string;
  timezone: string;
  do_not_call: boolean;
  tcpa_blacklist: boolean;
  accurate_country_code: boolean;
  sms_email: string;
  number_recycling: Record<string, any>;
}

// Email Check Types
export interface EmailCheckResponse {
  message: string;
  success: boolean;
  valid: boolean;
  disposable: boolean;
  smtp_score: number;
  overall_score: number;
  first_name?: string;
  generic: boolean;
  common: boolean;
  dns_valid: boolean;
  honeypot: boolean;
  deliverability: string;
  frequent_complainer: boolean;
  spam_trap_score: string;
  catch_all: boolean;
  timed_out: boolean;
  suspect: boolean;
  recent_abuse: boolean;
  fraud_score: number;
  suggested_domain: string;
  leaked: boolean;
  domain_age: Record<string, any>;
  first_seen: Record<string, any>;
  domain_trust: string;
  sanitized_email: string;
  domain_velocity: string;
  user_activity: string;
  associated_names: Record<string, any>;
  associated_phone_numbers: Record<string, any>;
  risky_tld: boolean;
  spf_record: boolean;
  dmarc_record: boolean;
  mx_records: string[];
  a_records: string[];
  request_id: string;
}

// Combined Validation Result
export interface ValidationDetail {
  valid: boolean;
  reasons: string;
  data: any;
}

export interface IpqsValidationResult {
  validated: boolean;
  ip: ValidationDetail;
  phone: ValidationDetail;
  email: ValidationDetail;
}

export class IpqsUtil {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl: string;
  private defaultParams: IpqsQueryParams;

  constructor(config: IpqsConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://ipqualityscore.com/api/json';
    
    this.client = axios.create({
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.defaultParams = {
      strictness: 1,
      allow_public_access_points: true,
      lighter_penalties: false,
    };
  }

  /**
   * Check IP address
   */
  async checkIp(ipAddress: string): Promise<IpCheckResponse> {
    const url = `${this.baseUrl}/ip/${this.apiKey}/${ipAddress}`;
    
    try {
      const response = await this.client.get<IpCheckResponse>(url, {
        params: this.defaultParams,
      });
      return response.data;
    } catch (error: any) {
      console.error('IPQS IP check error:', error.response?.data || error.message);
      throw new Error(`IPQS IP check failed: ${error.message}`);
    }
  }

  /**
   * Check phone number
   */
  async checkPhone(phoneNumber: string): Promise<PhoneCheckResponse> {
    // Ensure phone is formatted with +1
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+1${phoneNumber.replace(/\D/g, '')}`;
    const url = `${this.baseUrl}/phone/${this.apiKey}/${formattedPhone}`;
    
    try {
      const response = await this.client.get<PhoneCheckResponse>(url, {
        params: this.defaultParams,
      });
      return response.data;
    } catch (error: any) {
      console.error('IPQS Phone check error:', error.response?.data || error.message);
      throw new Error(`IPQS Phone check failed: ${error.message}`);
    }
  }

  /**
   * Check email address
   */
  async checkEmail(email: string): Promise<EmailCheckResponse> {
    const url = `${this.baseUrl}/email/${this.apiKey}/${email}`;
    
    try {
      const response = await this.client.get<EmailCheckResponse>(url, {
        params: this.defaultParams,
      });
      return response.data;
    } catch (error: any) {
      console.error('IPQS Email check error:', error.response?.data || error.message);
      throw new Error(`IPQS Email check failed: ${error.message}`);
    }
  }

  /**
   * Validate all three (IP, Phone, Email)
   */
  async validateAll(ipAddress: string, phoneNumber: string, email: string): Promise<IpqsValidationResult> {
    try {
      // Run all checks in parallel
      const [ipResult, phoneResult, emailResult] = await Promise.all([
        this.checkIp(ipAddress),
        this.checkPhone(phoneNumber),
        this.checkEmail(email),
      ]);

      // Validate IP
      const ipValidation = this.validateIp(ipResult);
      
      // Validate Phone
      const phoneValidation = this.validatePhone(phoneResult);
      
      // Validate Email
      const emailValidation = this.validateEmail(emailResult);

      // Overall validation is true only if all pass
      const validated = ipValidation.valid && phoneValidation.valid && emailValidation.valid;

      return {
        validated,
        ip: ipValidation,
        phone: phoneValidation,
        email: emailValidation,
      };
    } catch (error: any) {
      console.error('IPQS validation error:', error.message);
      throw error;
    }
  }

  /**
   * Validate IP check result
   */
  private validateIp(result: IpCheckResponse): ValidationDetail {
    const reasons: string[] = [];
    
    if (!result.success) {
      reasons.push('API request failed');
    }
    
    if (result.fraud_score > 75) {
      reasons.push('High fraud score');
    }
    
    if (result.proxy) {
      reasons.push('Proxy detected');
    }
    
    if (result.vpn || result.active_vpn) {
      reasons.push('VPN detected');
    }
    
    if (result.tor || result.active_tor) {
      reasons.push('TOR detected');
    }
    
    if (result.recent_abuse) {
      reasons.push('Recent abuse detected');
    }
    
    if (result.bot_status) {
      reasons.push('Bot detected');
    }

    return {
      valid: reasons.length === 0,
      reasons: reasons.join(', '),
      data: { ...result, type: 'ip' },
    };
  }

  /**
   * Validate Phone check result
   */
  private validatePhone(result: PhoneCheckResponse): ValidationDetail {
    const reasons: string[] = [];
    
    if (!result.success) {
      reasons.push('API request failed');
    }
    
    if (!result.valid) {
      reasons.push('Invalid phone number');
    }
    
    if (result.fraud_score > 75) {
      reasons.push('High fraud score');
    }
    
    if (result.recent_abuse) {
      reasons.push('Recent abuse detected');
    }
    
    if (result.VOIP) {
      reasons.push('VOIP number');
    }
    
    if (result.risky) {
      reasons.push('Risky number');
    }
    
    if (!result.active) {
      reasons.push('Inactive number');
    }
    
    if (result.spammer) {
      reasons.push('Known spammer');
    }
    
    if (result.do_not_call) {
      reasons.push('On do-not-call list');
    }

    return {
      valid: reasons.length === 0,
      reasons: reasons.join(', '),
      data: { ...result, type: 'phone' },
    };
  }

  /**
   * Validate Email check result
   */
  private validateEmail(result: EmailCheckResponse): ValidationDetail {
    const reasons: string[] = [];
    
    if (!result.success) {
      reasons.push('API request failed');
    }
    
    if (!result.valid) {
      reasons.push('Invalid email');
    }
    
    if (result.disposable) {
      reasons.push('Disposable email');
    }
    
    if (result.fraud_score > 75) {
      reasons.push('High fraud score');
    }
    
    if (!result.dns_valid) {
      reasons.push('Invalid DNS');
    }
    
    if (result.honeypot) {
      reasons.push('Honeypot detected');
    }
    
    if (result.deliverability === 'low' || result.deliverability === 'none') {
      reasons.push('Low deliverability');
    }
    
    if (result.frequent_complainer) {
      reasons.push('Frequent complainer');
    }
    
    if (result.spam_trap_score !== 'none') {
      reasons.push('Spam trap detected');
    }
    
    if (result.suspect) {
      reasons.push('Suspect email');
    }
    
    if (result.recent_abuse) {
      reasons.push('Recent abuse detected');
    }

    return {
      valid: reasons.length === 0,
      reasons: reasons.join(', '),
      data: { ...result, type: 'email' },
    };
  }
}
