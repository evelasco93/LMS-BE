export type UserRole = "admin" | "staff";

export interface CreateUserRequest {
  email: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserRequest {
  role: UserRole;
}

export interface ResetPasswordRequest {
  password: string;
}

export interface CognitoUser {
  username: string;
  email: string;
  status: string;
  enabled: boolean;
  role: UserRole | null;
  createdAt?: Date;
  updatedAt?: Date;
}
