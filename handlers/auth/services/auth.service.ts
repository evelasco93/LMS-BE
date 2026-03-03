import { injectable, inject } from "inversify";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType,
  NotAuthorizedException,
  UserNotFoundException,
  PasswordResetRequiredException,
  UserNotConfirmedException,
} from "@aws-sdk/client-cognito-identity-provider";
import { AuthConstants } from "../constants/auth.constants";
import {
  LoginRequest,
  LoginResponse,
  RefreshRequest,
} from "../types/auth-request.types";
import { ServiceResult } from "../types/common.types";

@injectable()
export class AuthService {
  private readonly cognitoClient: CognitoIdentityProviderClient;

  constructor(
    @inject("AuthConstants") private readonly constants: AuthConstants,
  ) {
    this.cognitoClient = new CognitoIdentityProviderClient({
      region: this.constants.REGION,
    });
  }

  async login(request: LoginRequest): Promise<ServiceResult<LoginResponse>> {
    const { email, password } = request;

    if (!email || !password) {
      return { result: false, error: "email and password are required" };
    }

    try {
      const command = new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: this.constants.COGNITO_CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      });

      const response = await this.cognitoClient.send(command);

      if (!response.AuthenticationResult) {
        return {
          result: false,
          error: "Authentication failed - no token returned",
        };
      }

      const { AccessToken, IdToken, RefreshToken, ExpiresIn, TokenType } =
        response.AuthenticationResult;

      if (!AccessToken || !IdToken || !RefreshToken) {
        return {
          result: false,
          error: "Authentication failed - incomplete token set",
        };
      }

      return {
        result: true,
        data: {
          access_token: AccessToken,
          id_token: IdToken,
          refresh_token: RefreshToken,
          expires_in: ExpiresIn ?? 3600,
          token_type: TokenType ?? "Bearer",
        },
      };
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof UserNotFoundException
      ) {
        return { result: false, error: "Invalid email or password" };
      }

      if (error instanceof PasswordResetRequiredException) {
        return { result: false, error: "Password reset required" };
      }

      if (error instanceof UserNotConfirmedException) {
        return { result: false, error: "User account is not confirmed" };
      }

      const message = error instanceof Error ? error.message : "Login failed";
      return { result: false, error: message };
    }
  }

  async refresh(
    request: RefreshRequest,
  ): Promise<ServiceResult<Omit<LoginResponse, "refresh_token">>> {
    const { refresh_token } = request;

    if (!refresh_token) {
      return { result: false, error: "refresh_token is required" };
    }

    try {
      const command = new InitiateAuthCommand({
        AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
        ClientId: this.constants.COGNITO_CLIENT_ID,
        AuthParameters: {
          REFRESH_TOKEN: refresh_token,
        },
      });

      const response = await this.cognitoClient.send(command);

      if (!response.AuthenticationResult) {
        return { result: false, error: "Token refresh failed" };
      }

      const { AccessToken, IdToken, ExpiresIn, TokenType } =
        response.AuthenticationResult;

      if (!AccessToken || !IdToken) {
        return {
          result: false,
          error: "Token refresh failed - incomplete response",
        };
      }

      return {
        result: true,
        data: {
          access_token: AccessToken,
          id_token: IdToken,
          expires_in: ExpiresIn ?? 3600,
          token_type: TokenType ?? "Bearer",
        },
      };
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return { result: false, error: "Invalid or expired refresh token" };
      }

      const message =
        error instanceof Error ? error.message : "Token refresh failed";
      return { result: false, error: message };
    }
  }
}
