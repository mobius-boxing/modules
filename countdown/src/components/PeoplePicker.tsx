import type { Group, Person } from "../types/api";

interface Props {
  label: string;
  hint: string;
  people: Person[];
  groups: Group[];
  selectedUsers: string[];
  selectedGroups: string[];
  onChange: (next: { users: string[]; groups: string[] }) => void;
}

const toggle = (list: string[], uuid: string): string[] =>
  list.includes(uuid) ? list.filter((item) => item !== uuid) : [...list, uuid];

/**
 * Plain checkboxes in a scrolling well. A team of eight fits without a search
 * box, and a real <input type="checkbox"> is keyboard- and screen-reader-correct
 * for free — this is not the place to invent an affordance.
 */
export function PeoplePicker({
  label,
  hint,
  people,
  groups,
  selectedUsers,
  selectedGroups,
  onChange,
}: Props) {
  return (
    <fieldset className="picker">
      <legend className="field__label">{label}</legend>
      <p className="field__hint">{hint}</p>

      <div className="picker__well">
        {groups.length > 0 ? (
          <>
            <p className="picker__section">Grupos</p>
            {groups.map((group) => (
              <label className="picker__row" key={group.uuid}>
                <input
                  type="checkbox"
                  name={`group-${group.uuid}`}
                  checked={selectedGroups.includes(group.uuid)}
                  onChange={() =>
                    onChange({
                      users: selectedUsers,
                      groups: toggle(selectedGroups, group.uuid),
                    })
                  }
                />
                <span>{group.name}</span>
                <span className="picker__meta">
                  {group.members.length === 1 ? "1 persona" : `${group.members.length} personas`}
                </span>
              </label>
            ))}
          </>
        ) : null}

        <p className="picker__section">Personas</p>
        {people.map((person) => (
          <label className="picker__row" key={person.uuid}>
            <input
              type="checkbox"
              name={`user-${person.uuid}`}
              checked={selectedUsers.includes(person.uuid)}
              onChange={() =>
                onChange({ users: toggle(selectedUsers, person.uuid), groups: selectedGroups })
              }
            />
            <span>{person.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
