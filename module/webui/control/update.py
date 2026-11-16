import threading
from concurrent.futures import ThreadPoolExecutor
import traceback
from typing import Any, Dict, List, Optional

from module.logger import logger
from module.webui.control.events import InternalErrorBus
from module.webui.setting import State
from module.webui.updater import updater
from module.webui.error_rendering import render_exception_html


STATE_MAP = {
    0: "up_to_date",
    1: "update_available",
    "checking": "checking",
    "failed": "failed",
    "start": "waiting_instances",
    "wait": "waiting_instances",
    "run update": "running",
    "reload": "reload_required",
    "finish": "finished",
    "cancel": "canceling",
}

class UpdateControl:
    def __init__(self, internal_errors: InternalErrorBus) -> None:
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="control-update")
        self.lock = threading.Lock()
        self.internal_errors = internal_errors

    def state(self) -> str:
        return STATE_MAP.get(updater.state, "unknown")

    def _commit(self, value) -> Optional[Dict[str, Any]]:
        if not value:
            return None
        if isinstance(value[0], tuple):
            value = value[0]
        sha, author, time_text, message = value
        return {"sha": sha, "author": author, "date": time_text, "message": message}

    def commits(self) -> Dict[str, Any]:
        with self.lock:
            local = self._commit(updater.get_commit(short_sha1=True))
            upstream = self._commit(updater.get_commit(f"origin/{updater.Branch}", short_sha1=True))
            history = []
            raw_history = updater.get_commit(f"origin/{updater.Branch}", n=20, short_sha1=True) or []
            if raw_history and isinstance(raw_history[0], tuple):
                for item in raw_history:
                    commit = self._commit(item)
                    if commit:
                        history.append(commit)
        return {
            "state": self.state(),
            "restart_enabled": State.restart_event is not None,
            "branch": updater.Branch,
            "local": local,
            "upstream": upstream,
            "history": history,
        }

    def check(self) -> Dict[str, Any]:
        if updater.state in ("checking", "start", "wait", "run update", "reload"):
            return {"accepted": False, "state": self.state()}
        self._safe_check()
        return {"accepted": True, "state": self.state()}

    def _safe_check(self) -> None:
        updater.check_update()

    def record_internal_error(
            self,
            error: Exception,
            source: str,
            stack: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self.internal_errors.record(
            str(error),
            source=source,
            traceback_text=stack or traceback.format_exc(),
            html=render_exception_html(error),
        )

    def run(self) -> Dict[str, Any]:
        if updater.state in ("checking", "start", "wait", "run update", "reload"):
            return {"accepted": False, "state": self.state()}
        self.executor.submit(self._safe_run)
        return {"accepted": True, "state": self.state()}

    def _safe_run(self) -> None:
        try:
            updater.run_update()
        except Exception as error:
            logger.exception(error)
            updater.state = "failed"
            self.record_internal_error(error, "update-run")

    def cancel(self) -> Dict[str, Any]:
        updater.cancel()
        return {"accepted": True, "state": self.state()}
