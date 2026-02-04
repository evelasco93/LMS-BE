import axios, { AxiosInstance } from 'axios';

export interface TrustedFormConfig {
  username: string;
  password: string;
}

export interface TrustedFormRequest {
  match_lead: {
    phone: string;
  };
}

export interface TrustedFormResponse {
  reason: string;
  outcome: string;
}

export class TrustedFormsUtil {
  private client: AxiosInstance;
  private baseUrl: string = 'https://cert.trustedform.com';

  constructor(config: TrustedFormConfig) {
    // Create Basic Auth header manually
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    
    this.client = axios.create({
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
    });
  }


  /**
   * Validate a TrustedForm certificate
   * @param certId - The TrustedForm certificate ID
   * @param phone - The phone number to match
   */
  async validate(certId: string, phone: string): Promise<TrustedFormResponse> {
    const url = `${this.baseUrl}/${certId}/validate`;
    const body: TrustedFormRequest = {
      match_lead: {
        phone,
      },
    };

    try {
      const response = await this.client.get(url, { params: body });
      return response.data;
    } catch (error: any) {
      console.error('TrustedForm validation error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers,
        url: url,
      });
      
      // Check if TrustedForm returned a JSON error response
      if (error.response?.data) {
        // Try to parse the response data if it's a string
        let tfResponse = error.response.data;
        if (typeof tfResponse === 'string') {
          try {
            tfResponse = JSON.parse(tfResponse);
          } catch (e) {
            // If parsing fails, keep as string
          }
        }
        
        // If it has reason and outcome, it's a valid TrustedForm error response
        if (tfResponse.reason && tfResponse.outcome) {
          return tfResponse as TrustedFormResponse;
        }
      }
      
      // If we couldn't parse TrustedForm response, throw the error to be caught upstream
      const status = error.response?.status;
      let errorMessage = '';
      
      if (status === 404) {
        errorMessage = `TrustedForm certificate not found. The certificate ID '${certId}' is invalid, malformed, or does not exist.`;
      } else if (status === 401) {
        errorMessage = 'TrustedForm authentication failed. Invalid API credentials.';
      } else if (status === 403) {
        errorMessage = 'TrustedForm access forbidden. Check API permissions.';
      } else if (status === 400) {
        errorMessage = 'TrustedForm bad request. Invalid request parameters or malformed certificate ID.';
      } else if (status >= 500) {
        errorMessage = 'TrustedForm service error. The TrustedForm API is currently unavailable.';
      } else {
        errorMessage = `TrustedForm validation failed: ${error.response?.status} - ${error.message}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Check if validation was successful
   */
  isValidationSuccessful(response: TrustedFormResponse): boolean {
    return response.outcome === 'success';;
  }
}
