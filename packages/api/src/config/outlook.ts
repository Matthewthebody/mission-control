const REQUIRED_OUTLOOK_ENV_KEYS = [
  "OUTLOOK_TENANT_ID",
  "OUTLOOK_CLIENT_ID",
  "OUTLOOK_CLIENT_SECRET",
  "OUTLOOK_REDIRECT_URI",
  "OUTLOOK_SCOPES"
] as const;

export const OUTLOOK_PILOT_CALLBACK_PATH = "/api/integrations/outlook/oauth/callback";
export const OUTLOOK_PILOT_APPROVED_SCOPES = ["offline_access", "User.Read", "Calendars.Read"] as const;
export const OUTLOOK_PILOT_SCOPE_STRING = OUTLOOK_PILOT_APPROVED_SCOPES.join(" ");

type OutlookEnvKey = (typeof REQUIRED_OUTLOOK_ENV_KEYS)[number];

export type OutlookOauthConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopesArray: string[];
  scopesString: string;
  authorityUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  graphBaseUrl: string;
};

export function getMissingOutlookOauthEnvVars(env: NodeJS.ProcessEnv = process.env) {
  return REQUIRED_OUTLOOK_ENV_KEYS.filter((key) => !readRequiredEnv(key, env, false));
}

export function isOutlookOauthConfigured(env: NodeJS.ProcessEnv = process.env) {
  try {
    createOutlookOauthConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function assertOutlookOauthConfig(env: NodeJS.ProcessEnv = process.env) {
  return createOutlookOauthConfig(env);
}

export function createOutlookOauthConfig(env: NodeJS.ProcessEnv = process.env): OutlookOauthConfig {
  const tenantId = readRequiredEnv("OUTLOOK_TENANT_ID", env);
  const clientId = readRequiredEnv("OUTLOOK_CLIENT_ID", env);
  const clientSecret = readRequiredEnv("OUTLOOK_CLIENT_SECRET", env);
  const redirectUri = validateRedirectUri(readRequiredEnv("OUTLOOK_REDIRECT_URI", env));
  const scopesArray = parseScopes(readScopeEnv(env));
  const authorityUrl = `https://login.microsoftonline.com/${tenantId}`;

  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    scopesArray,
    scopesString: scopesArray.join(" "),
    authorityUrl,
    authorizeUrl: `${authorityUrl}/oauth2/v2.0/authorize`,
    tokenUrl: `${authorityUrl}/oauth2/v2.0/token`,
    graphBaseUrl: "https://graph.microsoft.com/v1.0"
  };
}

function readRequiredEnv(key: OutlookEnvKey, env: NodeJS.ProcessEnv, throwOnMissing = true) {
  const value = env[key]?.trim();
  if (value) {
    return value;
  }
  if (!throwOnMissing) {
    return "";
  }
  throw new Error(`Missing required Outlook OAuth environment variable: ${key}`);
}

function readScopeEnv(env: NodeJS.ProcessEnv) {
  const rawValue = env.OUTLOOK_SCOPES;
  if (rawValue === undefined) {
    throw new Error("Missing required Outlook OAuth environment variable: OUTLOOK_SCOPES");
  }
  return rawValue;
}

function parseScopes(value: string) {
  const scopesArray = Array.from(
    new Set(
      value
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    )
  );

  if (!scopesArray.length) {
    throw new Error("OUTLOOK_SCOPES must contain at least one scope.");
  }

  const missingScopes = OUTLOOK_PILOT_APPROVED_SCOPES.filter((scope) => !scopesArray.includes(scope));
  const extraScopes = scopesArray.filter(
    (scope) => !OUTLOOK_PILOT_APPROVED_SCOPES.includes(scope as (typeof OUTLOOK_PILOT_APPROVED_SCOPES)[number])
  );

  if (missingScopes.length || extraScopes.length) {
    throw new Error(
      `OUTLOOK_SCOPES must exactly match the Phase 1 delegated Outlook pilot scopes: ${OUTLOOK_PILOT_SCOPE_STRING}.`
    );
  }

  return [...OUTLOOK_PILOT_APPROVED_SCOPES];
}

function validateRedirectUri(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("OUTLOOK_REDIRECT_URI must be a valid absolute URL.");
  }

  if (!parsed.protocol || !parsed.hostname) {
    throw new Error("OUTLOOK_REDIRECT_URI must be a valid absolute URL.");
  }

  if (parsed.pathname !== OUTLOOK_PILOT_CALLBACK_PATH) {
    throw new Error(`OUTLOOK_REDIRECT_URI must use the Phase 1 Outlook callback path ${OUTLOOK_PILOT_CALLBACK_PATH}.`);
  }

  return parsed.toString();
}
