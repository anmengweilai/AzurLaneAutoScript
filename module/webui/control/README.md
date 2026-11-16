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
