import { createSign } from "node:crypto";
import type { ServiceAccountJson } from "./types.js";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function base64url(value: string | Buffer): string {
  const buf = typeof value === "string" ? Buffer.from(value) : value;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function buildJwt(account: ServiceAccountJson): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: GSC_SCOPE,
      aud: account.token_uri,
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const sig = base64url(signer.sign(account.private_key));
  return `${unsigned}.${sig}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/** Exchange a service-account JWT for a short-lived Bearer token. */
export async function fetchGscAccessToken(
  account: ServiceAccountJson,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const jwt = buildJwt(account);
  const res = await fetchImpl(account.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC token exchange failed ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}
