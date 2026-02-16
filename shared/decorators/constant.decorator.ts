/**
 * Constant decorator for environment variable injection
 * Makes the property read-only and retrieves value from process.env
 */
export function constant(target: any, propertyKey: string): void {
  Object.defineProperty(target, propertyKey, {
    writable: false,
    enumerable: true,
    configurable: false,
    get: () => process.env[propertyKey.toUpperCase()]
  });
}
