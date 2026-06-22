"""SkillHone configuration loader.

Reads from ~/.skillhone/settings.json (JSON5 format with comments).
Falls back to environment variables for backward compatibility.

Usage:
    from skillhone.config import cfg

    cfg.executor.api_base   # from settings.json
    cfg.executor.model      # from settings.json
    cfg.improver.api_base   # from settings.json
    cfg.forgejo.url         # from settings.json
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

try:
    import json5
except ImportError:
    import json as json5  # fallback: standard json (no comments support)

from .paths import get_home


# ─────────────────────────────────────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ImproverConfig:
    api_base: str = ""
    model: str = "claude-opus-4-6"

@dataclass
class ExecutorConfig:
    api_base: str = ""
    model: str = ""
    thinking_enabled: bool = True
    context_size: int = 40000
    workers: int = 8
    temperature: float = 1.0
    top_p: float = 0.95
    top_k: int = 20
    presence_penalty: float = 1.5
    max_iterations: int = 150
    # Process pooling options (v14+: CLI startup optimization)
    enable_process_pool: bool = True
    process_pool_size: int = 16
    pool_initialization_batch_size: int = 4
    pool_bare_mode: bool = True

@dataclass
class SynthesisConfig:
    api_base: str = ""
    model: str = ""
    workers: int = 8

@dataclass
class ForgejoConfig:
    url: str = "http://localhost:3000"
    owner: str = "skillhone"

@dataclass
class SkillHoneConfig:
    api_key: str = ""
    improver: ImproverConfig = field(default_factory=ImproverConfig)
    executor: ExecutorConfig = field(default_factory=ExecutorConfig)
    synthesis: SynthesisConfig = field(default_factory=SynthesisConfig)
    forgejo: ForgejoConfig = field(default_factory=ForgejoConfig)


# ─────────────────────────────────────────────────────────────────────────────
# Loader
# ─────────────────────────────────────────────────────────────────────────────

def _load_settings_file() -> dict:
    """Load ~/.skillhone/settings.json if it exists."""
    settings_path = get_home() / "settings.json"
    if not settings_path.exists():
        return {}
    try:
        return json5.loads(settings_path.read_text(encoding="utf-8"))
    except Exception as e:
        import warnings
        warnings.warn(f"Failed to parse {settings_path}: {e}")
        return {}


def _env_fallback(key: str, default: str = "") -> str:
    """Get value from env var (backward compat)."""
    return os.environ.get(key, default)


def load_config() -> SkillHoneConfig:
    """Load config from settings.json, with env var fallback."""
    raw = _load_settings_file()

    # Improver
    imp_raw = raw.get("improver", {})
    improver = ImproverConfig(
        api_base=imp_raw.get("api_base") or _env_fallback("IMPROVER_API_BASE"),
        model=imp_raw.get("model") or _env_fallback("IMPROVER_API_MODELS", "claude-opus-4-6"),
    )

    # Executor (formerly "test" — the model that actually runs the skill on each probe)
    executor_raw = raw.get("executor", {})
    executor = ExecutorConfig(
        api_base=executor_raw.get("api_base") or _env_fallback("EXECUTOR_API_BASE"),
        model=executor_raw.get("model") or _env_fallback("EXECUTOR_API_MODELS"),
        thinking_enabled=executor_raw.get("thinking_enabled",
            _env_fallback("EXECUTOR_API_THINKING_ENABLED", "true").lower() != "false"),
        context_size=int(executor_raw.get("context_size") or _env_fallback("EXECUTOR_API_CONTEXT_SIZE", "40000")),
        workers=int(executor_raw.get("workers") or _env_fallback("EXECUTOR_API_WORKERS", "8")),
        temperature=float(executor_raw.get("temperature", 1.0)),
        top_p=float(executor_raw.get("top_p", 0.95)),
        top_k=int(executor_raw.get("top_k", 20)),
        presence_penalty=float(executor_raw.get("presence_penalty", 1.5)),
        max_iterations=int(executor_raw.get("max_iterations") or _env_fallback("EXECUTOR_MAX_ITERATIONS", "150")),
        # Process pooling (v14+)
        enable_process_pool=executor_raw.get("enable_process_pool",
            _env_fallback("SKILLHONE_ENABLE_PROCESS_POOL", "true").lower() != "false"),
        process_pool_size=int(executor_raw.get("process_pool_size") or _env_fallback("SKILLHONE_POOL_SIZE", "16")),
        pool_initialization_batch_size=int(executor_raw.get("pool_initialization_batch_size") or _env_fallback("SKILLHONE_POOL_BATCH_SIZE", "4")),
        pool_bare_mode=executor_raw.get("pool_bare_mode",
            _env_fallback("SKILLHONE_POOL_BARE_MODE", "true").lower() != "false"),
    )

    # Synthesis
    syn_raw = raw.get("synthesis", {})
    synthesis = SynthesisConfig(
        api_base=syn_raw.get("api_base") or _env_fallback("SYNTHESIS_API_BASE"),
        model=syn_raw.get("model") or _env_fallback("SYNTHESIS_API_MODELS"),
        workers=int(syn_raw.get("workers") or _env_fallback("SYNTHESIS_API_WORKERS", "8")),
    )

    # Forgejo
    fg_raw = raw.get("forgejo", {})
    forgejo = ForgejoConfig(
        url=fg_raw.get("url") or _env_fallback("FORGEJO_URL", "http://localhost:3000"),
        owner=fg_raw.get("owner") or _env_fallback("FORGEJO_OWNER", "skillhone"),
    )

    return SkillHoneConfig(
        api_key=raw.get("api_key") or _env_fallback("API_KEY"),
        improver=improver,
        executor=executor,
        synthesis=synthesis,
        forgejo=forgejo,
    )


# Singleton — load once on import
cfg = load_config()
