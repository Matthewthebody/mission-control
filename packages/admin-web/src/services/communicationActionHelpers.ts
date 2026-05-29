export async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available in this environment.");
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();

  const copied = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
  document.body.removeChild(input);

  if (!copied) {
    throw new Error("Clipboard copy is unavailable in this browser.");
  }
}

export function buildImmediateMeetingWindow(now = new Date()) {
  const startAt = new Date(now);
  const endAt = new Date(now.getTime() + 30 * 60_000);
  return {
    scheduled_start_at: startAt.toISOString(),
    scheduled_end_at: endAt.toISOString()
  };
}
