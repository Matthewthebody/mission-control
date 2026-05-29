import { config } from "../config.js";

function createAdminWebUrl() {
  return new URL(config.ADMIN_WEB_URL.replace(/\/$/, "/"));
}

export function buildTeamsEmbeddedAppUrl(deepLink: string) {
  if (/^https?:\/\//i.test(deepLink)) {
    return deepLink;
  }

  const url = createAdminWebUrl();
  url.searchParams.set("teams", "1");

  if (deepLink.startsWith("#")) {
    url.hash = deepLink.slice(1);
    return url.toString();
  }

  if (deepLink.startsWith("/")) {
    url.pathname = deepLink;
    return url.toString();
  }

  url.hash = deepLink;
  return url.toString();
}
