import type {
  ConfigInput,
  Credential,
  GraphNode,
  NodeTypeDescriptor,
  WorkflowField,
} from "../types/api";

interface Props {
  /** The selected node, or null when nothing is selected. */
  node: GraphNode | null;
  /** Its type's entry in the registry, or null when the registry lacks it. */
  descriptor: NodeTypeDescriptor | null;
  /** Why the registry could not be read, when it could not. */
  registryError: string | null;
  /** The workflow's declared fields — what a `fieldKey` input may name. */
  workflowFields: WorkflowField[];
  /** The company's credentials — what a `credential` input may point at. */
  credentials: Credential[];
  /** Why the credentials could not be read, when they could not. */
  credentialsError: string | null;
  onChange: (config: Record<string, unknown>) => void;
  onRemove: () => void;
  disabled: boolean;
}

/**
 * The right-hand config panel, GENERATED from the node type's `configSchema`.
 *
 * Nothing here switches on a node type by name — there is no `if (type ===
 * "condition")` and there must never be one. A condition is three inputs
 * because the registry declares three (`fieldKey`, `select`, `text`), not
 * because this file knows what a condition is; an email node is four for the
 * same reason. A type added on the backend appears the moment
 * `GET /node-types` lists it.
 *
 * The eight input kinds are `NODE_FILES_CONFIG_INPUT_TYPES`. Two of them are
 * pickers the editor fills from data it already has: `fieldKey` from the
 * workflow's declared fields, `credential` from `GET /credentials`. An input
 * kind this build has never heard of arrives as `text` (see
 * `lib/nodeTypes.ts`), so it is still editable rather than invisible.
 */
