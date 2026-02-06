import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logOutboundMessage } from "./logger.js";
import { stateManager, type LogEntry } from "./state.js";
import { getActiveTools, getToolDef, type ToolDef } from "./tools.js";
import type { ToolVersion } from "./state.js";

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  registeredTools: Map<string, ReturnType<McpServer["registerTool"]>>;
}

const sessions = new Map<string, SessionEntry>();

const PORT = parseInt(process.env.PORT || "4100", 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

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

function createSession(): SessionEntry {
  const server = new McpServer({
    name: "MCP Chaos Rig",
    version: "1.0.0",
    icons: [{ src: `${BASE_URL}/favicon.svg`, mimeType: "image/svg+xml" }],
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  const registeredTools = new Map<string, ReturnType<McpServer["registerTool"]>>();
  for (const def of getActiveTools(stateManager.state)) {
    registeredTools.set(def.name, registerToolOnServer(server, def));
  }

  return { server, transport, registeredTools };
}

export async function handleMcpRequest(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "GET" || req.method === "DELETE") {
    if (!sessionId || !sessions.has(sessionId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
      return;
    }
    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res, req.body);
    if (req.method === "DELETE") sessions.delete(sessionId);
    return;
  }

  if (sessionId && sessions.has(sessionId)) {
    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res, req.body);
    return;
  }

  const entry = createSession();
  await entry.server.connect(entry.transport);
  await entry.transport.handleRequest(req, res, req.body);

  const newSessionId = entry.transport.sessionId;
  if (newSessionId) {
    const origSend = entry.transport.send.bind(entry.transport);
    entry.transport.send = async (message, options) => {
      const msg = message as Record<string, unknown>;
      logOutboundMessage(msg, newSessionId);
      const logEntry: LogEntry = {
        timestamp: Date.now(),
        method: "SSE",
        path: "/mcp",
        sessionId: newSessionId,
        source: "sse",
        direction: "out",
      };
      if (msg.method && typeof msg.method === "string") logEntry.rpcMethod = msg.method;
      if (msg.id !== undefined) logEntry.rpcId = msg.id as string | number;
      if (msg.result !== undefined) logEntry.rpcMethod = "result";
      if (msg.error !== undefined) logEntry.rpcMethod = "error";
      try { logEntry.body = JSON.stringify(msg); } catch {}
      stateManager.addLogEntry(logEntry);
      return origSend(message, options);
    };
    sessions.set(newSessionId, entry);
    entry.transport.onclose = () => sessions.delete(newSessionId);
  }
}

// Live-update tools in active sessions when UI toggles/changes them
stateManager.on("tool-change", (change: { toolName: string; type: string; enabled?: boolean; version?: ToolVersion }) => {
  for (const [, entry] of sessions) {
    const { server, registeredTools } = entry;
    const existing = registeredTools.get(change.toolName);

    if (change.type === "toggle") {
      if (change.enabled && !existing) {
        const version = stateManager.state.toolVersions[change.toolName] as ToolVersion | undefined;
        const def = getToolDef(change.toolName, version);
        if (def) registeredTools.set(change.toolName, registerToolOnServer(server, def));
      } else if (!change.enabled && existing) {
        existing.remove();
        registeredTools.delete(change.toolName);
      }
    } else if (change.type === "version") {
      const def = getToolDef(change.toolName, change.version);
      if (def && existing) {
        existing.update({
          title: def.title,
          description: def.description,
          paramsSchema: def.inputSchema,
          callback: async (args: Record<string, unknown>) => def.handler(args),
        });
      } else if (def && !existing && stateManager.state.enabledTools[change.toolName]) {
        registeredTools.set(change.toolName, registerToolOnServer(server, def));
      }
    }
  }
});

// Force-disconnect all sessions when auth mode changes (clients must re-auth)
stateManager.on("auth-change", () => disconnectAllSessions());

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
