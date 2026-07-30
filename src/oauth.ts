import { Router } from "express";
import { randomUUID } from "node:crypto";
import { DemoInMemoryAuthProvider } from "@modelcontextprotocol/sdk/examples/server/demoInMemoryOAuthProvider.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { redirectUriMatches } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { InvalidTokenError, InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { stateManager } from "./state.js";

const pendingAuthorizations = new Map<string, { client: any; params: any }>();
const oauthProvider = new DemoInMemoryAuthProvider();

// Tracks which client_id owns each refresh token (for strict mode)
const refreshTokenOwners = new Map<string, string>();

const clientStore = (oauthProvider.clientsStore as any).clients as Map<string, any>;
let seededStaticClientId: string | null = null;

/**
 * Reconciles the in-memory client store with the configured static client.
 *
 * The previously seeded id is always dropped first, so rotating client_id or
 * leaving static mode invalidates the old credentials the way a real server
 * would. Entering static mode empties the store, so a client holding an
 * earlier dynamic registration stops being accepted instead of quietly
 * continuing to work.
 */
export function syncStaticClient() {
  const { oauthClientMode, staticClient } = stateManager.state;

  if (seededStaticClientId) {
    clientStore.delete(seededStaticClientId);
    seededStaticClientId = null;
  }
  if (oauthClientMode !== "static") return;

  clientStore.clear();
  clientStore.set(staticClient.clientId, {
    client_id: staticClient.clientId,
    ...(staticClient.clientSecret ? { client_secret: staticClient.clientSecret } : {}),
    client_name: "Pre-registered client",
    redirect_uris: staticClient.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: staticClient.clientSecret ? "client_secret_post" : "none",
  });
  seededStaticClientId = staticClient.clientId;
}

function registrationDisabled(): boolean {
  return stateManager.state.oauthClientMode === "static";
}

const originalExchange = oauthProvider.exchangeAuthorizationCode.bind(oauthProvider);
oauthProvider.exchangeAuthorizationCode = async (client: any, authorizationCode: string, codeVerifier?: string) => {
  const tokens = await originalExchange(client, authorizationCode, codeVerifier);
  const ttlSecs = stateManager.state.accessTokenTtlSecs;
  const stored = (oauthProvider as any).tokens.get(tokens.access_token);
  if (stored) stored.expiresAt = Date.now() + ttlSecs * 1000;
  const refreshToken = randomUUID();
  refreshTokenOwners.set(refreshToken, client.client_id);
  return { ...tokens, expires_in: ttlSecs, refresh_token: refreshToken };
};

oauthProvider.exchangeRefreshToken = async (client: any, refreshToken: string, scopes?: string[]) => {
  if (stateManager.state.failOAuthRefresh) {
    throw new InvalidTokenError("Refresh token rejected (test toggle)");
  }

  if (stateManager.state.strictRefreshTokens) {
    const owner = refreshTokenOwners.get(refreshToken);
    if (!owner) {
      throw new InvalidGrantError("Unknown refresh token");
    }
    if (owner !== client.client_id) {
      throw new InvalidGrantError(
        `Refresh token belongs to client [${owner}], not [${client.client_id}]`
      );
    }
    refreshTokenOwners.delete(refreshToken);
  }

  const ttlSecs = stateManager.state.accessTokenTtlSecs;
  const accessToken = randomUUID();
  const resolvedScopes = scopes ?? stateManager.state.scopeConfig.scopes;
  (oauthProvider as any).tokens.set(accessToken, {
    token: accessToken,
    clientId: client.client_id,
    scopes: resolvedScopes,
    expiresAt: Date.now() + ttlSecs * 1000,
    type: "access",
  });
  const newRefreshToken = randomUUID();
  refreshTokenOwners.set(newRefreshToken, client.client_id);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ttlSecs,
    scope: resolvedScopes.join(" "),
    refresh_token: newRefreshToken,
  };
};

const originalVerify = oauthProvider.verifyAccessToken.bind(oauthProvider);
oauthProvider.verifyAccessToken = async (token: string) => {
  const mode = stateManager.state.rejectOAuth;
  if (mode === "401") throw new InvalidTokenError("OAuth token rejected (test toggle: 401)");
  if (mode === "500") throw new Error("OAuth token rejected (test toggle: 500)");
  try {
    return await originalVerify(token);
  } catch {
    throw new InvalidTokenError("Invalid or expired token");
  }
};

