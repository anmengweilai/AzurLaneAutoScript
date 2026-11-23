"""Emulator screen capture and single-pointer input for agents.

The panel process never owns a device connection: instances talk to the emulator
from their own process, so this adapter drives the emulator through plain `adb`
commands instead of importing `module.device`. It therefore works while an
instance is stopped, and only needs the serial of the instance config.

`adb shell input` only knows one pointer, so this adapter exposes tap and swipe
(a long swipe is a drag, a zero-length long swipe is a long press). Multi-touch
needs minitouch/maatouch or a raw `sendevent` stream, which the panel does not
own; see the README.

Routes are registered in :mod:`module.webui.control.routes`.
"""
import os
import shutil
import subprocess
import threading
from typing import Any, Dict, List, Optional

from module.config.utils import filepath_config, read_file
from module.logger import logger
from module.webui.control.errors import ControlApiError, InvalidArgument, NotFound
from module.webui.control.instances import validate_name
from module.webui.setting import State


SCREENSHOT_TIMEOUT = 20
TAP_TIMEOUT = 15
SWIPE_TIMEOUT = 20
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'
MAX_COORDINATE = 100000
DEFAULT_SWIPE_MS = 300
MIN_SWIPE_MS = 1
MAX_SWIPE_MS = 60000


def coordinate(value: Any, key: str) -> int:
    """Normalize one absolute screen coordinate, rejecting anything lossy."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidArgument(f"`{key}` must be a number")
    if isinstance(value, float):
        if not value.is_integer():
            raise InvalidArgument(f"`{key}` must be an integer")
        value = int(value)
    if not 0 <= value <= MAX_COORDINATE:
        raise InvalidArgument(f"`{key}` must be between 0 and {MAX_COORDINATE}")
    return value


def duration(value: Any) -> int:
    """Normalize a gesture duration in milliseconds."""
    if value is None:
        return DEFAULT_SWIPE_MS
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidArgument("`duration_ms` must be an integer")
    if not MIN_SWIPE_MS <= value <= MAX_SWIPE_MS:
        raise InvalidArgument(f"`duration_ms` must be between {MIN_SWIPE_MS} and {MAX_SWIPE_MS}")
    return value


class DeviceControl:
    """Screenshot and tap endpoints backed by `adb`.

    Every adb call for one instance is serialized, so two screenshots or a
    screenshot and a tap never interleave on the same device.
    """

    def __init__(self) -> None:
        self._locks: Dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _lock(self, name: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(name, threading.Lock())

    def config(self, name: str) -> Dict[str, Any]:
        validate_name(name)
        config = read_file(filepath_config(name))
        if not config:
            raise NotFound(f"Instance config not found: {name}", code="CONFIG_NOT_FOUND")
        return config

    def serial(self, name: str) -> str:
        config = self.config(name)
        emulator = (config.get("Alas") or {}).get("Emulator") or {}
        serial = emulator.get("Serial")
        if not serial or not isinstance(serial, str):
            raise ControlApiError(
                f"Instance has no emulator serial configured: {name}",
                code="EMULATOR_NOT_CONFIGURED",
                status_code=409,
                details={"instance": name},
            )
        return serial

    def adb_binary(self) -> str:
        executable = ""
        try:
            executable = (State.deploy_config.AdbExecutable or "").replace("\\", "/")
        except Exception:
            executable = ""
        if executable and os.path.exists(executable):
            return os.path.abspath(executable)
        found = shutil.which("adb")
        if found:
            return found
        return "adb"

    def _spawn(self, serial: str, args: List[str], timeout: int) -> subprocess.CompletedProcess:
        command = [self.adb_binary(), "-s", serial] + args
        try:
            return subprocess.run(
                command,
                capture_output=True,
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError:
            raise ControlApiError(
                "adb executable not found, set Deploy.Adb.AdbExecutable in deploy.yaml",
                code="ADB_NOT_FOUND",
                status_code=503,
            )
        except subprocess.TimeoutExpired:
            raise ControlApiError(
                f"adb command timed out after {timeout}s",
                code="ADB_TIMEOUT",
                status_code=504,
                details={"command": args},
            )

    @staticmethod
    def _output(result: subprocess.CompletedProcess) -> str:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        if stderr:
            return stderr
        return result.stdout.decode("utf-8", errors="replace").strip()

    def _reconnect(self, serial: str) -> None:
        """Network emulators (127.0.0.1:port) need `adb connect` after a restart."""
        if ":" not in serial:
            return
        logger.info(f"Trying adb connect {serial}")
        self._spawn(serial, ["connect", serial], TAP_TIMEOUT)
        # `-s serial` is meaningless for `connect`, so issue the raw form as well.
        try:
            subprocess.run(
                [self.adb_binary(), "connect", serial],
                capture_output=True,
                timeout=TAP_TIMEOUT,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass

    def _run(self, serial: str, args: List[str], timeout: int) -> bytes:
        result = self._spawn(serial, args, timeout)
        if result.returncode == 0:
            return result.stdout
        output = self._output(result)
        if "not found" in output or "offline" in output:
            self._reconnect(serial)
            result = self._spawn(serial, args, timeout)
            if result.returncode == 0:
                return result.stdout
            output = self._output(result)
        raise ControlApiError(
            output or "adb command failed",
            code="ADB_ERROR",
            status_code=503,
            details={"command": args, "returncode": result.returncode},
        )

    def screenshot(self, name: str) -> bytes:
        serial = self.serial(name)
        translated = False
        with self._lock(name):
            try:
                data = self._run(serial, ["exec-out", "screencap", "-p"], SCREENSHOT_TIMEOUT)
            except ControlApiError as error:
                args = error.details.get("command") or []
                if error.code != "ADB_ERROR" or "exec-out" not in args:
                    raise
                # Old adb builds have no `exec-out`, so fall back to the shell form.
                logger.warning("adb exec-out unsupported, falling back to shell screencap")
                data = self._run(serial, ["shell", "screencap", "-p"], SCREENSHOT_TIMEOUT)
                translated = True
        if translated:
            # The shell form runs through a pty, which rewrites "\n" into "\r\n".
            # The PNG signature itself contains "\r\n", so only repair this path.
            data = data.replace(b"\r\n", b"\n")
        if not data:
            raise ControlApiError(
                f"Emulator returned an empty screenshot: {name}",
                code="SCREENSHOT_EMPTY",
                status_code=502,
                details={"instance": name, "serial": serial},
            )
        if not data.startswith(PNG_MAGIC):
            raise ControlApiError(
                f"Emulator returned an invalid screenshot: {name}",
                code="SCREENSHOT_INVALID",
                status_code=502,
                details={"instance": name, "serial": serial},
            )
        return data

    def tap(self, name: str, x: int, y: int) -> Dict[str, Any]:
        x = coordinate(x, "x")
        y = coordinate(y, "y")
        serial = self.serial(name)
        with self._lock(name):
            self._run(serial, ["shell", "input", "tap", str(x), str(y)], TAP_TIMEOUT)
        logger.info(f"Device tap [{name}] ({x}, {y})")
        return {"accepted": True, "instance": name, "x": x, "y": y}

    def swipe(
            self,
            name: str,
            x1: int,
            y1: int,
            x2: int,
            y2: int,
            duration_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Drag from (x1, y1) to (x2, y2).

        `duration_ms` decides the gesture: a short one is a flick, a long one is
        a drag, and a start equal to the end with >= 500 ms is a long press.
        """
        x1 = coordinate(x1, "x1")
        y1 = coordinate(y1, "y1")
        x2 = coordinate(x2, "x2")
        y2 = coordinate(y2, "y2")
        duration_ms = duration(duration_ms)
        serial = self.serial(name)
        with self._lock(name):
            self._run(
                serial,
                [
                    "shell", "input", "swipe",
                    str(x1), str(y1), str(x2), str(y2), str(duration_ms),
                ],
                SWIPE_TIMEOUT,
            )
        logger.info(f"Device swipe [{name}] ({x1}, {y1}) -> ({x2}, {y2}) {duration_ms}ms")
        return {
            "accepted": True,
            "instance": name,
            "from": {"x": x1, "y": y1},
            "to": {"x": x2, "y": y2},
            "duration_ms": duration_ms,
        }