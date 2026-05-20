export interface RequestActor {
  sub?: string;
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
}

/** Immutable log entry written whenever a tracked field changes on a record */
export interface IEditHistoryEntry {
  field: string;
  previous_value: unknown;
  new_value: unknown;
  changed_at: string; // ISO timestamp
  changed_by?: RequestActor;
}

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

export function extractAuthorizationHeader(
  headers?: Record<string, string | string[] | undefined>,
): string | undefined {
  if (!headers) return undefined;
  const lower = headers["authorization"];
  if (typeof lower === "string") return lower;
  const upper = headers["Authorization"];
  if (typeof upper === "string") return upper;
  return undefined;
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = headers[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0]?.trim();
    return first ? first : undefined;
  }
  return undefined;
}

export function extractCorrelationIdFromHeaders(
  headers?: Record<string, string | string[] | undefined>,
): string | undefined {
  if (!headers) return undefined;

  return (
    getHeaderValue(headers, "x-correlation-id") ??
    getHeaderValue(headers, "X-Correlation-Id") ??
    getHeaderValue(headers, "x-request-id") ??
    getHeaderValue(headers, "X-Request-Id")
  );
}

export function withCorrelationId<T extends Record<string, unknown>>(
  response: T,
  headers?: Record<string, string | string[] | undefined>,
): T & { correlation_id?: string } {
  const correlationId = extractCorrelationIdFromHeaders(headers);
  return correlationId
    ? { ...response, correlation_id: correlationId }
    : (response as T & { correlation_id?: string });
}

export function extractRequestActorFromAuthHeader(
  authorizationHeader?: string,
): RequestActor | undefined {
  if (!authorizationHeader) return undefined;
  const token = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  const payload = decodeJwtPayload(token);
  if (!payload) return undefined;

  const firstName =
    (payload["given_name"] as string | undefined) ??
    (payload["custom:first_name"] as string | undefined);
  const lastName =
    (payload["family_name"] as string | undefined) ??
    (payload["custom:last_name"] as string | undefined);

  return {
    sub: payload["sub"] as string | undefined,
    username:
      (payload["cognito:username"] as string | undefined) ??
      (payload["username"] as string | undefined),
    email: payload["email"] as string | undefined,
    first_name: firstName,
    last_name: lastName,
    full_name:
      (payload["name"] as string | undefined) ??
      ([firstName, lastName].filter(Boolean).join(" ") || undefined),
  };
}

export function extractRequestActorFromHeaders(
  headers?: Record<string, string | string[] | undefined>,
): RequestActor | undefined {
  const auth = extractAuthorizationHeader(headers);
  return extractRequestActorFromAuthHeader(auth);
}
