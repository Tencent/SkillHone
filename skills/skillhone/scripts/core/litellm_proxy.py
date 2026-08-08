"""Transparent LiteLLM-to-Anthropic bridge for Claude Agent SDK workflows."""
from __future__ import annotations

import atexit
import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from threading import Lock

_LOCK = Lock()
_INSTANCES: dict[str, "LiteLLMProxy"] = {}


class LiteLLMProxy:
    """Own a local LiteLLM proxy without ever persisting the upstream key."""

    def __init__(self, profile: dict, api_key: str):
        self.profile = profile
        self.api_key = api_key
        self.process: subprocess.Popen | None = None
        self.config_path: Path | None = None
        self.port = 0
        self.master_key = "sk-skillhone-" + secrets.token_hex(16)

    def start(self) -> "LiteLLMProxy":
        if self.process and self.process.poll() is None:
            return self
        if not self.api_key:
            raise RuntimeError("LiteLLM provider requires api_key in the model profile or top-level config")
        model = self.profile.get("model")
        if not model or "/" not in model:
            raise RuntimeError("LiteLLM model must use provider/model format (for example deepseek/deepseek-chat)")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        config = {
            "model_list": [{
                # The Anthropic endpoint normalizes provider/model to the
                # provider-local portion before looking up the deployment.
                "model_name": model.split("/", 1)[1],
                "litellm_params": {
                    "model": model,
                    "api_key": "os.environ/SKILLHONE_UPSTREAM_API_KEY",
                    **({"api_base": self.profile["api_base"]} if self.profile.get("api_base") else {}),
                    **({"api_version": self.profile["api_version"]} if self.profile.get("api_version") else {}),
                },
            }],
            "general_settings": {"master_key": self.master_key},
        }
        handle = tempfile.NamedTemporaryFile("w", prefix="skillhone_litellm_", suffix=".json", delete=False)
        json.dump(config, handle)
        handle.close()
        self.config_path = Path(handle.name)
        child_env = {**os.environ, "SKILLHONE_UPSTREAM_API_KEY": self.api_key}
        executable = shutil.which("litellm", path=str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", ""))
        if not executable:
            self.stop()
            raise RuntimeError("LiteLLM CLI not found; install `litellm[proxy]`")
        self.process = subprocess.Popen(
            [executable, "--config", str(self.config_path),
             "--host", "127.0.0.1", "--port", str(self.port)],
            env=child_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            text=True,
        )
        deadline = time.monotonic() + float(self.profile.get("proxy_start_timeout", 30))
        health_url = f"http://127.0.0.1:{self.port}/health/liveliness"
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.stop()
                raise RuntimeError("LiteLLM proxy exited during startup; verify the litellm[proxy] installation and model profile")
            try:
                with urllib.request.urlopen(health_url, timeout=1):
                    return self
            except Exception:
                time.sleep(0.2)
        self.stop()
        raise RuntimeError("Timed out waiting for the local LiteLLM proxy")

    def agent_env(self, alias: str) -> dict[str, str]:
        model = self.profile["model"]
        return {
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{self.port}",
            "ANTHROPIC_API_KEY": self.master_key,
            "ANTHROPIC_AUTH_TOKEN": "",
            "ANTHROPIC_CUSTOM_HEADERS": "",
            "ANTHROPIC_MODEL": alias,
            f"ANTHROPIC_DEFAULT_{alias.upper()}_MODEL": model,
            "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
        }

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        if self.config_path:
            self.config_path.unlink(missing_ok=True)


def agent_env_for(profile: dict, top_level_api_key: str = "") -> dict[str, str]:
    """Return Claude SDK env, starting one reusable local bridge if requested."""
    model = profile.get("model", "")
    profile_key = profile.get("api_key")
    if not profile_key and profile.get("api_key_env"):
        profile_key = os.environ.get(str(profile["api_key_env"]), "")
    # New profiles always use LiteLLM's provider/model form. Keep old
    # unprefixed Claude profiles working as a compatibility path.
    use_litellm = profile.get("provider") == "litellm" or "/" in model
    if not use_litellm:
        env = {k: str(v) for k, v in profile.get("env", {}).items()}
        alias = profile.get("sdk_model_alias", "opus")
        values = {
            "ANTHROPIC_API_KEY": profile_key or top_level_api_key,
            "ANTHROPIC_BASE_URL": profile.get("api_base"),
            "ANTHROPIC_MODEL": alias,
            f"ANTHROPIC_DEFAULT_{alias.upper()}_MODEL": profile.get("model"),
        }
        for name, value in values.items():
            if value and not env.get(name):
                env[name] = str(value)
        return env
    key = profile_key or top_level_api_key
    identity_data = {k: profile.get(k) for k in ("model", "api_base", "api_version")}
    identity_data["key_hash"] = hashlib.sha256(key.encode()).hexdigest()
    identity = json.dumps(identity_data, sort_keys=True)
    with _LOCK:
        proxy = _INSTANCES.get(identity)
        if not proxy or not proxy.process or proxy.process.poll() is not None:
            proxy = LiteLLMProxy(profile, key).start()
            _INSTANCES[identity] = proxy
    alias = profile.get("sdk_model_alias", "opus")
    return {**{k: str(v) for k, v in profile.get("env", {}).items()}, **proxy.agent_env(alias)}


def _shutdown() -> None:
    for proxy in list(_INSTANCES.values()):
        proxy.stop()


atexit.register(_shutdown)
