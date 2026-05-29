import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

const ENCRYPTION_PREFIX = "enc:v1";

function getEncryptionKey() {
  const source = config.OUTLOOK_TOKEN_ENCRYPTION_SECRET || config.JWT_SECRET;
  return createHash("sha256").update(source).digest();
}

function toBase64Url(value: Buffer) {
  return value.toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

export function encryptSecret(value: string, associatedData?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  if (associatedData) {
    cipher.setAAD(Buffer.from(associatedData));
  }
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [ENCRYPTION_PREFIX, toBase64Url(iv), toBase64Url(authTag), toBase64Url(encrypted)].join(".");
}

export function decryptSecret(payload: string, associatedData?: string) {
  const [prefix, ivEncoded, authTagEncoded, encryptedEncoded] = payload.split(".");
  if (prefix !== ENCRYPTION_PREFIX || !ivEncoded || !authTagEncoded || !encryptedEncoded) {
    throw new Error("Encrypted secret is malformed");
  }

  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), fromBase64Url(ivEncoded));
  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData));
  }
  decipher.setAuthTag(fromBase64Url(authTagEncoded));
  const decrypted = Buffer.concat([decipher.update(fromBase64Url(encryptedEncoded)), decipher.final()]);
  return decrypted.toString("utf8");
}
