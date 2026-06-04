export interface IPlatformFieldDef {
  field_label: string;
  field_name: string;
  data_type: string;
  required: boolean;
  description?: string;
}

export interface IPlatformPresetSeed {
  id: string;
  name: string;
  description?: string;
  /** "List" for list-option presets, "FieldSet" for field-set presets */
  data_type: "List" | "FieldSet";
  options?: { value: string; label: string }[];
  fields?: IPlatformFieldDef[];
  locked?: boolean;
  casing?: string;
  mapping_modes?: string[];
}

export const PLATFORM_PRESETS_SEED: IPlatformPresetSeed[] = [
  // ── US States ───────────────────────────────────────────────────────────
  {
    id: "PP-US-STATES",
    name: "US States",
    description: "All 50 US states",
    data_type: "List",
    options: [
      { value: "Alabama", label: "Alabama" },
      { value: "Alaska", label: "Alaska" },
      { value: "Arizona", label: "Arizona" },
      { value: "Arkansas", label: "Arkansas" },
      { value: "California", label: "California" },
      { value: "Colorado", label: "Colorado" },
      { value: "Connecticut", label: "Connecticut" },
      { value: "Delaware", label: "Delaware" },
      { value: "Florida", label: "Florida" },
      { value: "Georgia", label: "Georgia" },
      { value: "Hawaii", label: "Hawaii" },
      { value: "Idaho", label: "Idaho" },
      { value: "Illinois", label: "Illinois" },
      { value: "Indiana", label: "Indiana" },
      { value: "Iowa", label: "Iowa" },
      { value: "Kansas", label: "Kansas" },
      { value: "Kentucky", label: "Kentucky" },
      { value: "Louisiana", label: "Louisiana" },
      { value: "Maine", label: "Maine" },
      { value: "Maryland", label: "Maryland" },
      { value: "Massachusetts", label: "Massachusetts" },
      { value: "Michigan", label: "Michigan" },
      { value: "Minnesota", label: "Minnesota" },
      { value: "Mississippi", label: "Mississippi" },
      { value: "Missouri", label: "Missouri" },
      { value: "Montana", label: "Montana" },
      { value: "Nebraska", label: "Nebraska" },
      { value: "Nevada", label: "Nevada" },
      { value: "New Hampshire", label: "New Hampshire" },
      { value: "New Jersey", label: "New Jersey" },
      { value: "New Mexico", label: "New Mexico" },
      { value: "New York", label: "New York" },
      { value: "North Carolina", label: "North Carolina" },
      { value: "North Dakota", label: "North Dakota" },
      { value: "Ohio", label: "Ohio" },
      { value: "Oklahoma", label: "Oklahoma" },
      { value: "Oregon", label: "Oregon" },
      { value: "Pennsylvania", label: "Pennsylvania" },
      { value: "Rhode Island", label: "Rhode Island" },
      { value: "South Carolina", label: "South Carolina" },
      { value: "South Dakota", label: "South Dakota" },
      { value: "Tennessee", label: "Tennessee" },
      { value: "Texas", label: "Texas" },
      { value: "Utah", label: "Utah" },
      { value: "Vermont", label: "Vermont" },
      { value: "Virginia", label: "Virginia" },
      { value: "Washington", label: "Washington" },
      { value: "West Virginia", label: "West Virginia" },
      { value: "Wisconsin", label: "Wisconsin" },
      { value: "Wyoming", label: "Wyoming" },
    ],
    casing: "title_case",
    mapping_modes: ["abbr_to_full", "full_to_abbr"],
  },

  // ── US Territories ──────────────────────────────────────────────────────
  {
    id: "PP-US-TERRITORIES",
    name: "US Territories",
    description: "US territories and commonwealths",
    data_type: "List",
    options: [
      { value: "American Samoa", label: "American Samoa" },
      { value: "Guam", label: "Guam" },
      { value: "Northern Mariana Islands", label: "Northern Mariana Islands" },
      { value: "Puerto Rico", label: "Puerto Rico" },
      { value: "US Virgin Islands", label: "US Virgin Islands" },
    ],
    casing: "title_case",
    mapping_modes: ["abbr_to_full", "full_to_abbr"],
  },

  // ── Months ──────────────────────────────────────────────────────────────
  {
    id: "PP-MONTHS",
    name: "Months",
    description: "Calendar months with abbreviation mapping",
    data_type: "List",
    options: [
      { value: "01", label: "January" },
      { value: "02", label: "February" },
      { value: "03", label: "March" },
      { value: "04", label: "April" },
      { value: "05", label: "May" },
      { value: "06", label: "June" },
      { value: "07", label: "July" },
      { value: "08", label: "August" },
      { value: "09", label: "September" },
      { value: "10", label: "October" },
      { value: "11", label: "November" },
      { value: "12", label: "December" },
    ],
    mapping_modes: ["abbr_to_full", "full_to_abbr"],
  },

  // ── Days ────────────────────────────────────────────────────────────────
  {
    id: "PP-DAYS",
    name: "Days",
    description: "Days of the week",
    data_type: "List",
    options: [
      { value: "Mon", label: "Monday" },
      { value: "Tue", label: "Tuesday" },
      { value: "Wed", label: "Wednesday" },
      { value: "Thu", label: "Thursday" },
      { value: "Fri", label: "Friday" },
      { value: "Sat", label: "Saturday" },
      { value: "Sun", label: "Sunday" },
    ],
    mapping_modes: ["abbr_to_full", "full_to_abbr"],
  },

  // ── Yes / No ────────────────────────────────────────────────────────────
  {
    id: "PP-YES-NO",
    name: "Yes / No",
    description: "Simple yes or no options",
    data_type: "List",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },

  // ── Base Campaign Fields ──────────────────────────────────────────────
  {
    id: "PP-BASE-CAMPAIGN-FIELDS",
    name: "Base Campaign Fields",
    description: "Essential lead fields included with every campaign",
    data_type: "FieldSet",
    locked: true,
    fields: [
      { field_label: "Campaign Key", field_name: "campaign_key", data_type: "Text", required: true },
      { field_label: "Campaign ID", field_name: "campaign_id", data_type: "Text", required: true },
      { field_label: "First Name", field_name: "first_name", data_type: "Text", required: true },
      { field_label: "Last Name", field_name: "last_name", data_type: "Text", required: true },
      { field_label: "Email", field_name: "email", data_type: "Text", required: true },
      { field_label: "Phone", field_name: "phone", data_type: "Text", required: true },
      { field_label: "Trusted Form Cert ID", field_name: "trusted_form_cert_id", data_type: "Text", required: true },
    ],
  },
];
