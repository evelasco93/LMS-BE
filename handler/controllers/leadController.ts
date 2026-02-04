import 'reflect-metadata';
import { injectable, inject } from 'inversify';
import { apiController, GET, POST, body, produces, Controller } from 'ts-lambda-api';
import { LeadService } from '../services/leadService';
import { LeadPayload } from '../types';

export interface RestApiResponse {
  success: boolean;
  message: string;
  data?: any;
  count?: number;
  error?: string;
}

@injectable()
@apiController('/smashorbit/prototype/lead')
export class LeadController extends Controller{
  constructor(@inject('LeadService') private readonly leadService: LeadService) {
    super()
  }

  /**
   * Create a new lead
   */
  @POST('/')
  @produces("application/json")
  async createLead(@body payload: LeadPayload): Promise<any> {
    try {
      
      await this.leadService.createLead(payload);
      
      return {
        result: true,
        message: 'lead accepted',
      };
    } catch (error: any) {
      console.error('Error in createLead:', error);
      
      // Check if error is a duplicate
      if (error.message && error.message.includes('Duplicate lead found')) {
        return {
          result: false,
          message: 'duplicate lead rejected',
        };
      }
      
      // Check if error is TrustedForm validation failure
      if (error.validationType === 'trustedform') {
        return {
          result: false,
          message: 'TrustedForm validation failed',
          details: error.details,
        };
      }
      
      // Check if error is IPQS validation failure
      if (error.validationType === 'ipqs') {
        return {
          result: false,
          message: 'IPQS validation failed',
          details: error.details,
        };
      }
      
      return {
        result: false,
        message: 'lead rejected',
        error: error.message,
      };
    }
  }

  /**
   * Get all leads
   */
  @GET('/')
  @produces("application/json")
  async getAllLeads(): Promise<RestApiResponse> {
    try {
      
      const leads = await this.leadService.getAllLeads();
      
      return {
        success: true,
        message: 'Leads retrieved successfully',
        count: leads.length,
        data: leads,
      };
    } catch (error: any) {
      console.error('Error in getAllLeads:', error);
      return {
        success: false,
        message: 'Failed to retrieve leads',
        error: error.message,
      };
    }
  }
}
