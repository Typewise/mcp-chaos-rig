import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stateManager, slowModeDelay } from "./state.js";
import { handleMcpRequest } from "./server.js";
import { createApiRouter } from "./api.js";
import { dynamicAuthMiddleware } from "./auth.js";
import { createOAuthRouter, oauthMiddleware } from "./oauth.js";
import { requestLogger } from "./logger.js";

const PORT = parseInt(process.env.PORT || "4100", 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", 1); // Required for rate-limiting behind ngrok/proxies
app.set("views", join(__dirname, "ui"));
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get("/ui", (_req, res) => res.render("index"));
app.get("/favicon.svg", (_req, res) => {
  res
    .type("image/svg+xml")
    .send(readFileSync(join(__dirname, "ui", "favicon.svg"), "utf-8"));
});
app.use("/api", createApiRouter());

app.use((req, res, next) => {
  if (!req.path.startsWith("/api") && req.path !== "/ui") {
    res.on("finish", () => {
      const isOAuth =
        req.path.startsWith("/oauth") || req.path.includes("well-known");
      const entry: import("./state.js").LogEntry = {
        timestamp: Date.now(),
        method: req.method,
        path: req.path,
        sessionId: req.headers["mcp-session-id"] as string | undefined,
        source: isOAuth ? "auth" : "mcp",
        status: res.statusCode,
      };
      const qs = req.originalUrl.split("?")[1];
      if (qs) entry.query = qs;
      if (req.method === "POST" && req.body && typeof req.body === "object") {
        const body = req.body as Record<string, unknown>;
        if (body.method && typeof body.method === "string") {
          entry.rpcMethod = body.method;
          if (body.id !== undefined) entry.rpcId = body.id as string | number;
          if (
            body.method === "tools/call" &&
            body.params &&
            typeof body.params === "object"
          ) {
            const params = body.params as Record<string, unknown>;
            if (params.name) entry.toolName = String(params.name);
            if (params.arguments) {
              try {
                entry.toolArgs = JSON.stringify(params.arguments);
              } catch {}
            }
          }
        }
        if (!entry.rpcMethod) {
          try {
            entry.body = JSON.stringify(body);
          } catch {}
        }
      }
      stateManager.addLogEntry(entry);
    });
  }
  next();
});

app.use("/mcp", async (_req, _res, next) => {
  await slowModeDelay();
  next();
});
app.use("/oauth", async (_req, _res, next) => {
  await slowModeDelay();
  next();
});
app.use("/.well-known", async (_req, _res, next) => {
  await slowModeDelay();
  next();
});

// OAuth must be mounted before MCP to handle well-known discovery
app.use(createOAuthRouter(BASE_URL));

app.use(
  "/mcp",
  dynamicAuthMiddleware(() => oauthMiddleware as any),
);
app.all("/mcp", async (req, res) => {
  try {
    await handleMcpRequest(req as any, res as any);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

const server = app.listen(PORT, () => {
  console.log(`\nMCP Chaos Rig running:\n`);
  console.log(`  Web UI:        ${BASE_URL}/ui`);
  console.log(`  MCP endpoint:  ${BASE_URL}/mcp`);
  console.log(`  OAuth:         ${BASE_URL}/oauth`);
  console.log(`  API:           ${BASE_URL}/api/state\n`);
});

server.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
