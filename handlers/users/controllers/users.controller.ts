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
  queryParam,
  Controller,
} from "ts-lambda-api";
import { UsersService } from "../services/users.service";
import {
  CreateUserRequest,
  ResetPasswordRequest,
  UpdateUserRequest,
} from "../types/users-request.types";
import { UpsertTablePreferenceRequest } from "../interfaces/IUserTablePreference.interface";
import { RestApiResponse } from "../types/common.types";
import { isAdmin } from "../guards/admin.guard";
import { extractRequestActorFromHeaders } from "@shared/utils/request-audit.util";

@injectable()
@apiController("/users")
export class UsersController extends Controller {
  constructor(
    @inject("UsersService") private readonly usersService: UsersService,
  ) {
    super();
  }

  private getActor() {
    return extractRequestActorFromHeaders(
      this.request.headers as Record<string, string | string[] | undefined>,
    );
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

    const result = await this.usersService.createUser(payload, this.getActor());

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
      this.getActor(),
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
      this.getActor(),
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
   * PUT /v2/users/:id/enable
   * Re-enable a previously disabled (soft-deleted) Cognito user.
   * Admin only.
   */
  @PUT("/:id/enable")
  @produces("application/json")
  async enableUser(@pathParam("id") id: string): Promise<RestApiResponse> {
    if (!this.guardAdmin()) {
      return {
        success: false,
        message: "Forbidden",
        error: "Admin access required",
      };
    }

    const result = await this.usersService.enableUser(
      decodeURIComponent(id),
      this.getActor(),
    );

    if (!result.result) {
      this.response.status(result.error === "User not found" ? 404 : 500);
      return {
        success: false,
        message: result.error ?? "Failed to enable user",
        error: result.error,
      };
    }

    return { success: true, message: "User enabled", data: result.data };
  }

  /**
   * DELETE /v2/users/:id
   * Soft-delete (disable) a user from Cognito by default.
   * Pass ?permanent=true to permanently remove the account.
   * Admin only.
   */
  @DELETE("/:id")
  @produces("application/json")
  async deleteUser(
    @pathParam("id") id: string,
    @queryParam("permanent") permanent?: string,
  ): Promise<RestApiResponse> {
    if (!this.guardAdmin()) {
      return {
        success: false,
        message: "Forbidden",
        error: "Admin access required",
      };
    }

    const result = await this.usersService.deleteUser(
      decodeURIComponent(id),
      {
        permanent: permanent === "true" || permanent === "1",
      },
      this.getActor(),
    );

    if (!result.result) {
      this.response.status(result.error === "User not found" ? 404 : 500);
      return {
        success: false,
        message: result.error ?? "Failed to delete user",
        error: result.error,
      };
    }

    this.response.status(200);
    return {
      success: true,
      message:
        permanent === "true" || permanent === "1"
          ? "User permanently deleted"
          : "User disabled successfully",
    };
  }

  // ── Table Preferences ───────────────────────────────────────────

  /**
   * GET /preferences/:tableId
   * Get the calling user's UI configuration for a specific table.
   * The user identity is taken from the JWT `sub` claim — no separate :id param.
   */
  @GET("/preferences/:tableId")
  @produces("application/json")
  async getTablePreference(
    @pathParam("tableId") tableId: string,
  ): Promise<RestApiResponse> {
    const actor = this.getActor();
    if (!actor?.sub) {
      this.response.status(401);
      return { success: false, message: "Unauthorized" };
    }
    const result = await this.usersService.getTablePreference(
      actor.sub,
      tableId,
    );
    if (!result.result) {
      this.response.status(404);
      return {
        success: false,
        message: result.error ?? "Preference not found",
      };
    }
    return {
      success: true,
      message: "Preference retrieved",
      data: result.data,
    };
  }

  /**
   * PUT /preferences/:tableId
   * Create or replace the calling user's UI configuration for a specific table.
   */
  @PUT("/preferences/:tableId")
  @produces("application/json")
  async upsertTablePreference(
    @pathParam("tableId") tableId: string,
    @body payload: UpsertTablePreferenceRequest,
  ): Promise<RestApiResponse> {
    const actor = this.getActor();
    if (!actor?.sub) {
      this.response.status(401);
      return { success: false, message: "Unauthorized" };
    }
    const result = await this.usersService.upsertTablePreference(
      actor.sub,
      tableId,
      payload,
      actor,
    );
    if (!result.result) {
      this.response.status(400);
      return {
        success: false,
        message: result.error ?? "Failed to save preference",
      };
    }
    return { success: true, message: "Preference saved", data: result.data };
  }

  /**
   * DELETE /preferences/:tableId
   * Delete the calling user's UI configuration for a specific table.
   */
  @DELETE("/preferences/:tableId")
  @produces("application/json")
  async deleteTablePreference(
    @pathParam("tableId") tableId: string,
  ): Promise<RestApiResponse> {
    const actor = this.getActor();
    if (!actor?.sub) {
      this.response.status(401);
      return { success: false, message: "Unauthorized" };
    }
    const result = await this.usersService.deleteTablePreference(
      actor.sub,
      tableId,
      actor,
    );
    if (!result.result) {
      this.response.status(400);
      return {
        success: false,
        message: result.error ?? "Failed to delete preference",
      };
    }
    return { success: true, message: "Preference deleted" };
  }
}
