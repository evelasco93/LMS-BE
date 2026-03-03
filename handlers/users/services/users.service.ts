import { injectable, inject } from "inversify";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  UsernameExistsException,
  UserNotFoundException as CognitoUserNotFoundException,
  MessageActionType,
} from "@aws-sdk/client-cognito-identity-provider";
import { UsersConstants } from "../constants/users.constants";
import {
  CognitoUser,
  CreateUserRequest,
  ResetPasswordRequest,
  UpdateUserRequest,
  UserRole,
} from "../types/users-request.types";
import { ServiceResult } from "../types/common.types";

const KNOWN_ROLES: UserRole[] = ["admin", "staff"];

@injectable()
export class UsersService {
  private readonly cognitoClient: CognitoIdentityProviderClient;

  constructor(
    @inject("UsersConstants") private readonly constants: UsersConstants,
  ) {
    this.cognitoClient = new CognitoIdentityProviderClient({
      region: this.constants.REGION,
    });
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async createUser(
    request: CreateUserRequest,
  ): Promise<ServiceResult<CognitoUser>> {
    const { email, password, role = "staff" } = request;

    if (!email || !password) {
      return { result: false, error: "email and password are required" };
    }

    if (!KNOWN_ROLES.includes(role)) {
      return {
        result: false,
        error: `role must be one of: ${KNOWN_ROLES.join(", ")}`,
      };
    }

    try {
      // Create user, suppress the temporary-password welcome email
      await this.cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: this.constants.COGNITO_USER_POOL_ID,
          Username: email,
          MessageAction: MessageActionType.SUPPRESS,
          UserAttributes: [
            { Name: "email", Value: email },
            { Name: "email_verified", Value: "true" },
          ],
        }),
      );

