// Serializable field/entity definitions for the master data admin.
// Everything here must stay plain data (no functions) because field
// definitions are passed to the client form component.

export type FieldType =
  | "text"
  | "textarea"
  | "int"
  | "number"
  | "money"
  | "date"
  | "time"
  | "bool"
  | "select" // one of static options
  | "multiselect" // several of static options -> text[]
  | "ref" // foreign key -> one row of another table
  | "refs" // several rows of another table -> uuid[]
  | "tags" // comma separated -> text[]
  | "weekdays" // 0 = Sunday .. 6 = Saturday -> int[]
  | "json";

export interface Option {
  value: string;
  label: string;
}

export interface RefSpec {
  table: string;
  select: string; // PostgREST select, may embed a parent, e.g. "id, name, sales_properties(name)"
  order: string;
  label: string[]; // dotted paths joined with " - ", e.g. ["sales_properties.name", "name"]
  filter?: { column: string; op: "eq" | "neq"; value: string };
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: Option[];
  ref?: RefSpec;
  wide?: boolean;
  // Value stored when the input is left empty. Needed for NOT NULL columns
  // that have a database default (an explicit null would be rejected).
  empty?: unknown;
  // Initial value on the "new" form.
  initial?: unknown;
  // For "select" fields stored in an integer column (e.g. weekday).
  asNumber?: boolean;
}

// Supabase Storage bucket created in sales_module_v1.sql.
export const MEDIA_BUCKET = "sales-media";

// Must match the CHECK constraint on public.sales_media.owner_type.
export type MediaOwner = "property" | "room_category" | "park" | "addon" | "brand";

export interface EntityDef {
  key: string; // URL segment under /sales/admin/
  table: string;
  title: string;
  singular: string;
  group: string;
  description: string;
  icon: string;
  fields: FieldDef[];
  list: string[]; // field names shown as list columns
  filters?: string[]; // ref/select field names offered as list filters
  order: { column: string; ascending: boolean }[];
  listFilter?: { column: string; op: "eq" | "neq"; value: string };
  afterSave?: "property-location";
  media?: { owner: MediaOwner; max: number }; // photo gallery on the edit page
  deleteWarning?: string;
}

export type ActionResult = { ok?: boolean; error?: string; id?: string };

export interface MediaItem {
  id: string;
  url: string;
  storage_path: string;
  caption: string | null;
  is_cover: boolean;
  sort: number;
}
