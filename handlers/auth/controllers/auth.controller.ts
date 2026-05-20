import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  POST,
  body,
  produces,
  Controller,
  response,
} from "ts-lambda-api";
import { AuthService } from "../services/auth.service";
import { LoginRequest, RefreshRequest } from "../types/auth-request.types";
import { RestApiResponse } from "../types/common.types";
import { mapServiceErrorToHttpStatus, withCorrelationId } from "@shared/utils";

@injectable()
@apiController("/auth")
export class AuthController extends Controller {
  constructor(
    @inject("AuthService") private readonly authService: AuthService,
  ) {
    super();
  }

  private withCorrelation<T extends RestApiResponse>(response: T): T {
    return withCorrelationId(
      response,
      this.request.headers as Record<string, string | string[] | undefined>,
    ) as T;
  }

  private fail(
    message: string,
    error?: string,
    fallbackStatus = 401,
  ): RestApiResponse {
    const mappedStatus = mapServiceErrorToHttpStatus(error, fallbackStatus);
    this.response.status(mappedStatus === 400 ? fallbackStatus : mappedStatus);
    return this.withCorrelation({
      success: false,
      message,
      error,
    });
  }

  /**
   * POST /v2/auth/login
   * Exchange email + password for Cognito tokens.
   * Returns access_token (use as Bearer for internal API calls) and id_token.
   */
  @POST("/login")
  @produces("application/json")
  async login(@body payload: LoginRequest): Promise<RestApiResponse> {
    const result = await this.authService.login(payload);

    if (!result.result) {
      return this.fail("Authentication failed", result.error, 401);
    }

    return this.withCorrelation({
      success: true,
      message: "Login successful",
      data: result.data,
    });
  }

  /**
   * POST /v2/auth/refresh
   * Exchange a refresh_token for new access/id tokens.
   */
  @POST("/refresh")
  @produces("application/json")
  async refresh(@body payload: RefreshRequest): Promise<RestApiResponse> {
    const result = await this.authService.refresh(payload);

    if (!result.result) {
      return this.fail("Token refresh failed", result.error, 401);
    }

    return this.withCorrelation({
      success: true,
      message: "Token refreshed",
      data: result.data,
    });
  }
}