      // Immediately set a permanent password so the user doesn't land in
      // FORCE_CHANGE_PASSWORD status
      await this.cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.constants.COGNITO_USER_POOL_ID,
          Username: email,
          Password: password,
          Permanent: true,
        }),
      );

      // Assign to role group
      await this.cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: this.constants.COGNITO_USER_POOL_ID,
          Username: email,
          GroupName: role,
        }),
      );

      return {
        result: true,
        data: {
          username: email,
          email,
          status: "CONFIRMED",
          enabled: true,
          role,
        },
      };
    } catch (error) {
      if (error instanceof UsernameExistsException) {
        return {
          result: false,
          error: "A user with that email already exists",
        };
      }
      const message =
        error instanceof Error ? error.message : "Failed to create user";
      return { result: false, error: message };
    }
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async listUsers(): Promise<ServiceResult<CognitoUser[]>> {
    try {
      const response = await this.cognitoClient.send(
        new ListUsersCommand({
          UserPoolId: this.constants.COGNITO_USER_POOL_ID,
        }),
      );

      const users = await Promise.all(
        (response.Users ?? []).map(async (u) => {
          const email =
            u.Attributes?.find((a) => a.Name === "email")?.Value ??
            u.Username ??
            "";

          let role: UserRole | null = null;
          try {
            const groupsResp = await this.cognitoClient.send(
              new AdminListGroupsForUserCommand({
                UserPoolId: this.constants.COGNITO_USER_POOL_ID,
                Username: u.Username!,
              }),
            );
            const names = groupsResp.Groups?.map((g) => g.GroupName) ?? [];
            if (names.includes("admin")) role = "admin";
            else if (names.includes("staff")) role = "staff";
          } catch {
            // Non-fatal — return user without role
          }

          return {
            username: u.Username ?? "",
            email,
            status: u.UserStatus ?? "UNKNOWN",
            enabled: u.Enabled ?? true,
            role,
            createdAt: u.UserCreateDate,
            updatedAt: u.UserLastModifiedDate,
          } as CognitoUser;
        }),
      );

      return { result: true, data: users };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to list users";
      return { result: false, error: message };
    }
  }

  // ─── Get ──────────────────────────────────────────────────────────────────

  async getUser(username: string): Promise<ServiceResult<CognitoUser>> {
    try {
      const [userResp, groupsResp] = await Promise.all([
        this.cognitoClient.send(
          new AdminGetUserCommand({
            UserPoolId: this.constants.COGNITO_USER_POOL_ID,
            Username: username,
          }),
        ),
        this.cognitoClient.send(
          new AdminListGroupsForUserCommand({
            UserPoolId: this.constants.COGNITO_USER_POOL_ID,
            Username: username,
          }),
        ),
      ]);

      const names = groupsResp.Groups?.map((g) => g.GroupName) ?? [];
      let role: UserRole | null = null;
      if (names.includes("admin")) role = "admin";
      else if (names.includes("staff")) role = "staff";

      const email =
        userResp.UserAttributes?.find((a) => a.Name === "email")?.Value ??
        username;

      return {
        result: true,
        data: {
          username: userResp.Username ?? username,
          email,
          status: userResp.UserStatus ?? "UNKNOWN",
          enabled: userResp.Enabled ?? true,
          role,
          createdAt: userResp.UserCreateDate,
          updatedAt: userResp.UserLastModifiedDate,
        },
      };
    } catch (error) {
      if (error instanceof CognitoUserNotFoundException) {
        return { result: false, error: "User not found" };
      }
      const message =
        error instanceof Error ? error.message : "Failed to get user";
      return { result: false, error: message };
    }
  }

  // ─── Update role ──────────────────────────────────────────────────────────

  async updateUserRole(
    username: string,
    request: UpdateUserRequest,
  ): Promise<ServiceResult<CognitoUser>> {
    const { role } = request;

    if (!KNOWN_ROLES.includes(role)) {
      return {
        result: false,
        error: `role must be one of: ${KNOWN_ROLES.join(", ")}`,
      };
    }

    try {
      // Get current groups
      const groupsResp = await this.cognitoClient.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: this.constants.COGNITO_USER_POOL_ID,
          Username: username,
        }),
      );

      // Remove from all known role groups
      await Promise.all(
        (groupsResp.Groups ?? [])
          .filter((g) => KNOWN_ROLES.includes(g.GroupName as UserRole))
          .map((g) =>
            this.cognitoClient.send(
              new AdminRemoveUserFromGroupCommand({
                UserPoolId: this.constants.COGNITO_USER_POOL_ID,
                Username: username,
                GroupName: g.GroupName!,
              }),
            ),
          ),
      );

      // Add to new role group
      await this.cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: this.constants.COGNITO_USER_POOL_ID,
          Username: username,
          GroupName: role,
        }),
      );

      return this.getUser(username);
    } catch (error) {
      if (error instanceof CognitoUserNotFoundException) {
        return { result: false, error: "User not found" };
      }
      const message =
        error instanceof Error ? error.message : "Failed to update user role";
      return { result: false, error: message };
    }
  }

  // ─── Reset password ───────────────────────────────────────────────────────

  async resetPassword(
    username: string,
    request: ResetPasswordRequest,
  ): Promise<ServiceResult> {
    const { password } = request;

    if (!password) {
      return { result: false, error: "password is required" };
    }

    try {
      await this.cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.constants.COGNITO_USER_POOL_ID,
          Username: username,
          Password: password,
          Permanent: true,
        }),
      );
      return { result: true };
    } catch (error) {
      if (error instanceof CognitoUserNotFoundException) {
        return { result: false, error: "User not found" };
      }
      const message =
        error instanceof Error ? error.message : "Failed to reset password";
      return { result: false, error: message };
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async deleteUser(username: string): Promise<ServiceResult> {
    try {
      await this.cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.constants.COGNITO_USER_POOL_ID,
          Username: username,
        }),
      );
      return { result: true };
    } catch (error) {
      if (error instanceof CognitoUserNotFoundException) {
        return { result: false, error: "User not found" };
      }
      const message =
        error instanceof Error ? error.message : "Failed to delete user";
      return { result: false, error: message };
    }
  }
}
