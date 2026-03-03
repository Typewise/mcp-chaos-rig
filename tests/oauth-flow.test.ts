import { test, expect, beforeAll } from "vitest";
import { api, fullPost, resetState, ensureServer, BASE } from "./helpers.js";

beforeAll(async () => {
  await ensureServer();
  await resetState();
});

async function obtainAccessToken(): Promise<string> {
  const regRes = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "test-client",
      redirect_uris: ["http://localhost:9999/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  const client = await regRes.json();

  const authUrl = new URL(`${BASE}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", "http://localhost:9999/callback");
  authUrl.searchParams.set("state", "test-state");
  authUrl.searchParams.set("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  authUrl.searchParams.set("code_challenge_method", "S256");

  const consentRes = await fetch(authUrl.toString(), { redirect: "manual" });
  const consentHtml = await consentRes.text();
  const pendingId = consentHtml.match(/name="id"\s+value="([^"]+)"/)![1];

  const approveRes = await fetch(`${BASE}/oauth/authorize-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `id=${pendingId}&action=approve`,
    redirect: "manual",
  });
  const redirectUrl = new URL(approveRes.headers.get("location")!);
  const authCode = redirectUrl.searchParams.get("code")!;

  const tokenRes = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: "http://localhost:9999/callback",
      code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    }).toString(),
  });
  const tokens = await tokenRes.json();
  return tokens.access_token;
}

test("reject-auth with scope: header includes scope on 401", async () => {
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
  await api("/api/scope-settings", { wwwAuthenticateScope: "protected" });
  await api("/api/reject-auth", { target: "oauth", mode: "401" });

  const resp = await fullPost("/mcp");
  expect(resp.headers.get("www-authenticate") ?? "").toContain('scope="protected"');
  expect(resp.status).toBe(401);
});

test("valid token not rejected despite mismatched wwwAuthenticateScope", async () => {
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
  await api("/api/scope-settings", { wwwAuthenticateScope: "completely-different-scope" });

  const token = await obtainAccessToken();
  const resp = await fullPost("/mcp", { Authorization: `Bearer ${token}` });
  expect(resp.status).not.toBe(403);
  expect(resp.status).not.toBe(401);
});

test("unauthenticated request still shows advertised scope in header", async () => {
  const resp = await fullPost("/mcp");
  expect(resp.headers.get("www-authenticate") ?? "").toContain('scope="completely-different-scope"');
});

test("enforceScopeMatching OFF: token passes despite scope mismatch", async () => {
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
  await api("/api/scope-settings", { scopes: ["admin", "write"], enforceScopeMatching: false });

  const token = await obtainAccessToken();
  const resp = await fullPost("/mcp", { Authorization: `Bearer ${token}` });
  expect(resp.status).not.toBe(403);
  expect(resp.status).not.toBe(401);
});

test("enforceScopeMatching ON: token rejected with 403 for scope mismatch", async () => {
  await api("/api/scope-settings", { enforceScopeMatching: true });
  const token = await obtainAccessToken();
  const resp = await fullPost("/mcp", { Authorization: `Bearer ${token}` });
  expect(resp.status).toBe(403);
});

test("enforceScopeMatching ON: unauthenticated gets 401 not 403", async () => {
  const resp = await fullPost("/mcp");
  expect(resp.status).toBe(401);
});

test("enforceScopeMatching toggled back OFF: token passes again", async () => {
  await api("/api/scope-settings", { enforceScopeMatching: false });
  const token = await obtainAccessToken();
  const resp = await fullPost("/mcp", { Authorization: `Bearer ${token}` });
  expect(resp.status).not.toBe(403);
  expect(resp.status).not.toBe(401);
});
