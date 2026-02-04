import express from "express";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stateManager, slowModeDelay } from "./state.js";
import { handleMcpRequest } from "./server.js";
import { createApiRouter } from "./api.js";
import { dynamicAuthMiddleware } from "./auth.js";

// OAuth imports (loaded conditionally)
import { DemoInMemoryAuthProvider } from "@modelcontextprotocol/sdk/examples/server/demoInMemoryOAuthProvider.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const PORT = parseInt(process.env.PORT || "4100", 10);
const AUTH_PORT = parseInt(process.env.AUTH_PORT || "4101", 10);

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- OAuth auth server (separate Express app on AUTH_PORT) ---
let oauthProvider: DemoInMemoryAuthProvider | null = null;
let oauthMiddleware: ReturnType<typeof requireBearerAuth> | null = null;

function setupOAuthServer() {
  const authServerUrl = new URL(`http://localhost:${AUTH_PORT}`);
  oauthProvider = new DemoInMemoryAuthProvider();

  // Wrap verifyAccessToken to support the "reject OAuth" toggle
  const originalVerify = oauthProvider.verifyAccessToken.bind(oauthProvider);
  oauthProvider.verifyAccessToken = async (token: string) => {
    const mode = stateManager.state.rejectOAuth;
    if (mode === "401") {
      throw new InvalidTokenError("OAuth token rejected (test toggle: 401)");
    }
    if (mode === "500") {
      throw new Error("OAuth token rejected (test toggle: 500)");
    }
    return originalVerify(token);
  };

  // --- Consent page ---

  // Pending authorizations waiting for user decision on the consent page
  const pendingAuthorizations = new Map<string, { client: any; params: any }>();

  // Wrap authorize() to show an interactive consent page instead of auto-approving
  oauthProvider.authorize = async (client: any, params: any, res: any) => {
    const pendingId = randomUUID();
    pendingAuthorizations.set(pendingId, { client, params });

    // Auto-expire pending authorizations after 5 minutes
    setTimeout(() => pendingAuthorizations.delete(pendingId), 5 * 60 * 1000);

    res.render("consent", {
      pendingId,
      clientName: client.client_name || client.client_id,
      scopes: params.scopes?.join(", ") || "(none)",
      redirectUri: params.redirectUri,
    });
  };

  const authApp = express();
  authApp.set("views", join(__dirname, "ui"));
  authApp.set("view engine", "ejs");
  authApp.use(express.json());
  authApp.use(express.urlencoded({ extended: true }));

  // Log all auth server requests into shared log
  authApp.use((req, res, next) => {
    res.on("finish", () => {
      const authEntry: import("./state.js").LogEntry = {
        timestamp: Date.now(),
        method: req.method,
        path: req.path,
        source: "auth",
        status: res.statusCode,
      };
      const authQs = req.originalUrl.split("?")[1];
      if (authQs) authEntry.query = authQs;
      if (req.body && typeof req.body === "object" && Object.keys(req.body as object).length > 0) {
        try { authEntry.body = JSON.stringify(req.body); } catch {}
      }
      stateManager.addLogEntry(authEntry);
    });
    next();
  });

  // Slow mode delay for auth server
  authApp.use(async (_req, _res, next) => {
    await slowModeDelay();
    next();
  });

  authApp.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: authServerUrl,
      scopesSupported: ["mcp:tools"],
    })
  );

  // Serve favicon from auth server (for consent page)
  authApp.get("/favicon.svg", (_req, res) => {
    const svg = readFileSync(join(__dirname, "ui", "favicon.svg"), "utf-8");
    res.type("image/svg+xml").send(svg);
  });

  // Decision endpoint — the consent page form posts here
  authApp.post("/authorize-decision", (req, res) => {
    const { id, action } = req.body as { id: string; action: string };
    const pending = pendingAuthorizations.get(id);
    if (!pending) {
      res.status(400).type("html").send(
        `<html><body style="background:#0d1117;color:#f85149;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh">
        <div>Authorization request expired or already used.</div></body></html>`
      );
      return;
    }

    pendingAuthorizations.delete(id);
    const { client, params } = pending;
    const targetUrl = new URL(params.redirectUri);

    if (action === "approve") {
      // Generate a real code via the provider's internal storage
      const code = randomUUID();
      (oauthProvider as any).codes.set(code, { client, params });
      targetUrl.searchParams.set("code", code);
      if (params.state) targetUrl.searchParams.set("state", params.state);
      res.redirect(targetUrl.toString());
      return;
    }

    if (action === "decline") {
      targetUrl.searchParams.set("error", "access_denied");
      targetUrl.searchParams.set("error_description", "User declined authorization");
      if (params.state) targetUrl.searchParams.set("state", params.state);
      res.redirect(targetUrl.toString());
      return;
    }

    if (action === "wrong-code") {
      targetUrl.searchParams.set("code", "invalid-bogus-code-000");
      if (params.state) targetUrl.searchParams.set("state", params.state);
      res.redirect(targetUrl.toString());
      return;
    }

    if (action === "wrong-state") {
      const code = randomUUID();
      (oauthProvider as any).codes.set(code, { client, params });
      targetUrl.searchParams.set("code", code);
      targetUrl.searchParams.set("state", "tampered-wrong-state-value");
      res.redirect(targetUrl.toString());
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  });

  // Introspection endpoint
  authApp.post("/introspect", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ error: "Token is required" });
        return;
      }
      const tokenInfo = await oauthProvider!.verifyAccessToken(token);
      res.json({
        active: true,
        client_id: tokenInfo.clientId,
        scope: tokenInfo.scopes.join(" "),
        exp: tokenInfo.expiresAt,
      });
    } catch {
      res.status(401).json({ active: false });
    }
  });

  const authServer = authApp.listen(AUTH_PORT, () => {
    console.log(`OAuth auth server on http://localhost:${AUTH_PORT}`);
  });

  // Create the bearer auth middleware for the MCP server
  oauthMiddleware = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: [],
  });

  return authServer;
}

