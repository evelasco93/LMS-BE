import type { CasingMode } from "../../handlers/campaigns/interfaces/ICampaign.interface";

/**
 * Apply the specified casing transformation to a string value.
 * Returns the original value unchanged when mode is "default" or undefined.
 */
export function applyCasing(
  value: string,
  mode: CasingMode | undefined,
): string {
  if (!mode || mode === "default") return value;

  switch (mode) {
    case "lowercase":
      return value.toLowerCase();
    case "uppercase":
      return value.toUpperCase();
    case "capitalize_first":
      return value.charAt(0).toUpperCase() + value.slice(1);
    case "title_case":
      return value.replace(
        /\w\S*/g,
        (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      );
    default:
      return value;
  }
}
