import { FormEvent, useEffect, useRef, useState } from "react";
import { nextDueDate } from "../lib/format";
import { describeRecurrence } from "../types/api";
import type { DocumentItem } from "../types/api";

interface Props {
  /** The document being resolved, or null when the dialog is closed. */
  document: DocumentItem | null;
  busy: boolean;
  onCancel: () => void;
  onResolve: (nextDue: string | null) => void;
}

/**
 * Shown only for documents that repeat — a one-off *habilitación municipal*
 * should not be asked this every time it is resolved.
 *
 * The next date is computed from the recurrence and left editable, because the
 * supplier who moved the date is the reason anyone opens this dialog twice.
 */
export function RenewDialog({ document: doc, busy, onCancel, onResolve }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [nextDue, setNextDue] = useState("");

  useEffect(() => {
    if (!doc?.recurrence) return;
    setNextDue(nextDueDate(doc.dueDate, doc.recurrence.count, doc.recurrence.unit));
  }, [doc]);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (doc && !element.open) element.showModal();
    else if (!doc && element.open) element.close();
  }, [doc]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onResolve(nextDue);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="renew-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={handleSubmit}>
        <div className="dialog__head">
          <h2 className="dialog__title" id="renew-title">
            Resolver y renovar
          </h2>
        </div>

        <div className="dialog__body">
          <p className="dialog__lead">
            <strong>{doc?.title}</strong> se repite{" "}
            {doc?.recurrence ? describeRecurrence(doc.recurrence) : ""}. Al resolverlo se crea el
            siguiente con la fecha que elijas.
          </p>

          <div className="field">
            <label className="field__label" htmlFor="renew-due">
              Próximo vencimiento
            </label>
            <input
              id="renew-due"
              className="input"
              type="date"
              name="nextDueDate"
              required
              value={nextDue}
              onChange={(event) => setNextDue(event.target.value)}
            />
          </div>
        </div>

        <div className="dialog__foot">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          {/* Resolving without renewing has to stay one click away, or a document
              that stops repeating becomes impossible to close cleanly. */}
          <button type="button" className="btn" onClick={() => onResolve(null)} disabled={busy}>
            Sólo resolver
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Guardando…" : "Resolver y renovar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
