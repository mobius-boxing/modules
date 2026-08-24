import type {
  ConfigInput,
  ConfigInputType,
  ConfigOption,
  NodeHandle,
  NodeTypeDescriptor,
} from "../types/api";

/**
 * The reader for `GET /node-types`.
 *
 * This module is the whole reason that endpoint exists: adding a node type is a
 * backend file and nothing else, because the palette, the handles a node draws,
 * whether anything may point at it and every control in its config panel come
 * from the descriptor. Nothing in this app switches on a node type by name.
 *
 * Read defensively even so — it is wire data. An entry without a type is
 * dropped; an input whose kind this build has never heard of degrades to a text
 * box, so a type shipped by a newer API is still editable rather than invisible.
 */

const HANDLES: readonly NodeHandle[] = ["out", "true", "false"];

/**
 * The default outgoing handle. Spelled out rather than imported from
 * `lib/graph.ts`, which exports the same constant: both files are covered by
 * node's test runner, which cannot resolve an extensionless import between two
 * source modules, so a pure lib here carries no runtime import at all. The
 * shared truth is the `NodeHandle` type, which both files use.
 */
const DEFAULT_HANDLE: NodeHandle = "out";

const INPUT_TYPES: readonly ConfigInputType[] = [
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "fieldKey",
  "credential",
  "keyValue",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readOptions(raw: unknown): ConfigOption[] {
  if (!Array.isArray(raw)) return [];
  const options: ConfigOption[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const value = entry.value;
    if (typeof value !== "string" && typeof value !== "number") continue;
    options.push({ value: String(value), label: text(entry.label) ?? String(value) });
  }
  return options;
}

function readInputType(raw: unknown): ConfigInputType {
  return typeof raw === "string" && (INPUT_TYPES as readonly string[]).includes(raw)
    ? (raw as ConfigInputType)
    : "text";
}

function readDefaultValue(raw: unknown): string | number | boolean | null {
  return typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
    ? raw
    : null;
}

function readConfigSchema(raw: unknown): ConfigInput[] {
  if (!Array.isArray(raw)) return [];
  const inputs: ConfigInput[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const key = text(entry.key);
    if (key === null) continue;
    inputs.push({
      key,
      label: text(entry.label) ?? key,
      input: readInputType(entry.input),
      required: entry.required === true,
      options: readOptions(entry.options),
      templated: entry.templated === true,
      placeholder: text(entry.placeholder),
      help: text(entry.help),
      defaultValue: readDefaultValue(entry.defaultValue),
    });
  }
  return inputs;
}

function readHandles(raw: unknown): NodeHandle[] {
  if (!Array.isArray(raw)) return [DEFAULT_HANDLE];
  const handles = raw.filter(
    (entry): entry is NodeHandle =>
      typeof entry === "string" && (HANDLES as readonly string[]).includes(entry),
  );
  // A node with no outgoing handle at all could never be connected onward; a
  // registry that sends none is more likely broken than deliberate.
  return handles.length === 0 ? [DEFAULT_HANDLE] : handles;
}

/** `GET /node-types`, read defensively: an entry without a type is dropped. */
export function normalizeNodeTypes(raw: unknown): NodeTypeDescriptor[] {
  if (!Array.isArray(raw)) return [];
  const descriptors: NodeTypeDescriptor[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const type = text(entry.type);
    if (type === null) continue;
    descriptors.push({
      type,
      label: text(entry.label) ?? type,
      description: text(entry.description) ?? "",
      handles: readHandles(entry.handles),
      // Only the trigger refuses input, so the safe default for a descriptor
      // that does not say is "yes": a node nothing may point at is unusable.
      acceptsInput: entry.acceptsInput !== false,
      configSchema: readConfigSchema(entry.configSchema),
    });
  }
  return descriptors;
}

/** The descriptor for a node type, or null when the registry does not know it. */
export function findDescriptor(
  descriptors: NodeTypeDescriptor[],
  type: string,
): NodeTypeDescriptor | null {
  return descriptors.find((descriptor) => descriptor.type === type) ?? null;
}

/**
 * What a node in the definition draws when the registry has no entry for its
 * type — an API older or newer than this build, or one that could not be
 * reached. The node stays visible, identifiable and connectable; only its
 * config form is missing, and the panel says why.
 */
export function fallbackDescriptor(type: string): NodeTypeDescriptor {
  return {
    type,
    label: type,
    description: "",
    handles: [DEFAULT_HANDLE],
    acceptsInput: true,
    configSchema: [],
  };
}

/**
 * The config a freshly added node starts with: the schema's declared defaults,
 * and nothing else. Seeded on creation rather than filled in at render time, so
 * what the panel shows and what gets saved are the same object.
 */
export function defaultConfig(descriptor: NodeTypeDescriptor): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const input of descriptor.configSchema) {
    if (input.defaultValue !== null) config[input.key] = input.defaultValue;
  }
  return config;
}

/**
 * The one line a node shows under its title: the first configured value, in the
 * schema's own order. Derived from the schema rather than from the type's name,
 * so a node type added on the backend gets a summary for free.
 */
export function summarize(descriptor: NodeTypeDescriptor, config: Record<string, unknown>): string {
  for (const input of descriptor.configSchema) {
    const value = config[input.key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}
