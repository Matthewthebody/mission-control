import { useEffect, useState } from "react";
import { ApiClientError, apiFetch, apiUrl } from "../api";
import { setToken } from "../auth";
import { BrandMark } from "../components/BrandMark";
import { detectTeamsMode, rememberTeamsMode } from "../teamsHost";

type Props = {
  onLoggedIn: () => void;
  notice?: string;
};

const showDevLogin =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

type AuthOptions = {
  microsoft_entra_enabled: boolean;
  password_login_enabled: boolean;
  password_login_break_glass_only: boolean;
  dev_login_enabled: boolean;
};

export function Login({ onLoggedIn, notice }: Props) {
  const teamsMode = detectTeamsMode();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("LocalDemo123!");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authOptions, setAuthOptions] = useState<AuthOptions>(() => getDefaultAuthOptions());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await apiFetch<Partial<AuthOptions>>("/auth/options");
        if (cancelled) {
          return;
        }
        setAuthOptions(normalizeAuthOptions(response));
      } catch {
        if (cancelled) {
          return;
        }
        setAuthOptions(getDefaultAuthOptions());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const microsoftSignInEnabled = authOptions.microsoft_entra_enabled;
  const showLocalDevLogin = showDevLogin && authOptions.dev_login_enabled;
  const subtitle = microsoftSignInEnabled
    ? "Use Microsoft Entra ID for employee sign-in. Password and dev login stay available for local development and break-glass testing only."
    : "Microsoft Entra sign-in is disabled in this environment. Use password sign-in for local development or break-glass access.";
  const identityGuidance = microsoftSignInEnabled
    ? "Kemmetmueller Concierge, scheduling, permissions, and role access will attach after your Microsoft identity is matched to an internal employee record."
    : "Microsoft sign-in is unavailable here because Entra auth is disabled or not fully configured in this environment.";

  function startMicrosoftLogin() {
    const returnHash =
      window.location.hash && window.location.hash !== "#auth/callback"
        ? window.location.hash
        : teamsMode
          ? "#teams/home"
          : "#home";
    rememberTeamsMode(teamsMode);
    window.location.assign(`${apiUrl}/auth/microsoft/start?return_hash=${encodeURIComponent(returnHash)}`);
  }

  async function submitPasswordLogin() {
    setIsSubmitting(true);
    setError("");
    try {
      const response = await apiFetch<{ token: string }>("/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      setToken(response.token);
      onLoggedIn();
    } catch (err) {
      setError(formatLoginError(err, "We couldn't sign you in."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitDevLogin() {
    setIsSubmitting(true);
    setError("");
    try {
      const response = await apiFetch<{ token: string }>("/auth/dev-login", undefined, {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setToken(response.token);
      onLoggedIn();
    } catch (err) {
      setError(formatLoginError(err, "Local dev login is unavailable right now."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={`login-shell${teamsMode ? " login-shell--teams" : ""}`}>
      <section className="login-copy">
        <div className="eyebrow">{teamsMode ? "Microsoft Teams" : "Kemmetmueller Photography"}</div>
        <BrandMark size="lg" />
        <h1>{teamsMode ? "Sign in to the Teams employee home." : "Sign in to the live operations workspace."}</h1>
        <p>
          {teamsMode
            ? "The Teams personal app uses the same Microsoft identity and internal permissions as Mission Control, but keeps the experience focused on daily work, schedule, search, and high-signal updates."
            : "Scheduling, attendance, alerts, and access controls all run through this workspace. Microsoft Entra ID is the primary employee sign-in path, while password sign-in stays available for local development and break-glass testing."}
        </p>
        <div className="hero-notes">
          <div className="hero-note">
            <span className="hero-note__dot" />
            Secure session-based access
          </div>
          <div className="hero-note">
            <span className="hero-note__dot" />
            Live role and permission checks
          </div>
          <div className="hero-note">
            <span className="hero-note__dot" />
            Realtime scheduling and attendance
          </div>
        </div>
      </section>

      <section className="login-card panel">
        <div className="eyebrow">Studio Access</div>
        <h2>Sign In</h2>
        <p className="section-subtitle">{subtitle}</p>
        {microsoftSignInEnabled ? (
          <div className="login-actions login-actions--stacked">
            <button type="button" disabled={isSubmitting} onClick={startMicrosoftLogin}>
              {teamsMode ? "Open Teams Sign-In" : "Sign In With Microsoft"}
            </button>
          </div>
        ) : null}
        <div className="muted">{identityGuidance}</div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitPasswordLogin();
          }}
        >
          <label>
            <span className="field-label">Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span className="field-label">Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <div className="login-actions">
            <button type="submit" className="secondary-button" disabled={isSubmitting}>
              {isSubmitting ? "Signing In..." : "Password Sign-In"}
            </button>
            {showLocalDevLogin ? (
              <button type="button" className="secondary-button" disabled={isSubmitting} onClick={() => void submitDevLogin()}>
                Local Dev Login
              </button>
            ) : null}
          </div>
          <p className="muted">Local demo credentials for smoke testing: admin@example.com / LocalDemo123!</p>
        </form>
        {notice ? <div className="success-banner">{notice}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
      </section>
    </div>
  );
}

function formatLoginError(error: unknown, fallback: string) {
  if (error instanceof ApiClientError && error.status === 0) {
    return "We couldn't reach Mission Control. Check that the local API is running and try again.";
  }
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) {
    return fallback;
  }
  if (/network/i.test(message)) {
    return "We couldn't reach Mission Control. Check that the local API is running and try again.";
  }
  if (/invalid/i.test(message) || /credentials/i.test(message)) {
    return "That email and password combination did not work.";
  }
  return message;
}

function getDefaultAuthOptions(): AuthOptions {
  return {
    microsoft_entra_enabled: !showDevLogin,
    password_login_enabled: true,
    password_login_break_glass_only: false,
    dev_login_enabled: showDevLogin
  };
}

function normalizeAuthOptions(response: Partial<AuthOptions> | null | undefined): AuthOptions {
  const defaults = getDefaultAuthOptions();
  if (!response || typeof response !== "object") {
    return defaults;
  }
  return {
    microsoft_entra_enabled:
      typeof response.microsoft_entra_enabled === "boolean" ? response.microsoft_entra_enabled : defaults.microsoft_entra_enabled,
    password_login_enabled:
      typeof response.password_login_enabled === "boolean" ? response.password_login_enabled : defaults.password_login_enabled,
    password_login_break_glass_only:
      typeof response.password_login_break_glass_only === "boolean"
        ? response.password_login_break_glass_only
        : defaults.password_login_break_glass_only,
    dev_login_enabled: typeof response.dev_login_enabled === "boolean" ? response.dev_login_enabled : defaults.dev_login_enabled
  };
}
