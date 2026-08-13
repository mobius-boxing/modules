import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api/client";
import type { Group, Person } from "../types/api";

export function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [groupList, peopleList] = await Promise.all([api.listGroups(), api.listPeople()]);
      setGroups(groupList);
      setPeople(peopleList);
    } catch {
      setError("No se pudieron cargar los grupos.");
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
      await api.createGroup(name);
      setName("");
      setCreating(false);
    });
  };

  const toggleMember = (group: Group, personUuid: string) => {
    const current = group.members.map((member) => member.uuid);
    const next = current.includes(personUuid)
      ? current.filter((uuid) => uuid !== personUuid)
      : [...current, personUuid];
    return act(group.uuid, async () => {
      await api.setGroupMembers(group.uuid, next);
    });
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Grupos</h1>
        <span className="page__count tabular">{groups.length}</span>
        <button
          type="button"
          className="btn btn--primary"
          aria-expanded={creating}
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? "Cancelar" : "Crear grupo"}
        </button>
      </div>

      <p className="page__lead">
        La pertenencia se resuelve en el momento: si agregás a alguien, pasa a poder resolver los
        documentos que ya estaban asignados al grupo.
      </p>

      {creating ? (
        <form className="inline-form" onSubmit={create}>
          <div className="field">
            <label className="field__label" htmlFor="group-name">
              Nombre del grupo
            </label>
            <input
              id="group-name"
              className="input"
              type="text"
              name="name"
              required
              autoFocus
              maxLength={80}
              placeholder="Contaduría"
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
      ) : groups.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Todavía no hay grupos</p>
          <p className="empty__hint">
            Un grupo te deja asignar un documento a varias personas de una vez, sin elegirlas una
            por una cada vez.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            Crear el primero
          </button>
        </div>
      ) : (
        <ul className="rows rows--spaced">
          {groups.map((group) => {
            const open = editing === group.uuid;
            const armed = confirming === group.uuid;
            return (
              <li className="row row--plain row--stacked" key={group.uuid}>
                <span className="row__main">
                  <span className="row__name">{group.name}</span>
                  <span className="row__meta">
                    {group.members.length === 0
                      ? "Sin miembros. Un documento asignado sólo a este grupo no lo puede resolver nadie."
                      : group.members.map((member) => member.name).join(", ")}
                  </span>
                </span>

                <span className="row__actions row__actions--always">
                  {armed ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--quiet btn--danger is-armed"
                        disabled={busy === group.uuid}
                        onClick={() => {
                          setConfirming(null);
                          void act(group.uuid, () => api.deleteGroup(group.uuid));
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
                        aria-expanded={open}
                        onClick={() => setEditing(open ? null : group.uuid)}
                      >
                        {open ? "Listo" : "Miembros"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--danger"
                        onClick={() => setConfirming(group.uuid)}
                      >
                        Eliminar
                      </button>
                    </>
                  )}
                </span>

                {open ? (
                  <div className="row__panel">
                    <div className="picker__well">
                      {people.map((person) => (
                        <label className="picker__row" key={person.uuid}>
                          <input
                            type="checkbox"
                            name={`member-${person.uuid}`}
                            checked={group.members.some((member) => member.uuid === person.uuid)}
                            disabled={busy === group.uuid}
                            onChange={() => toggleMember(group, person.uuid)}
                          />
                          <span>{person.name}</span>
                        </label>
                      ))}
                    </div>
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
