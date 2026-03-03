export const BASE = "http://localhost:4100";

export async function api(path: string, body?: object) {
  const opts: RequestInit = body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : {};
  const res = await fetch(`${BASE}${path}`, opts);
  return res.json();
}

/** POST to path, return { status, headers, body } */
export async function fullPost(path: string, headers?: Record<string, string>, body = "{}") {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(5000),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: await res.json().catch(() => null),
  };
}

export async function resetState() {
  await api("/api/auth-mode", { mode: "bearer" });
  await api("/api/scope-settings", {
    scopes: ["mcp:tools"],
    wwwAuthenticateScope: null,
    hideScopesFromMetadata: false,
    enforceScopeMatching: false,
  });
  await api("/api/reject-auth", { target: "bearer", mode: "none" });
  await api("/api/reject-auth", { target: "oauth", mode: "none" });
}

/** Call in beforeAll — skips the entire suite if the server is unreachable. */
export async function ensureServer() {
  try {
    await api("/api/state");
  } catch {
    throw new Error(`Server not running on ${BASE} — start it with: npm start`);
  }
}
