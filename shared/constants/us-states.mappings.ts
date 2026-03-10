/**
 * Pre-built value-mapping presets for US state normalisation.
 *
 * Resolved at runtime from a criteria field's `state_mapping` direction value.
 * Nothing large is stored in DynamoDB — just the direction string.
 */

/** Mirrors IValueMapping from campaigns — kept local to avoid a handler dependency. */
interface IValueMapping {
  from: string[];
  to: string;
}

/**
 * Returns the appropriate state preset for the given direction string,
 * or an empty array when the direction is absent / disabled.
 *
 * @example
 * resolveStateMappings("abbr_to_name") // "CA" → "California"
 * resolveStateMappings("name_to_abbr") // "California" → "CA"
 * resolveStateMappings(undefined)      // [] — no-op
 */
export function resolveStateMappings(
  direction: "abbr_to_name" | "name_to_abbr" | undefined,
): IValueMapping[] {
  if (direction === "abbr_to_name") return US_STATE_ABBR_TO_NAME;
  if (direction === "name_to_abbr") return US_STATE_NAME_TO_ABBR;
  return [];
}

// ── Abbreviation → Full name ──────────────────────────────────────────────────

export const US_STATE_ABBR_TO_NAME: IValueMapping[] = [
  { from: ["AL"], to: "Alabama" },
  { from: ["AK"], to: "Alaska" },
  { from: ["AZ"], to: "Arizona" },
  { from: ["AR"], to: "Arkansas" },
  { from: ["CA"], to: "California" },
  { from: ["CO"], to: "Colorado" },
  { from: ["CT"], to: "Connecticut" },
  { from: ["DE"], to: "Delaware" },
  { from: ["FL"], to: "Florida" },
  { from: ["GA"], to: "Georgia" },
  { from: ["HI"], to: "Hawaii" },
  { from: ["ID"], to: "Idaho" },
  { from: ["IL"], to: "Illinois" },
  { from: ["IN"], to: "Indiana" },
  { from: ["IA"], to: "Iowa" },
  { from: ["KS"], to: "Kansas" },
  { from: ["KY"], to: "Kentucky" },
  { from: ["LA"], to: "Louisiana" },
  { from: ["ME"], to: "Maine" },
  { from: ["MD"], to: "Maryland" },
  { from: ["MA"], to: "Massachusetts" },
  { from: ["MI"], to: "Michigan" },
  { from: ["MN"], to: "Minnesota" },
  { from: ["MS"], to: "Mississippi" },
  { from: ["MO"], to: "Missouri" },
  { from: ["MT"], to: "Montana" },
  { from: ["NE"], to: "Nebraska" },
  { from: ["NV"], to: "Nevada" },
  { from: ["NH"], to: "New Hampshire" },
  { from: ["NJ"], to: "New Jersey" },
  { from: ["NM"], to: "New Mexico" },
  { from: ["NY"], to: "New York" },
  { from: ["NC"], to: "North Carolina" },
  { from: ["ND"], to: "North Dakota" },
  { from: ["OH"], to: "Ohio" },
  { from: ["OK"], to: "Oklahoma" },
  { from: ["OR"], to: "Oregon" },
  { from: ["PA"], to: "Pennsylvania" },
  { from: ["RI"], to: "Rhode Island" },
  { from: ["SC"], to: "South Carolina" },
  { from: ["SD"], to: "South Dakota" },
  { from: ["TN"], to: "Tennessee" },
  { from: ["TX"], to: "Texas" },
  { from: ["UT"], to: "Utah" },
  { from: ["VT"], to: "Vermont" },
  { from: ["VA"], to: "Virginia" },
  { from: ["WA"], to: "Washington" },
  { from: ["WV"], to: "West Virginia" },
  { from: ["WI"], to: "Wisconsin" },
  { from: ["WY"], to: "Wyoming" },
  // Territories
  { from: ["DC"], to: "District of Columbia" },
  { from: ["PR"], to: "Puerto Rico" },
  { from: ["GU"], to: "Guam" },
  { from: ["VI"], to: "U.S. Virgin Islands" },
  { from: ["AS"], to: "American Samoa" },
  { from: ["MP"], to: "Northern Mariana Islands" },
];

// ── Full name → Abbreviation ──────────────────────────────────────────────────

export const US_STATE_NAME_TO_ABBR: IValueMapping[] = [
  { from: ["Alabama"], to: "AL" },
  { from: ["Alaska"], to: "AK" },
  { from: ["Arizona"], to: "AZ" },
  { from: ["Arkansas"], to: "AR" },
  { from: ["California"], to: "CA" },
  { from: ["Colorado"], to: "CO" },
  { from: ["Connecticut"], to: "CT" },
  { from: ["Delaware"], to: "DE" },
  { from: ["Florida"], to: "FL" },
  { from: ["Georgia"], to: "GA" },
  { from: ["Hawaii"], to: "HI" },
  { from: ["Idaho"], to: "ID" },
  { from: ["Illinois"], to: "IL" },
  { from: ["Indiana"], to: "IN" },
  { from: ["Iowa"], to: "IA" },
  { from: ["Kansas"], to: "KS" },
  { from: ["Kentucky"], to: "KY" },
  { from: ["Louisiana"], to: "LA" },
  { from: ["Maine"], to: "ME" },
  { from: ["Maryland"], to: "MD" },
  { from: ["Massachusetts"], to: "MA" },
  { from: ["Michigan"], to: "MI" },
  { from: ["Minnesota"], to: "MN" },
  { from: ["Mississippi"], to: "MS" },
  { from: ["Missouri"], to: "MO" },
  { from: ["Montana"], to: "MT" },
  { from: ["Nebraska"], to: "NE" },
  { from: ["Nevada"], to: "NV" },
  { from: ["New Hampshire"], to: "NH" },
  { from: ["New Jersey"], to: "NJ" },
  { from: ["New Mexico"], to: "NM" },
  { from: ["New York"], to: "NY" },
  { from: ["North Carolina"], to: "NC" },
  { from: ["North Dakota"], to: "ND" },
  { from: ["Ohio"], to: "OH" },
  { from: ["Oklahoma"], to: "OK" },
  { from: ["Oregon"], to: "OR" },
  { from: ["Pennsylvania"], to: "PA" },
  { from: ["Rhode Island"], to: "RI" },
  { from: ["South Carolina"], to: "SC" },
  { from: ["South Dakota"], to: "SD" },
  { from: ["Tennessee"], to: "TN" },
  { from: ["Texas"], to: "TX" },
  { from: ["Utah"], to: "UT" },
  { from: ["Vermont"], to: "VT" },
  { from: ["Virginia"], to: "VA" },
  { from: ["Washington"], to: "WA" },
  { from: ["West Virginia"], to: "WV" },
  { from: ["Wisconsin"], to: "WI" },
  { from: ["Wyoming"], to: "WY" },
  // Territories
  { from: ["District of Columbia"], to: "DC" },
  { from: ["Puerto Rico"], to: "PR" },
  { from: ["Guam"], to: "GU" },
  { from: ["U.S. Virgin Islands", "US Virgin Islands"], to: "VI" },
  { from: ["American Samoa"], to: "AS" },
  { from: ["Northern Mariana Islands"], to: "MP" },
];
