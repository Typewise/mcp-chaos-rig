import { EventEmitter } from "node:events";

export type AuthMode = "none" | "bearer" | "oauth" | "headers";

/** "none" = accept tokens, "401" = invalid token, "500" = internal server error */
export type RejectMode = "none" | "401" | "500";

export type ToolVersion = "v1" | "v2";

/** "dcr" = clients self-register, "static" = only the pre-registered client below is accepted */
export type OAuthClientMode = "dcr" | "static";

/**
 * A client the server already knows about, the way an authorization server that
 * issues credentials out of band does it (Google, Atlassian, most enterprise IdPs).
 */
export interface StaticClientConfig {
  clientId: string;
  /** Empty string = public client, so the token endpoint accepts auth method "none". */
  clientSecret: string;
  /** Exact match required at /authorize, except the port for loopback hosts (RFC 8252). */
  redirectUris: string[];
}

/**
 * Controls how OAuth scopes are advertised across discovery tiers.
 * See: specifications/mcp-chaos-rig-scope-discovery/plan.md
 */
export interface ScopeConfig {
  /** Scopes advertised in well-known metadata endpoints. Empty array = omit the field. */
  scopes: string[];
  /** Scope value for WWW-Authenticate header on 401s. null = don't include scope in header. "use-metadata" = use scopes[]. */
  wwwAuthenticateScope: string | null;
  /** If true, omit scopes_supported from well-known metadata entirely. */
  hideScopesFromMetadata: boolean;
  /** If true, pass advertised scopes as requiredScopes — tokens without matching scopes get 403. */
  enforceScopeMatching: boolean;
}

export interface LogEntry {
  timestamp: number;
  method: string;
  path: string;
  sessionId?: string;
  source?: "mcp" | "auth" | "sse";
  status?: number;
  /** JSON-RPC method name (e.g. "tools/call", "initialize") */
  rpcMethod?: string;
  /** For tools/call: the tool name */
  toolName?: string;
  /** For tools/call: stringified arguments */
  toolArgs?: string;
  /** JSON-RPC id */
  rpcId?: string | number;
  /** Query string (without leading ?) */
  query?: string;
  /** Stringified request body (non-MCP requests) */
  body?: string;
}

export interface ServerState {
  authMode: AuthMode;
  bearerToken: string;
  requiredHeaders: Record<string, string>;
  rejectBearer: RejectMode;
  rejectHeaders: RejectMode;
  rejectOAuth: RejectMode;
  slowMode: boolean;
  slowMinMs: number;
  slowMaxMs: number;
  accessTokenTtlSecs: number;
  failOAuthRefresh: boolean;
  strictRefreshTokens: boolean;
  oauthClientMode: OAuthClientMode;
  staticClient: StaticClientConfig;
  flakyTools: boolean;
  flakyPct: number;
  enabledTools: Record<string, boolean>;
  toolVersions: Record<string, ToolVersion>;
  scopeConfig: ScopeConfig;
}

const MAX_LOG_ENTRIES = 200;

const DEFAULT_STATIC_REDIRECT_URI = "http://localhost:3000/api/mcp/oauth/callback";

const AUTH_MODES: AuthMode[] = ["none", "bearer", "oauth", "headers"];

function authModeFromEnv(): AuthMode {
  const mode = process.env.AUTH_MODE;
  if (!mode) return "bearer";
  if (!AUTH_MODES.includes(mode as AuthMode)) {
    throw new Error(`AUTH_MODE must be one of ${AUTH_MODES.join(", ")} (got "${mode}")`);
  }
  return mode as AuthMode;
}

/**
 * Boot-time static client config, so a rig behind a tunnel starts with the
 * caller's real callback instead of needing an API call before the first
 * authorize. An empty STATIC_CLIENT_SECRET is honored as "public client".
 */
function staticClientFromEnv(): StaticClientConfig {
  const envUris = (process.env.STATIC_REDIRECT_URIS || "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
  return {
    clientId: process.env.STATIC_CLIENT_ID || "static-client-id",
    clientSecret: process.env.STATIC_CLIENT_SECRET ?? "static-client-secret",
    redirectUris: envUris.length > 0 ? envUris : [DEFAULT_STATIC_REDIRECT_URI],
  };
}

class StateManager extends EventEmitter {
  state: ServerState = {
    authMode: authModeFromEnv(),
    bearerToken: "test-token-123",
    requiredHeaders: {
      client_id: "test-client-id",
      client_secret: "test-client-secret",
    },
    rejectBearer: "none",
    rejectHeaders: "none",
    rejectOAuth: "none",
    accessTokenTtlSecs: 15,
    failOAuthRefresh: false,
    strictRefreshTokens: false,
    oauthClientMode: process.env.OAUTH_CLIENT_MODE === "static" ? "static" : "dcr",
    staticClient: staticClientFromEnv(),
    slowMode: false,
    slowMinMs: 500,
    slowMaxMs: 3000,
    flakyTools: false,
    flakyPct: 20,
    enabledTools: {
      echo: true,
      add: true,
      "get-time": false,
      "random-number": false,
      reverse: false,
      typeEcho: true,
      "get-contact-by-id": true,
      "get-contact-by-email": true,
      "list-contacts": true,
      "search-contacts": true,
      "create-contact": true,
      "update-contact": true,
      "delete-contact": true,
      "submit-customs-declaration": false,
      "create-product-listing": false,
      "search-properties": false,
      "dispute-charge": true,
    },
    toolVersions: {
      echo: "v1",
      add: "v1",
    },
    scopeConfig: {
      scopes: ["mcp:tools"],
      wwwAuthenticateScope: null,
      hideScopesFromMetadata: false,
      enforceScopeMatching: false,
    },
  };

  log: LogEntry[] = [];

  setAuthMode(mode: AuthMode) {
    this.state.authMode = mode;
    this.emit("auth-change", mode);
  }

  setBearerToken(token: string) {
    this.state.bearerToken = token;
  }

  setToolEnabled(toolName: string, enabled: boolean) {
    if (!(toolName in this.state.enabledTools)) return false;
    this.state.enabledTools[toolName] = enabled;
    this.emit("tool-change", { toolName, type: "toggle", enabled });
    return true;
  }

  setToolVersion(toolName: string, version: ToolVersion) {
    if (!(toolName in this.state.toolVersions)) return false;
    this.state.toolVersions[toolName] = version;
    this.emit("tool-change", { toolName, type: "version", version });
    return true;
  }

  addLogEntry(entry: LogEntry) {
    this.log.push(entry);
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log = this.log.slice(-MAX_LOG_ENTRIES);
    }
  }
}

export const stateManager = new StateManager();

export async function slowModeDelay() {
  if (!stateManager.state.slowMode) return;
  const { slowMinMs, slowMaxMs } = stateManager.state;
  const ms =
    Math.floor(Math.random() * (slowMaxMs - slowMinMs + 1)) + slowMinMs;
  await new Promise((r) => setTimeout(r, ms));
}
