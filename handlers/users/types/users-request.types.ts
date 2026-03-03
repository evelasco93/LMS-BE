export type UserRole = "admin" | "staff";

export interface CreateUserRequest {
  email: string;
  password: string;
  role?: UserRole;
  firstName?: string;
  lastName?: string;
}

export interface UpdateUserRequest {
  role?: UserRole;
  firstName?: string;
  lastName?: string;
}

export interface ResetPasswordRequest {
  password: string;
}

export interface CognitoUser {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  status: string;
  enabled: boolean;
  role: UserRole | null;
  createdAt?: Date;
  updatedAt?: Date;
}
