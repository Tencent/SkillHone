"""Redaction helpers for durable agent logs."""
from __future__ import annotations

import os
import re
from typing import Any

_SENSITIVE_KEY_RE = re.compile(
    r"(^|[_-])(token|api[_-]?key|apikey|authorization|secret|password|credential)([_-]|$)",
    re.IGNORECASE,
)

_SECRET_VALUE_RE = re.compile(
    r"(?i)\b(authorization:\s*token\s+|FORGEJO_TOKEN=|"
    r"ANTHROPIC_API_KEY=|api_key[\"']?\s*[:=]\s*[\"']?)([^\s\"'\\,}]+)"
)


def _redact_text(value: str) -> str:
    return _SECRET_VALUE_RE.sub(lambda m: f"{m.group(1)}[REDACTED]", value)


def redact_for_log(value: Any) -> Any:
    """Return a copy of value safe for persistent trajectory/history logs."""
    if isinstance(value, dict):
        redacted: dict[Any, Any] = {}
        for key, item in value.items():
            if _SENSITIVE_KEY_RE.search(str(key)):
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = redact_for_log(item)
        return redacted
    if isinstance(value, list):
        return [redact_for_log(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_for_log(item) for item in value)
    if isinstance(value, str):
        text = _redact_text(value)
        for env_name, env_value in os.environ.items():
            if env_value and _SENSITIVE_KEY_RE.search(env_name):
                text = text.replace(env_value, "[REDACTED]")
        return text
    return value
