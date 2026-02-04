import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { stateManager } from "./state.js";
import { getActiveTools, getToolDef, type ToolDef } from "./tools.js";
import type { ToolVersion } from "./state.js";

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  registeredTools: Map<string, ReturnType<McpServer["registerTool"]>>;
}

const sessions = new Map<string, SessionEntry>();

function registerToolOnServer(server: McpServer, def: ToolDef) {
  return server.registerTool(def.name, {
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
  }, async (args) => {
    if (stateManager.state.flakyTools && Math.random() * 100 < stateManager.state.flakyPct) {
      return { content: [{ type: "text", text: `Error: tool "${def.name}" failed (simulated flaky failure)` }], isError: true };
    }
    return def.handler(args);
  });
}

const MCP_PORT = parseInt(process.env.PORT || "4100", 10);

function createSession(): SessionEntry {
  const server = new McpServer({
    name: "MCP Chaos Rig",
    version: "1.0.0",
    icons: [{
      src: `http://localhost:${MCP_PORT}/favicon.svg`,
      mimeType: "image/svg+xml",
    }],
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  const registeredTools = new Map<string, ReturnType<McpServer["registerTool"]>>();

  // Register currently active tools
  const activeTools = getActiveTools(stateManager.state);
  for (const def of activeTools) {
    const registered = registerToolOnServer(server, def);
    registeredTools.set(def.name, registered);
  }

  return { server, transport, registeredTools };
}

export async function handleMcpRequest(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  // For GET/DELETE, look up existing session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "GET" || req.method === "DELETE") {
    if (!sessionId || !sessions.has(sessionId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
      return;
    }
    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res, req.body);
    if (req.method === "DELETE") {
      sessions.delete(sessionId);
    }
    return;
  }

  // POST - either new session or existing
  if (sessionId && sessions.has(sessionId)) {
    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res, req.body);
    return;
  }

  // New session
  const entry = createSession();
  await entry.server.connect(entry.transport);

  // Handle the request - the transport will set the session ID in the response
  await entry.transport.handleRequest(req, res, req.body);

  const newSessionId = entry.transport.sessionId;
  if (newSessionId) {
    sessions.set(newSessionId, entry);

    // Clean up on transport close
    entry.transport.onclose = () => {
      sessions.delete(newSessionId);
    };
  }
}

// Propagate tool changes to all active sessions
stateManager.on("tool-change", (change: { toolName: string; type: string; enabled?: boolean; version?: ToolVersion }) => {
  for (const [, entry] of sessions) {
    const { server, registeredTools } = entry;
    const existing = registeredTools.get(change.toolName);

    if (change.type === "toggle") {
      if (change.enabled && !existing) {
        // Tool was enabled - register it
        const version = stateManager.state.toolVersions[change.toolName] as ToolVersion | undefined;
        const def = getToolDef(change.toolName, version);
        if (def) {
          const reg = registerToolOnServer(server, def);
          registeredTools.set(change.toolName, reg);
        }
      } else if (!change.enabled && existing) {
        // Tool was disabled
        existing.remove();
        registeredTools.delete(change.toolName);
      }
    } else if (change.type === "version") {
      // Version changed - update the tool definition
      const def = getToolDef(change.toolName, change.version);
      if (def && existing) {
        existing.update({
          title: def.title,
          description: def.description,
          paramsSchema: def.inputSchema,
          callback: async (args: Record<string, unknown>) => def.handler(args),
        });
      } else if (def && !existing && stateManager.state.enabledTools[change.toolName]) {
        const reg = registerToolOnServer(server, def);
        registeredTools.set(change.toolName, reg);
      }
    }
  }
});

// Auth mode change: disconnect all sessions
stateManager.on("auth-change", () => {
  disconnectAllSessions();
});

export function disconnectAllSessions() {
  for (const [sessionId, entry] of sessions) {
    entry.server.close().catch(() => {});
    sessions.delete(sessionId);
  }
}

export function getSessionCount() {
  return sessions.size;
}

export function getSessionIds() {
  return Array.from(sessions.keys());
}
