import { test, expect, beforeAll } from "vitest";
import { api, resetState, ensureServer } from "./helpers.js";

beforeAll(async () => {
  await ensureServer();
  await resetState();
  await api("/api/auth-mode", { mode: "oauth" });
});

test("scopes with special characters (URN + URL)", async () => {
  await api("/api/scope-settings", { scopes: ["urn:example:scope", "https://api.example.com/read"] });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toEqual(["urn:example:scope", "https://api.example.com/read"]);
});

test("single scope array", async () => {
  await api("/api/scope-settings", { scopes: ["single"] });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toEqual(["single"]);
});

test("many scopes (7) all present", async () => {
  await api("/api/scope-settings", { scopes: ["a", "b", "c", "d", "e", "f", "g"] });
  const meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toHaveLength(7);
});

test("rapid hide toggle: hidden then restored", async () => {
  await api("/api/scope-settings", { hideScopesFromMetadata: true });
  let meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toBeUndefined();

  await api("/api/scope-settings", { hideScopesFromMetadata: false });
  meta = await api("/.well-known/oauth-authorization-server");
  expect(meta.scopes_supported).toHaveLength(7);
});

test("scope config survives bearer→oauth round-trip", async () => {
  await api("/api/scope-settings", {
    scopes: ["persisted"],
    wwwAuthenticateScope: "kept",
    hideScopesFromMetadata: true,
  });
  await api("/api/auth-mode", { mode: "bearer" });
  await api("/api/auth-mode", { mode: "oauth" });
  const state = await api("/api/state");
  expect(state.scopeConfig.scopes).toEqual(["persisted"]);
  expect(state.scopeConfig.wwwAuthenticateScope).toBe("kept");
  expect(state.scopeConfig.hideScopesFromMetadata).toBe(true);
});
