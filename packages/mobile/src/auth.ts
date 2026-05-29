import { mobileFetch } from "./api";

let token = "";

export async function passwordLogin(email: string, password: string) {
  const response = await mobileFetch<{ token: string }>("/auth/login", undefined, {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  token = response.token;
  return token;
}

export async function devLogin(email: string) {
  const response = await mobileFetch<{ token: string }>("/auth/dev-login", undefined, {
    method: "POST",
    body: JSON.stringify({ email })
  });
  token = response.token;
  return token;
}

export function getToken() {
  return token;
}
