# Alas MCP server

[Model Context Protocol](https://modelcontextprotocol.io) server for the Alas
Control API (`/api/v1`). It exposes five tools, so any MCP client — DeepSeek
Harness, Claude Desktop, Cursor, Codex — can inspect and drive Alas without
hand-writing HTTP calls.

The server is a thin adapter: every call maps to one Control API request, and
authentication reuses the panel's own rules (Bearer password when one is set,
otherwise loopback-only access).

## Tools

| Tool | Covers |
|---|---|
| `alas_instances` | list, get, start, stop, restart, overview, create, templates |
| `alas_config` | get (optionally only selected paths), patch, validate, export, schema, menu, i18n |
| `alas_logs` | recent in-memory log window for one instance, resumable by `cursor` |
| `alas_device` | screenshot as an image block, tap, swipe/drag/long press (single pointer, over adb) |
| `alas_system` | health, version, runtime, bootstrap, settings, update status/check/run/cancel, remote access |

One tool per area rather than one per endpoint: ~30 individual tools would sit
in every prompt, while the `action` enum keeps the same reach at five entries.

`alas_device` drives the emulator over plain adb, so it works while the instance
is stopped. Coordinates are emulator pixels taken from the screenshot it returns;
stop the instance before touching the screen, or ALAS will be clicking at the
same time. adb has a single pointer, so multi-touch is not exposed.

`alas_config` with `action: "patch"` validates and writes in one call. Add
`dry_run: true` to check the values without saving. Saving while an instance is
running applies on its next scheduler reload — the response's `apply_hint` says
which case applies.

## Run

```bash
cd integrations/alas-mcp
npm install
npm start          # stdio transport; speaks MCP on stdout, logs on stderr
```

Configuration is read from the environment:

| Variable | Default | Purpose |
|---|---|---|
| `ALAS_BASE_URL` | `http://127.0.0.1:22267` | Panel origin |
| `ALAS_PASSWORD` | _(unset)_ | Control API password, when one is configured |
| `ALAS_TIMEOUT_MS` | `15000` | Per-request timeout |

## Connect a client

DeepSeek Harness (`cordis.patch.yml` in the profile):

```yaml
- id: mcp-alas
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: alas
    transport: stdio
    command: node
    args:
      - /absolute/path/to/AzurLaneAutoScript/integrations/alas-mcp/src/server.js
    env:
      ALAS_BASE_URL: http://127.0.0.1:22267
```

Claude Desktop / Cursor (`mcpServers`):

```json
{
  "mcpServers": {
    "alas": {
      "command": "node",
      "args": ["/absolute/path/to/AzurLaneAutoScript/integrations/alas-mcp/src/server.js"],
      "env": { "ALAS_BASE_URL": "http://127.0.0.1:22267" }
    }
  }
}
```

Restart the client after editing its configuration; MCP servers are spawned on
connect, not reloaded.

## Test

```bash
node --test test/smoke.test.js          # read-only checks against a running panel
ALAS_TEST_WRITE=1 node --test test/smoke.test.js   # also taps, swipes, and stops
```

The suite expects Alas to be up on `ALAS_BASE_URL` with at least one instance.

## Notes

- Logs come from the panel's in-memory ring buffer (latest 1000 events), not
  from `log/` on disk, so they only cover the current service run.
- Update actions are asynchronous; poll `alas_system` with `action: "update_status"`.
- Instance names are the config names shown in the panel (`alas`, `alas2`, …).