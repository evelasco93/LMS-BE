import { injectable, inject } from 'inversify';
import { v4 as uuidv4 } from 'uuid';
import { DynamoDbUtil } from '../../common/utils/dynamoDbUtil';
import { IpqsUtil, IpqsValidationResult } from '../../common/clients/ipqs';
import { TrustedFormsUtil, TrustedFormResponse } from '../../common/clients/trustedForms';
import { LeadPayload, LeadRecord } from '../types';

export interface LeadServiceConfig {
  leadsTableName: string;
  region: string;
  ipqsApiKey: string;
  ipqsBaseUrl: string;
  trustedFormUsername: string;
  trustedFormPassword: string;
}

@injectable()
export class LeadService {
  private dynamoDb: DynamoDbUtil;
  private ipqsUtil: IpqsUtil;
  private trustedFormsUtil: TrustedFormsUtil;

  constructor() {
    const config = this.loadConfig();
    
    this.dynamoDb = new DynamoDbUtil(config.leadsTableName, config.region);
    
    this.ipqsUtil = new IpqsUtil({
      apiKey: config.ipqsApiKey,
      baseUrl: config.ipqsBaseUrl,
    });
    
    this.trustedFormsUtil = new TrustedFormsUtil({
      username: config.trustedFormUsername,
      password: config.trustedFormPassword,
    });
  }

  private loadConfig(): LeadServiceConfig {
    return {
      leadsTableName: process.env.LEADS_TABLE_NAME || '',
      region: process.env.AWS_REGION || 'us-east-1',
      ipqsApiKey: process.env.IPQS_API_KEY || '',
      ipqsBaseUrl: process.env.IPQS_BASE_URL || 'https://ipqualityscore.com/api/json',
      trustedFormUsername: process.env.TRUSTEDFORM_USERNAME || 'API',
      trustedFormPassword: process.env.TRUSTEDFORM_PASSWORD || '',
    };
  }

  /**
   * Create a new lead record
   */
  async createLead(payload: LeadPayload): Promise<LeadRecord> {
    try {
      // Extract required fields
      const email = payload.email || payload.body?.email;
      const phone = payload.phone || payload.body?.phone;
      const ipAddress = payload.ip_address || payload.body?.ip_address;
      const trustedFormCertId = payload.trusted_form_cert_id || payload.body?.trusted_form_cert_id;

      if (!email || !phone || !ipAddress) {
        throw new Error('Missing required fields: email, phone, or ip_address');
      }

      // Check for duplicate phone number
      const phoneResults = await this.dynamoDb.queryByGsi('phone-index', 'phone', phone);
      if (phoneResults && phoneResults.length > 0) {
        throw new Error(`Duplicate lead found with phone number: ${phone}`);
      }

      // Check for duplicate email
      const emailResults = await this.dynamoDb.queryByGsi('email-index', 'email', email);
      if (emailResults && emailResults.length > 0) {
        throw new Error(`Duplicate lead found with email: ${email}`);
      }

      // Run validations - catch errors to ensure lead is still saved
      let ipqsResult: IpqsValidationResult | null = null;
      let trustedFormResult: TrustedFormResponse | null = null;
      let trustedFormError: string | null = null;
      let ipqsError: string | null = null;
      
      // Run validations in parallel with error handling
      try {
        const results = await Promise.allSettled([
          this.ipqsUtil.validateAll(ipAddress, phone, email),
          this.trustedFormsUtil.validate(trustedFormCertId, phone)
        ]);
        
        // Process IPQS result
        if (results[0].status === 'fulfilled') {
          ipqsResult = results[0].value;
        } else {
          ipqsError = results[0].reason?.message || 'IPQS validation error';
          console.error('IPQS validation error:', results[0].reason);
        }
        
        // Process TrustedForm result
        if (results[1].status === 'fulfilled') {
          trustedFormResult = results[1].value;
        } else {
          trustedFormError = results[1].reason?.message || 'TrustedForm validation error';
          console.error('TrustedForm validation error:', results[1].reason);
        }
      } catch (error: any) {
        console.error('Unexpected error during validation:', error);
      }
      
      // Create lead record with whatever validation results we have
      const leadRecord = this.buildLeadRecord(
        payload, 
        ipqsResult || this.getDefaultIpqsResult(), 
        trustedFormResult || this.getDefaultTrustedFormResult(),
        trustedFormError
      );

      // ALWAYS save to DynamoDB regardless of validation results
      await this.dynamoDb.put(leadRecord);

      // Now check if validations failed and throw error AFTER saving
      if (trustedFormError) {
        const error: any = new Error(trustedFormError);
        error.validationType = 'trustedform';
        error.details = {
          error: trustedFormError,
          certId: trustedFormCertId,
        };
        throw error;
      }

      if (trustedFormResult && !this.trustedFormsUtil.isValidationSuccessful(trustedFormResult)) {
        const error: any = new Error('TrustedForm validation failed');
        error.validationType = 'trustedform';
        error.details = {
          outcome: trustedFormResult.outcome,
          reason: trustedFormResult.reason,
        };
        throw error;
      }

      // Check if IPQS validation failed
      if (ipqsResult && !ipqsResult.validated) {
        const failedChecks: string[] = [];
        const details: any = {};

        if (!ipqsResult.ip.valid) {
          failedChecks.push('IP');
          details.ip = ipqsResult.ip.reasons;
        }
        if (!ipqsResult.phone.valid) {
          failedChecks.push('phone');
          details.phone = ipqsResult.phone.reasons;
        }
        if (!ipqsResult.email.valid) {
          failedChecks.push('email');
          details.email = ipqsResult.email.reasons;
        }

        const error: any = new Error(`IPQS validation failed: ${failedChecks.join(', ')}`);
        error.validationType = 'ipqs';
        error.details = details;
        throw error;
      }
      
      // Lead passed all validations
      return leadRecord;
    } catch (error: any) {
      console.error('Error creating lead:', error);
      // Re-throw with validation details intact
      throw error;
    }
  }

