# Control API

`/api/v1` exposes a stable HTTP control surface without replacing PyWebIO.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Public health check |
| `POST` | `/api/v1/auth/login` | Sign a browser session cookie |
| `POST` | `/api/v1/auth/logout` | Delete the session cookie |
| `GET` | `/api/v1/auth/me` | Current identity and scopes |
| `GET` | `/api/v1/version` | Runtime and commit information |
| `GET` | `/api/v1/bootstrap` | Authentication state and UI settings |
| `GET`/`PATCH` | `/api/v1/settings` | Read or update language/theme |
| `GET` | `/api/v1/config/schema/{mod}` | Full config schema |
| `GET` | `/api/v1/config/menu/{mod}` | Task menu schema |
| `GET` | `/api/v1/i18n/{locale}` | Translation dictionary |
| `GET`/`POST` | `/api/v1/instances` | List or create instance configs |
| `POST` | `/api/v1/instances/import` | Import an instance JSON file |
| `GET` | `/api/v1/instances/{name}` | Get one instance |
| `POST` | `/api/v1/instances/{name}/start` | Idempotently start an instance or task |
| `POST` | `/api/v1/instances/{name}/stop` | Stop an instance |
| `POST` | `/api/v1/instances/{name}/restart` | Restart an instance |
| `GET` | `/api/v1/instances/{name}/overview` | Scheduler overview |
| `GET` | `/api/v1/instances/{name}/screen` | Emulator screenshot as `image/png` |
| `POST` | `/api/v1/instances/{name}/tap` | Tap the emulator screen at `{"x": 640, "y": 360}` |
| `POST` | `/api/v1/instances/{name}/swipe` | Swipe/drag/long press with `x1,y1,x2,y2,duration_ms` |
| `GET`/`PATCH` | `/api/v1/instances/{name}/config` | Read or patch instance config |
| `POST` | `/api/v1/instances/{name}/config/validate` | Validate without saving |
| `GET` | `/api/v1/instances/{name}/config/export` | Download instance JSON |
| `WS` | `/api/v1/instances/{name}/logs?cursor=0` | Stream plain-text logs |
| `GET`/`POST` | `/api/v1/update/*` | Status, check, run, and cancel updates |
| `GET` | `/api/v1/remote-access/status` | SSH remote access state |
| `GET` | `/api/v1/system/runtime` | Runtime information |
| `POST` | `/api/v1/system/force-restart` | Force ALAS service reload |

## Authentication

Requests may use the browser session cookie or `Authorization: Bearer <password>`.
When no password is configured, only requests from `127.0.0.1` or `::1` are accepted.

## Instance states

`stopped`, `starting`, `running`, `stopping`, `failed`, `updating`, and `unknown`.

The API does not expose numeric `ProcessManager.state` values or Rich renderable
objects directly; the control adapter translates them into stable JSON.

## Device input

`screen`, `tap`, and `swipe` drive the emulator with plain `adb` commands, using
the `Emulator.Serial` of the instance config and `Deploy.Adb.AdbExecutable`
(falling back to `adb` on `PATH`). The panel never imports `module.device`, so the
adapter works while the instance is stopped and never competes for a device
connection.

`tap` takes absolute screen pixels of the emulator resolution, not the scale the
frontend displays; `screen` returns the native screenshot so a client can read
the resolution from the image. Every adb call is serialized per instance.

`swipe` is one `adb shell input swipe`, so `duration_ms` picks the gesture:

| Gesture | Request |
|---|---|
| Flick / scroll | short distance + short `duration_ms` (default 300) |
| Drag | long distance + long `duration_ms` (1000+) |
| Long press | `x1 == x2`, `y1 == y2`, `duration_ms` >= 500 |

`adb shell input` has a single pointer, so there is no multi-touch (pinch, two
fingers, simultaneous presses). Inside ALAS that job belongs to minitouch,
maatouch, or a raw `sendevent` stream held by the instance process; the panel
does not own any of those connections.

Stop the instance before using these routes: while an instance runs, ALAS clicks
on its own schedule and the two input sources will fight over the screen.

## Frontend

The Umi/React client is under `frontend/`.

```bash
cd frontend
npm install
PORT=8081 npm run dev
npm run build
npx tsc --noEmit
```

Development requests to `/api` are proxied to `http://127.0.0.1:22267`.
