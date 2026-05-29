export function readRetryAfterSeconds(headers: Headers) {
  const value = headers.get("Retry-After");
  if (!value) {
    return null;
  }

  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.floor(asSeconds);
  }

  const retryDate = Date.parse(value);
  if (Number.isNaN(retryDate)) {
    return null;
  }

  const deltaSeconds = Math.ceil((retryDate - Date.now()) / 1000);
  return deltaSeconds > 0 ? deltaSeconds : 0;
}
