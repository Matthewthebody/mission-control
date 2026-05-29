import { createThrottle } from "./throttle.js";

const throttle = createThrottle(5, 1000);

export async function airtableRequest(path: string, token: string, init?: RequestInit) {
  await throttle();
  const response = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  return response.json();
}
