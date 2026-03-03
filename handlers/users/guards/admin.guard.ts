/**
 * Decodes the JWT payload section without re-verifying the signature.
 * The API Gateway Cognito authorizer already verifies the token before the
 * Lambda is invoked, so we only need to read the claims (e.g. cognito:groups).
 */
export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Returns true when the Authorization bearer token contains the "admin"
 * Cognito User Pool group.
 */
export function isAdmin(authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader) return false;
  const token = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const groups: string[] = payload["cognito:groups"] ?? [];
  return groups.includes("admin");
}
