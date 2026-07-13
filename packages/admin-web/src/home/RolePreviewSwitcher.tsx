import { HOME_ROLES, type HomeRoleId } from "./homeRoles";

// Leadership-only preview of the operating model. The Home shell mounts this
// ONLY for leadership sessions and every previewed surface is live-or-labeled,
// so the switcher can never place a real employee on a fabricated workspace.
export function RolePreviewSwitcher({
  value,
  onChange
}: {
  value: HomeRoleId;
  onChange: (id: HomeRoleId) => void;
}) {
  return (
    <label className="home-role-switcher">
      <span className="home-role-switcher__label">Preview seat</span>
      <select
        className="home-role-switcher__select"
        aria-label="Preview seat"
        value={value}
        onChange={(event) => onChange(event.target.value as HomeRoleId)}
      >
        {HOME_ROLES.map((role) => (
          <option key={role.id} value={role.id}>
            {role.label}
          </option>
        ))}
      </select>
    </label>
  );
}
