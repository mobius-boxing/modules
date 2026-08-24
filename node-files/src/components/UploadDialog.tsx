import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Workflow } from "../types/api";

/**
 * The upload cap and the accepted types are the API's (20 MB, and the six mime
 * types the extractor can read). They are repeated here only to fail early with
 * a readable message — the server is the one that enforces them, and a file
 * that slips past this check still gets a 400.
 */
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
];

interface Props {
  /** The workflow the document is uploaded to, or null when closed. */
  workflow: Workflow | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onUpload: (file: File) => void;
}

/**
 * Native <dialog>: focus trap, Escape, top layer and focus restoration all come
 * from the platform instead of hand-rolled JS that gets them subtly wrong.
 */
export function UploadDialog({ workflow, busy, error, onCancel, onUpload }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // Modal state is reset on open: the dialog closes without unmounting, so a
  // stale file from the previous upload would otherwise still be selected.
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (workflow && !element.open) {
      setFile(null);
      setLocalError(null);
      element.showModal();
    } else if (!workflow && element.open) {
      element.close();
    }
  }, [workflow]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setLocalError("El archivo supera los 20 MB permitidos.");
      return;
    }
    if (file.type !== "" && !ACCEPTED.includes(file.type)) {
      setLocalError("Formato no admitido. Se aceptan PDF, PNG, JPG, WEBP, TXT y CSV.");
      return;
    }
    setLocalError(null);
    onUpload(file);
  };

  /** The local check speaks first; the API's own answer is the fallback. */
  const message = localError ?? error;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="upload-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={handleSubmit}>
        <div className="dialog__head">
          <h2 className="dialog__title" id="upload-title">
            Subir documento
          </h2>
        </div>

        <div className="dialog__body">
          <p className="dialog__lead">
            El documento se procesa con <strong>{workflow?.name}</strong> y queda como una ejecución
            que podés seguir desde Ejecuciones.
          </p>

          <div className="field">
            <label className="field__label" htmlFor="upload-file">
              Archivo
            </label>
            <input
              id="upload-file"
              className="input"
              type="file"
              name="file"
              data-testid="upload-file"
              required
              accept={ACCEPTED.join(",")}
              onChange={(event) => {
                setLocalError(null);
                setFile(event.target.files?.[0] ?? null);
              }}
            />
            <span className="field__hint">PDF, PNG, JPG, WEBP, TXT o CSV. Hasta 20 MB.</span>
          </div>

          {message ? (
            <p className="notice" role="alert" data-testid="upload-error">
              {message}
            </p>
          ) : null}
        </div>

        <div className="dialog__foot">
          <button
            type="button"
            className="btn"
            data-testid="upload-cancel"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            data-testid="upload-submit"
            disabled={busy || !file}
          >
            {busy ? "Subiendo…" : "Subir y procesar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
