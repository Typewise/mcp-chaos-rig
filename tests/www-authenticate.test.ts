import { test, expect, beforeAll } from "vitest";
import { api, fullPost, resetState, ensureServer } from "./helpers.js";

beforeAll(async () => {
  await ensureServer();
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
});

// — OAuth mode —

test("oauth default: Bearer header present, no scope param", async () => {
  const resp = await fullPost("/mcp");
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toContain("Bearer");
  expect(wwwAuth).not.toContain("scope=");
});

test("oauth custom wwwAuthenticateScope appears in header", async () => {
  await api("/api/scope-settings", { wwwAuthenticateScope: "access" });
  const resp = await fullPost("/mcp");
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toContain('scope="access"');
});

test("oauth multiple space-delimited scopes in header", async () => {
  await api("/api/scope-settings", { wwwAuthenticateScope: "read write admin" });
  const resp = await fullPost("/mcp");
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toContain('scope="read write admin"');
});

test("oauth use-metadata resolves scopes from config", async () => {
  await api("/api/scope-settings", { scopes: ["a", "b", "c"], wwwAuthenticateScope: "use-metadata" });
  const resp = await fullPost("/mcp");
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toContain('scope="a b c"');
});

test("oauth use-metadata with empty scopes omits scope param", async () => {
  await api("/api/scope-settings", { scopes: [], wwwAuthenticateScope: "use-metadata" });
  const resp = await fullPost("/mcp");
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).not.toContain("scope=");
});

test("oauth null wwwAuthenticateScope removes scope from header", async () => {
  await api("/api/scope-settings", { wwwAuthenticateScope: null });
  const resp = await fullPost("/mcp");
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).not.toContain("scope=");
});

// — Bearer mode —

test("bearer missing auth: WWW-Authenticate=Bearer", async () => {
  await resetState();
  const resp = await fullPost("/mcp");
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toBe("Bearer");
});

test("bearer wrong token: WWW-Authenticate=Bearer", async () => {
  const resp = await fullPost("/mcp", { Authorization: "Bearer wrong" });
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toBe("Bearer");
});

test("bearer invalid format: WWW-Authenticate=Bearer", async () => {
  const resp = await fullPost("/mcp", { Authorization: "Basic dXNlcjpwYXNz" });
  const wwwAuth = resp.headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toBe("Bearer");
});

test("bearer reject-401: returns 401 with WWW-Authenticate", async () => {
  await api("/api/reject-auth", { target: "bearer", mode: "401" });
  const resp = await fullPost("/mcp", { Authorization: "Bearer test-token-123" });
  expect(resp.headers.get("www-authenticate") ?? "").toBe("Bearer");
  expect(resp.status).toBe(401);
});

test("bearer reject-500: no WWW-Authenticate header", async () => {
  await api("/api/reject-auth", { target: "bearer", mode: "500" });
  const resp = await fullPost("/mcp", { Authorization: "Bearer test-token-123" });
  expect(resp.headers.get("www-authenticate") ?? "").toBe("");
  expect(resp.status).toBe(500);
});

test("bearer valid token: no WWW-Authenticate header", async () => {
  await api("/api/reject-auth", { target: "bearer", mode: "none" });
  const resp = await fullPost("/mcp", { Authorization: "Bearer test-token-123" });
  expect(resp.headers.get("www-authenticate") ?? "").toBe("");
});

// — No-auth mode —

test("no-auth mode: no WWW-Authenticate header", async () => {
  await api("/api/auth-mode", { mode: "none" });
  const resp = await fullPost("/mcp");
  expect(resp.headers.get("www-authenticate") ?? "").toBe("");
});
