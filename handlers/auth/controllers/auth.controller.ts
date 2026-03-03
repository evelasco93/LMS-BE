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

@injectable()
@apiController("/auth")
export class AuthController extends Controller {
  constructor(
    @inject("AuthService") private readonly authService: AuthService,
  ) {
    super();
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
      this.response.status(401);
      return {
        success: false,
        message: "Authentication failed",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Login successful",
      data: result.data,
    };
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
      this.response.status(401);
      return {
        success: false,
        message: "Token refresh failed",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Token refreshed",
      data: result.data,
    };
  }
}
