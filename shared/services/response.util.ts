/**
 * Common response builder for API responses
 */

export interface ApiResponse<T = any> {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export class ResponseBuilder {
  private static readonly DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
  };

  static success<T = any>(data: T, statusCode: number = 200): ApiResponse<T> {
    return {
      statusCode,
      headers: this.DEFAULT_HEADERS,
      body: JSON.stringify(data),
    };
  }

  static created<T = any>(data: T): ApiResponse<T> {
    return this.success(data, 201);
  }

  static noContent(): ApiResponse {
    return {
      statusCode: 204,
      headers: this.DEFAULT_HEADERS,
      body: '',
    };
  }

  static error(
    message: string,
    statusCode: number = 500,
    details?: any
  ): ApiResponse {
    return {
      statusCode,
      headers: this.DEFAULT_HEADERS,
      body: JSON.stringify({
        error: message,
        ...(details && { details }),
      }),
    };
  }

  static badRequest(message: string, details?: any): ApiResponse {
    return this.error(message, 400, details);
  }

  static unauthorized(message: string = 'Unauthorized'): ApiResponse {
    return this.error(message, 401);
  }

  static forbidden(message: string = 'Forbidden'): ApiResponse {
    return this.error(message, 403);
  }

  static notFound(message: string = 'Resource not found'): ApiResponse {
    return this.error(message, 404);
  }

  static conflict(message: string, details?: any): ApiResponse {
    return this.error(message, 409, details);
  }

  static internalError(message: string = 'Internal server error'): ApiResponse {
    return this.error(message, 500);
  }
}
