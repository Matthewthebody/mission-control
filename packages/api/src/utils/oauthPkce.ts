import crypto from "node:crypto";

export type OauthPkcePair = {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

export function createOauthPkcePair(): OauthPkcePair {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256"
  };
}
