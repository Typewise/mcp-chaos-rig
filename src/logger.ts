import type { Request, Response, NextFunction } from "express";

const reset = "\x1b[0m";

const dim = "\x1b[2m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const cyan = "\x1b[36m";
const magenta = "\x1b[35m";

function statusColor(status: number): string {
  if (status >= 500) return red;
  if (status >= 400) return yellow;
  if (status >= 300) return cyan;
  return green;
}

function elapsed(start: [number, number]): string {
  const [s, ns] = process.hrtime(start);
  return (s * 1e3 + ns * 1e-6).toFixed(1);
}

function skip(path: string): boolean {
  return path === "/ui" || path === "/favicon.svg" || path.startsWith("/api");
}

export function logOutboundMessage(message: Record<string, unknown>, sessionId?: string) {
  const sid = sessionId?.slice(0, 8);
  const parts = [`${dim}  sse ←${reset}`];
  if (message.method) parts.push(`${cyan}${message.method}${reset}`);
  else if (message.result !== undefined) parts.push(`${cyan}result${reset}`);
  else if (message.error !== undefined) parts.push(`${cyan}error${reset}`);
  if (message.id !== undefined) parts.push(`${dim}id=${message.id}${reset}`);
  if (sid) parts.push(`${dim}sid=${sid}${reset}`);
  console.log(parts.join(" "));
  try {
    console.log(`${dim}  ${JSON.stringify(message)}${reset}`);
  } catch {}
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const path = req.path ?? req.url ?? "";
  if (skip(path)) return next();

  const start = process.hrtime();
  const sid = typeof req.headers["mcp-session-id"] === "string"
    ? req.headers["mcp-session-id"].slice(0, 8)
    : undefined;

  res.on("finish", () => {
    const status = res.statusCode;
    const ms = elapsed(start);
    const body = req.body as Record<string, unknown> | undefined;

    const rpcMethod =
      body?.method && typeof body.method === "string" ? body.method : undefined;
    const toolName =
      rpcMethod === "tools/call" && body?.params && typeof body.params === "object"
        ? String((body.params as Record<string, unknown>).name ?? "")
        : undefined;
    const method = req.method.padEnd(4);

    if (status === 304) {
      const parts = [method, path, status, `${ms}ms`];
      if (rpcMethod) parts.push(`rpc=${rpcMethod}` as any);
      if (toolName) parts.push(`tool=${toolName}` as any);
      if (sid) parts.push(`sid=${sid}` as any);
      console.log(`${dim}${parts.join(" ")}${reset}`);
      return;
    }

    const parts = [
      req.method === "GET" ? `${dim}${method}${reset}` : method,
      path,
      `${statusColor(status)}${status}${reset}`,
      `${dim}${ms}ms${reset}`,
    ];

    if (rpcMethod) parts.push(`${cyan}rpc=${rpcMethod}${reset}`);
    if (toolName) parts.push(`${magenta}tool=${toolName}${reset}`);
    if (sid) parts.push(`${dim}sid=${sid}${reset}`);

    console.log(parts.join(" "));

    if (body && typeof body === "object" && Object.keys(body).length > 0) {
      try {
        console.log(`${dim}  ${JSON.stringify(body)}${reset}`);
      } catch {}
    }
  });

  next();
}
