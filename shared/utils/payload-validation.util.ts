export type ValidationResult<T extends Record<string, unknown>> = {
  ok: boolean;
  extras: string[];
  sanitized: Partial<T>;
};

/**
 * Validates an incoming payload against an allowed field list and returns a sanitized copy.
 */
export function validateAllowedFields<T extends Record<string, unknown>>(
  payload: T,
  allowedKeys: string[],
): ValidationResult<T> {
  const allowed = new Set(allowedKeys);
  const sanitized: Partial<T> = {};
  const extras: string[] = [];

  Object.entries(payload).forEach(([key, value]) => {
    if (allowed.has(key)) {
      (sanitized as Record<string, unknown>)[key] = value;
    } else {
      extras.push(key);
    }
  });

  return { ok: extras.length === 0, extras, sanitized };
}
