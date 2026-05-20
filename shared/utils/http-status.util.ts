const NOT_FOUND_KEYWORDS = ["not found"];
const CONFLICT_KEYWORDS = [
  "already exists",
  "already been cherry-picked",
  "duplicate",
  "conflict",
  "cannot hard delete",
  "cannot soft delete",
  "cannot delete",
  "cannot update",
  "linked to campaigns",
  "has campaign leads",
];
const BAD_REQUEST_KEYWORDS = ["invalid", "required", "missing", "malformed"];

export function mapServiceErrorToHttpStatus(
  error?: string,
  fallbackStatus = 400,
): number {
  if (!error) return fallbackStatus;

  const normalizedError = error.toLowerCase();

  if (NOT_FOUND_KEYWORDS.some((keyword) => normalizedError.includes(keyword))) {
    return 404;
  }

  if (CONFLICT_KEYWORDS.some((keyword) => normalizedError.includes(keyword))) {
    return 409;
  }

  if (normalizedError.includes("unauthorized")) {
    return 401;
  }

  if (normalizedError.includes("forbidden")) {
    return 403;
  }

  if (
    BAD_REQUEST_KEYWORDS.some((keyword) => normalizedError.includes(keyword))
  ) {
    return 400;
  }

  return fallbackStatus;
}
