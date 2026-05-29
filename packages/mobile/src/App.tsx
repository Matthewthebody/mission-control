import { useEffect, useState } from "react";
import { initDb } from "./db";
import { syncOfflineQueue } from "./syncer";
import { LoginScreen } from "./screens/Login";
import { ShootScreen } from "./screens/Shoot";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    initDb();
    void syncOfflineQueue();
  }, []);

  return loggedIn ? <ShootScreen /> : <LoginScreen onLoggedIn={() => setLoggedIn(true)} />;
}
