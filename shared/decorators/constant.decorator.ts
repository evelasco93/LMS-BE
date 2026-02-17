/**
 * Constant decorator for environment variable injection
 * Supports both legacy and stage-3 decorator semantics without creating invalid descriptors
 */
type FieldContext = {
  name: string | symbol;
  addInitializer?: (initializer: () => void) => void;
};

const isFieldContext = (value: unknown): value is FieldContext => {
  return !!value && typeof value === "object" && "name" in value;
};

export function constant(envKey?: string) {
  const apply = (target: any, keyOrContext: string | symbol | FieldContext) => {
    const envName = (
      envKey ??
      (isFieldContext(keyOrContext)
        ? String(keyOrContext.name)
        : String(keyOrContext))
    ).toUpperCase();

    // Stage-3 decorator support
    if (
      isFieldContext(keyOrContext) &&
      typeof keyOrContext.addInitializer === "function"
    ) {
      keyOrContext.addInitializer(function (this: Record<string, unknown>) {
        Object.defineProperty(this, keyOrContext.name, {
          configurable: false,
          enumerable: true,
          writable: false,
          value: process.env[envName],
        });
      });

      return;
    }

    // Legacy experimental decorator support
    Object.defineProperty(target, keyOrContext as string | symbol, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: process.env[envName],
    });
  };

  return function constantDecorator(
    target: any,
    keyOrContext: string | symbol | FieldContext,
  ): void {
    apply(target, keyOrContext);
  };
}
