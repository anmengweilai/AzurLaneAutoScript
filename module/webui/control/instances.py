import threading
import time
from typing import Any, Dict, List, Optional

from module.logger import logger
from module.submodule.utils import get_config_mod
from module.webui.control.errors import NotFound
from module.webui.control.events import EventHub
from module.webui.process_manager import ProcessManager
from module.webui.updater import updater
from module.config.utils import alas_instance


STATE_MAP = {
    1: "running",
    2: "stopped",
    3: "failed",
    4: "updating",
}


def validate_name(name: str) -> None:
    if name not in alas_instance():
        raise NotFound(f"Instance not found: {name}", code="INSTANCE_NOT_FOUND")


class InstanceControl:
    def __init__(self, hub: EventHub) -> None:
        self.hub = hub
        self._locks: Dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self._starting: Dict[str, float] = {}
        self._stopping: Dict[str, float] = {}

    def _lock(self, name: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(name, threading.Lock())

    @staticmethod
    def manager(name: str) -> ProcessManager:
        validate_name(name)
        return ProcessManager.get_manager(name)

    def state(self, name: str, manager: Optional[ProcessManager] = None) -> str:
        manager = manager or self.manager(name)
        raw_state = manager.state
        if name in self._starting:
            if manager.alive:
                return "starting" if time.time() - self._starting[name] < 3 else "running"
            return "failed"
        if name in self._stopping:
            return "stopping" if manager.alive else "stopped"
        return STATE_MAP.get(raw_state, "unknown")

    def payload(self, name: str) -> Dict[str, Any]:
        manager = self.manager(name)
        process = manager._process
        pid = None
        if process is not None and process.is_alive():
            pid = process.pid

        return {
            "name": name,
            "mod": get_config_mod(name),
            "state": self.state(name, manager),
            "pid": pid,
            "started_at": None,
            "log_cursor": self.hub.buffer(name).latest_sequence(),
        }

    def list(self) -> List[Dict[str, Any]]:
        return [self.payload(name) for name in sorted(alas_instance())]

    def get(self, name: str) -> Dict[str, Any]:
        return self.payload(name)

    def start(self, name: str, task: Optional[str] = None) -> Dict[str, Any]:
        validate_name(name)
        with self._lock(name):
            manager = self.manager(name)
            if manager.alive:
                return self.payload(name)

            target_task = task or get_config_mod(name)
            logger.info(f"Control API starting instance [{name}] task [{target_task}]")
            manager.start(func=target_task, ev=updater.event)
            self._stopping.pop(name, None)
            self._starting[name] = time.time()
            self.hub.buffer(name).append(f"Instance [{name}] start requested", level="info")
            return self.payload(name)

    def stop(self, name: str) -> Dict[str, Any]:
        validate_name(name)
        with self._lock(name):
            manager = self.manager(name)
            if manager.alive:
                logger.info(f"Control API stopping instance [{name}]")
                self._starting.pop(name, None)
                self._stopping[name] = time.time()
                manager.stop()
                self.hub.buffer(name).append(f"Instance [{name}] stop requested", level="warning")
            else:
                self._starting.pop(name, None)
                self._stopping.pop(name, None)
            return self.payload(name)

    def restart(self, name: str, task: Optional[str] = None) -> Dict[str, Any]:
        validate_name(name)
        with self._lock(name):
            manager = self.manager(name)
            if manager.alive:
                manager.stop()
            target_task = task or get_config_mod(name)
            logger.info(f"Control API restarting instance [{name}] task [{target_task}]")
            manager.start(func=target_task, ev=updater.event)
            self._stopping.pop(name, None)
            self._starting[name] = time.time()
            self.hub.buffer(name).append(f"Instance [{name}] restart requested", level="info")
            return self.payload(name)
