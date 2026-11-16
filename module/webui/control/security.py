import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from starlette.requests import Request
from starlette.responses import Response

from module.logger import logger
from module.webui.control.errors import Forbidden, InvalidArgument, RateLimited, Unauthenticated
from module.webui.setting import State


COOKIE_NAME = "alas_control_session"
SESSION_TTL = 12 * 60 * 60
LOGIN_WINDOW = 5 * 60
LOGIN_MAX_FAILURES = 8
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _secret_path() -> Path:
    return Path("./config/.control_api_secret")


def load_secret() -> bytes:
    """Keep browser sessions valid across restarts without storing secrets in git."""
    path = _secret_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        value = path.read_text(encoding="ascii").strip()
        if len(value) >= 64:
            return bytes.fromhex(value)

    value = secrets.token_bytes(32).hex()
    path.write_text(value, encoding="ascii")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return bytes.fromhex(value)


def configured_password() -> Optional[str]:
    password = State.deploy_config.Password
    return str(password) if password is not None and password != "" else None


class ControlSecurity:
    def __init__(self) -> None:
        self.secret = load_secret()
        self.failures: Dict[str, Tuple[int, float]] = {}

    def _sign(self, payload: bytes) -> str:
        return hmac.new(self.secret, payload, hashlib.sha256).hexdigest()

    def encode_session(self, subject: str) -> str:
        payload = json.dumps(
            {"sub": subject, "exp": int(time.time()) + SESSION_TTL},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return payload.hex() + "." + self._sign(payload)

    def decode_session(self, token: str) -> Optional[Dict[str, Any]]:
        try:
            payload_hex, signature = token.split(".", 1)
            payload = bytes.fromhex(payload_hex)
            if not hmac.compare_digest(self._sign(payload), signature):
                return None
            data = json.loads(payload.decode("utf-8"))
            if int(data.get("exp", 0)) < int(time.time()):
                return None
            return data
        except (ValueError, TypeError, json.JSONDecodeError):
            return None

    def _client_key(self, request: Request) -> str:
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    def _rate_allowed(self, request: Request) -> bool:
        key = self._client_key(request)
        now = time.time()
        count, expires_at = self.failures.get(key, (0, 0.0))
        if expires_at < now:
            count = 0
            expires_at = now + LOGIN_WINDOW
        if count >= LOGIN_MAX_FAILURES:
            raise RateLimited("Too many failed login attempts")
        self.failures[key] = (count, expires_at)
        return True

    def _rate_fail(self, request: Request) -> None:
        key = self._client_key(request)
        now = time.time()
        count, expires_at = self.failures.get(key, (0, now + LOGIN_WINDOW))
        if expires_at < now:
            expires_at = now + LOGIN_WINDOW
        self.failures[key] = (count + 1, expires_at)

    def _password_matches(self, password: str) -> bool:
        expected = configured_password()
        return expected is not None and hmac.compare_digest(password, expected)

    def login(self, request: Request, password: str) -> Response:
        if not isinstance(password, str) or not password:
            raise InvalidArgument("password is required")

        self._rate_allowed(request)
        if not self._password_matches(password):
            self._rate_fail(request)
            logger.warning(f"Control API login failed from {self._client_key(request)}")
            raise Unauthenticated("Invalid password")

        self.failures.pop(self._client_key(request), None)
        token = self.encode_session("password")
        response = Response(status_code=204)
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_TTL,
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
            path="/",
        )
        return response

    def _bearer_password(self, request: Request) -> Optional[str]:
        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            return token
        return None

    def authenticate(self, request: Request) -> Dict[str, Any]:
        expected = configured_password()
        token = request.cookies.get(COOKIE_NAME)
        if token:
            session = self.decode_session(token)
            if session:
                return {"subject": session["sub"], "scopes": ["admin"]}

        bearer = self._bearer_password(request)
        if bearer and expected and hmac.compare_digest(bearer, expected):
            return {"subject": "api-token", "scopes": ["admin"]}

        if expected:
            raise Unauthenticated()

        # Preserve the current Alas behaviour: an explicitly unconfigured password
        # is allowed locally, but never over an unauthenticated public endpoint.
        host = request.client.host if request.client else ""
        if host in LOCAL_HOSTS:
            return {"subject": "local", "scopes": ["admin"]}
        raise Forbidden("A password is required for remote Control API access")

    def authenticate_websocket(self, websocket) -> bool:
        expected = configured_password()
        token = websocket.cookies.get(COOKIE_NAME)
        if token and self.decode_session(token):
            return True
        bearer = websocket.query_params.get("token") or websocket.headers.get("authorization", "").split(" ", 1)[-1]
        if expected and bearer and hmac.compare_digest(bearer, expected):
            return True
        if expected:
            return False
        host = websocket.client.host if websocket.client else ""
        return host in LOCAL_HOSTS
