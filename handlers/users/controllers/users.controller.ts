import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  POST,
  PUT,
  DELETE,
  body,
  pathParam,
  produces,
  Controller,
} from "ts-lambda-api";
import { UsersService } from "../services/users.service";
import {
  CreateUserRequest,
  ResetPasswordRequest,
  UpdateUserRequest,
} from "../types/users-request.types";
import { RestApiResponse } from "../types/common.types";
import { isAdmin } from "../guards/admin.guard";

@injectable()
@apiController("/users")
export class UsersController extends Controller {
  constructor(
    @inject("UsersService") private readonly usersService: UsersService,
  ) {
    super();
  }

  /**
   * Reads the Authorization header and returns false (setting 403) if the
   * caller is not in the Cognito "admin" group. The token has already been
   * validated by the API Gateway Cognito authorizer — we only decode the
   * payload to read the group claim.
   */
  private guardAdmin(): boolean {
    const authHeader =
      (this.request.headers as Record<string, string | undefined>)[
        "authorization"
      ] ??
      (this.request.headers as Record<string, string | undefined>)[
        "Authorization"
      ];

    if (!isAdmin(authHeader)) {
      this.response.status(403);
      return false;
    }
    return true;
  }

  /**
   * POST /v2/users
   * Create a new user in Cognito and assign them a role (admin | staff).
   * Admin only.
   */
  @POST("/")
  @produces("application/json")
  async createUser(@body payload: CreateUserRequest): Promise<RestApiResponse> {
    if (!this.guardAdmin()) {
      return {
        success: false,
        message: "Forbidden",
        error: "Admin access required",
      };
    }

    const result = await this.usersService.createUser(payload);

    if (!result.result) {
      this.response.status(400);
      return {
        success: false,
        message: "Failed to create user",
        error: result.error,
      };
    }

    this.response.status(201);
    return { success: true, message: "User created", data: result.data };
  }

  /**
   * GET /v2/users
   * List all users in the Cognito User Pool.
   * Admin only.
   */
  @GET("/")
  @produces("application/json")
  async listUsers(): Promise<RestApiResponse> {
    if (!this.guardAdmin()) {
      return {
        success: false,
        message: "Forbidden",
        error: "Admin access required",
      };
    }

    const result = await this.usersService.listUsers();

    if (!result.result) {
      this.response.status(500);
      return {
        success: false,
        message: "Failed to list users",
        error: result.error,
      };
    }

    return { success: true, message: "Users retrieved", data: result.data };
  }

  /**
   * GET /v2/users/:id
   * Get a single user by username (URL-encoded email).
   * Admin only.
   */
  @GET("/:id")
  @produces("application/json")
  async getUser(@pathParam("id") id: string): Promise<RestApiResponse> {
    if (!this.guardAdmin()) {
      return {
        success: false,
        message: "Forbidden",
        error: "Admin access required",
      };
    }

    const result = await this.usersService.getUser(decodeURIComponent(id));

    if (!result.result) {
      this.response.status(result.error === "User not found" ? 404 : 500);
      return {
        success: false,
        message: result.error ?? "Not found",
        error: result.error,
      };
    }

    return { success: true, message: "User retrieved", data: result.data };
  }

  /**
   * PUT /v2/users/:id
   * Update a user's role.
   * Body: { role: "admin" | "staff" }
   * Admin only.
   */
  @PUT("/:id")
  @produces("application/json")
  async updateUserRole(
    @pathParam("id") id: string,
    @body payload: UpdateUserRequest,
  ): Promise<RestApiResponse> {
    if (!this.guardAdmin()) {
      return {
        success: false,
        message: "Forbidden",
        error: "Admin access required",
      };
    }

    const result = await this.usersService.updateUserRole(
      decodeURIComponent(id),
      payload,
    );

    if (!result.result) {
      this.response.status(result.error === "User not found" ? 404 : 400);
      return {
        success: false,
        message: "Failed to update user",
        error: result.error,
      };
    }

    return { success: true, message: "User updated", data: result.data };
  }

  /**
   * PUT /v2/users/:id/password
   * Reset (or update) a user's password to a new permanent value.
   * Body: { password: "NewPass1!" }
   * Admin only.
   */
  @PUT("/:id/password")
  @produces("application/json")
  async resetPassword(
    @pathParam("id") id: string,
    @body payload: ResetPasswordRequest,
  ): Promise<RestApiResponse> {
    if (!this.guardAdmin()) {
      return {
        success: false,
        message: "Forbidden",
        error: "Admin access required",
      };
    }

    const result = await this.usersService.resetPassword(
      decodeURIComponent(id),
      payload,
    );

    if (!result.result) {
      this.response.status(result.error === "User not found" ? 404 : 400);
      return {
        success: false,
        message: "Failed to reset password",
        error: result.error,
      };
    }

    return { success: true, message: "Password updated" };
  }

  /**
   * DELETE /v2/users/:id
   * Permanently delete a user from Cognito.
   * Admin only.
   */
  @DELETE("/:id")
  @produces("application/json")
  async deleteUser(@pathParam("id") id: string): Promise<RestApiResponse> {
    if (!this.guardAdmin()) {
      return {
        success: false,
        message: "Forbidden",
        error: "Admin access required",
      };
    }

    const result = await this.usersService.deleteUser(decodeURIComponent(id));

    if (!result.result) {
      this.response.status(result.error === "User not found" ? 404 : 500);
      return {
        success: false,
        message: result.error ?? "Failed to delete user",
        error: result.error,
      };
    }

    this.response.status(200);
    return { success: true, message: "User deleted" };
  }
}
