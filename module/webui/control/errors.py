from typing import Any, Dict, Optional


class ControlApiError(Exception):
    status_code = 500
    code = "INTERNAL_ERROR"

    def __init__(
        self,
        message: str,
        *,
        code: Optional[str] = None,
        status_code: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.details = details or {}


class InvalidArgument(ControlApiError):
    status_code = 400
    code = "INVALID_ARGUMENT"


class Unauthenticated(ControlApiError):
    status_code = 401
    code = "UNAUTHENTICATED"


class Forbidden(ControlApiError):
    status_code = 403
    code = "FORBIDDEN"


class NotFound(ControlApiError):
    status_code = 404
    code = "NOT_FOUND"


class Conflict(ControlApiError):
    status_code = 409
    code = "CONFLICT"


class RateLimited(ControlApiError):
    status_code = 429
    code = "RATE_LIMITED"
