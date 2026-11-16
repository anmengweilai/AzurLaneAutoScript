import json
import threading
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from rich.console import Console, ConsoleRenderable

from module.logger import HTMLConsole, Highlighter, WEB_THEME
from module.webui.setting import State
from module.webui.utils import (
    DARK_TERMINAL_THEME,
    LIGHT_TERMINAL_THEME,
    LOG_CODE_FORMAT,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LogBuffer:
    def __init__(self, maxlen: int = 1000) -> None:
        self.maxlen = maxlen
        self._events: deque = deque(maxlen=maxlen)
        self._sequence = 0
        self._lock = threading.Lock()

    def append(
            self,
            message: str,
            *,
            level: str = "info",
            html: Optional[str] = None,
            lines: int = 1,
    ) -> Dict[str, Any]:
        text = message.strip()
        lower = text.lower()
        if "error" in lower or "critical" in lower or "traceback" in lower:
            level = "error"
        elif "warning" in lower:
            level = "warning"

        with self._lock:
            self._sequence += 1
            event = {
                "seq": self._sequence,
                "timestamp": utc_now(),
                "level": level,
                "format": "html" if html else "plain",
                "message": text,
                "lines": max(1, int(lines)),
            }
            if html:
                event["html"] = html
            self._events.append(event)
            return event

    def after(self, cursor: int = 0, limit: int = 200) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(event) for event in self._events if event["seq"] > cursor][:limit]

    def latest_sequence(self) -> int:
        with self._lock:
            return self._events[-1]["seq"] if self._events else 0


def renderable_to_text(renderable: Any) -> str:
    console = Console(file=None, width=120, no_color=True, highlight=False, markup=False)
    with console.capture() as capture:
        console.print(renderable)
    return capture.get()


def renderable_to_html(renderable: ConsoleRenderable) -> Tuple[str, str]:
    """Render a Rich object with the same truecolor HTML used by PyWebIO."""
    console = HTMLConsole(
        force_terminal=False,
        force_interactive=False,
        width=120,
        color_system="truecolor",
        markup=False,
        record=True,
        safe_box=False,
        highlighter=Highlighter(),
        theme=WEB_THEME,
    )
    with console.capture() as capture:
        console.print(renderable)
    text = capture.get().strip()
    terminal_theme = DARK_TERMINAL_THEME if State.theme == "dark" else LIGHT_TERMINAL_THEME
    html = console.export_html(
        theme=terminal_theme,
        clear=True,
        code_format=LOG_CODE_FORMAT,
        inline_styles=True,
    )
    return text, html


class EventHub:
    def __init__(self, maxlen: int = 1000) -> None:
        self.maxlen = maxlen
        self._buffers: Dict[str, LogBuffer] = {}
        self._lock = threading.Lock()

    def buffer(self, instance: str) -> LogBuffer:
        with self._lock:
            if instance not in self._buffers:
                self._buffers[instance] = LogBuffer(self.maxlen)
            return self._buffers[instance]


class InternalErrorBus:
    def __init__(self, maxlen: int = 100) -> None:
        self.maxlen = maxlen
        self._errors: deque = deque(maxlen=maxlen)
        self._sequence = time.time_ns()
        self._lock = threading.Lock()

    def record(
            self,
            message: str,
            *,
            source: str,
            traceback_text: Optional[str] = None,
            html: Optional[str] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            self._sequence += 1
            event = {
                "seq": self._sequence,
                "source": source,
                "message": message,
                "traceback": traceback_text or message,
                "timestamp": time.time_ns(),
            }
            if html:
                event["html"] = html
            self._errors.append(event)
            return dict(event)

    def after(self, cursor: int = 0) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(event) for event in self._errors if event["seq"] > cursor]

    def latest_sequence(self) -> int:
        with self._lock:
            return self._errors[-1]["seq"] if self._errors else 0


class ProcessLogCollector:
    """Poll existing ProcessManager queues without changing the PyWebIO implementation."""

    def __init__(self, hub: EventHub, process_store, poll_interval: float = 0.25) -> None:
        self.hub = hub
        self.process_store = process_store
        self.poll_interval = poll_interval
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._seen: "OrderedDict[int, float]" = OrderedDict()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="control-api-log-collector", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def collect_once(self) -> int:
        count = 0
        managers = list(self.process_store.values())

        for manager in managers:
            buffer = self.hub.buffer(manager.config_name)
            for renderable in list(manager.renderables):
                identity = id(renderable)
                if identity in self._seen:
                    continue
                self._seen[identity] = time.time()
                while len(self._seen) > 2000:
                    self._seen.popitem(last=False)
                text, html = renderable_to_html(renderable)
                buffer.append(text, html=html, lines=text.count("\n") + 1)
                count += 1
        return count

    def _run(self) -> None:
        while not self._stop.wait(self.poll_interval):
            try:
                self.collect_once()
            except Exception:
                continue
