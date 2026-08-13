import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api/client";
import type { Category } from "../types/api";

function documentsLabel(count: number): string {
  if (count === 0) return "Sin documentos";
  return count === 1 ? "1 documento" : `${count} documentos`;
}

/** Which row is being renamed. Rubros and sub-rubros share the state because a
 *  uuid identifies exactly one of them and only one is ever open at a time. */
interface Renaming {
  uuid: string;
  kind: "category" | "subcategory";
  value: string;
}

/**
 * Rubros and their sub-rubros. Deliberately shaped like Grupos: a page the
 * client visits rarely, so the create form stays folded away and each row keeps
 * its own actions rather than hiding them behind a selection.
 *
 * Renaming is inline rather than a dialog — it changes one short string, and a
 * modal for one field is heavier than the edit itself.
 */
export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [subName, setSubName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);

  const load = useCallback(async () => {
    try {
      setCategories(await api.listCategories());
    } catch {
      setError("No se pudieron cargar los rubros.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, action: () => Promise<void>) => {
    setError(null);
    setBusy(key);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "La acción no se pudo completar.");
    } finally {
      setBusy(null);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    return act("create", async () => {
      await api.createCategory(name);
      setName("");
      setCreating(false);
    });
  };

  const addSubcategory = (categoryUuid: string) => (event: FormEvent) => {
    event.preventDefault();
    return act(categoryUuid, async () => {
      await api.createSubcategory(categoryUuid, subName);
      setSubName("");
    });
  };

  /** One submit handler for both kinds; only the endpoint differs. */
  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (!renaming) return;
    const { uuid, kind, value } = renaming;
    return act(uuid, async () => {
      if (kind === "category") await api.renameCategory(uuid, value);
      else await api.renameSubcategory(uuid, value);
      setRenaming(null);
    });
  };

  /** Escape cancels, so a rename never traps you in an edit you didn't want. */
  const renameKeyDown = (event: { key: string }) => {
    if (event.key === "Escape") setRenaming(null);
  };

  const renameForm = (label: string) => (
    <form className="rename" onSubmit={submitRename}>
      <label className="sr-only" htmlFor="rename-input">
        {label}
      </label>
      <input
        id="rename-input"
        className="input"
        type="text"
        name="name"
        required
        autoFocus
        maxLength={80}
        value={renaming?.value ?? ""}
        onKeyDown={renameKeyDown}
        onChange={(event) =>
          setRenaming((current) => (current ? { ...current, value: event.target.value } : current))
        }
      />
      <button className="btn btn--primary" type="submit" disabled={busy === renaming?.uuid}>
        Guardar
      </button>
      <button type="button" className="btn" onClick={() => setRenaming(null)}>
        Cancelar
      </button>
    </form>
  );

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Rubros</h1>
        <span className="page__count tabular">{categories.length}</span>
        <button
          type="button"
          className="btn btn--primary"
          aria-expanded={creating}
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? "Cancelar" : "Crear rubro"}
        </button>
      </div>

      <p className="page__lead">
        Cada vencimiento se carga con un rubro. El sub-rubro es opcional y sirve para abrir un rubro
        grande en partes: Servicios → Electricidad, Gas, Internet.
      </p>

      {creating ? (
        <form className="inline-form" onSubmit={create}>
          <div className="field">
            <label className="field__label" htmlFor="category-name">
              Nombre del rubro
            </label>
            <input
              id="category-name"
              className="input"
              type="text"
              name="name"
              required
              autoFocus
              maxLength={80}
              placeholder="Servicios"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button className="btn btn--primary" type="submit" disabled={busy === "create"}>
            {busy === "create" ? "Creando…" : "Crear"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="group" aria-hidden="true">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : categories.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Todavía no hay rubros</p>
          <p className="empty__hint">
            Hasta que exista al menos uno no se pueden cargar vencimientos, porque el rubro es
            obligatorio.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            Crear el primero
          </button>
        </div>
      ) : (
        <ul className="rows rows--spaced">
          {categories.map((category) => {
            const open = editing === category.uuid;
            const armed = confirming === category.uuid;
            const isRenaming = renaming?.kind === "category" && renaming.uuid === category.uuid;
            return (
              <li className="row row--plain row--stacked" key={category.uuid}>
                <span className="row__main">
                  {isRenaming ? (
                    renameForm(`Nuevo nombre para ${category.name}`)
                  ) : (
                    <>
                      <span className="row__name">{category.name}</span>
                      <span className="row__meta">
                        {documentsLabel(category.documentCount)}
                        {category.subcategories.length > 0
                          ? ` · ${category.subcategories.map((sub) => sub.name).join(", ")}`
                          : " · Sin sub-rubros"}
                      </span>
                    </>
                  )}
                </span>

                {isRenaming ? null : (
                  <span className="row__actions row__actions--always">
                    {armed ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--quiet btn--danger is-armed"
                          disabled={busy === category.uuid}
                          onClick={() => {
                            setConfirming(null);
                            void act(category.uuid, () => api.deleteCategory(category.uuid));
                          }}
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={() => setConfirming(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={() =>
                            setRenaming({
                              uuid: category.uuid,
                              kind: "category",
                              value: category.name,
                            })
                          }
                        >
                          Renombrar
                        </button>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          aria-expanded={open}
                          onClick={() => {
                            setSubName("");
                            setEditing(open ? null : category.uuid);
                          }}
                        >
                          {open ? "Listo" : "Sub-rubros"}
                        </button>
                        <button
                          type="button"
                          className="btn btn--quiet btn--danger"
                          onClick={() => setConfirming(category.uuid)}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </span>
                )}

                {open ? (
                  <div className="row__panel">
                    <ul className="sublist">
                      {category.subcategories.map((subcategory) => {
                        const renamingSub =
                          renaming?.kind === "subcategory" && renaming.uuid === subcategory.uuid;
                        return (
                          <li className="sublist__row" key={subcategory.uuid}>
                            {renamingSub ? (
                              renameForm(`Nuevo nombre para ${subcategory.name}`)
                            ) : (
                              <>
                                <span className="sublist__name">{subcategory.name}</span>
                                <span className="sublist__meta tabular">
                                  {documentsLabel(subcategory.documentCount)}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn--quiet"
                                  onClick={() =>
                                    setRenaming({
                                      uuid: subcategory.uuid,
                                      kind: "subcategory",
                                      value: subcategory.name,
                                    })
                                  }
                                >
                                  Renombrar
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--quiet btn--danger"
                                  disabled={busy === category.uuid}
                                  onClick={() =>
                                    act(category.uuid, () =>
                                      api.deleteSubcategory(subcategory.uuid),
                                    )
                                  }
                                >
                                  Eliminar
                                </button>
                              </>
                            )}
                          </li>
                        );
                      })}
                      {category.subcategories.length === 0 ? (
                        <li className="sublist__row sublist__row--empty">
                          Este rubro todavía no tiene sub-rubros.
                        </li>
                      ) : null}
                    </ul>

                    <form
                      className="inline-form inline-form--tight"
                      onSubmit={addSubcategory(category.uuid)}
                    >
                      <div className="field">
                        <label className="sr-only" htmlFor={`sub-${category.uuid}`}>
                          Nuevo sub-rubro de {category.name}
                        </label>
                        <input
                          id={`sub-${category.uuid}`}
                          className="input"
                          type="text"
                          name="subcategoryName"
                          required
                          maxLength={80}
                          placeholder="Electricidad"
                          value={subName}
                          onChange={(event) => setSubName(event.target.value)}
                        />
                      </div>
                      <button className="btn" type="submit" disabled={busy === category.uuid}>
                        Agregar
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
