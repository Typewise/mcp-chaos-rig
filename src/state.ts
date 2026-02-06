import { EventEmitter } from "node:events";

export type AuthMode = "none" | "bearer" | "oauth";

/** "none" = accept tokens, "401" = invalid token, "500" = internal server error */
export type RejectMode = "none" | "401" | "500";

export type ToolVersion = "v1" | "v2";

export interface LogEntry {
  timestamp: number;
  method: string;
  path: string;
  sessionId?: string;
  source?: "mcp" | "auth";
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
  rejectBearer: RejectMode;
  rejectOAuth: RejectMode;
  slowMode: boolean;
  slowMinMs: number;
  slowMaxMs: number;
  accessTokenTtlSecs: number;
  failOAuthRefresh: boolean;
  flakyTools: boolean;
  flakyPct: number;
  enabledTools: Record<string, boolean>;
  toolVersions: Record<string, ToolVersion>;
}

const MAX_LOG_ENTRIES = 200;

class StateManager extends EventEmitter {
  state: ServerState = {
    authMode: "bearer",
    bearerToken: "test-token-123",
    rejectBearer: "none",
    rejectOAuth: "none",
    accessTokenTtlSecs: 15,
    failOAuthRefresh: false,
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
      "list-contacts": true,
      "search-contacts": true,
      "create-contact": true,
      "update-contact": true,
      "delete-contact": true,
    },
    toolVersions: {
      echo: "v1",
      add: "v1",
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
