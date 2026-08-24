import type { ExtractedField, FieldType, FieldValue, WorkflowField } from "../types/api";

/**
 * Pure helpers for the field schema and for the values a run extracts. No React
 * and no DOM in here: `test/fields.test.ts` imports this file directly with
 * node's test runner, the way shared/whitelabel does.
 */

export const FIELD_TYPES: FieldType[] = [
  "string",
  "number",
  "date",
  "currency",
  "boolean",
  "list",
];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  string: "Texto",
  number: "Número",
  date: "Fecha",
  currency: "Importe",
  boolean: "Sí / No",
  list: "Lista",
};

/**
 * The key becomes a property name in the extracted JSON and is quoted nowhere,
 * so it is restricted the same way the API restricts it. Kept as a literal
 * rather than assembled at runtime: this exact pattern is the contract.
 */
export const FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/** null when the key is usable; otherwise the message the form prints. */
export function validateFieldKey(key: string): string | null {
  if (key.trim() === "") return "El identificador es obligatorio.";
  if (!FIELD_KEY_PATTERN.test(key)) {
    return "El identificador debe empezar con una letra y usar sólo letras, números y guión bajo (ej: numero_factura).";
  }
  return null;
}

/**
 * Whole-schema check, run before saving: per-key rules plus the two things a
 * single row cannot see — duplicates and a missing label.
 */
export function validateFields(fields: WorkflowField[]): string | null {
  const seen = new Set<string>();
  for (const field of fields) {
    const keyError = validateFieldKey(field.key);
    if (keyError) return keyError;
    if (field.label.trim() === "") return `El campo "${field.key}" necesita un nombre visible.`;
    if (seen.has(field.key)) return `El identificador "${field.key}" está repetido.`;
    seen.add(field.key);
  }
  return null;
}

/** Moves `from` to `to`, returning a new array; out-of-range moves are no-ops. */
export function moveField<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1) as [T];
  next.splice(to, 0, moved);
  return next;
}

/**
 * `nf_runs.extracted` is jsonb the extractor wrote, so a value may arrive
 * either as `{value, confidence}` or bare. Both are accepted and normalised
 * here so no screen has to guess; anything else becomes a null value rather
 * than a crash.
 */
export function normalizeExtracted(raw: unknown): Record<string, ExtractedField> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const result: Record<string, ExtractedField> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry) && "value" in entry) {
      const { value, confidence } = entry as { value: unknown; confidence?: unknown };
      result[key] = {
        value: asFieldValue(value),
        confidence: typeof confidence === "number" ? confidence : null,
      };
      continue;
    }
    result[key] = { value: asFieldValue(entry), confidence: null };
  }
  return result;
}

function asFieldValue(value: unknown): FieldValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => String(item));
  // An object where a scalar was declared: show it rather than dropping it.
  return JSON.stringify(value);
}

/**
 * The schema to render a run against. The API sends the workflow's fields with
 * the run when it can; when it cannot, the extracted keys are the schema — a
 * reviewer must never be shown a blank form because a shape moved.
 */
export function fieldsForRun(
  declared: WorkflowField[] | undefined,
  extracted: Record<string, ExtractedField>,
): WorkflowField[] {
  if (declared && declared.length > 0) return declared;
  return Object.keys(extracted).map((key) => ({
    key,
    label: key,
    type: "string" as FieldType,
    required: false,
  }));
}

/** What a value looks like on screen. Empty string means "nothing extracted". */
export function formatFieldValue(value: FieldValue): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** The value as the review form's input holds it — always a string. */
export function toEditableValue(value: FieldValue): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * The reviewer's string back to the declared type. An empty box is null, never
 * `0` or `""` — "the model found nothing and I confirm that" has to survive.
 */
export function fromEditableValue(raw: string, type: FieldType): FieldValue {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  switch (type) {
    case "number":
    case "currency": {
      const parsed = Number(trimmed.replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "boolean":
      return trimmed === "true";
    case "list":
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
    default:
      return trimmed;
  }
}

/** "92 %" — the model's confidence, or an em dash when it reported none. */
export function formatConfidence(confidence: number | null | undefined): string {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return "—";
  // Providers report either 0–1 or 0–100; both are shown as a percentage.
  const percent = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(percent)} %`;
}
