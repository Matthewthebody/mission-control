export type ThemeMode = "dark" | "light";

type Props = {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
};

export function ThemeToggle({ theme, onChange }: Props) {
  return (
    <div className="theme-toggle" role="group" aria-label="Theme toggle">
      <button className={theme === "dark" ? "is-active" : ""} onClick={() => onChange("dark")} type="button">
        Dark
      </button>
      <button className={theme === "light" ? "is-active" : ""} onClick={() => onChange("light")} type="button">
        Light
      </button>
    </div>
  );
}
