export function toGraphicsLabel(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/\bPhotography\b/g, "Studios")
    .replace(/\bphotography\b/g, "studios")
    .replace(/\bProduction\b/g, "Graphics")
    .replace(/\bproduction\b/g, "graphics");
}
