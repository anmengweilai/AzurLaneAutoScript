import platform
import sys
import threading
import time
from typing import Any, Dict

from module.logger import logger
from module.webui.remote_access import RemoteAccess
from module.webui.setting import State
from module.webui.control.errors import InvalidArgument


STARTED_AT = time.time()
REMOTE_STATE = {0: "disabled_or_stopped", 1: "running", 2: "connecting", 3: "ssh_missing"}


def runtime() -> Dict[str, Any]:
    deploy = State.deploy_config
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "webui_host": deploy.WebuiHost,
        "webui_port": deploy.WebuiPort,
        "started_at": STARTED_AT,
        "password_configured": deploy.Password is not None,
    }


def remote_status() -> Dict[str, Any]:
    state = RemoteAccess.get_state()
    return {
        "state": REMOTE_STATE.get(state, "unknown"),
        "entry_point": RemoteAccess.get_entry_point(),
        "enabled": bool(State.deploy_config.EnableRemoteAccess),
        "password_configured": bool(State.deploy_config.Password),
    }


def update_settings(data: Dict[str, Any]) -> Dict[str, Any]:
    from module.webui import lang

    allowed = {}
    if "language" in data:
        from module.config.utils import LANGUAGES

        language = data["language"]
        if language not in LANGUAGES:
            raise InvalidArgument("Unsupported language", details={"language": language})
        lang.set_language(language)
        allowed["language"] = lang.LANG
    if "theme" in data:
        theme = data["theme"]
        if theme not in ("default", "dark"):
            raise InvalidArgument("Theme must be default or dark", details={"theme": theme})
        State.deploy_config.Theme = theme
        State.theme = theme
        allowed["theme"] = theme
    if not allowed:
        raise InvalidArgument("At least one of language or theme is required")
    return {
        "language": lang.LANG,
        "theme": State.theme,
    }


def force_restart() -> Dict[str, Any]:
    from module.webui.app import clearup

    if State.restart_event is None:
        raise InvalidArgument("Reload is not enabled", code="RELOAD_DISABLED")

    def restart_later():
        time.sleep(3)
        logger.info("Control API force restart requested")
        clearup()
        State.restart_event.set()

    threading.Thread(target=restart_later, name="control-api-restart", daemon=True).start()
    return {"accepted": True, "state": "restarting"}
