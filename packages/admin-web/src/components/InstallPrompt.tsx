import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) {
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setInstallEvent(null);
    }
  }

  if (installed) {
    return <div className="metric-pill">PWA ready</div>;
  }

  if (!installEvent) {
    return null;
  }

  return (
    <button className="secondary-button" type="button" onClick={() => void install()}>
      Install App
    </button>
  );
}

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}
