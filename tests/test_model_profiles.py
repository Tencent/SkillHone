import sys
from pathlib import Path


SCRIPTS = Path(__file__).parents[1] / "skills" / "skillhone" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from evaluation import template
import synth


def test_executor_profile_falls_back_to_improver(monkeypatch):
    improver = {
        "model": "deepseek/deepseek-chat",
        "api_key": "role-key",
        "sdk_model_alias": "opus",
        "workers": 3,
    }
    monkeypatch.setattr(template, "_cfg", {"improver": improver})

    assert template._executor_profile() is improver
    assert template._get_model() == "deepseek/deepseek-chat"
    assert template._get_model_alias() == "opus"
    assert template._get_workers() == 3


def test_explicit_executor_profile_wins(monkeypatch):
    executor = {"model": "openai/gpt-5-mini"}
    monkeypatch.setattr(template, "_cfg", {
        "improver": {"model": "deepseek/deepseek-chat"},
        "executor": executor,
    })

    assert template._executor_profile() is executor
    assert template._get_model() == "openai/gpt-5-mini"


def test_synthesis_profile_is_independent_and_optional():
    improver = {"model": "deepseek/deepseek-chat"}
    synthesis = {"model": "gemini/gemini-2.5-flash"}

    assert synth._model_profile({"improver": improver}, "synthesis") is improver
    assert synth._model_profile({
        "improver": improver,
        "synthesis": synthesis,
    }, "synthesis") is synthesis