export function NodeConfigPanel({
  node,
  descriptor,
  registryError,
  workflowFields,
  credentials,
  credentialsError,
  onChange,
  onRemove,
  disabled,
}: Props) {
  if (node === null) {
    return (
      <aside className="panel" data-testid="node-panel">
        <p className="panel__empty" data-testid="node-panel-empty">
          Elegí un nodo del diagrama para configurarlo.
        </p>
      </aside>
    );
  }

  const set = (key: string, value: unknown) => onChange({ ...node.config, [key]: value });

  return (
    <aside className="panel" data-testid="node-panel">
      <div className="panel__head">
        <h3 className="panel__title" data-testid="node-panel-title">
          {descriptor?.label ?? node.type}
        </h3>
        <span className="panel__id tabular">{node.nodeId}</span>
        <button
          type="button"
          className="btn btn--quiet btn--danger"
          data-testid="node-remove"
          disabled={disabled}
          onClick={onRemove}
        >
          Quitar
        </button>
      </div>

      {descriptor !== null && descriptor.description !== "" ? (
        <p className="panel__lead">{descriptor.description}</p>
      ) : null}

      {descriptor === null ? (
        <p className="notice" role="alert" data-testid="node-panel-unknown">
          {registryError ??
            `El servidor no declara el tipo "${node.type}", así que no hay formulario para su configuración.`}
        </p>
      ) : descriptor.configSchema.length === 0 ? (
        <p className="panel__empty" data-testid="node-panel-no-fields">
          Este nodo no necesita configuración.
        </p>
      ) : (
        <div className="panel__fields">
          {descriptor.configSchema.map((input) => (
            <ConfigControl
              key={input.key}
              input={input}
              value={node.config[input.key]}
              workflowFields={workflowFields}
              credentials={credentials}
              credentialsError={credentialsError}
              disabled={disabled}
              onChange={(value) => set(input.key, value)}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

interface ControlProps {
  input: ConfigInput;
  value: unknown;
  workflowFields: WorkflowField[];
  credentials: Credential[];
  credentialsError: string | null;
  disabled: boolean;
  onChange: (value: unknown) => void;
}

/** A string for a text box, whatever the jsonb actually holds. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

/** A `keyValue` input's stored shape: a flat map of strings. */
function asPairs(value: unknown): [string, string][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    asText(entry),
  ]);
}

function ConfigControl({
  input,
  value,
  workflowFields,
  credentials,
  credentialsError,
  disabled,
  onChange,
}: ControlProps) {
  const id = `config-${input.key}`;
  const hint = input.templated
    ? [input.help, "Admite {{fields.clave}}."].filter((part) => part !== null).join(" ")
    : input.help;

  const label = (
    <label className="field__label" htmlFor={id}>
      {input.label}
      {input.required ? "" : <span className="field__optional"> (opcional)</span>}
    </label>
  );

  if (input.input === "keyValue") {
    return <KeyValueControl input={input} value={value} disabled={disabled} onChange={onChange} />;
  }

  return (
    <div className="field">
      {input.input === "boolean" ? null : label}

      {input.input === "boolean" ? (
        <label className="schema__check" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            name={input.key}
            data-testid={id}
            checked={value === true}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          {input.label}
        </label>
      ) : input.input === "select" ? (
        <select
          id={id}
          className="input"
          name={input.key}
          data-testid={id}
          value={asText(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Sin elegir</option>
          {input.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : input.input === "fieldKey" ? (
        <select
          id={id}
          className="input"
          name={input.key}
          data-testid={id}
          value={asText(value)}
          disabled={disabled || workflowFields.length === 0}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Elegí un campo</option>
          {workflowFields.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label === "" ? field.key : field.label}
            </option>
          ))}
          {/* A key saved before the field was renamed or removed stays
              selectable, so opening the panel cannot silently blank it. */}
          {asText(value) !== "" && !workflowFields.some((field) => field.key === value) ? (
            <option value={asText(value)}>{asText(value)}</option>
          ) : null}
        </select>
      ) : input.input === "credential" ? (
        <select
          id={id}
          className="input"
          name={input.key}
          data-testid={id}
          value={asText(value)}
          disabled={disabled || credentialsError !== null}
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">Sin credencial</option>
          {credentials.map((credential) => (
            <option key={credential.uuid} value={credential.uuid}>
              {credential.name}
            </option>
          ))}
        </select>
      ) : input.input === "textarea" ? (
        <textarea
          id={id}
          className="input"
          name={input.key}
          data-testid={id}
          rows={4}
          placeholder={input.placeholder ?? undefined}
          value={asText(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="input"
          type={input.input === "number" ? "number" : "text"}
          name={input.key}
          data-testid={id}
          placeholder={input.placeholder ?? undefined}
          value={asText(value)}
          disabled={disabled}
          onChange={(event) => {
            // An empty number box is "no value", never 0 — the same rule the
            // review form follows for an extracted number.
            if (input.input !== "number") return onChange(event.target.value);
            const raw = event.target.value;
            const parsed = Number(raw);
            return onChange(raw.trim() === "" || !Number.isFinite(parsed) ? null : parsed);
          }}
        />
      )}

      {input.input === "fieldKey" && workflowFields.length === 0 ? (
        <span className="field__hint">Declará los campos a extraer y aparecen acá.</span>
      ) : null}
      {input.input === "credential" && credentialsError !== null ? (
        <span className="field__hint" data-testid={`${id}-error`}>
          {credentialsError}
        </span>
      ) : null}
      {hint === null || hint === "" ? null : <span className="field__hint">{hint}</span>}
    </div>
  );
}

/**
 * A `keyValue` input — HTTP headers today. Stored as a flat object, edited as
 * rows: the empty row at the end is how a pair is added, so there is no
 * separate "add" state to keep in sync with the value.
 */
function KeyValueControl({
  input,
  value,
  disabled,
  onChange,
}: Pick<ControlProps, "input" | "value" | "disabled" | "onChange">) {
  const pairs = asPairs(value);
  const rows: [string, string][] = [...pairs, ["", ""]];

  const write = (next: [string, string][]) => {
    const map: Record<string, string> = {};
    for (const [key, entry] of next) {
      if (key.trim() === "") continue;
      map[key] = entry;
    }
    onChange(map);
  };

  return (
    <div className="field" data-testid={`config-${input.key}`}>
      <span className="field__label">
        {input.label}
        {input.required ? "" : <span className="field__optional"> (opcional)</span>}
      </span>

      {rows.map(([key, entry], index) => (
        <div className="kv__row" key={index}>
          <div className="field field--grow">
            <label className="field__label sr-only" htmlFor={`config-${input.key}-${index}-name`}>
              Nombre
            </label>
            <input
              id={`config-${input.key}-${index}-name`}
              className="input"
              type="text"
              name={`${input.key}Name${index}`}
              data-testid={`config-${input.key}-${index}-name`}
              placeholder="Content-Type"
              value={key}
              disabled={disabled}
              onChange={(event) => {
                const next = [...rows] as [string, string][];
                next[index] = [event.target.value, entry];
                write(next);
              }}
            />
          </div>
          <div className="field field--grow">
            <label className="field__label sr-only" htmlFor={`config-${input.key}-${index}-value`}>
              Valor
            </label>
            <input
              id={`config-${input.key}-${index}-value`}
              className="input"
              type="text"
              name={`${input.key}Value${index}`}
              data-testid={`config-${input.key}-${index}-value`}
              placeholder="application/json"
              value={entry}
              disabled={disabled}
              onChange={(event) => {
                const next = [...rows] as [string, string][];
                next[index] = [key, event.target.value];
                write(next);
              }}
            />
          </div>
          {index < pairs.length ? (
            <button
              type="button"
              className="btn btn--quiet btn--danger kv__remove"
              data-testid={`config-${input.key}-${index}-remove`}
              aria-label={`Quitar ${key === "" ? `la fila ${index + 1}` : key}`}
              disabled={disabled}
              onClick={() => write(pairs.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          ) : (
            <span className="kv__remove" />
          )}
        </div>
      ))}

      {input.help === null ? null : <span className="field__hint">{input.help}</span>}
    </div>
  );
}
