import { Router } from "express";
import { stateManager, type AuthMode, type RejectMode, type ToolVersion } from "./state.js";
import { getSessionCount, getSessionIds } from "./server.js";
import { getAllToolNames, hasVersions, getToolDef } from "./tools.js";
import { listContacts, resetDatabase } from "./db.js";

export function createApiRouter(): Router {
  const router = Router();

  // Full current state
  router.get("/state", (_req, res) => {
    const { state } = stateManager;
    const toolInfo = getAllToolNames().map((name) => ({
      name,
      enabled: state.enabledTools[name],
      hasVersions: hasVersions(name),
      currentVersion: state.toolVersions[name] || null,
      params: Object.keys(getToolDef(name, state.toolVersions[name] as ToolVersion)?.inputSchema || {}),
    }));
    res.json({ ...state, sessionCount: getSessionCount(), sessions: getSessionIds(), tools: toolInfo });
  });

  // Switch auth mode
  router.post("/auth-mode", (req, res) => {
    const { mode } = req.body as { mode: AuthMode };
    if (!["none", "bearer", "oauth"].includes(mode)) {
      res.status(400).json({ error: "Invalid auth mode" });
      return;
    }
    stateManager.setAuthMode(mode);
    res.json({ authMode: mode, disconnectedSessions: true });
  });

  // Update bearer token
  router.post("/bearer-token", (req, res) => {
    const { token } = req.body as { token: string };
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Token required" });
      return;
    }
    stateManager.setBearerToken(token);
    res.json({ bearerToken: token });
  });

  // Toggle tool
  router.post("/tool-toggle", (req, res) => {
    const { toolName, enabled } = req.body as { toolName: string; enabled: boolean };
    if (!stateManager.setToolEnabled(toolName, enabled)) {
      res.status(400).json({ error: "Unknown tool" });
      return;
    }
    res.json({ toolName, enabled });
  });

  // Switch tool version
  router.post("/tool-version", (req, res) => {
    const { toolName, version } = req.body as { toolName: string; version: ToolVersion };
    if (!["v1", "v2"].includes(version)) {
      res.status(400).json({ error: "Invalid version" });
      return;
    }
    if (!stateManager.setToolVersion(toolName, version)) {
      res.status(400).json({ error: "Tool has no versions" });
      return;
    }
    res.json({ toolName, version });
  });

  // Request log
  router.get("/log", (_req, res) => {
    res.json({ entries: stateManager.log });
  });

  // Clear log
  router.post("/clear-log", (_req, res) => {
    stateManager.log = [];
    res.json({ cleared: true });
  });

  // Slow mode
  router.post("/slow-mode", (req, res) => {
    const { enabled, minMs, maxMs } = req.body as { enabled?: boolean; minMs?: number; maxMs?: number };
    if (typeof enabled === "boolean") stateManager.state.slowMode = enabled;
    if (typeof minMs === "number") stateManager.state.slowMinMs = Math.max(0, minMs);
    if (typeof maxMs === "number") stateManager.state.slowMaxMs = Math.max(0, maxMs);
    res.json({
      slowMode: stateManager.state.slowMode,
      slowMinMs: stateManager.state.slowMinMs,
      slowMaxMs: stateManager.state.slowMaxMs,
    });
  });

  // Flaky tools
  router.post("/flaky-tools", (req, res) => {
    const { enabled, pct } = req.body as { enabled?: boolean; pct?: number };
    if (typeof enabled === "boolean") stateManager.state.flakyTools = enabled;
    if (typeof pct === "number") stateManager.state.flakyPct = Math.max(0, Math.min(100, pct));
    res.json({
      flakyTools: stateManager.state.flakyTools,
      flakyPct: stateManager.state.flakyPct,
    });
  });

  // Set rejection mode for bearer or OAuth
  router.post("/reject-auth", (req, res) => {
    const { target, mode } = req.body as { target: "bearer" | "oauth"; mode: RejectMode };
    if (!["bearer", "oauth"].includes(target) || !["none", "401", "500"].includes(mode)) {
      res.status(400).json({ error: "Invalid target or mode" });
      return;
    }
    if (target === "bearer") stateManager.state.rejectBearer = mode;
    else stateManager.state.rejectOAuth = mode;
    res.json({ rejectBearer: stateManager.state.rejectBearer, rejectOAuth: stateManager.state.rejectOAuth });
  });

  // Contacts database view
  router.get("/contacts", (_req, res) => {
    res.json({ contacts: listContacts() });
  });

  // Reset contacts database to seed data
  router.post("/reset-db", (_req, res) => {
    resetDatabase();
    res.json({ reset: true });
  });

  return router;
}