// Start OAuth server immediately (it runs on separate port, harmless when not in oauth mode)
const authServer = setupOAuthServer();

// --- Main MCP + API server ---
const app = express();
app.set("views", join(__dirname, "ui"));
app.set("view engine", "ejs");
app.use(express.json());

// Serve UI
app.get("/ui", (_req, res) => {
  res.render("index");
});

// Serve favicon
app.get("/favicon.svg", (_req, res) => {
  const svg = readFileSync(join(__dirname, "ui", "favicon.svg"), "utf-8");
  res.type("image/svg+xml").send(svg);
});

// API routes (no auth)
app.use("/api", createApiRouter());

// Log all requests except /api and /ui (those are control plane polling)
app.use((req, res, next) => {
  if (!req.path.startsWith("/api") && req.path !== "/ui") {
    res.on("finish", () => {
      const entry: import("./state.js").LogEntry = {
        timestamp: Date.now(),
        method: req.method,
        path: req.path,
        sessionId: req.headers["mcp-session-id"] as string | undefined,
        source: "mcp",
        status: res.statusCode,
      };
      // Capture query string
      const qs = req.originalUrl.split("?")[1];
      if (qs) entry.query = qs;
      // Extract JSON-RPC details from MCP POST bodies
      if (req.method === "POST" && req.body && typeof req.body === "object") {
        const body = req.body as Record<string, unknown>;
        if (body.method && typeof body.method === "string") {
          entry.rpcMethod = body.method;
          if (body.id !== undefined) entry.rpcId = body.id as string | number;
          // For tools/call, extract tool name and args
          if (body.method === "tools/call" && body.params && typeof body.params === "object") {
            const params = body.params as Record<string, unknown>;
            if (params.name) entry.toolName = String(params.name);
            if (params.arguments) {
              try { entry.toolArgs = JSON.stringify(params.arguments); } catch {}
            }
          }
        }
        // Include full body for non-RPC POSTs (or always as fallback)
        if (!entry.rpcMethod) {
          try { entry.body = JSON.stringify(body); } catch {}
        }
      }
      stateManager.addLogEntry(entry);
    });
  }
  next();
});

// Slow mode delay for MCP and well-known endpoints (not /api or /ui)
app.use("/mcp", async (_req, _res, next) => { await slowModeDelay(); next(); });
app.use("/.well-known", async (_req, _res, next) => { await slowModeDelay(); next(); });

// Dynamic auth for MCP endpoint
app.use(
  "/mcp",
  dynamicAuthMiddleware(() => oauthMiddleware as any)
);

// MCP endpoint - handle all methods
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

// OAuth well-known metadata (served from main server when in oauth mode)
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  if (stateManager.state.authMode !== "oauth") {
    res.status(404).json({ error: "OAuth not active" });
    return;
  }
  res.json({
    resource: `http://localhost:${PORT}`,
    authorization_servers: [`http://localhost:${AUTH_PORT}`],
    scopes_supported: ["mcp:tools"],
  });
});

app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
  if (stateManager.state.authMode !== "oauth") {
    res.status(404).json({ error: "OAuth not active" });
    return;
  }
  res.json({
    resource: `http://localhost:${PORT}/mcp`,
    authorization_servers: [`http://localhost:${AUTH_PORT}`],
    scopes_supported: ["mcp:tools"],
  });
});

// Proxy auth server metadata from MCP port so SDK clients can discover it.
// The SDK calls /.well-known/oauth-authorization-server on the MCP server URL
// and needs to find the auth server's token/authorize/register endpoints.
// Serve both path-aware (/mcp suffix) and root discovery paths
app.get("/.well-known/oauth-authorization-server/mcp", serveAuthServerMetadata);
app.get("/.well-known/oauth-authorization-server", serveAuthServerMetadata);

async function serveAuthServerMetadata(_req: any, res: any) {
  if (stateManager.state.authMode !== "oauth") {
    res.status(404).json({ error: "OAuth not active" });
    return;
  }
  try {
    const resp = await fetch(`http://localhost:${AUTH_PORT}/.well-known/oauth-authorization-server`);
    const metadata = await resp.json();
    res.json(metadata);
  } catch {
    res.status(502).json({ error: "Failed to fetch auth server metadata" });
  }
}

const mainServer = app.listen(PORT, () => {
  console.log(`\nMCP Dev Server running:\n`);
  console.log(`  Web UI:          http://localhost:${PORT}/ui`);
  console.log(`  MCP endpoint:    http://localhost:${PORT}/mcp`);
  console.log(`  OAuth auth:      http://localhost:${AUTH_PORT}`);
  console.log(`  API:             http://localhost:${PORT}/api/state\n`);
});

process.on("SIGTERM", () => {
  authServer.close();
  mainServer.close();
  process.exit(0);
});