// Replace auto-approve with interactive consent page
oauthProvider.authorize = async (client: any, params: any, res: any) => {
  const pendingId = randomUUID();
  pendingAuthorizations.set(pendingId, { client, params });
  setTimeout(() => pendingAuthorizations.delete(pendingId), 5 * 60 * 1000);
  res.render("consent", {
    pendingId,
    clientName: client.client_name || client.client_id,
    scopes: params.scopes?.join(", ") || "(none)",
    redirectUri: params.redirectUri,
  });
};

import type { ScopeConfig } from "./state.js";

export function resolveWwwAuthScopes(config: ScopeConfig): string[] {
  if (config.wwwAuthenticateScope === null) return [];
  if (config.wwwAuthenticateScope === "use-metadata") return config.scopes;
  return config.wwwAuthenticateScope.split(" ");
}

/**
 * Dynamic OAuth middleware. Two independent concerns:
 *
 * 1. Scope advertisement — what scope value appears in WWW-Authenticate header
 *    on 401s. Controlled by wwwAuthenticateScope. Uses res.set monkey-patch
 *    because the SDK only sets scope when requiredScopes is non-empty.
 *
 * 2. Scope enforcement — whether valid tokens are rejected for missing scopes
 *    (403 Insufficient Scope). Controlled by enforceScopeMatching. Uses
 *    scopeConfig.scopes as requiredScopes. When ON, the SDK adds scope to
 *    WWW-Authenticate itself, so the monkey-patch is skipped to avoid duplication.
 */
export const oauthMiddleware = (req: any, res: any, next: any) => {
  const { scopeConfig } = stateManager.state;

  if (scopeConfig.enforceScopeMatching) {
    // Enforcement ON: SDK handles both scope checking and WWW-Authenticate header.
    // Uses scopeConfig.scopes (the canonical scopes), not the advertised header scopes.
    const mw = requireBearerAuth({
      verifier: oauthProvider,
      requiredScopes: scopeConfig.scopes,
    });
    return mw(req, res, next);
  }

  // Enforcement OFF: no scope checking. Monkey-patch to inject scope into header.
  const advertisedScopes = resolveWwwAuthScopes(scopeConfig);
  if (advertisedScopes.length > 0) {
    const originalSet = res.set.bind(res);
    res.set = (field: string, val: string) => {
      if (field === "WWW-Authenticate" && typeof val === "string" && val.startsWith("Bearer")) {
        val += `, scope="${advertisedScopes.join(" ")}"`;
      }
      return originalSet(field, val);
    };
  }

  const mw = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: [],
  });
  mw(req, res, next);
};