  /**
   * Get default IPQS result for when validation fails
   */
  private getDefaultIpqsResult(): IpqsValidationResult {
    return {
      validated: false,
      ip: { valid: false, reasons: 'Validation failed', data: {} },
      phone: { valid: false, reasons: 'Validation failed', data: {} },
      email: { valid: false, reasons: 'Validation failed', data: {} },
    };
  }

  /**
   * Get default TrustedForm result for when validation fails
   */
  private getDefaultTrustedFormResult(): TrustedFormResponse {
    return {
      outcome: 'failed',
      reason: 'Validation error occurred',
    };
  }

  /**
   * Get all leads
   */
  async getAllLeads(): Promise<LeadRecord[]> {
    try {
      const leads = await this.dynamoDb.scan();
      // Sort by timestamp with newest at bottom (ascending order)
      return (leads as LeadRecord[]).sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeA - timeB;
      });
    } catch (error: any) {
      console.error('Error getting leads:', error);
      throw new Error(`Failed to get leads: ${error.message}`);
    }
  }

  /**
   * Build a lead record from payload and validation results
   */
  private buildLeadRecord(
    payload: LeadPayload,
    ipqsResult: IpqsValidationResult,
    trustedFormResult: TrustedFormResponse,
    trustedFormError?: string | null
  ): LeadRecord {
    const now = new Date();
    const timestamp = now.toISOString();
    
    // Generate UUID v4 for leadId
    const id = uuidv4();

    const bodyData = payload.body || payload;

    return {
      // Core identification
      id,
      timestamp,
      created_at: timestamp,
      
      // Lead data
      date: bodyData.date || now.toISOString().split('T')[0],
      time: bodyData.time || now.toISOString().split('T')[1].split('.')[0],
      marketing_source: bodyData.marketing_source,
      first_name: bodyData.first_name,
      last_name: bodyData.last_name,
      phone: bodyData.phone,
      email: bodyData.email,
      state: bodyData.state,
      message: bodyData.message,
      
      // Rideshare specific
      rideshare_abuse: bodyData.rideshare_abuse,
      rideshare_company: bodyData.rideshare_company,
      abuse_state: bodyData.abuse_state,
      gender: bodyData.gender,
      assault_type: bodyData.assault_type,
      has_ride_receipt: bodyData.has_ride_receipt,
      has_attorney: bodyData.has_attorney,
      
      // Marketing
      test: bodyData.test,
      utm_campaign: bodyData.utm_campaign,
      utm_source: bodyData.utm_source,
      utm_medium: bodyData.utm_medium,
      utm_content: bodyData.utm_content,
      utm_term: bodyData.utm_term,
      pub_id: bodyData.pub_id || bodyData.sub_id,
      
      // Technical
      ip_address: bodyData.ip_address,
      page_url: bodyData.page_url,
      referrer_url: bodyData.referrer_url,
      trusted_form_cert_id: bodyData.trusted_form_cert_id,
      
      // Campaign
      order_number: bodyData.order_number,
      campaign_id: bodyData.campaign_id,
      campaign_key: bodyData.campaign_key,
      consent: bodyData.consent,
      
      // Validation results
      passed_tf_check: this.trustedFormsUtil.isValidationSuccessful(trustedFormResult),
      passed_phone_check: ipqsResult.phone.valid,
      passed_email_check: ipqsResult.email.valid,
      passed_ip_check: ipqsResult.ip.valid,
      
      // TrustedForm response
      trustedform_response: {
        cert_id: bodyData.trusted_form_cert_id,
        outcome: trustedFormError ? 'error' : trustedFormResult.outcome,
        reason: trustedFormError ? trustedFormError : trustedFormResult.reason,
        validated: trustedFormError ? false : this.trustedFormsUtil.isValidationSuccessful(trustedFormResult),
        raw_response: trustedFormError ? null : trustedFormResult,
        error: trustedFormError || null,
      },
      
      // IPQS response
      ipqs_response: {
        phone: ipqsResult.phone.data,
        email: ipqsResult.email.data,
        ip: ipqsResult.ip.data,
        validated: ipqsResult.validated,
        results: {
          phone: {
            valid: ipqsResult.phone.valid,
            reasons: ipqsResult.phone.reasons,
          },
          email: {
            valid: ipqsResult.email.valid,
            reasons: ipqsResult.email.reasons,
          },
          ip: {
            valid: ipqsResult.ip.valid,
            reasons: ipqsResult.ip.reasons,
          },
        },
      },
      
      // Sales fields
      sellable: ipqsResult.validated && this.trustedFormsUtil.isValidationSuccessful(trustedFormResult),
      sold: false,
      cherry_picked: false,
      
      // Include any other fields from the original payload
      ...Object.keys(bodyData).reduce((acc, key) => {
        if (!acc[key]) {
          acc[key] = bodyData[key];
        }
        return acc;
      }, {} as any),
    };
  }
}
