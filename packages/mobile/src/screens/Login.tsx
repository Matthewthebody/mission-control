import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { devLogin, passwordLogin } from "../auth";

type Props = {
  onLoggedIn: () => void;
};

export function LoginScreen({ onLoggedIn }: Props) {
  const [email, setEmail] = useState("photo@example.com");
  const [password, setPassword] = useState("LocalDemo123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function runPasswordLogin() {
    setLoading(true);
    setError("");
    try {
      await passwordLogin(email, password);
      onLoggedIn();
    } catch (err) {
      setError(formatLoginError(err, "We couldn't sign you in."));
    } finally {
      setLoading(false);
    }
  }

  async function runDevLogin() {
    setLoading(true);
    setError("");
    try {
      await devLogin(email);
      onLoggedIn();
    } catch (err) {
      setError(formatLoginError(err, "Local dev login is unavailable right now."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: "800" }}>Photographer Mission Control</Text>
      <Text>Sign in to view today's shifts, record punches, and send attendance updates.</Text>
      <TextInput value={email} onChangeText={setEmail} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput value={password} onChangeText={setPassword} secureTextEntry style={{ borderWidth: 1, padding: 8 }} />
      <Button title={loading ? "Signing In..." : "Sign In With Password"} disabled={loading} onPress={() => void runPasswordLogin()} />
      <Button title={loading ? "Working..." : "Local Dev Login"} disabled={loading} onPress={() => void runDevLogin()} />
      <Text>Use your assigned test account. Local demo password: LocalDemo123!</Text>
      {error ? <Text style={{ color: "#b42318" }}>{error}</Text> : null}
    </View>
  );
}

function formatLoginError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) {
    return fallback;
  }
  if (/network/i.test(message)) {
    return "We couldn't reach Mission Control. Check your connection and try again.";
  }
  if (/invalid/i.test(message) || /credentials/i.test(message)) {
    return "That email and password combination did not work.";
  }
  return message;
}
