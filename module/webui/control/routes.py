import asyncio
import platform
import subprocess
import sys
import time
from typing import Any, Dict, List

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from module.logger import logger
from module.webui.control.errors import ControlApiError, InvalidArgument, NotFound
from module.webui.control.events import EventHub, InternalErrorBus, ProcessLogCollector
from module.webui.control.instances import InstanceControl, validate_name
from module.webui.control.security import ControlSecurity
from module.webui.control.config import ConfigControl
from module.webui.control.management import config_filename
from module.webui.control.overview import overview
from module.webui.control.system import remote_status, runtime
from module.webui.control.update import UpdateControl
from module.webui.control.security import configured_password
from module.webui.process_manager import ProcessManager
from module.webui.setting import State


STARTED_AT = time.time()
MAX_IMPORT_BYTES = 1024 * 1024


async def request_json(request: Request) -> Dict[str, Any]:
    try:
        value = await request.json()
    except Exception:
        raise InvalidArgument("Request body must be valid JSON")
    if not isinstance(value, dict):
        raise InvalidArgument("Request body must be a JSON object")
    return value


def error_response(error: ControlApiError) -> JSONResponse:
    return JSONResponse(
        {
            "error": {
                "code": error.code,
                "message": error.message,
                "details": error.details,
            }
        },
        status_code=error.status_code,
    )


def git_commit() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"


