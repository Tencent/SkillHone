import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).parents[1] / "skills" / "skillhone" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from core import litellm_proxy


class _Process:
    def poll(self):
        return None

    def terminate(self):
        pass

    def wait(self, timeout=None):
        return 0


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


@pytest.mark.parametrize("model, routed_name", [
    ("deepseek/deepseek-chat", "deepseek-chat"),
    ("anthropic/claude-sonnet-test", "claude-sonnet-test"),
])
def test_litellm_proxy_keeps_upstream_key_out_of_config(
    monkeypatch, model, routed_name
):
    captured = {}

    def fake_popen(command, **kwargs):
        captured["command"] = command
        captured["env"] = kwargs["env"]
        return _Process()

    monkeypatch.setattr(litellm_proxy.shutil, "which", lambda *args, **kwargs: "/venv/bin/litellm")
    monkeypatch.setattr(litellm_proxy.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(litellm_proxy.urllib.request, "urlopen", lambda *args, **kwargs: _Response())

    proxy = litellm_proxy.LiteLLMProxy(
        {"model": model}, "secret-upstream-key"
    ).start()
    config = json.loads(proxy.config_path.read_text())

    assert "secret-upstream-key" not in proxy.config_path.read_text()
    assert config["model_list"][0]["model_name"] == routed_name
    assert config["model_list"][0]["litellm_params"]["model"] == model
    assert captured["env"]["SKILLHONE_UPSTREAM_API_KEY"] == "secret-upstream-key"
    assert "--host" in captured["command"] and "127.0.0.1" in captured["command"]
    assert proxy.agent_env("haiku")["ANTHROPIC_BASE_URL"].startswith("http://127.0.0.1:")
    proxy.stop()


def test_provider_prefix_selects_litellm_for_anthropic_too(monkeypatch):
    started = []

    class _Proxy:
        process = _Process()

        def __init__(self, profile, key):
            started.append((profile, key))

        def start(self):
            return self

        def agent_env(self, alias):
            return {"ANTHROPIC_BASE_URL": "http://127.0.0.1:4000"}

        def stop(self):
            pass

    litellm_proxy._INSTANCES.clear()
    monkeypatch.setattr(litellm_proxy, "LiteLLMProxy", _Proxy)
    env = litellm_proxy.agent_env_for({
        "model": "anthropic/claude-sonnet-test",
        "api_key": "anthropic-role-key",
    })

    assert env["ANTHROPIC_BASE_URL"] == "http://127.0.0.1:4000"
    assert started[0][0]["model"] == "anthropic/claude-sonnet-test"
    assert started[0][1] == "anthropic-role-key"


def test_non_litellm_profile_preserves_existing_env():
    assert litellm_proxy.agent_env_for(
        {
            "provider": "anthropic",
            "api_key": "role-key",
            "api_base": "https://ignored.test",
            "model": "claude-test",
            "sdk_model_alias": "haiku",
            "env": {"ANTHROPIC_BASE_URL": "https://example.test"},
        },
        "legacy-key",
    ) == {
        "ANTHROPIC_BASE_URL": "https://example.test",
        "ANTHROPIC_API_KEY": "role-key",
        "ANTHROPIC_MODEL": "haiku",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-test",
    }
