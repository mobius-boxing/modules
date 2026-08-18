import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PeoplePicker } from "./PeoplePicker";
import type { Category, DocumentItem, Group, Person, RecurrenceUnit } from "../types/api";

interface Props {
  open: boolean;
  categories: Category[];
  /** The document being edited; null/absent means the dialog creates a new one. */
  document?: DocumentItem | null;
  onClose: () => void;
  onCreated: (document: DocumentItem) => void;
  /** The edited document as the API returned it, so the row can be replaced in place. */
  onSaved: (document: DocumentItem) => void;
}

const UNIT_OPTIONS: { value: RecurrenceUnit; label: string }[] = [
  { value: "day", label: "días" },
  { value: "month", label: "meses" },
  { value: "year", label: "años" },
];

/** Mirrors the column default in mobius-api: a document nobody thinks about gets a week. */
const DEFAULT_REMINDER_DAYS = "7";

/**
 * Name, rubro, sub-rubro, due date, días de aviso and repetition — for a new
 * document or for one already filed.
 *
 * This is more than the three fields PRODUCT.md argues for, and deliberately so:
 * the client wants every document classified, so rubro sits in front rather than
 * folded away — but it is optional, and can be taken off again: a company that
 * has not finished classifying its paperwork must still be able to load an
 * expiration. Repetition stays optional and sits last, because most documents do
 * not repeat.
 *
 * One dialog serves both modes rather than a second form: the fields are the
 * same, and two components would drift. Editing covers exactly what the update
 * endpoint accepts — assignments are not editable here, they go through the
 * permission-gated assignments endpoint.
 *
 * The `document` prop is destructured as `editing` on purpose: a bare `document`
 * binding would shadow the global one this component uses for the body-overflow
 * effect, with no type error to warn about it.
 *
 * Native <dialog> + showModal(): the platform provides the focus trap, Escape
 * handling, top-layer stacking and focus restoration to the trigger.
 */
