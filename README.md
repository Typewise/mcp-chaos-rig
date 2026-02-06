<p align="center">
  <img src="src/ui/favicon.svg" alt="MCP Chaos Rig" width="80" height="80">
</p>

<h1 align="center">MCP Chaos Rig</h1>

<p align="center">A local MCP server that breaks on demand. Test your client against auth failures, disappearing tools, flaky responses, and schema changes—all from a web UI.</p>

---

## The problem

You're building an MCP client. You need to test OAuth flows, tool discovery, error handling, and session lifecycle. Production servers don't fail on command. You need a server that does.

## What Chaos Rig does

Run a local MCP server where you control everything:

- **Break authentication** — Force 401s and 500s mid-session, even on valid tokens
- **Break tools** — Disable tools to trigger `tools/changed`, switch schema versions live
- **Break reliability** — Add random latency, make tool calls fail at configurable rates
- **See everything** — Live request log shows JSON-RPC methods, tool args, session IDs

![Server tab](docs/server-tab.png)

### Test scenarios

| Scenario                    | How to test it                                                                   |
| --------------------------- | -------------------------------------------------------------------------------- |
| OAuth 2.1 consent flow      | Use the interactive consent page: approve, decline, invalid code, tampered state |
| Token rejection mid-session | Toggle "Reject OAuth" to 401 or 500 while client is connected                    |
| Tool disappearing           | Disable a tool in the Tools tab—clients receive `tools/changed`                  |
| Tool schema changing        | Switch echo or add between v1 and v2 schemas                                     |
| Flaky tool calls            | Set failure rate 0–100%—failed calls return `isError: true`                      |
| Slow responses              | Enable slow mode with configurable latency range                                 |
| PKCE code exchange          | OAuth consent page offers "Wrong Code" and "Wrong State" options                 |
| Database-backed tools       | CRUD operations on a real SQLite contact database                                |

---

## Quick start

```bash
# tested on node 24
npm install
npm run dev
```

Open the control panel at [localhost:4100/ui](http://localhost:4100/ui).
Point your MCP client at `http://localhost:4100/mcp`.

### Testing with your production server

To let your prod environment call your local Chaos Rig, expose it via a tunnel (ngrok, Cloudflare Tunnel, etc.):

```bash
BASE_URL=https://your-forwarder.something.dev npm run dev
```

Auth state is in-memory and doesn't survive restarts.

---

## Control panel tabs

### Server

Configure auth mode, slow mode (random latency), and flaky tools (% failure rate).

| Auth mode | Behavior                                              |
| --------- | ----------------------------------------------------- |
| None      | All requests pass through                             |
| Bearer    | Requires `Authorization: Bearer test-token-123`       |
| OAuth 2.1 | Full authorization flow with interactive consent page |

Bearer and OAuth modes support fault injection—force 401 or 500 responses to test error handling.

### Tools

![Tools tab](docs/tools-tab.png)

Toggle tools on/off. Disabling sends `tools/changed` to connected clients. Some tools (echo, add) support version switching.

**Available tools:**

- `echo` — Returns your message (v2 adds format options)
- `add` — Sums two numbers (v2 accepts an array)
- `get-time` — Current server time as ISO 8601
- `random-number` — Random integer in a range
- `reverse` — Reverses a string
- `list-contacts`, `search-contacts`, `create-contact`, `update-contact`, `delete-contact` — SQLite CRUD

### Contacts

![Contacts tab](docs/contacts-tab.png)

View and reset the SQLite database backing the contact tools. Starts with three seed records.

### Log

![Log tab](docs/log-tab.png)

Live request log: timestamp, source (mcp/auth), method, status, JSON-RPC method, tool name, arguments. Keeps last 200 entries.

---

## OAuth consent page

![OAuth consent page](docs/oauth-consent.png)

When auth mode is OAuth, the authorization endpoint shows an interactive consent page:

| Button      | Result                                             |
| ----------- | -------------------------------------------------- |
| Approve     | Redirects with valid authorization code            |
| Decline     | Redirects with `error=access_denied`               |
| Wrong Code  | Redirects with invalid code (token exchange fails) |
| Wrong State | Redirects with tampered state parameter            |