class ControlApi:
    def __init__(self) -> None:
        self.security = ControlSecurity()
        self.hub = EventHub()
        self.internal_errors = InternalErrorBus()
        self.instances = InstanceControl(self.hub)
        self.config = ConfigControl()
        self.updates = UpdateControl(self.internal_errors)
        self.collector = ProcessLogCollector(self.hub, ProcessManager._processes)

    @property
    def routes(self) -> List[Any]:
        return [
            Route("/api/v1/health", self.health, methods=["GET"]),
            Route("/api/v1/auth/login", self.login, methods=["POST"]),
            Route("/api/v1/auth/logout", self.logout, methods=["POST"]),
            Route("/api/v1/auth/me", self.current_identity, methods=["GET"]),
            Route("/api/v1/version", self.version, methods=["GET"]),
            Route("/api/v1/bootstrap", self.bootstrap, methods=["GET"]),
            Route("/api/v1/settings", self.get_settings, methods=["GET"]),
            Route("/api/v1/settings", self.update_settings, methods=["PATCH"]),
            Route("/api/v1/config/schema/{mod}", self.config_schema, methods=["GET"]),
            Route("/api/v1/config/menu/{mod}", self.config_menu, methods=["GET"]),
            Route("/api/v1/i18n/{locale}", self.locale, methods=["GET"]),
            Route("/api/v1/instances/templates", self.instance_templates, methods=["GET"]),
            Route("/api/v1/instances/import", self.import_instance, methods=["POST"]),
            Route("/api/v1/instances", self.list_instances, methods=["GET"]),
            Route("/api/v1/instances", self.create_instance, methods=["POST"]),
            Route("/api/v1/instances/{name}", self.get_instance, methods=["GET"]),
            Route("/api/v1/instances/{name}/config", self.get_config, methods=["GET"]),
            Route("/api/v1/instances/{name}/config/validate", self.validate_config, methods=["POST"]),
            Route("/api/v1/instances/{name}/config", self.patch_config, methods=["PATCH"]),
            Route("/api/v1/instances/{name}/config/export", self.export_config, methods=["GET"]),
            Route("/api/v1/instances/{name}/overview", self.instance_overview, methods=["GET"]),
            Route("/api/v1/instances/{name}/start", self.start_instance, methods=["POST"]),
            Route("/api/v1/instances/{name}/stop", self.stop_instance, methods=["POST"]),
            Route("/api/v1/instances/{name}/restart", self.restart_instance, methods=["POST"]),
            WebSocketRoute("/api/v1/instances/{name}/logs", self.instance_logs),
            WebSocketRoute("/api/v1/internal-errors/ws", self.internal_errors_stream),
            Route("/api/v1/update/status", self.update_status, methods=["GET"]),
            Route("/api/v1/update/check", self.update_check, methods=["POST"]),
            Route("/api/v1/update/run", self.update_run, methods=["POST"]),
            Route("/api/v1/update/cancel", self.update_cancel, methods=["POST"]),
            Route("/api/v1/remote-access/status", self.remote_access, methods=["GET"]),
            Route("/api/v1/system/runtime", self.system_runtime, methods=["GET"]),
            Route("/api/v1/system/force-restart", self.force_restart, methods=["POST"]),
            Route("/api/v1/system/raise-exception", self.raise_exception, methods=["POST"]),
        ]

    def startup(self) -> None:
        self.collector.start()
        logger.info("Control API started at /api/v1")

    def shutdown(self) -> None:
        self.collector.stop()

    async def health(self, request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    async def login(self, request: Request) -> Response:
        body = await request_json(request)
        return self.security.login(request, body.get("password"))

    async def logout(self, request: Request) -> Response:
        self.security.authenticate(request)
        response = Response(status_code=204)
        response.delete_cookie("alas_control_session", path="/")
        return response

    async def current_identity(self, request: Request) -> JSONResponse:
        identity = self.security.authenticate(request)
        return JSONResponse(identity)

    async def version(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        commit = await run_in_threadpool(git_commit)
        return JSONResponse(
            {
                "api": "v1",
                "commit": commit,
                "python": sys.version.split()[0],
                "platform": platform.platform(),
                "pid": None,
                "started_at": STARTED_AT,
            }
        )

    async def bootstrap(self, request: Request) -> JSONResponse:
        from module.config.utils import LANGUAGES
        from module.webui import lang

        try:
            identity = self.security.authenticate(request)
        except ControlApiError:
            identity = None
        return JSONResponse(
            {
                "authenticated": identity is not None,
                "identity": identity,
                "api": "v1",
                "settings": {
                    "language": lang.LANG,
                    "theme": State.theme,
                    "languages": LANGUAGES,
                    "password_required": bool(configured_password()),
                },
            }
        )

    async def get_settings(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        from module.config.utils import LANGUAGES
        from module.webui import lang

        return JSONResponse(
            {
                "language": lang.LANG,
                "theme": State.theme,
                "languages": LANGUAGES,
                "runtime": runtime(),
                "remote_access": remote_status(),
            }
        )

    async def update_settings(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        from module.webui.control.system import update_settings

        body = await request_json(request)
        return JSONResponse(await run_in_threadpool(update_settings, body))

    async def config_schema(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        mod = request.path_params["mod"]
        return JSONResponse(await run_in_threadpool(self.config.args, mod))

    async def config_menu(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        mod = request.path_params["mod"]
        return JSONResponse(await run_in_threadpool(self.config.menu, mod))

    async def locale(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        locale = request.path_params["locale"]
        return JSONResponse(await run_in_threadpool(self.config.locale, locale))

    async def list_instances(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        instances = await run_in_threadpool(self.instances.list)
        return JSONResponse({"items": instances, "total": len(instances)})

    async def create_instance(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        body = await request_json(request)
        name = body.get("name")
        copy_from = body.get("copy_from")
        if not isinstance(name, str) or not isinstance(copy_from, str):
            raise InvalidArgument("name and copy_from are required")
        result = await run_in_threadpool(self.config.create, name, copy_from)
        return JSONResponse(result, status_code=201)

    async def get_instance(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        name = request.path_params["name"]
        instance = await run_in_threadpool(self.instances.get, name)
        return JSONResponse(instance)

    async def start_instance(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        name = request.path_params["name"]
        body = await request_json(request) if request.headers.get("content-length", "0") != "0" else {}
        instance = await run_in_threadpool(self.instances.start, name, body.get("task"))
        return JSONResponse(instance, status_code=202)

    async def stop_instance(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        name = request.path_params["name"]
        instance = await run_in_threadpool(self.instances.stop, name)
        return JSONResponse(instance, status_code=202)

    async def restart_instance(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        name = request.path_params["name"]
        body = await request_json(request) if request.headers.get("content-length", "0") != "0" else {}
        instance = await run_in_threadpool(self.instances.restart, name, body.get("task"))
        return JSONResponse(instance, status_code=202)

    async def instance_templates(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        from module.webui.control.management import templates

        return JSONResponse({"items": await run_in_threadpool(templates)})

    async def import_instance(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        body = await request_json(request)
        filename = str(body.get("filename", ""))
        content = body.get("content")
        if not filename or not isinstance(content, str):
            raise InvalidArgument("filename and content are required")
        if len(content.encode("utf-8")) > MAX_IMPORT_BYTES:
            raise InvalidArgument("Import file exceeds 1MB")
        result = await run_in_threadpool(self.config.import_config, filename, content)
        return JSONResponse(result, status_code=201)

    async def get_config(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        name = request.path_params["name"]
        config = await run_in_threadpool(self.config.read_json, name)
        revision = await run_in_threadpool(self.config.revision, name)
        return JSONResponse({"revision": revision, "config": config})

    async def validate_config(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        name = request.path_params["name"]
        body = await request_json(request)
        result = await run_in_threadpool(self.config.patch, name, body.get("changes", []), dry_run=True)
        return JSONResponse(result)

    async def patch_config(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        name = request.path_params["name"]
        body = await request_json(request)
        result = await run_in_threadpool(self.config.patch, name, body.get("changes", []), dry_run=bool(body.get("dry_run", False)))
        return JSONResponse(result)

    async def export_config(self, request: Request):
        self.security.authenticate(request)
        name = request.path_params["name"]
        path = await run_in_threadpool(self.config.export_path, name)
        return FileResponse(path=path, filename=config_filename(name))

    async def instance_overview(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        name = request.path_params["name"]
        return JSONResponse(await run_in_threadpool(overview, name))

    async def update_status(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        return JSONResponse(await run_in_threadpool(self.updates.commits))

    async def update_check(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        return JSONResponse(await run_in_threadpool(self.updates.check), status_code=202)

    async def update_run(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        return JSONResponse(await run_in_threadpool(self.updates.run), status_code=202)

    async def update_cancel(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        return JSONResponse(await run_in_threadpool(self.updates.cancel))

    async def internal_errors_stream(self, websocket: WebSocket) -> None:
        if not self.security.authenticate_websocket(websocket):
            await websocket.close(code=4401, reason="unauthenticated")
            return

        try:
            cursor = int(websocket.query_params.get("cursor", self.internal_errors.latest_sequence()))
        except (TypeError, ValueError):
            cursor = self.internal_errors.latest_sequence()

        await websocket.accept()
        idle_seconds = 0.0
        try:
            while True:
                events = self.internal_errors.after(cursor)
                if events:
                    for event in events:
                        await websocket.send_json({"type": "internal-error", "event": event})
                        cursor = event["seq"]
                    idle_seconds = 0.0
                else:
                    idle_seconds += 0.5
                    if idle_seconds >= 15:
                        await websocket.send_json({"type": "heartbeat", "cursor": cursor})
                        idle_seconds = 0.0
                await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            return

    async def remote_access(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        return JSONResponse(remote_status())

    async def system_runtime(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        return JSONResponse(runtime())

    async def force_restart(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        from module.webui.control.system import force_restart

        return JSONResponse(await run_in_threadpool(force_restart), status_code=202)

    async def raise_exception(self, request: Request) -> JSONResponse:
        self.security.authenticate(request)
        raise RuntimeError("Control API test exception")

    async def instance_logs(self, websocket: WebSocket) -> None:
        if not self.security.authenticate_websocket(websocket):
            await websocket.close(code=4401, reason="unauthenticated")
            return

        name = websocket.path_params["name"]
        try:
            validate_name(name)
        except NotFound:
            await websocket.close(code=4404, reason="instance not found")
            return

        try:
            cursor = int(websocket.query_params.get("cursor", "0"))
        except ValueError:
            cursor = 0

        await websocket.accept()
        idle_seconds = 0.0
        try:
            while True:
                events = self.hub.buffer(name).after(cursor)
                if events:
                    cursor = events[-1]["seq"]
                    for event in events:
                        await websocket.send_json(event)
                    idle_seconds = 0.0
                else:
                    idle_seconds += 0.5
                    if idle_seconds >= 15:
                        await websocket.send_json({"type": "heartbeat", "cursor": cursor})
                        idle_seconds = 0.0
                await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            return


