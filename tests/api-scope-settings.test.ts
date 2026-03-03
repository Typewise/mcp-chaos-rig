import { test, expect, beforeAll } from "vitest";
import { api, resetState, ensureServer } from "./helpers.js";

beforeAll(async () => {
  await ensureServer();
  await resetState();
});

test("default scopes are [mcp:tools]", async () => {
  const state = await api("/api/state");
  expect(state.scopeConfig.scopes).toEqual(["mcp:tools"]);
});

test("default wwwAuthenticateScope is null", async () => {
  const state = await api("/api/state");
  expect(state.scopeConfig.wwwAuthenticateScope).toBeNull();
});

test("default hideScopesFromMetadata is false", async () => {
  const state = await api("/api/state");
  expect(state.scopeConfig.hideScopesFromMetadata).toBe(false);
});

test("default enforceScopeMatching is false", async () => {
  const state = await api("/api/state");
  expect(state.scopeConfig.enforceScopeMatching).toBe(false);
});

test("partial update: scopes only leaves other fields unchanged", async () => {
  const res = await api("/api/scope-settings", { scopes: ["read", "write"] });
  expect(res.scopeConfig.scopes).toEqual(["read", "write"]);
  expect(res.scopeConfig.wwwAuthenticateScope).toBeNull();
  expect(res.scopeConfig.hideScopesFromMetadata).toBe(false);
});

test("partial update: wwwAuthenticateScope only leaves scopes unchanged", async () => {
  const res = await api("/api/scope-settings", { wwwAuthenticateScope: "access" });
  expect(res.scopeConfig.wwwAuthenticateScope).toBe("access");
  expect(res.scopeConfig.scopes).toEqual(["read", "write"]);
});

test("set wwwAuthenticateScope back to null", async () => {
  const res = await api("/api/scope-settings", { wwwAuthenticateScope: null });
  expect(res.scopeConfig.wwwAuthenticateScope).toBeNull();
});

test("partial update: hideScopesFromMetadata only", async () => {
  const res = await api("/api/scope-settings", { hideScopesFromMetadata: true });
  expect(res.scopeConfig.hideScopesFromMetadata).toBe(true);
});

test("empty scopes array accepted", async () => {
  const res = await api("/api/scope-settings", { scopes: [] });
  expect(res.scopeConfig.scopes).toEqual([]);
});

test("non-array scopes value does not overwrite existing scopes", async () => {
  await api("/api/scope-settings", { scopes: ["keep-me"] });
  const res = await api("/api/scope-settings", { scopes: "not-an-array" as any });
  expect(res.scopeConfig.scopes).toEqual(["keep-me"]);
});
