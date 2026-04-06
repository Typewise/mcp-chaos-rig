import type { Request, Response, NextFunction } from "express";
import { stateManager, type RejectMode } from "./state.js";
import { resolveWwwAuthScopes } from "./oauth.js";

function applyReject(res: Response, rejectMode: RejectMode, label: string): boolean {
  if (rejectMode === "401") {
    res.status(401).json({ error: `${label} rejected (test toggle: 401)` });
    return true;
  }
  if (rejectMode === "500") {
    res.status(500).json({ error: `${label} rejected (test toggle: 500)` });
    return true;
  }
  return false;
}

/**
 * Dynamic auth middleware that checks state.authMode per request.
 * - "none": pass through
 * - "bearer": validate Authorization: Bearer <token>
 * - "headers": validate all required headers match
 * - "oauth": delegate to SDK's requireBearerAuth (set up externally)
 */
export function dynamicAuthMiddleware(
  getOAuthMiddleware: () => ((req: Request, res: Response, next: NextFunction) => void) | null
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const mode = stateManager.state.authMode;

    if (mode === "none") {
      return next();
    }

    if (mode === "bearer") {
      if (stateManager.state.rejectBearer === "401") {
        res.set("WWW-Authenticate", "Bearer");
      }
      if (applyReject(res, stateManager.state.rejectBearer, "Bearer token")) return;

      const bearer401 = (error: string) => {
        res.set("WWW-Authenticate", "Bearer");
        res.status(401).json({ error });
      };
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        bearer401("Missing Authorization header");
        return;
      }
      const [type, token] = authHeader.split(" ");
      if (type?.toLowerCase() !== "bearer" || !token) {
        bearer401("Invalid Authorization header format, expected 'Bearer TOKEN'");
        return;
      }
      if (token !== stateManager.state.bearerToken) {
        bearer401("Invalid bearer token");
        return;
      }
      return next();
    }

    if (mode === "headers") {
      if (applyReject(res, stateManager.state.rejectHeaders, "Headers")) return;

      const required = stateManager.state.requiredHeaders;
      const missing: string[] = [];
      const invalid: string[] = [];
      for (const [key, expectedValue] of Object.entries(required)) {
        const actual = req.headers[key.toLowerCase()] as string | undefined;
        if (!actual) {
          missing.push(key);
        } else if (actual !== expectedValue) {
          invalid.push(key);
        }
      }
      if (missing.length > 0 || invalid.length > 0) {
        res.status(401).json({
          error: "Header authentication failed",
          ...(missing.length > 0 && { missingHeaders: missing }),
          ...(invalid.length > 0 && { invalidHeaders: invalid }),
        });
        return;
      }
      return next();
    }

    if (mode === "oauth") {
      if (stateManager.state.rejectOAuth === "401") {
        const scopes = resolveWwwAuthScopes(stateManager.state.scopeConfig);
        const header = scopes.length > 0
          ? `Bearer, scope="${scopes.join(" ")}"`
          : "Bearer";
        res.set("WWW-Authenticate", header);
      }
      if (applyReject(res, stateManager.state.rejectOAuth, "OAuth")) return;

      const oauthMw = getOAuthMiddleware();
      if (oauthMw) {
        return oauthMw(req, res, next);
      }
      res.status(503).json({ error: "OAuth not configured" });
      return;
    }

    next();
  };
}
