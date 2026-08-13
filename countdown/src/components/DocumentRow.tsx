import { useState } from "react";
import { dueLabel, formatDate, formatFullDate, formatTimestamp, urgency } from "../lib/format";
import { describeRecurrence } from "../types/api";
import type { DocumentItem } from "../types/api";

interface Props {
  doc: DocumentItem;
  canDelete: boolean;
  isNew: boolean;
  /** Only true when more than one person has filed something; see WorkspacePage. */
  showUploader: boolean;
  onToggleStatus: (doc: DocumentItem) => void;
  onEdit: (doc: DocumentItem) => void;
  onDelete: (doc: DocumentItem) => void;
  busy: boolean;
}

export function DocumentRow({
  doc,
  canDelete,
  isNew,
  showUploader,
  onToggleStatus,
  onEdit,
  onDelete,
  busy,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const level = urgency(doc.daysUntilDue, doc.status);
  const resolved = doc.status === "resolved";

  /**
   * A shared queue needs visible hands — but only where they say something.
   * Who resolved an item always matters. Who filed it matters only when the
   * team is actually sharing the queue; on a single-user account it would be the
   * same name under all fifty rows.
   */
  const assignedTo = [
    ...doc.resolvers.groups.map((group) => group.name),
    ...doc.resolvers.users.map((user) => user.name),
  ];

  // Rubro leads: it is what the client classifies by, and what the filter above
  // the list acts on. Sub-rubro rides along when there is one.
  const rubro = doc.category
    ? doc.subcategory
      ? `${doc.category.name} · ${doc.subcategory.name}`
      : doc.category.name
    : null;

  const trailing = resolved
    ? `Resuelto por ${doc.resolvedByName ?? "alguien"}${
        doc.resolvedAt ? ` · ${formatTimestamp(doc.resolvedAt)}` : ""
      }`
    : assignedTo.length > 0
      ? `Asignado a ${assignedTo.join(", ")}`
      : showUploader
        ? (doc.uploadedBy?.name ?? null)
        : null;

  const meta = [rubro, doc.recurrence ? describeRecurrence(doc.recurrence) : null, trailing]
    .filter(Boolean)
    .join(" · ");

  // The band class carries the row's colour to the tint, the left rule, the
  // light and the date at once — see § bands in global.css.
  return (
    <li
      className={`row band--${level}${resolved ? " row--resolved" : ""}${
        isNew ? " row--new" : ""
      }`}
    >
      <span className="dot" aria-hidden="true" />

      <span className="row__main">
        <span className="row__title-text">{doc.title}</span>
        {meta ? <span className="row__meta">{meta}</span> : null}
      </span>

      <time
        className="row__when"
        dateTime={doc.dueDate}
        title={formatFullDate(doc.dueDate)}
      >
        {formatDate(doc.dueDate)} · {dueLabel(doc.daysUntilDue, doc.status)}
      </time>

      <span className="row__actions">
        {confirming ? (
          <>
            <button
              type="button"
              className="btn btn--quiet btn--danger is-armed"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onDelete(doc);
              }}
            >
              Confirmar
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </button>
          </>
        ) : (
          <>
            {/* Hidden rather than disabled when they may not resolve: a greyed
                button invites clicking to find out why. The server refuses it
                either way. */}
            {doc.canResolve ? (
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => onToggleStatus(doc)}
              >
                {resolved ? "Reabrir" : "Resuelto"}
              </button>
            ) : null}
            {/* Not admin-gated, unlike Eliminar: editing a document needs only
                the module, so anyone who can see the row can correct it. A
                resolved document is history and is edited by reopening it. */}
            {resolved ? null : (
              <button
                type="button"
                className="btn btn--quiet"
                data-testid="document-edit"
                disabled={busy}
                onClick={() => onEdit(doc)}
              >
                Editar
              </button>
            )}
            {canDelete ? (
              <button
                type="button"
                className="btn btn--quiet btn--danger"
                onClick={() => setConfirming(true)}
              >
                Eliminar
              </button>
            ) : null}
          </>
        )}
      </span>
    </li>
  );
}
