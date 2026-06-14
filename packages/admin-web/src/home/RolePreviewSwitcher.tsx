import { HOME_ROLES, type HomeRoleId } from "./homeRoles";

// Demo-safe role preview. Lets anyone walk the operating model from each seat
// without real authentication. Persistence is handled by the Home shell.
export function RolePreviewSwitcher({
  value,
  onChange
}: {
  value: HomeRoleId;
  onChange: (id: HomeRoleId) => void;
}) {
  return (
    <label className="home-role-switcher">
      <span className="home-role-switcher__label">Viewing as</span>
      <select
        className="home-role-switcher__select"
        aria-label="Viewing as"
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
