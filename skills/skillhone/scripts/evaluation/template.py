"""SkillHone evaluation template — universal solver using Claude Agent SDK.

Self-contained. Copied into each eval repo as `evaluator/eval.py`.

Contract:
    python evaluator/eval.py \
      --skill-dir <path-to-skill-checkout> \
      --split {probe|pr_val|test} \
      --dataset-dir <path-to-this-eval-repo> \
      --output <score.json>
      [--iteration N] [--redact-traces] [--n-probe 10]

The solver uses Claude Agent SDK (claude-agent-sdk) to run an agent with Bash/Read/Write
tools in an isolated workdir. Skills are loaded from workdir/skills/.

Scoring: verification-based (exec Python assert code) with exact+loose match fallback.

Configuration (reads from ~/.skillhone/settings.json):
    executor.api_base    → ANTHROPIC_BASE_URL
    executor.model       → ANTHROPIC_DEFAULT_HAIKU_MODEL
    executor.workers     → concurrency limit
    executor.timeout     → solver timeout in seconds (default 1800)
    api_key              → ANTHROPIC_API_KEY
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

_SENSITIVE_KEY_RE = re.compile(
    r"(^|[_-])(token|api[_-]?key|apikey|authorization|secret|password|credential)([_-]|$)",
    re.IGNORECASE,
)
_SECRET_VALUE_RE = re.compile(
    r"(?i)\b(authorization:\s*token\s+|FORGEJO_TOKEN=|"
    r"ANTHROPIC_API_KEY=|api_key[\"']?\s*[:=]\s*[\"']?)([^\s\"'\\,}]+)"
)


def _redact_for_log(value):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if _SENSITIVE_KEY_RE.search(str(key)):
                out[key] = "[REDACTED]"
            else:
                out[key] = _redact_for_log(item)
        return out
    if isinstance(value, list):
        return [_redact_for_log(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact_for_log(item) for item in value)
    if isinstance(value, str):
        text = _SECRET_VALUE_RE.sub(lambda m: f"{m.group(1)}[REDACTED]", value)
        for env_name, env_value in os.environ.items():
            if env_value and _SENSITIVE_KEY_RE.search(env_name):
                text = text.replace(env_value, "[REDACTED]")
        return text
    return value

# ─────────────────────────────────────────────────────────────────────────────
# Configuration — reads from ~/.skillhone/settings.json
# ─────────────────────────────────────────────────────────────────────────────

_cfg = None
try:
    _settings_path = Path.home() / ".skillhone" / "settings.json"
    if _settings_path.exists():
        _cfg = json.loads(_settings_path.read_text())
except Exception:
    pass

_CURRENT_DATASET_DIR: Path | None = None


def _get_api_base() -> str:
    if _cfg and "executor" in _cfg:
        v = _cfg["executor"].get("api_base")
        if v:
            return v
    v = os.environ.get("EXECUTOR_API_BASE", "")
    if v:
        return v
    raise RuntimeError("Config 'executor.api_base' not found in ~/.skillhone/settings.json")


def _get_model() -> str:
    if _cfg and "executor" in _cfg:
        v = _cfg["executor"].get("model")
        if v:
            return v
    v = os.environ.get("EXECUTOR_API_MODELS", "")
    if v:
        return v
    raise RuntimeError("Config 'executor.model' not found in ~/.skillhone/settings.json")


def _get_model_alias() -> str:
    """SDK model alias (e.g. 'haiku') that maps to the actual model via env."""
    if _cfg and "executor" in _cfg:
        v = _cfg["executor"].get("sdk_model_alias")
        if v:
            return v
    return os.environ.get("ANTHROPIC_MODEL", "haiku")


def _get_api_key() -> str:
    if _cfg:
        v = _cfg.get("api_key")
        if v:
            return v
    v = os.environ.get("API_KEY", "")
    if v:
        return v
    raise RuntimeError("Config 'api_key' not found in ~/.skillhone/settings.json")


def _get_workers() -> int:
    # Env var takes precedence (per-run override) over settings.json default
    env_v = os.environ.get("EXECUTOR_WORKERS") or os.environ.get("EXECUTOR_API_WORKERS")
    if env_v:
        return int(env_v)
    if _cfg and "executor" in _cfg:
        return _cfg["executor"].get("workers", 16)
    return 16


def _get_timeout() -> int:
    """Solver timeout in seconds. Only safety valve — skill instructions control behavior."""
    # Env var takes precedence (per-run override) over settings.json default
    env_v = os.environ.get("EXECUTOR_TIMEOUT")
    if env_v:
        return int(env_v)
    if _cfg and "executor" in _cfg:
        return _cfg["executor"].get("timeout", 1800)
    return 1800


def _get_max_turns() -> int | None:
    """Optional hard cap on agent tool-use turns. None means no evaluator-level cap."""
    env_v = os.environ.get("EXECUTOR_MAX_TURNS")
    if env_v:
        return int(env_v) if env_v.lower() not in ("", "none", "0") else None
    if _cfg and "executor" in _cfg:
        v = _cfg["executor"].get("max_turns")
        return int(v) if v not in (None, 0) else None
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Scoring (uses verification-based or fallback exact+loose match)
# ─────────────────────────────────────────────────────────────────────────────

import re
import unicodedata


def _normalize(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _loose_match(pred: str, exp: str) -> bool:
    p, e = _normalize(pred), _normalize(exp)
    if not p or not e:
        return False
    return p == e or e in p or p in e


def _resolve_artifact_path(path: str, workdir: str | None) -> Path:
    """Resolve a solver-produced artifact path against the item workdir."""
    candidate = Path(path.strip())
    if not candidate.is_absolute():
        if not workdir:
            raise RuntimeError("relative artifact path requires solver workdir")
        candidate = Path(workdir) / candidate
    candidate = candidate.resolve()
    if not candidate.exists():
        raise FileNotFoundError(f"artifact not found: {candidate}")
    return candidate


def _load_audit_module():
    """Load a task-provided HTML artifact auditor from the eval repo."""
    if _CURRENT_DATASET_DIR is None:
        raise RuntimeError("dataset directory is not available to artifact verifier")
    candidates = [
        _CURRENT_DATASET_DIR / "scripts" / "audit_layout.py",
        _CURRENT_DATASET_DIR / "synthesis" / "tools" / "audit_layout.py",
    ]
    audit_path = next((p for p in candidates if p.exists()), None)
    if audit_path is None:
        tried = ", ".join(str(p) for p in candidates)
        raise FileNotFoundError(f"no artifact audit tool found; tried: {tried}")

    import importlib.util
    module_name = f"_skillhone_artifact_audit_{abs(hash(str(audit_path)))}"
    spec = importlib.util.spec_from_file_location(module_name, audit_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load artifact audit tool: {audit_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    if not hasattr(module, "audit_html"):
        raise AttributeError(f"{audit_path} must define audit_html(path: Path)")
    return module


def _audit_html_artifact(path: str, workdir: str | None = None) -> dict:
    """Audit an HTML artifact emitted by the solver.

    Verification snippets can call:

        result = _audit_html_artifact(open("answer.txt").read().strip())
        scores = result["scores"]

    The task owns the exact audit rules by shipping scripts/audit_layout.py in
    the eval repo. Missing or broken auditors raise so failures are visible.
    """
    artifact = _resolve_artifact_path(path, workdir)
    module = _load_audit_module()
    return module.audit_html(artifact)


def _rect_overlap(a: dict, b: dict) -> float:
    x_overlap = max(0.0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
    y_overlap = max(0.0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
    return x_overlap * y_overlap


def _audit_rendered_html_artifact(
    path: str,
    workdir: str | None = None,
    *,
    viewport_width: int = 3800,
    viewport_height: int = 1800,
    min_text_font_px: float = 18,
    min_text_chars: int = 3,
    overlap_ratio_threshold: float = 0.06,
) -> dict:
    """Audit a rendered HTML artifact using real browser layout.

    This is intentionally task-agnostic: it checks visual correctness signals
    that apply to any static HTML artifact, such as text collision, broken
    visible images, and viewport overflow. It raises if Playwright/Chromium is
    unavailable so infrastructure problems do not silently become passing
    scores.
    """
    artifact = _resolve_artifact_path(path, workdir)
    import queue
    import threading

    async def collect_rendered() -> dict:
        try:
            from playwright.async_api import async_playwright
        except Exception as exc:
            raise RuntimeError("Playwright is required for rendered HTML artifact audit") from exc

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
            try:
                page = await browser.new_page(
                    viewport={"width": viewport_width, "height": viewport_height},
                    device_scale_factor=1,
                )
                await page.goto(artifact.as_uri(), wait_until="load")
                await page.evaluate("() => document.fonts && document.fonts.ready")
                return await page.evaluate(
                    """({minTextFontPx, minTextChars}) => {
                      const elementIds = new Map();
                      let nextId = 1;
                      function idFor(el) {
                        if (!elementIds.has(el)) elementIds.set(el, nextId++);
                        return elementIds.get(el);
                      }
                      function visibleElement(el) {
                        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                          return false;
                        }
                        return true;
                      }
                      function ancestors(el) {
                        const ids = [];
                        let cur = el ? el.parentElement : null;
                        while (cur) {
                          ids.push(idFor(cur));
                          cur = cur.parentElement;
                        }
                        return ids;
                      }
                      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                      const textRects = [];
                      while (walker.nextNode()) {
                        const node = walker.currentNode;
                        const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
                        if (text.length < minTextChars) continue;
                        const el = node.parentElement;
                        if (!visibleElement(el)) continue;
                        const style = window.getComputedStyle(el);
                        const fontSize = Number.parseFloat(style.fontSize || '0');
                        if (!Number.isFinite(fontSize) || fontSize < minTextFontPx) continue;
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        for (const rect of Array.from(range.getClientRects())) {
                          if (rect.width < 2 || rect.height < 2) continue;
                          textRects.push({
                            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                            text: text.slice(0, 120),
                            fontSize,
                            elementId: idFor(el),
                            ancestorIds: ancestors(el),
                            tag: el.tagName.toLowerCase(),
                            className: String(el.className || '').slice(0, 80),
                          });
                        }
                        range.detach();
                      }
                      const images = Array.from(document.images).map((img) => {
                        const rect = img.getBoundingClientRect();
                        const style = window.getComputedStyle(img);
                        const visible = style.display !== 'none' && style.visibility !== 'hidden'
                          && rect.width > 2 && rect.height > 2;
                        return {
                          srcPrefix: String(img.currentSrc || img.src || '').slice(0, 80),
                          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                          visible,
                          complete: img.complete,
                          naturalWidth: img.naturalWidth,
                          naturalHeight: img.naturalHeight,
                        };
                      });
                      const doc = document.documentElement;
                      const body = document.body;
                      return {
                        viewport: {width: window.innerWidth, height: window.innerHeight},
                        document: {
                          scrollWidth: Math.max(doc.scrollWidth, body ? body.scrollWidth : 0),
                          scrollHeight: Math.max(doc.scrollHeight, body ? body.scrollHeight : 0),
                        },
                        textRects,
                        images,
                      };
                    }""",
                    {"minTextFontPx": min_text_font_px, "minTextChars": min_text_chars},
                )
            finally:
                await browser.close()

    result_queue: queue.Queue = queue.Queue(maxsize=1)

    def run_in_thread() -> None:
        try:
            result_queue.put((True, asyncio.run(collect_rendered())))
        except BaseException as exc:
            result_queue.put((False, exc))

    thread = threading.Thread(target=run_in_thread, daemon=True)
    thread.start()
    thread.join()
    ok, payload = result_queue.get()
    if not ok:
        raise payload
    rendered = payload

    text_rects = rendered["textRects"]
    text_overlaps: list[dict] = []
    for i, first in enumerate(text_rects):
        first_area = first["width"] * first["height"]
        if first_area <= 0:
            continue
        for second in text_rects[i + 1:]:
            if first["elementId"] == second["elementId"]:
                continue
            if first["elementId"] in second["ancestorIds"] or second["elementId"] in first["ancestorIds"]:
                continue
            second_area = second["width"] * second["height"]
            if second_area <= 0:
                continue
            overlap = _rect_overlap(first, second)
            if overlap <= 0:
                continue
            if overlap / min(first_area, second_area) >= overlap_ratio_threshold:
                text_overlaps.append({"first": first, "second": second, "overlap_area": overlap})
                if len(text_overlaps) >= 20:
                    break
        if len(text_overlaps) >= 20:
            break

    visible_images = [img for img in rendered["images"] if img["visible"]]
    broken_images = [
        img
        for img in visible_images
        if not img["complete"] or img["naturalWidth"] <= 0 or img["naturalHeight"] <= 0
    ]
    doc = rendered["document"]
    viewport = rendered["viewport"]
    overflow = {
        "width": doc["scrollWidth"] > viewport["width"] + 8,
        "height": doc["scrollHeight"] > viewport["height"] + 8,
        "scrollWidth": doc["scrollWidth"],
        "scrollHeight": doc["scrollHeight"],
        "viewportWidth": viewport["width"],
        "viewportHeight": viewport["height"],
    }
    scores = {
        "rendered_text_no_overlap_ok": len(text_overlaps) == 0,
        "rendered_images_ok": len(broken_images) == 0,
        "rendered_viewport_no_overflow_ok": not overflow["width"] and not overflow["height"],
    }
    return {
        "ok": all(scores.values()),
        "scores": scores,
        "diagnostics": {
            "text_rect_count": len(text_rects),
            "text_overlaps": text_overlaps[:5],
            "visible_images": len(visible_images),
            "broken_images": broken_images[:5],
            "overflow": overflow,
        },
    }


def _get_eval_config() -> dict:
    """Read eval-judge config from settings.json (separate from solver config)."""
    cfg = _cfg.get("eval", {}) if _cfg else {}
    return {
        "api_base": cfg.get("api_base") or os.environ.get("EVAL_API_BASE", ""),
        "api_key": cfg.get("api_key") or os.environ.get("EVAL_API_KEY", ""),
        "model": cfg.get("model") or os.environ.get("EVAL_API_MODEL", "gpt-5.5"),
        "max_tokens": cfg.get("max_tokens", 1024),
        "temperature": cfg.get("temperature", 0),
    }


def _llm_judge_equal(predicted: str, expected: str) -> bool:
    """LLM-based factual-equivalence judge.

    Strict fact equivalence: the prediction must convey the same key facts
    as the expected answer.

    Rules:
    - Length, formatting, wording are irrelevant — short and long correct
      answers are equally valid.
    - Missing a key fact, contradicting facts, hedging ("A or B"), or
      dumping unasked extra facts all count as 'no'.
    - No leniency for verbose answers that bury the right answer among
      others — guessing is not answering.

    Returns True iff the judge says yes.
    """
    if not predicted or not expected:
        return False
    cfg = _get_eval_config()
    if not cfg["api_base"]:
        return False
    try:
        import httpx
        prompt = (
            "You evaluate whether a predicted answer is factually equivalent to the expected answer.\n"
            "Reply ONLY with 'yes' or 'no'.\n\n"
            "Say 'yes' ONLY if the prediction states the same key fact(s) as the expected answer.\n"
            "Say 'no' otherwise — including all of:\n"
            "- Different entity, number, date, name, or any other contradicting fact.\n"
            "- Missing a key fact present in the expected answer.\n"
            "- Hedging or guessing by listing multiple possibilities ('A or B', 'could be X or Y', "
            "enumerating candidates) even if the correct option is among them.\n"
            "- Adding extra facts beyond what was asked; the answer must focus on the asked facts.\n\n"
            "IGNORE these signals entirely:\n"
            "- Length, verbosity, formatting, ordering, punctuation, wording.\n"
            "- A short correct answer is exactly as valid as a longer one.\n\n"
            f"Expected answer: {expected}\n\n"
            f"Predicted answer: {predicted}\n\n"
            "Factually equivalent (yes/no):"
        )
        body: dict = {
            "model": cfg["model"],
            "messages": [{"role": "user", "content": prompt}],
        }
        # gpt-5+ uses max_completion_tokens; older uses max_tokens
        if cfg["model"].startswith("gpt-5") or cfg["model"].startswith("o1") or cfg["model"].startswith("o3"):
            body["max_completion_tokens"] = cfg["max_tokens"]
        else:
            body["max_tokens"] = cfg["max_tokens"]
            body["temperature"] = cfg["temperature"]

        headers = {"Content-Type": "application/json"}
        if cfg["api_key"]:
            headers["Authorization"] = f"Bearer {cfg['api_key']}"

        r = httpx.post(
            f"{cfg['api_base']}/v1/chat/completions",
            json=body,
            headers=headers,
            timeout=60,
        )
        content = r.json()["choices"][0]["message"].get("content", "").strip().lower()
        return content.startswith("y")
    except Exception:
        return False


def _llm_judge(predicted: str, expected: str) -> bool:
    """LLM fallback judge: ask model if predicted is exactly equivalent to expected."""
    if not predicted or not expected:
        return False
    try:
        import httpx
        r = httpx.post(
            f"{_get_api_base()}/v1/chat/completions",
            json={
                "model": _get_model(),
                "messages": [{"role": "user", "content":
                    f"Are these two answers EXACTLY equivalent (same entity/value, just different wording or abbreviation)? "
                    f"Reply ONLY 'yes' or 'no'. Be strict — partial matches or related-but-different answers are 'no'.\n\n"
                    f"Answer A: {predicted}\n"
                    f"Answer B: {expected}\n\n"
                    f"Exactly equivalent (yes/no):"}],
                "max_tokens": 5,
                "temperature": 0,
                "chat_template_kwargs": {"enable_thinking": False},
            },
            timeout=10,
        )
        content = r.json()["choices"][0]["message"].get("content", "")
        return "yes" in content.lower()
    except Exception:
        return False


def _answer_filename(item: dict) -> str:
    contract = item.get("answer_contract")
    if isinstance(contract, dict):
        filename = contract.get("file")
        if isinstance(filename, str) and filename:
            return filename

    return "answer.txt"


def _verify(predicted: str, item: dict, workdir: str | None = None) -> tuple[bool, bool]:
    """Score predicted answer. Returns (passed, strict_match).

    If workdir is given, exec verification with cwd=workdir so it can read
    artifact files directly (preferred — verification owns its own answer reading).
    The 'answer' variable is also injected for legacy compatibility.
    """
    verification = item.get("verification", "")
    if verification:
        # Run verification in solver's workdir so artifact paths resolve correctly.
        old_cwd = os.getcwd()
        try:
            if workdir and os.path.isdir(workdir):
                os.chdir(workdir)
            # Two verification formats are supported:
            # v1 (assert-based): assertions raise AssertionError on failure;
            #   exec returning silently means passed.
            # v2 (dict-of-bool tiers): the snippet sets a `scores` dict like
            #   scores = {"tier_strict": ..., "tier_loose": ..., ...}.
            #   Pass = any tier_* True. Strict = tier_strict (or
            #   tier_normalized) True. Without this branch v2 snippets that
            #   never raise would all pass vacuously.
            ns: dict = {
                "answer": predicted,
                "_normalize": _normalize,
                "_loose_match": _loose_match,
                "_llm_judge_equal": _llm_judge_equal,
                "_audit_html_artifact": lambda p: _audit_html_artifact(p, workdir),
                "_audit_rendered_html_artifact": lambda p, **kwargs: _audit_rendered_html_artifact(
                    p, workdir, **kwargs
                ),
                "__builtins__": __builtins__,
            }
            exec(verification, ns)
            scores = ns.get("scores")
            if scores is None:
                # v1 (assert-style): exec returned silently => all asserts passed.
                return True, True
            if not isinstance(scores, dict) or not scores:
                # v2 verifier declared `scores` but it's empty/malformed —
                # treat as broken, not vacuously passing.
                return False, False
            # Accept tiers regardless of `tier_` prefix. Synthesis skills are
            # inconsistent: the skillhone-synthesis SKILL.md sample uses bare
            # names ('exact', 'loose'); older hand-written verifiers use
            # 'tier_exact', 'tier_strict', etc. Take any bool-coercible value.
            tier_items = [(k, bool(v)) for k, v in scores.items()
                          if isinstance(v, (bool, int))]
            if not tier_items:
                return False, False
            if bool(ns.get("scores_require_all")):
                all_pass = all(v for _, v in tier_items)
                return all_pass, all_pass
            any_pass = any(v for _, v in tier_items)
            # Strict tiers: names that canonically mean "answer is correct,
            # no looseness". Accept both prefixed and bare forms.
            _STRICT_TIERS = (
                "tier_strict", "tier_exact", "tier_normalized",
                "strict", "exact", "normalized",
            )
            strict_pass = any(bool(scores.get(t)) for t in _STRICT_TIERS)
            return any_pass, strict_pass
        except AssertionError:
            return False, False
        except Exception:
            return False, False
        finally:
            os.chdir(old_cwd)

    # Fallback: legacy format with "answer" field
    expected = item.get("answer", "")
    if not expected:
        # Extract expected from verification for LLM judge
        m = re.search(r"_normalize\('([^']+)'\)", verification)
        expected = m.group(1) if m else ""

    if not expected or not predicted:
        return False, False

    strict = _normalize(predicted) == _normalize(expected)
    loose = _loose_match(predicted, expected)
    if strict or loose:
        return True, strict

    # LLM judge fallback for semantic equivalence (e.g. "UK" vs "United Kingdom")
    if _llm_judge(predicted, expected):
        return True, False

    return False, False


# ─────────────────────────────────────────────────────────────────────────────
# Claude Agent SDK Solver
# ─────────────────────────────────────────────────────────────────────────────

_SDK_AVAILABLE = False
try:
    from claude_agent_sdk import query, ClaudeAgentOptions
    _SDK_AVAILABLE = True
except ImportError:
    pass


def _passthrough_env_names() -> tuple[str, ...]:
    """User-configurable allowlist of env var names to forward into the
    solver agent. Read from settings.json `executor.passthrough_env` (a list
    of UPPER_CASE names). Empty by default — the harness has no opinion
    about which task-domain credentials a given skill needs."""
    if _cfg and "executor" in _cfg:
        names = _cfg["executor"].get("passthrough_env") or []
        if isinstance(names, list):
            return tuple(str(x) for x in names if x)
    return ()


def _build_agent_env() -> dict[str, str]:
    """Build environment variables for claude-agent-sdk from settings.json,
    plus any allowlisted task-domain credentials present in os.environ
    (controlled by `executor.passthrough_env`)."""
    if _cfg and "executor" in _cfg and "env" in _cfg["executor"]:
        env = {k: str(v) for k, v in _cfg["executor"]["env"].items()}
    else:
        env = {
            "ANTHROPIC_BASE_URL": _get_api_base(),
            "ANTHROPIC_API_KEY": _get_api_key(),
            "ANTHROPIC_MODEL": _get_model_alias(),
            f"ANTHROPIC_DEFAULT_{_get_model_alias().upper()}_MODEL": _get_model(),
            "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
        }
    for k in _passthrough_env_names():
        v = os.environ.get(k, "")
        if v:
            env[k] = v
    return env


async def _solve_one_sdk(
    item: dict,
    skill_dir: str,
    workdir: str,
    uid: str,
) -> tuple[str, str]:
    """Run Claude Agent SDK to solve one item. Returns (predicted, error)."""
    # Load skill into workdir/.claude/skills/ (Claude Code skill discovery)
    skill_md_src = os.path.join(skill_dir, "SKILL.md")
    has_skill = os.path.exists(skill_md_src)
    skill_name = os.path.basename(skill_dir.rstrip("/")) or "skill"
    if has_skill:
        # Mount the primary (under-test) skill in full
        skill_dest = os.path.join(workdir, ".claude", "skills", skill_name)
        os.makedirs(skill_dest, exist_ok=True)
        shutil.copy2(skill_md_src, os.path.join(skill_dest, "SKILL.md"))
        for sub in ("scripts", "references", "agents", "assets"):
            src_sub = os.path.join(skill_dir, sub)
            dst_sub = os.path.join(skill_dest, sub)
            if os.path.isdir(src_sub) and not os.path.exists(dst_sub):
                shutil.copytree(src_sub, dst_sub, dirs_exist_ok=True)

    # Mount the rest of the local skill library so the solver can discover
    # neighbouring reference skills at solve time.
    # The under-test skill always wins on name conflict.
    skills_root = os.path.join(workdir, ".claude", "skills")
    os.makedirs(skills_root, exist_ok=True)
    mounted_extra = []
    for lib in (
        Path("/root/.skillhone/skills"),
        Path.home() / ".claude" / "skills",
    ):
        if not lib.exists():
            continue
        for src in sorted(lib.iterdir()):
            if not (src.is_dir() and (src / "SKILL.md").exists()):
                continue
            if src.name == skill_name:  # don't shadow under-test skill
                continue
            dest = os.path.join(skills_root, src.name)
            if os.path.exists(dest):
                continue
            try:
                shutil.copytree(
                    src, dest, dirs_exist_ok=False,
                    ignore_dangling_symlinks=True,
                )
                mounted_extra.append(src.name)
            except Exception:
                # Broken symlink / perm error — drop this skill, keep going.
                shutil.rmtree(dest, ignore_errors=True)

    # Mirror under-test skill's scripts/refs at workdir root for legacy access.
    src_scripts = os.path.join(skill_dir, "scripts")
    dst_scripts = os.path.join(workdir, "scripts")
    if os.path.isdir(src_scripts) and not os.path.isdir(dst_scripts):
        shutil.copytree(src_scripts, dst_scripts, dirs_exist_ok=True)
    src_refs = os.path.join(skill_dir, "references")
    dst_refs = os.path.join(workdir, "references")
    if os.path.isdir(src_refs) and not os.path.isdir(dst_refs):
        shutil.copytree(src_refs, dst_refs, dirs_exist_ok=True)

    question = item.get("question", item.get("query", ""))

    # Build system prompt with skill content injected directly (since --bare
    # skips skill discovery, we inject SKILL.md into system prompt).
    skill_content = ""
    if has_skill:
        try:
            skill_content = Path(skill_md_src).read_text(encoding="utf-8")
        except Exception:
            pass

    # List available scripts for progressive disclosure
    scripts_listing = ""
    if os.path.isdir(dst_scripts):
        scripts = [f for f in os.listdir(dst_scripts) if f.endswith('.py')]
        if scripts:
            scripts_listing = "\n".join(f"  - scripts/{f}" for f in sorted(scripts))

    # List references
    refs_listing = ""
    if os.path.isdir(dst_refs):
        refs = [f for f in os.listdir(dst_refs) if not f.startswith('.')]
        if refs:
            refs_listing = "\n".join(f"  - references/{f}" for f in sorted(refs))

    # Build system prompt with skill context
    sys_parts = []
    if skill_content:
        sys_parts.append(skill_content)
    if scripts_listing:
        sys_parts.append(f"Available scripts in your working directory (run with `python3 scripts/NAME.py`):\n{scripts_listing}")
    if refs_listing:
        sys_parts.append(f"Reference docs in your working directory (read with `cat references/NAME`):\n{refs_listing}")
    system_prompt = "\n\n".join(sys_parts) if sys_parts else ""

    answer_filename = _answer_filename(item)

    # User prompt is just the question + output instruction
    prompt = f"{question}\n\nWrite your answer to {workdir}/{answer_filename} (use this exact absolute path)."

    # Build options with skill support
    # Note: With --bare, Skill tool is not available. Skill content is injected
    # via system_prompt instead. Keep tools minimal.
    allowed = ["Bash", "Read", "Write", "Edit"]

    # Read env from settings.json
    agent_env = _build_agent_env()

    err = ""
    try:
        # Use system_prompt append to inject skill content (--bare skips
        # skill discovery, so we inject via system prompt instead).
        sys_prompt_cfg: dict | str | None = None
        if system_prompt:
            sys_prompt_cfg = {"type": "preset", "preset": "claude_code",
                             "append": system_prompt}

        options = ClaudeAgentOptions(
            cwd=workdir,
            model=_get_model_alias(),
            system_prompt=sys_prompt_cfg,
            setting_sources=[],  # No project settings needed with --bare
            allowed_tools=allowed,
            disallowed_tools=["WebSearch", "WebFetch"],
            permission_mode="bypassPermissions",
            max_turns=_get_max_turns(),  # Optional turn budget from settings.json (executor.max_turns)
            max_thinking_tokens=1024,
            env={
                **agent_env,
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                "CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK": "1",
            },
            load_timeout_ms=30000,  # 30s enough with --bare
            extra_args={
                "bare": None,  # Skip hooks/LSP/plugins/attribution/auto-memory
                "no-session-persistence": None,  # Don't save sessions to disk
            },
        )
        async for msg in query(prompt=prompt, options=options):
            # Save trajectory to workdir/trajectory.jsonl
            try:
                if hasattr(msg, '__dict__'):
                    entry = {"type": type(msg).__name__, **msg.__dict__}
                elif isinstance(msg, dict):
                    entry = msg
                else:
                    entry = {"type": type(msg).__name__, "raw": str(msg)[:1000]}
                with open(os.path.join(workdir, "trajectory.jsonl"), "a") as _tf:
                    _tf.write(json.dumps(_redact_for_log(entry), default=str, ensure_ascii=False) + "\n")
            except Exception:
                pass
    except Exception as e:
        raw_err = str(e)
        # Classify errors precisely so the improver doesn't misdiagnose.
        # "exit code 1" from SDK means the AGENT PROCESS itself failed
        # (e.g. SDK internal error, model error) — NOT a script crash.
        if "exit code" in raw_err.lower() or "non-zero" in raw_err.lower():
            err = f"agent_process_error: agent SDK exited abnormally (model error or internal failure): {raw_err[:200]}"
        elif "timeout" in raw_err.lower():
            err = f"agent_timeout: agent ran out of time ({_get_timeout()}s limit reached)"
        else:
            err = f"agent_exception: {raw_err[:250]}"

    # Read the requested answer artifact.
    answer_filename = _answer_filename(item)
    for candidate in [
        Path(workdir) / answer_filename,
        Path(workdir) / "app" / answer_filename,
        Path(workdir) / "answer.txt",
        Path(workdir) / "app" / "answer.txt",
    ]:
        try:
            answer = candidate.read_text().strip()
            if answer:
                return answer, err
        except (FileNotFoundError, PermissionError):
            pass

    return "", err or f"no_answer_produced: agent completed but never wrote {answer_filename}"


# ─────────────────────────────────────────────────────────────────────────────
# Fallback solver (raw LLM, no agent tools)
# ─────────────────────────────────────────────────────────────────────────────

async def _solve_one_fallback(question: str) -> str:
    """Absolute last resort: ask LLM to answer without any search."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=60.0) as http:
            r = await http.post(
                f"{_get_api_base()}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {_get_api_key()}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _get_model(),
                    "messages": [{"role": "user", "content":
                        f"Answer this factual question with ONLY a short answer "
                        f"(name, number, date, etc.) — no explanation.\n\n"
                        f"Question: {question}\n\nAnswer:"}],
                    "temperature": 0.0,
                    "max_tokens": 256,
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Eval loop
# ─────────────────────────────────────────────────────────────────────────────

async def eval_one(item: dict, skill_dir: str,
                   sem: asyncio.Semaphore,
                   workdir_base: str,
                   trace_dir: Optional[str] = None) -> dict:
    """Evaluate one item: agent solve → verify."""
    uid = item.get("uid", item.get("task_id", "unknown"))
    question = item.get("question", item.get("query", ""))
    t0 = time.time()
    predicted = ""
    err = ""
    workdir = os.path.join(workdir_base, f"work_{uid}")  # Defined early for trace persistence

    async with sem:
        try:
            if _SDK_AVAILABLE and os.path.exists(os.path.join(skill_dir, "SKILL.md")):
                os.makedirs(workdir, exist_ok=True)
                predicted, err = await asyncio.wait_for(
                    _solve_one_sdk(item, skill_dir, workdir, uid),
                    timeout=_get_timeout(),
                )
            else:
                # No skill or no SDK: fallback to raw LLM guess
                predicted = await _solve_one_fallback(question)
                if predicted:
                    err = "fallback LLM guess (no skill or SDK unavailable)"
        except asyncio.TimeoutError:
            err = f"hard timeout {_get_timeout()}s"
            # Try to read the requested answer artifact even after timeout
            try:
                answer_file = os.path.join(workdir, _answer_filename(item))
                predicted = Path(answer_file).read_text().strip()
            except Exception:
                pass
        except Exception as e:
            err = repr(e)[:300]

    # Score
    passed, strict = _verify(predicted, item, workdir=workdir)
    duration = round(time.time() - t0, 2)
    status = "✅" if passed else ("⚠️" if predicted else "❌")

    # For display, get expected (from verification or answer field)
    expected = item.get("answer", "")
    if not expected and "verification" in item:
        # Extract expected from verification code for display
        import re as _re
        m = _re.search(r"_normalize\('([^']+)'\)", item["verification"])
        if m:
            expected = m.group(1)

    print(f"  {status} {uid}: pred={predicted[:60]!r} exp={expected!r} "
          f"({duration:.1f}s)"
          + (f" err={err[:80]}" if err else ""), file=sys.stderr)

    # Persist solver trajectory to trace_dir (if provided)
    if trace_dir:
        try:
            traj_src = Path(workdir) / "trajectory.jsonl"
            if traj_src.exists():
                os.makedirs(trace_dir, exist_ok=True)
                shutil.copy2(str(traj_src), os.path.join(trace_dir, f"{uid}.jsonl"))
        except Exception:
            pass  # Non-fatal: don't crash eval if trace copy fails

    return {
        "uid": uid,
        "query": question,
        "expected": expected,
        "predicted": predicted,
        "strict_match": strict,
        "loose_match": passed and not strict,
        "passed": passed,
        "score": 1.0 if passed else 0.0,
        "duration_s": duration,
        "error": err,
        "solver_mode": "claude_agent_sdk" if _SDK_AVAILABLE else "fallback_llm",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Split loading + redaction
# ─────────────────────────────────────────────────────────────────────────────

def _load_split(dataset_dir: Path, split: str,
                iteration: int = 0, n_probe: int = 10) -> list[dict]:
    path = dataset_dir / f"{split}.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"eval split missing: {path}")
    items: list[dict] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    # Auto-assign a unique uid to any item that doesn't have one. eval_one
    # builds the per-item workdir as workdir_base/work_{uid}; if multiple
    # items share uid="unknown" they collide and overwrite each other's
    # answer artifacts, silently corrupting verification.
    for i, it in enumerate(items):
        if not it.get("uid") and not it.get("task_id"):
            it["uid"] = f"{split}_{i:04d}"
    if split == "probe" and n_probe > 0 and items:
        start = (iteration * n_probe) % len(items)
        items = (items + items)[start:start + n_probe]
    return items


def _redact(trace: dict) -> dict:
    out = dict(trace)
    out["query_preview"] = (trace.get("query") or "")[:120] + "…"
    out["predicted_preview"] = (trace.get("predicted") or "")[:120]
    for k in ("query", "predicted"):
        out.pop(k, None)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Public API — called by eval.py
# ─────────────────────────────────────────────────────────────────────────────

async def run_eval(
    skill_dir: str,
    dataset_dir: str,
    split: str,
    output: str,
    *,
    iteration: int = 0,
    n_probe: int = 0,
    redact_traces: bool = False,
    trace_dir: str | None = None,
) -> int:
    """Run evaluation on a skill. Returns 0 on success, 1 on failure.

    Args:
        skill_dir: Path to the skill (must contain SKILL.md).
        dataset_dir: Path to the eval repo (must contain <split>.jsonl).
        split: One of "probe", "train", "test".
        output: Path to write the result JSON.
        iteration: Window offset for probe sampling.
        n_probe: Number of items (0 = all).
        redact_traces: If True, redact traces in output.
        trace_dir: If set, copy per-item trajectories here.
    """
    _dataset_dir = Path(dataset_dir).resolve()
    _skill_dir = Path(skill_dir).resolve()
    global _CURRENT_DATASET_DIR
    _CURRENT_DATASET_DIR = _dataset_dir

    items = _load_split(_dataset_dir, split,
                        iteration=iteration, n_probe=n_probe)
    if not items:
        Path(output).write_text(json.dumps(
            {"split": split, "n_items": 0, "score": 0.0,
             "error": "no items"}, indent=2))
        return 1

    workers = _get_workers()
    sem = asyncio.Semaphore(workers)
    os.makedirs("/tmp/skillhone", exist_ok=True)
    workdir_base = tempfile.mkdtemp(prefix="eval_", dir="/tmp/skillhone")

    mode = "claude_agent_sdk" if _SDK_AVAILABLE else "fallback_llm"
    print(f"[eval] solver_mode={mode} | model={_get_model()} | "
          f"timeout={_get_timeout()}s | workers={workers} | "
          f"items={len(items)}", file=sys.stderr)

    # Launch all tasks concurrently (bounded by semaphore)
    traces = await asyncio.gather(*[
        eval_one(it, str(_skill_dir), sem, workdir_base, trace_dir=trace_dir)
        for it in items
    ])
    traces = list(traces)

    # Keep workdir alive — trajectory-analyzer subagent reads trajectories
    # for tool error diagnosis (rate limits, wrong tool names, etc.)
    # Workdir path is written to output JSON so evaluator can find it.

    n = len(traces)
    n_passed = sum(1 for t in traces if t.get("passed"))
    n_strict = sum(1 for t in traces if t.get("strict_match"))
    n_loose = sum(1 for t in traces if t.get("loose_match"))
    n_errors = sum(1 for t in traces if t.get("error"))
    n_no_answer = sum(1 for t in traces if not t.get("predicted"))

    out = {
        "split": split,
        "n_items": n,
        "n_passed": n_passed,
        "n_total": n,
        "n_strict": n_strict,
        "n_loose": n_loose,
        "n_errors": n_errors,
        "n_no_answer": n_no_answer,
        "score": round(n_passed / max(1, n), 4),
        "pass_rate": round(n_passed / max(1, n), 4),
        "avg_duration_s": round(sum(t.get("duration_s", 0) for t in traces) / max(1, n), 2),
        "model": _get_model(),
        "solver_mode": mode,
        "workdir": workdir_base,
    }
    if redact_traces:
        out["traces"] = [_redact(t) for t in traces]
    else:
        out["traces"] = traces
    Path(output).write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"{split}: passed={n_passed}/{n} ({n_passed/max(1,n)*100:.1f}%) "
          f"strict={n_strict} loose={n_loose} errors={n_errors} "
          f"no_answer={n_no_answer} mode={mode}", file=sys.stderr)

    # Log eval result to global history
    _history_file = Path.home() / ".skillhone" / "history.jsonl"
    try:
        import datetime
        record = {
            "ts": datetime.datetime.now().isoformat(),
            "action": "eval",
            "split": split,
            "skill_dir": str(_skill_dir),
            "eval_dir": str(_dataset_dir),
            "output": output,
            "workdir": workdir_base,
            "trace_dir": trace_dir,
            "iteration": iteration,
            "score": round(n_passed / max(1, n), 4),
            "n_passed": n_passed,
            "n_total": n,
            "n_errors": n_errors,
            "model": _get_model(),
        }
        _history_file.parent.mkdir(parents=True, exist_ok=True)
        with open(_history_file, "a") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass  # best-effort logging

    return 0
