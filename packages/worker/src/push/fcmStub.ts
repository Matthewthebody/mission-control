import { readFileSync } from "node:fs";
import admin from "firebase-admin";
import { config } from "../config.js";

let initialized = false;

function ensureApp() {
  if (initialized) {
    return true;
  }
  if (config.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const serviceAccount = JSON.parse(readFileSync(config.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    return true;
  }
  if (config.FIREBASE_PROJECT_ID && config.FIREBASE_CLIENT_EMAIL && config.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.FIREBASE_PROJECT_ID,
        clientEmail: config.FIREBASE_CLIENT_EMAIL,
        privateKey: config.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
    initialized = true;
    return true;
  }
  return false;
}

export async function sendPush(token: string, payload: { title: string; body: string; deepLink?: string }) {
  if (!ensureApp()) {
    return {
      ok: false,
      code: "disabled",
      response: { reason: "Firebase credentials missing" }
    };
  }
  try {
    const response = await admin.messaging().send({
      token,
      notification: {
        title: payload.title,
        body: payload.body
      },
      data: payload.deepLink ? { deep_link: payload.deepLink } : undefined
    });
    return {
      ok: true,
      code: "sent",
      response: { messageId: response }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const code =
      message.includes("registration-token-not-registered") || message.includes("invalid-registration-token")
        ? "invalid_token"
        : "error";
    return {
      ok: false,
      code,
      response: { message }
    };
  }
}
