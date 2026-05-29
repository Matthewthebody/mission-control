import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

document.documentElement.dataset.appReady = "true";
document.getElementById("app-fallback")?.setAttribute("hidden", "true");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const isLocalDevHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocalDevHost) {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister()))
      );
      return;
    }

    void navigator.serviceWorker.register("/sw.js");
  });
}
