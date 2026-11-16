"""
Copy from pywebio.platform.fastapi
"""
import asyncio
import os
import traceback
from pathlib import Path

import uvicorn
from pywebio.platform.fastapi import (STATIC_PATH, Session, cdn_validation,
                                      get_free_port,
                                      open_webbrowser_on_server_started,
                                      start_remote_access_service,
                                      webio_routes)
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles
from starlette.responses import JSONResponse

from module.logger import logger
from module.webui.control.routes import ControlApi
from module.webui.control.errors import ControlApiError
from module.webui.control.routes import error_response
from module.webui.error_rendering import render_exception_html

# Built Umi frontend (frontend/dist), served under /app so that it shares an
# origin with the Control API at /api/v1.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


class HeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-cache"
        return response


def asgi_app(
    applications,
    cdn=True,
    static_dir=None,
    debug=False,
    allowed_origins=None,
    check_origin=None,
    **starlette_settings
):
    debug = Session.debug = os.environ.get("PYWEBIO_DEBUG", debug)
    cdn = cdn_validation(cdn, "warn")
    if cdn is False:
        cdn = "pywebio_static"
    control_api = ControlApi()
    settings = dict(starlette_settings)
    startup = list(settings.pop("on_startup", []))
    shutdown = list(settings.pop("on_shutdown", []))
    startup.append(control_api.startup)
    shutdown.insert(0, control_api.shutdown)
    exception_handlers = dict(settings.pop("exception_handlers", {}))
    exception_handlers[ControlApiError] = error_response

    async def internal_error_response(request, exc: Exception):
        logger.exception(exc)
        traceback_html = render_exception_html(exc)
        event = control_api.internal_errors.record(
            str(exc) or "An internal error occurred in the application",
            source="api",
            traceback_text=traceback.format_exc(),
            html=traceback_html,
        )
        return JSONResponse(
            {
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": str(exc) or "An internal error occurred in the application",
                    "details": {
                        "seq": event["seq"],
                        "timestamp": event["timestamp"],
                        "tracebackHtml": traceback_html,
                    },
                }
            },
            status_code=500,
        )

    exception_handlers[Exception] = internal_error_response
    routes = webio_routes(
        applications,
        cdn=cdn,
        allowed_origins=allowed_origins,
        check_origin=check_origin,
    )
    if static_dir:
        routes.append(
            Mount("/static", app=StaticFiles(directory=static_dir), name="static")
        )
    if (FRONTEND_DIST / "index.html").is_file():
        routes.append(
            Mount(
                "/app",
                app=StaticFiles(directory=str(FRONTEND_DIST), html=True),
                name="control_web",
            )
        )
        logger.info(f"Control web served at /app from {FRONTEND_DIST}")
    else:
        logger.warning(
            f"Control web frontend not found at {FRONTEND_DIST}, "
            f"run `npm run build` in frontend/ to enable /app"
        )
    routes.append(
        Mount(
            "/pywebio_static",
            app=StaticFiles(directory=STATIC_PATH),
            name="pywebio_static",
        )
    )
    middleware = [Middleware(HeaderMiddleware)]
    return Starlette(
        routes=control_api.routes + routes,
        middleware=middleware,
        debug=debug,
        on_startup=startup,
        on_shutdown=shutdown,
        exception_handlers=exception_handlers,
        **settings,
    )


def start_server(
    applications,
    port=0,
    host="",
    cdn=True,
    static_dir=None,
    remote_access=False,
    debug=False,
    allowed_origins=None,
    check_origin=None,
    auto_open_webbrowser=False,
    **uvicorn_settings
):

    app = asgi_app(
        applications,
        cdn=cdn,
        static_dir=static_dir,
        debug=debug,
        allowed_origins=allowed_origins,
        check_origin=check_origin,
    )

    if auto_open_webbrowser:
        asyncio.get_event_loop().create_task(
            open_webbrowser_on_server_started("localhost", port)
        )

    if not host:
        host = "0.0.0.0"

    if port == 0:
        port = get_free_port()

    if remote_access:
        start_remote_access_service(local_port=port)

    uvicorn.run(app, host=host, port=port, **uvicorn_settings)
