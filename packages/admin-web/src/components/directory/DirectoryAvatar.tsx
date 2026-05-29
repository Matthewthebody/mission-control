type Props = {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
  kind?: "organization" | "contact";
};

export function DirectoryAvatar({ name, imageUrl, size = "md", kind = "contact" }: Props) {
  const initials = buildInitials(name);

  if (imageUrl) {
    return (
      <div className={`directory-avatar directory-avatar--${size} directory-avatar--${kind}`}>
        <img src={imageUrl} alt={name} />
      </div>
    );
  }

  return (
    <div className={`directory-avatar directory-avatar--${size} directory-avatar--${kind} directory-avatar--fallback`} aria-hidden="true">
      {initials}
    </div>
  );
}

function buildInitials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) {
    return "NA";
  }
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}
