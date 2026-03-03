import { test, expect, beforeAll } from "vitest";
import { api, resetState, ensureServer } from "./helpers.js";

beforeAll(async () => {
  await ensureServer();
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
});

test("auth-server metadata has default mcp:tools scope", async () => {
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toEqual(["mcp:tools"]);
});

test("protected-resource metadata has default mcp:tools scope", async () => {
  const meta = await api("/.well-known/oauth-protected-resource");
  expect(meta.scopes_supported).toEqual(["mcp:tools"]);
});

test("protected-resource/mcp metadata has default mcp:tools scope", async () => {
  const meta = await api("/.well-known/oauth-protected-resource/mcp");
  expect(meta.scopes_supported).toEqual(["mcp:tools"]);
});

test("custom scopes reflected in auth-server metadata", async () => {
  await api("/api/scope-settings", { scopes: ["admin", "read", "write"] });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toEqual(["admin", "read", "write"]);
});

test("custom scopes reflected in protected-resource metadata", async () => {
  const meta = await api("/.well-known/oauth-protected-resource");
  expect(meta.scopes_supported).toEqual(["admin", "read", "write"]);
});

test("hideScopesFromMetadata omits scopes_supported from auth-server", async () => {
  await api("/api/scope-settings", { hideScopesFromMetadata: true });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toBeUndefined();
  expect(meta.issuer).toBeTruthy();
  expect(meta.token_endpoint).toBeTruthy();
});

test("hideScopesFromMetadata omits scopes_supported from protected-resource", async () => {
  const meta = await api("/.well-known/oauth-protected-resource");
  expect(meta.scopes_supported).toBeUndefined();
  expect(meta.resource).toBeTruthy();
});

test("hideScopesFromMetadata omits scopes_supported from protected-resource/mcp", async () => {
  const meta = await api("/.well-known/oauth-protected-resource/mcp");
  expect(meta.scopes_supported).toBeUndefined();
});

test("empty scopes array omits field even without hide flag", async () => {
  await api("/api/scope-settings", { scopes: [], hideScopesFromMetadata: false });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toBeUndefined();
});

test("auth-server returns 404 in bearer mode", async () => {
  await api("/api/auth-mode", { mode: "bearer" });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.error).toBe("OAuth not active");
});

test("protected-resource returns 404 in bearer mode", async () => {
  const meta = await api("/.well-known/oauth-protected-resource");
  expect(meta.error).toBe("OAuth not active");
});

test("all auth-server path variants reflect configured scope", async () => {
  await api("/api/auth-mode", { mode: "oauth" });
  await api("/api/scope-settings", { scopes: ["check"], hideScopesFromMetadata: false });

  const paths = [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/mcp",
    "/.well-known/oauth-authorization-server/oauth",
    "/.well-known/openid-configuration",
    "/.well-known/openid-configuration/mcp",
    "/.well-known/openid-configuration/oauth",
    "/oauth/.well-known/oauth-authorization-server",
    "/oauth/.well-known/openid-configuration",
  ];
  for (const path of paths) {
    const meta = await api(path);
    expect(meta.scopes_supported, `${path} missing scope`).toContain("check");
  }
});

test("all resource path variants reflect configured scope", async () => {
  const paths = [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ];
  for (const path of paths) {
    const meta = await api(path);
    expect(meta.scopes_supported, `${path} missing scope`).toContain("check");
  }
});
