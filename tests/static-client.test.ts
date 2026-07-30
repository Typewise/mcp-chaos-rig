import { test, expect, beforeAll } from "vitest";
import { api, fullPost, resetState, ensureServer, BASE } from "./helpers.js";

const REDIRECT_URI = "http://localhost:9999/callback";
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

beforeAll(async () => {
  await ensureServer();
  await resetState();
});

async function useStaticClient(clientId: string, clientSecret: string) {
  await api("/api/auth-mode", { mode: "oauth" });
  await api("/api/oauth-client", {
    mode: "static",
    clientId,
    clientSecret,
    redirectUris: [REDIRECT_URI],
  });
}

async function metadata() {
  const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
  return res.json();
}

/** Drives /authorize, returns the raw response so error cases stay inspectable. */
async function authorize(clientId: string, redirectUri = REDIRECT_URI) {
  const url = new URL(`${BASE}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", "test-state");
  url.searchParams.set("code_challenge", CODE_CHALLENGE);
  url.searchParams.set("code_challenge_method", "S256");
  return fetch(url.toString(), { redirect: "manual" });
}

async function approve(clientId: string): Promise<string> {
  const consentRes = await authorize(clientId);
  const pendingId = (await consentRes.text()).match(/name="id"\s+value="([^"]+)"/)![1];
  const approveRes = await fetch(`${BASE}/oauth/authorize-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `id=${pendingId}&action=approve`,
    redirect: "manual",
  });
  return new URL(approveRes.headers.get("location")!).searchParams.get("code")!;
}

async function exchange(code: string, clientId: string, clientSecret?: string) {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: CODE_VERIFIER,
  };
  if (clientSecret) body.client_secret = clientSecret;
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return { status: res.status, body: await res.json() };
}

test("dcr mode advertises registration_endpoint", async () => {
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
  expect((await metadata()).registration_endpoint).toBe(`${BASE}/oauth/register`);
});

test("static mode omits registration_endpoint from metadata", async () => {
  await useStaticClient("acme-client", "acme-secret");
  expect(await metadata()).not.toHaveProperty("registration_endpoint");
});

test("static mode rejects dynamic registration at /oauth/register", async () => {
  const resp = await fullPost("/oauth/register", undefined, JSON.stringify({ redirect_uris: [REDIRECT_URI] }));
  expect(resp.status).toBe(404);
  expect(resp.body.error).toBe("registration_not_supported");
  expect(resp.body.error_description).toContain("acme-client");
});

test("static mode rejects the root /register fallback too", async () => {
  const resp = await fullPost("/register", undefined, JSON.stringify({ redirect_uris: [REDIRECT_URI] }));
  expect(resp.status).toBe(404);
  expect(resp.body.error).toBe("registration_not_supported");
});

test("pre-registered credentials complete the authorization code flow", async () => {
  const code = await approve("acme-client");
  const tokens = await exchange(code, "acme-client", "acme-secret");
  expect(tokens.status).toBe(200);
  expect(tokens.body.access_token).toBeTruthy();

  const resp = await fullPost("/mcp", { Authorization: `Bearer ${tokens.body.access_token}` });
  expect(resp.status).not.toBe(401);
  expect(resp.status).not.toBe(403);
});

test("switching to static mode invalidates a client that registered via dcr", async () => {
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
  const reg = await fullPost(
    "/oauth/register",
    undefined,
    JSON.stringify({ client_name: "dcr-client", redirect_uris: [REDIRECT_URI] }),
  );
  const dcrClientId = reg.body.client_id;
  expect(dcrClientId).toBeTruthy();

  await useStaticClient("acme-client", "acme-secret");

  const res = await authorize(dcrClientId);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("invalid_client");
});

test("unknown client_id is rejected at /authorize", async () => {
  const res = await authorize("not-the-static-client");
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("invalid_client");
});

test("unregistered redirect_uri is rejected at /authorize, naming what is registered", async () => {
  const res = await authorize("acme-client", "http://localhost:9999/wrong-callback");
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("invalid_request");
  expect(body.error_description).toContain("http://localhost:9999/wrong-callback");
  expect(body.error_description).toContain(REDIRECT_URI);
});

test("a non-loopback redirect_uri mismatch is rejected the same way", async () => {
  await api("/api/oauth-client", { redirectUris: ["https://platform-api.example.app/api/mcp/oauth/callback"] });
  const res = await authorize("acme-client", "https://other-host.example.app/api/mcp/oauth/callback");
  expect(res.status).toBe(400);
  expect((await res.json()).error_description).toContain("platform-api.example.app");
  await api("/api/oauth-client", { redirectUris: [REDIRECT_URI] });
});

test("only the port is relaxed, and only for loopback hosts", async () => {
  const res = await authorize("acme-client", "http://localhost:9998/callback");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('name="id"');
});

test("wrong client_secret is rejected at /token", async () => {
  const code = await approve("acme-client");
  const tokens = await exchange(code, "acme-client", "wrong-secret");
  expect(tokens.status).toBe(400);
  expect(tokens.body.error).toBe("invalid_client");
});

test("missing client_secret is rejected at /token for a confidential client", async () => {
  const code = await approve("acme-client");
  const tokens = await exchange(code, "acme-client");
  expect(tokens.status).toBe(400);
  expect(tokens.body.error).toBe("invalid_client");
});

test("rotating client_id invalidates the previous one", async () => {
  await useStaticClient("acme-client-v2", "acme-secret");
  const res = await authorize("acme-client");
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("invalid_client");

  const code = await approve("acme-client-v2");
  const tokens = await exchange(code, "acme-client-v2", "acme-secret");
  expect(tokens.status).toBe(200);
});

test("empty client_secret makes it a public client authenticating with none", async () => {
  await useStaticClient("public-client", "");
  const code = await approve("public-client");
  const tokens = await exchange(code, "public-client");
  expect(tokens.status).toBe(200);
  expect(tokens.body.access_token).toBeTruthy();
});

test("switching back to dcr restores registration and drops the static client", async () => {
  await api("/api/oauth-client", { mode: "dcr" });
  expect((await metadata()).registration_endpoint).toBe(`${BASE}/oauth/register`);

  const regRes = await fullPost(
    "/oauth/register",
    undefined,
    JSON.stringify({ client_name: "dcr-client", redirect_uris: [REDIRECT_URI] }),
  );
  expect(regRes.status).toBe(201);

  const res = await authorize("public-client");
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("invalid_client");
});
