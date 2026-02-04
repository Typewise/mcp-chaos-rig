import type { Request, Response, NextFunction } from "express";
import { stateManager } from "./state.js";

/**
 * Dynamic auth middleware that checks state.authMode per request.
 * - "none": pass through
 * - "bearer": validate Authorization: Bearer <token>
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
      const rejectMode = stateManager.state.rejectBearer;
      if (rejectMode === "401") {
        res.status(401).json({ error: "Bearer token rejected (test toggle: 401)" });
        return;
      }
      if (rejectMode === "500") {
        res.status(500).json({ error: "Bearer token rejected (test toggle: 500)" });
        return;
      }
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: "Missing Authorization header" });
        return;
      }
      const [type, token] = authHeader.split(" ");
      if (type?.toLowerCase() !== "bearer" || !token) {
        res.status(401).json({ error: "Invalid Authorization header format, expected 'Bearer TOKEN'" });
        return;
      }
      if (token !== stateManager.state.bearerToken) {
        res.status(401).json({ error: "Invalid bearer token" });
        return;
      }
      return next();
    }

    if (mode === "oauth") {
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
