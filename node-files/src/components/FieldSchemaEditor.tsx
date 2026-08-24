import { FIELD_TYPES, FIELD_TYPE_LABELS, moveField, validateFieldKey } from "../lib/fields";
import type { FieldType, WorkflowField } from "../types/api";

interface Props {
  fields: WorkflowField[];
  onChange: (fields: WorkflowField[]) => void;
  disabled: boolean;
}

/** A new row starts empty: an invented key would be saved by accident. */
const EMPTY_FIELD: WorkflowField = { key: "", label: "", type: "string", required: false, description: "" };

/**
 * The workflow's field schema — the part of a flow that Phase 1 actually has.
 * There is no canvas and no node graph here on purpose: those are Phase 2.
 *
 * The key is what the extracted JSON is keyed by, so it is validated as it is
 * typed and the message says what a valid one looks like. Order matters (it is
 * the order the reviewer reads the values in), hence the two move buttons.
 */
export function FieldSchemaEditor({ fields, onChange, disabled }: Props) {
  const patch = (index: number, change: Partial<WorkflowField>) => {
    onChange(fields.map((field, i) => (i === index ? { ...field, ...change } : field)));
  };

  return (
    <div className="schema">
      <div className="schema__head">
        <h2 className="schema__title">Campos a extraer</h2>
        <button
          type="button"
          className="btn"
          data-testid="field-add"
          disabled={disabled}
          onClick={() => onChange([...fields, { ...EMPTY_FIELD }])}
        >
          Agregar campo
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="field__hint" data-testid="fields-empty">
          Todavía no declaraste ningún campo. Sin campos no hay nada que extraer.
        </p>
      ) : (
        // The row index is the key: `field.key` is being typed and changes on
        // every keystroke, and every input here is controlled by this array, so
        // a positional key holds no state of its own to lose on a reorder.
        <ol className="schema__rows" data-testid="fields-list">
          {fields.map((field, index) => {
            const keyError = field.key === "" ? null : validateFieldKey(field.key);
            return (
              <li className="schema__row" key={index}>
                <div className="field-row">
                  <div className="field field--grow">
                    <label className="field__label" htmlFor={`field-key-${index}`}>
                      Identificador
                    </label>
                    <input
                      id={`field-key-${index}`}
                      className="input"
                      type="text"
                      name={`fieldKey${index}`}
                      data-testid={`field-key-${index}`}
                      value={field.key}
                      disabled={disabled}
                      aria-invalid={keyError !== null}
                      placeholder="numero_factura"
                      onChange={(event) => patch(index, { key: event.target.value })}
                    />
                  </div>

                  <div className="field field--grow">
                    <label className="field__label" htmlFor={`field-label-${index}`}>
                      Nombre visible
                    </label>
                    <input
                      id={`field-label-${index}`}
                      className="input"
                      type="text"
                      name={`fieldLabel${index}`}
                      data-testid={`field-label-${index}`}
                      value={field.label}
                      disabled={disabled}
                      placeholder="Número de factura"
                      onChange={(event) => patch(index, { label: event.target.value })}
                    />
                  </div>

                  <div className="field field--narrow">
                    <label className="field__label" htmlFor={`field-type-${index}`}>
                      Tipo
                    </label>
                    <select
                      id={`field-type-${index}`}
                      className="input"
                      name={`fieldType${index}`}
                      data-testid={`field-type-${index}`}
                      value={field.type}
                      disabled={disabled}
                      onChange={(event) =>
                        patch(index, { type: event.target.value as FieldType })
                      }
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {FIELD_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field-row">
                  <div className="field field--grow">
                    <label className="field__label" htmlFor={`field-hint-${index}`}>
                      Pista para la extracción <span className="field__optional">(opcional)</span>
                    </label>
                    <input
                      id={`field-hint-${index}`}
                      className="input"
                      type="text"
                      name={`fieldHint${index}`}
                      data-testid={`field-hint-${index}`}
                      value={field.description ?? ""}
                      disabled={disabled}
                      placeholder="Arriba a la derecha, junto a la fecha"
                      onChange={(event) => patch(index, { description: event.target.value })}
                    />
                  </div>

                  <label className="schema__check" htmlFor={`field-required-${index}`}>
                    <input
                      id={`field-required-${index}`}
                      type="checkbox"
                      name={`fieldRequired${index}`}
                      data-testid={`field-required-${index}`}
                      checked={field.required}
                      disabled={disabled}
                      onChange={(event) => patch(index, { required: event.target.checked })}
                    />
                    Obligatorio
                  </label>

                  <span className="schema__actions">
                    <button
                      type="button"
                      className="btn btn--quiet"
                      data-testid={`field-up-${index}`}
                      aria-label={`Subir el campo ${index + 1}`}
                      disabled={disabled || index === 0}
                      onClick={() => onChange(moveField(fields, index, index - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet"
                      data-testid={`field-down-${index}`}
                      aria-label={`Bajar el campo ${index + 1}`}
                      disabled={disabled || index === fields.length - 1}
                      onClick={() => onChange(moveField(fields, index, index + 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet btn--danger"
                      data-testid={`field-remove-${index}`}
                      disabled={disabled}
                      onClick={() => onChange(fields.filter((_, i) => i !== index))}
                    >
                      Quitar
                    </button>
                  </span>
                </div>

                {keyError ? (
                  <p className="notice" role="alert" data-testid={`field-key-error-${index}`}>
                    {keyError}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
