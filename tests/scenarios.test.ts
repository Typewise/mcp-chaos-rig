import { test, expect, beforeAll } from "vitest";
import { api, fullPost, resetState, ensureServer } from "./helpers.js";

beforeAll(async () => {
  await ensureServer();
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
});

test("scenario 1: default backward-compat — metadata has mcp:tools, no scope in 401", async () => {
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(JSON.stringify(meta.scopes_supported)).toContain("mcp:tools");
  const resp = await fullPost("/mcp");
  expect(resp.headers.get("www-authenticate") ?? "").not.toContain("scope=");
});

test("scenario 2: tier 1 only — hidden metadata, scope=access in 401", async () => {
  await api("/api/scope-settings", {
    scopes: ["mcp:tools"],
    wwwAuthenticateScope: "access",
    hideScopesFromMetadata: true,
  });
  const authMeta = await api("/.well-known/oauth-authorization-server");
  expect(authMeta.scopes_supported).toBeUndefined();
  const resMeta = await api("/.well-known/oauth-protected-resource");
  expect(resMeta.scopes_supported).toBeUndefined();
  const resp = await fullPost("/mcp");
  expect(resp.headers.get("www-authenticate") ?? "").toContain('scope="access"');
});

test("scenario 3: tier 2 only — metadata has read+write, no scope in 401", async () => {
  await api("/api/scope-settings", {
    scopes: ["read", "write"],
    wwwAuthenticateScope: null,
    hideScopesFromMetadata: false,
  });
  const meta = await api("/.well-known/oauth-protected-resource");
  expect(meta.scopes_supported).toEqual(["read", "write"]);
  const resp = await fullPost("/mcp");
  expect(resp.headers.get("www-authenticate") ?? "").not.toContain("scope=");
});

test("scenario 4: no scopes anywhere", async () => {
  await api("/api/scope-settings", {
    scopes: [],
    wwwAuthenticateScope: null,
    hideScopesFromMetadata: true,
  });
  expect((await api("/.well-known/oauth-authorization-server")).scopes_supported).toBeUndefined();
  expect((await api("/.well-known/oauth-protected-resource")).scopes_supported).toBeUndefined();
  const resp = await fullPost("/mcp");
  expect(resp.headers.get("www-authenticate") ?? "").not.toContain("scope=");
});

test("scenario 5: conflicting scopes — metadata says admin, 401 says read", async () => {
  await api("/api/scope-settings", {
    scopes: ["admin"],
    wwwAuthenticateScope: "read",
    hideScopesFromMetadata: false,
  });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toEqual(["admin"]);
  const wwwAuth = (await fullPost("/mcp")).headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toContain('scope="read"');
  expect(wwwAuth).not.toContain('scope="admin"');
});

test("scenario 6: custom scope names with use-metadata", async () => {
  await api("/api/scope-settings", {
    scopes: ["my:custom:scope"],
    wwwAuthenticateScope: "use-metadata",
    hideScopesFromMetadata: false,
  });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toEqual(["my:custom:scope"]);
  const wwwAuth = (await fullPost("/mcp")).headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toContain('scope="my:custom:scope"');
});

test("scenario 7: empty metadata, scope only in header", async () => {
  await api("/api/scope-settings", {
    scopes: [],
    wwwAuthenticateScope: "mcp:tools",
    hideScopesFromMetadata: true,
  });
  expect((await api("/.well-known/oauth-authorization-server")).scopes_supported).toBeUndefined();
  const wwwAuth = (await fullPost("/mcp")).headers.get("www-authenticate") ?? "";
  expect(wwwAuth).toContain('scope="mcp:tools"');
});