export function createOAuthRouter(baseUrl: string): Router {
  const router = Router();
  syncStaticClient();

  function serveAuthServerMetadata(_req: any, res: any) {
    if (stateManager.state.authMode !== "oauth") {
      res.status(404).json({ error: "OAuth not active" });
      return;
    }
    const issuer = `${baseUrl}/oauth`;
    const { scopes, hideScopesFromMetadata } = stateManager.state.scopeConfig;
    const metadata: Record<string, any> = {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      code_challenge_methods_supported: ["S256"],
    };
    // Omitted in static mode: how a client discovers it must use pre-issued credentials.
    if (!registrationDisabled()) {
      metadata.registration_endpoint = `${issuer}/register`;
    }
    if (!hideScopesFromMetadata && scopes.length > 0) {
      metadata.scopes_supported = scopes;
    }
    res.json(metadata);
  }

  function serveProtectedResourceMetadata(_req: any, res: any) {
    if (stateManager.state.authMode !== "oauth") {
      res.status(404).json({ error: "OAuth not active" });
      return;
    }
    const { scopes, hideScopesFromMetadata } = stateManager.state.scopeConfig;
    const metadata: Record<string, any> = {
      resource: baseUrl,
      authorization_servers: [`${baseUrl}/oauth`],
    };
    if (!hideScopesFromMetadata && scopes.length > 0) {
      metadata.scopes_supported = scopes;
    }
    res.json(metadata);
  }

  function serveProtectedResourceMetadataMcp(_req: any, res: any) {
    if (stateManager.state.authMode !== "oauth") {
      res.status(404).json({ error: "OAuth not active" });
      return;
    }
    const { scopes, hideScopesFromMetadata } = stateManager.state.scopeConfig;
    const metadata: Record<string, any> = {
      resource: `${baseUrl}/mcp`,
      authorization_servers: [`${baseUrl}/oauth`],
    };
    if (!hideScopesFromMetadata && scopes.length > 0) {
      metadata.scopes_supported = scopes;
    }
    res.json(metadata);
  }

  // Well-known paths - multiple variants because clients try different combinations
  router.get("/.well-known/oauth-protected-resource", serveProtectedResourceMetadata);
  router.get("/.well-known/oauth-protected-resource/mcp", serveProtectedResourceMetadataMcp);
  router.get("/.well-known/oauth-authorization-server", serveAuthServerMetadata);
  router.get("/.well-known/oauth-authorization-server/mcp", serveAuthServerMetadata);
  router.get("/.well-known/oauth-authorization-server/oauth", serveAuthServerMetadata);
  router.get("/.well-known/openid-configuration", serveAuthServerMetadata);
  router.get("/.well-known/openid-configuration/mcp", serveAuthServerMetadata);
  router.get("/.well-known/openid-configuration/oauth", serveAuthServerMetadata);
  router.get("/oauth/.well-known/oauth-authorization-server", serveAuthServerMetadata);
  router.get("/oauth/.well-known/openid-configuration", serveAuthServerMetadata);

  function requireOAuthActive(_req: any, res: any, next: any) {
    if (stateManager.state.authMode !== "oauth") {
      res.status(404).json({ error: "OAuth not active" });
      return;
    }
    next();
  }

  const sdkAuthRouter = mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: new URL(`${baseUrl}/oauth`),
    scopesSupported: ["mcp:tools"],
  });
  function rejectRegistration(_req: any, res: any) {
    res.status(404).json({
      error: "registration_not_supported",
      error_description:
        `Dynamic client registration is disabled (static client mode). ` +
        `Use the pre-registered client_id [${stateManager.state.staticClient.clientId}].`,
    });
  }

  // Registered before the SDK router so it wins the /oauth/register path.
  router.post("/oauth/register", (req, res, next) => {
    if (registrationDisabled()) return rejectRegistration(req, res);
    next();
  });

  /**
   * The SDK answers a redirect_uri mismatch with a bare "Unregistered
   * redirect_uri", which is the first thing to go wrong when pointing a
   * deployed client at a rig still holding the local default. Answer with the
   * URIs that are actually registered instead.
   */
  router.all("/oauth/authorize", (req: any, res: any, next: any) => {
    const { authMode, oauthClientMode, staticClient } = stateManager.state;
    if (authMode !== "oauth" || oauthClientMode !== "static") return next();

    const params = req.method === "POST" ? req.body || {} : req.query;
    const requested = params.redirect_uri;
    if (params.client_id !== staticClient.clientId) return next();
    if (typeof requested !== "string" || !requested) return next();
    if (staticClient.redirectUris.some((registered) => redirectUriMatches(requested, registered))) {
      return next();
    }

    res.status(400).json({
      error: "invalid_request",
      error_description:
        `Unregistered redirect_uri [${requested}]. Registered: ` +
        `${staticClient.redirectUris.join(", ") || "(none)"}. Match is exact, ` +
        `except the port on loopback hosts (RFC 8252).`,
    });
  });

  router.use("/oauth", requireOAuthActive, sdkAuthRouter);

  function handleAuthorizeDecision(req: any, res: any) {
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
  }
  router.post("/oauth/authorize-decision", requireOAuthActive, handleAuthorizeDecision);
  router.post("/authorize-decision", requireOAuthActive, handleAuthorizeDecision);

  async function handleIntrospect(req: any, res: any) {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ error: "Token is required" });
        return;
      }
      const tokenInfo = await oauthProvider.verifyAccessToken(token);
      res.json({
        active: true,
        client_id: tokenInfo.clientId,
        scope: tokenInfo.scopes.join(" "),
        exp: tokenInfo.expiresAt,
      });
    } catch {
      res.status(401).json({ active: false });
    }
  }
  router.post("/oauth/introspect", requireOAuthActive, handleIntrospect);
  router.post("/introspect", requireOAuthActive, handleIntrospect);

  // SDK falls back to POST /register at root when discovery fails.
  // Without this, Express returns HTML 404 which breaks parseErrorResponse.
  router.post("/register", (req, res) => {
    if (registrationDisabled()) return rejectRegistration(req, res);
    if (stateManager.state.authMode === "oauth") {
      return sdkAuthRouter(req, res, () => {
        res.status(404).json({ error: "not_found" });
      });
    }
    res.status(400).json({
      error: "invalid_request",
      error_description: `OAuth is not active (current mode: ${stateManager.state.authMode}). Switch via POST /api/auth-mode {"mode":"oauth"}`,
    });
  });

  return router;
}