export function DocumentDialog({
  open,
  categories,
  document: editing,
  onClose,
  onCreated,
  onSaved,
}: Props) {
  const { isAdmin } = useAuth();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [categoryUuid, setCategoryUuid] = useState("");
  const [subcategoryUuid, setSubcategoryUuid] = useState("");
  const [repeats, setRepeats] = useState(false);
  const [recurrenceCount, setRecurrenceCount] = useState("1");
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurrenceUnit>("month");
  const [reminderDays, setReminderDays] = useState(DEFAULT_REMINDER_DAYS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Assignment stays folded away: most documents take the defaults.
  const [showAssign, setShowAssign] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [resolvers, setResolvers] = useState<{ users: string[]; groups: string[] }>({
    users: [],
    groups: [],
  });
  const [watchers, setWatchers] = useState<{ users: string[]; groups: string[] }>({
    users: [],
    groups: [],
  });

  const subcategories = useMemo(
    () => categories.find((category) => category.uuid === categoryUuid)?.subcategories ?? [],
    [categories, categoryUuid],
  );

  // Only admins can assign, so only they need the name lists. Fetched once the
  // section is actually opened rather than on every dialog mount.
  useEffect(() => {
    if (!showAssign || !isAdmin || people.length > 0) return;
    void Promise.all([api.listPeople(), api.listGroups()])
      .then(([peopleList, groupList]) => {
        setPeople(peopleList);
        setGroups(groupList);
      })
      .catch(() => setError("No se pudieron cargar las personas."));
  }, [showAssign, isAdmin, people.length]);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      titleRef.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  // showModal() blocks interaction but not scrolling behind the backdrop.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const reset = useCallback(() => {
    setTitle("");
    setDueDate("");
    setCategoryUuid("");
    setSubcategoryUuid("");
    setRepeats(false);
    setRecurrenceCount("1");
    setRecurrenceUnit("month");
    setReminderDays(DEFAULT_REMINDER_DAYS);
    setError(null);
    setShowAssign(false);
    setResolvers({ users: [], groups: [] });
    setWatchers({ users: [], groups: [] });
  }, []);

  // The dialog closes without unmounting, so every open starts from a known
  // state: the document's own values when editing, the create defaults otherwise.
  useEffect(() => {
    if (!open) return;
    if (!editing) {
      reset();
      return;
    }
    setTitle(editing.title);
    setDueDate(editing.dueDate);
    setCategoryUuid(editing.category?.uuid ?? "");
    setSubcategoryUuid(editing.subcategory?.uuid ?? "");
    setRepeats(editing.recurrence !== null);
    setRecurrenceCount(String(editing.recurrence?.count ?? 1));
    setRecurrenceUnit(editing.recurrence?.unit ?? "month");
    setReminderDays(String(editing.reminderDays));
    setError(null);
    setShowAssign(false);
  }, [open, editing, reset]);

  const handleClose = () => {
    reset();
    onClose();
  };

  /** A sub-rubro belongs to one rubro; changing the rubro invalidates it. */
  const pickCategory = (uuid: string) => {
    setCategoryUuid(uuid);
    setSubcategoryUuid("");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const fields = {
        title: title.trim(),
        dueDate,
        // Both keys, always, in create and in edit: `null` is the API's
        // clearing sentinel, and "" would mean "no change" on a patch — which
        // is exactly how a rubro became impossible to take off again.
        category: categoryUuid || null,
        subcategory: subcategoryUuid || null,
        ...(repeats
          ? { recurrenceCount: Number(recurrenceCount), recurrenceUnit }
          : {}),
        reminderDays: Number(reminderDays),
      };

      if (editing) {
        // Assignments stay out: they are replaced through the permission-gated
        // assignments endpoint, and the update endpoint refuses them by design.
        onSaved(await api.updateDocument(editing.uuid, fields));
      } else {
        onCreated(
          await api.createDocument({
            ...fields,
            resolverUsers: resolvers.users,
            resolverGroups: resolvers.groups,
            watcherUsers: watchers.users,
            watcherGroups: watchers.groups,
          }),
        );
      }
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el documento.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="document-dialog-title"
      onCancel={handleClose}
      onClick={(event) => {
        // The dialog element itself is the backdrop area; the form covers the rest.
        if (event.target === dialogRef.current) handleClose();
      }}
    >
      <form onSubmit={handleSubmit}>
        <div className="dialog__head">
          <h2 className="dialog__title" id="document-dialog-title">
            {editing ? "Editar vencimiento" : "Nuevo vencimiento"}
          </h2>
        </div>

        <div className="dialog__body">
          <div className="field">
            <label className="field__label" htmlFor="document-name">
              Nombre
            </label>
            <input
              id="document-name"
              ref={titleRef}
              className="input"
              type="text"
              name="title"
              data-testid="document-title"
              required
              maxLength={200}
              autoComplete="off"
              placeholder="Factura Edenor julio"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor="document-category">
                Rubro
              </label>
              <select
                id="document-category"
                className="input"
                name="category"
                data-testid="document-category"
                value={categoryUuid}
                onChange={(event) => pickCategory(event.target.value)}
              >
                {/* An explicit choice, not an unfilled required field. */}
                <option value="">Sin rubro</option>
                {categories.map((category) => (
                  <option key={category.uuid} value={category.uuid}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="document-subcategory">
                Sub-rubro
              </label>
              <select
                id="document-subcategory"
                className="input"
                name="subcategory"
                disabled={subcategories.length === 0}
                value={subcategoryUuid}
                onChange={(event) => setSubcategoryUuid(event.target.value)}
              >
                <option value="">
                  {subcategories.length === 0 ? "Sin sub-rubros" : "Ninguno"}
                </option>
                {subcategories.map((subcategory) => (
                  <option key={subcategory.uuid} value={subcategory.uuid}>
                    {subcategory.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {categories.length === 0 ? (
            <p className="field__hint">
              Todavía no hay rubros: un administrador puede crearlos en Rubros. Igual podés cargar
              el vencimiento sin rubro y clasificarlo después.
            </p>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="document-due">
              Vencimiento
            </label>
            <input
              id="document-due"
              className="input"
              type="date"
              name="dueDate"
              data-testid="document-due-date"
              required
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="document-reminder-days">
              Avisar con
            </label>
            <div className="repeat">
              <input
                id="document-reminder-days"
                className="input input--tiny"
                type="number"
                name="reminderDays"
                data-testid="document-reminder-days"
                min={0}
                max={365}
                required
                value={reminderDays}
                onChange={(event) => setReminderDays(event.target.value)}
              />
              <span className="repeat__lead">días de anticipación</span>
            </div>
            <span className="field__hint">
              Desde ese día se incluye en el aviso diario, y sigue apareciendo mientras esté
              pendiente, incluso después de vencido. 0 = avisar sólo desde el día del vencimiento.
            </span>
          </div>

          <div className="field">
            <label className="picker__row picker__row--flush">
              <input
                type="checkbox"
                name="repeats"
                checked={repeats}
                // Editing cannot switch repetition off: the update endpoint has no
                // way to express "clear it", so an enabled checkbox here would
                // look like it worked and quietly do nothing.
                disabled={Boolean(editing?.recurrence)}
                onChange={(event) => setRepeats(event.target.checked)}
              />
              <span>Se repite</span>
            </label>

            {editing?.recurrence ? (
              <span className="field__hint">
                La repetición no se puede quitar desde acá; sí podés cambiar cada cuánto.
              </span>
            ) : null}

            {repeats ? (
              <div className="repeat">
                <span className="repeat__lead">Cada</span>
                <label className="sr-only" htmlFor="document-recurrence-count">
                  Cantidad
                </label>
                <input
                  id="document-recurrence-count"
                  className="input input--tiny"
                  type="number"
                  name="recurrenceCount"
                  min={1}
                  max={365}
                  required
                  value={recurrenceCount}
                  onChange={(event) => setRecurrenceCount(event.target.value)}
                />
                <label className="sr-only" htmlFor="document-recurrence-unit">
                  Unidad
                </label>
                <select
                  id="document-recurrence-unit"
                  className="input input--short"
                  name="recurrenceUnit"
                  value={recurrenceUnit}
                  onChange={(event) => setRecurrenceUnit(event.target.value as RecurrenceUnit)}
                >
                  {UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <span className="field__hint">
              Al resolverlo vas a poder crear el siguiente con la fecha ya calculada.
            </span>
          </div>

          {/* Assignment is create-only: the update endpoint deliberately refuses
              assignments, so offering the pickers while editing would be a form
              that accepts input and throws it away. */}
          {isAdmin && !editing ? (
            <div className="assign">
              <button
                type="button"
                className="disclosure disclosure--inline"
                aria-expanded={showAssign}
                onClick={() => setShowAssign((value) => !value)}
              >
                {showAssign ? "Ocultar asignación" : "Asignar"}
              </button>

              {showAssign ? (
                <>
                  <PeoplePicker
                    label="Puede resolver"
                    hint="Si no elegís a nadie, lo puede resolver cualquiera."
                    people={people}
                    groups={groups}
                    selectedUsers={resolvers.users}
                    selectedGroups={resolvers.groups}
                    onChange={setResolvers}
                  />
                  <PeoplePicker
                    label="Recibe avisos"
                    hint="Reciben un único aviso diario con todos sus vencimientos, desde los días de anticipación de cada uno. Si no elegís a nadie, los recibe todo el equipo de la empresa."
                    people={people}
                    groups={groups}
                    selectedUsers={watchers.users}
                    selectedGroups={watchers.groups}
                    onChange={setWatchers}
                  />
                </>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="notice" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="dialog__foot">
          <button type="button" className="btn" onClick={handleClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving}
            data-testid="document-submit"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
