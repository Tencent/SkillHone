#!/usr/bin/env python3
"""Mechanical validation of Q/A proposals (v2: scores dict-of-bool contract).

Checks every candidate against the hard rules in
``references/verification_format.md``:

* Top-level fields: ``question`` (str, non-empty) + ``verification`` (str). Optional:
  ``aggregation``, ``level``. Anything else moves to the sidecar.
* Verification snippet:
  - Reads ``answer.txt`` (string literal must appear).
  - Either assigns ``scores: dict[str, bool]`` (v2 new-style) OR contains ``assert``
    (v1 legacy). The grader's back-compat shim accepts both.
  - Round-trips: with the declared gold answer, ``scores`` should have at least one
    True value (or the legacy ``assert`` should not raise). With a sentinel wrong
    answer, no key in ``scores`` should be True (or the legacy ``assert`` raises).
* Freshness: no time-drift keywords in the question.
* Type compliance: float/int/enum/regex/json format if the contract declares it.

Usage as a CLI:
    python3 validate.py --input candidates.json --contract contract.json
"""

from __future__ import annotations

import argparse
import json
import os
import re as _re
import shutil
import tempfile
import unicodedata
from pathlib import Path

# --- Freshness terms -------------------------------------------------------

_TIME_DRIFT_TERMS_EN = [
    "currently", "recently", "latest", "this week", "this month", "this year",
    "today", "right now", "trending", "as of now",
]
_TIME_DRIFT_TERMS_ZH = ["当前", "最近", "最新", "本周", "本月", "今年", "今天", "现在", "目前热门"]


# --- Type checkers (kept from v1 for optional contract.allowed_types) ------

def _check_float(value: str, contract: dict) -> tuple[bool, str]:
    fmt = contract.get("float_format", {})
    pattern = fmt.get("regex", r"^-?\d+\.\d{2}$")
    if not isinstance(value, str):
        return False, f"float answer must be string, got {type(value).__name__}"
    if not _re.match(pattern, value):
        return False, f"float answer {value!r} does not match {pattern!r}"
    try:
        float(value)
    except ValueError:
        return False, f"float answer {value!r} not parseable"
    return True, ""


def _check_int(value: str) -> tuple[bool, str]:
    if not isinstance(value, str):
        return False, "int answer must be string"
    s = value.replace(",", "").replace(" ", "")
    if not _re.match(r"^-?\d+$", s):
        return False, f"int answer {value!r} is not an integer"
    return True, ""


def _check_string(value: str) -> tuple[bool, str]:
    if not isinstance(value, str) or not value.strip():
        return False, "string answer empty or non-string"
    if value != value.strip():
        return False, "string answer has leading/trailing whitespace"
    return True, ""


def _check_enum(value: str, contract: dict) -> tuple[bool, str]:
    allowed = contract.get("enum_values", [])
    if not isinstance(value, str):
        return False, "enum answer must be string"
    if allowed and value not in allowed:
        return False, f"enum answer {value!r} not in {allowed}"
    return True, ""


_TYPE_CHECKERS = {
    "float": lambda v, c: _check_float(v, c),
    "int":   lambda v, c: _check_int(v),
    "string": lambda v, c: _check_string(v),
    "enum":  lambda v, c: _check_enum(v, c),
}


def _check_freshness(question: str) -> tuple[bool, str]:
    ql = question.lower()
    for kw in _TIME_DRIFT_TERMS_EN:
        if kw in ql:
            return False, f"question contains time-drift keyword: {kw!r}"
    for kw in _TIME_DRIFT_TERMS_ZH:
        if kw in question:
            return False, f"question contains time-drift keyword: {kw!r}"
    return True, ""


# --- Verification snippet checks (v2: dict-of-bool) ------------------------

def _normalize(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = s.lower()
    s = _re.sub(r"[^\w\s]", " ", s)
    s = _re.sub(r"\s+", " ", s).strip()
    return s


def _loose_match(pred: str, exp: str) -> bool:
    p, e = _normalize(pred), _normalize(exp)
    if not p or not e:
        return False
    return p == e or e in p or p in e


def _llm_judge_equal(predicted: str, expected: str) -> bool:  # noqa: ARG001
    # Offline stub — round-trip exercises string branches only. Snippets
    # relying solely on LLM equivalence will fail the round-trip and get flagged.
    return False


def _lint_verification(snippet: str) -> tuple[bool, str]:
    if not isinstance(snippet, str) or not snippet.strip():
        return False, "verification is empty"
    if "open(" not in snippet and "answer.txt" not in snippet:
        return False, "verification does not read answer.txt"
    has_scores = "scores" in snippet and "=" in snippet
    has_assert = "assert " in snippet or snippet.strip().startswith("assert")
    if not (has_scores or has_assert):
        return False, "verification has neither `scores = ...` nor `assert ...`"
    if "def verify" in snippet or "def _verify" in snippet:
        return False, "verification is a function def — must be a top-level snippet"
    return True, ""


def _exec_snippet(snippet: str, answer_text: str) -> tuple[dict | None, str | None]:
    """Run the snippet with answer.txt=answer_text and return (scores_dict, error_kind).

    ``scores_dict`` is None when the snippet errored. ``error_kind`` is one of:
    None / 'assert' / 'other'. Legacy assert-style snippets that complete without
    raising are mapped to {"pass": True}; AssertionError → {"pass": False}.
    """
    recorddir = tempfile.mkdtemp(prefix="verify_lint_")
    old_cwd = os.getcwd()
    try:
        with open(os.path.join(recorddir, "answer.txt"), "w") as f:
            f.write(answer_text)
        os.chdir(recorddir)
        ns = {
            "answer": answer_text,
            "_normalize": _normalize,
            "_loose_match": _loose_match,
            "_llm_judge_equal": _llm_judge_equal,
            "__builtins__": __builtins__,
        }
        try:
            exec(snippet, ns)
        except AssertionError:
            return ns.get("scores") if isinstance(ns.get("scores"), dict) else {"pass": False}, "assert"
        except Exception:  # noqa: BLE001
            return ns.get("scores") if isinstance(ns.get("scores"), dict) else {"pass": False, "_error": True}, "other"
        # No exception
        if "scores" in ns and isinstance(ns["scores"], dict):
            return ns["scores"], None
        # Legacy assert-only that didn't raise → pass
        return {"pass": True}, None
    finally:
        os.chdir(old_cwd)
        shutil.rmtree(recorddir, ignore_errors=True)


def _coerce_to_bool_dict(d: dict) -> dict[str, bool]:
    out: dict[str, bool] = {}
    for k, v in d.items():
        if k.startswith("_"):  # private marker like _error
            continue
        out[str(k)] = bool(v)
    return out


def _round_trip_verification(snippet: str, expected: str) -> tuple[bool, str]:
    """Two rounds: gold answer must produce at least one True; sentinel wrong
    answer must produce no True. Anything else is a broken snippet."""
    gold_scores, gold_err = _exec_snippet(snippet, expected)
    if gold_err == "other":
        return False, "correct answer raised non-AssertionError (snippet bug)"
    if gold_scores is None:
        return False, "snippet did not produce scores"
    gold_clean = _coerce_to_bool_dict(gold_scores)
    if not any(gold_clean.values()):
        return False, f"correct answer scored all-False: {gold_clean}"

    sentinel = "__BROKEN_ANSWER_DO_NOT_MATCH_ANYTHING__"
    bad_scores, bad_err = _exec_snippet(snippet, sentinel)
    if bad_err == "other":
        return True, "(wrong answer raised non-AssertionError; tolerated but flagged)"
    bad_clean = _coerce_to_bool_dict(bad_scores or {})
    if any(bad_clean.values()):
        # At least one criterion accepted the sentinel → the snippet grades
        # too generously.
        leaky = [k for k, v in bad_clean.items() if v]
        return False, f"wrong-answer sentinel passed criteria {leaky}"
    return True, ""


# --- Schema gate (top-level fields) ----------------------------------------

_REQUIRED_FIELDS = {"question", "verification"}
_OPTIONAL_FIELDS = {"aggregation", "level", "task_id"}  # passed through, not required


def _check_schema(line_obj) -> tuple[bool, str]:
    if not isinstance(line_obj, dict):
        return False, "not a JSON object"
    missing = _REQUIRED_FIELDS - line_obj.keys()
    if missing:
        return False, f"missing required fields: {sorted(missing)}"
    extras = line_obj.keys() - _REQUIRED_FIELDS - _OPTIONAL_FIELDS
    if extras:
        return False, f"unexpected fields {sorted(extras)} — move to *.meta.jsonl"
    q = line_obj.get("question", "")
    if not isinstance(q, str) or not q.strip():
        return False, "question must be a non-empty string"
    v = line_obj.get("verification", "")
    if not isinstance(v, str) or not v.strip():
        return False, "verification must be a non-empty string"
    return True, ""


def _check_no_answer_leak(question: str, gold: str) -> tuple[bool, str]:
    if not gold:
        return True, ""
    if _normalize(gold) and _normalize(gold) in _normalize(question):
        return False, "gold answer appears verbatim in the question"
    return True, ""


# --- Entry point -----------------------------------------------------------

def validate_candidates(candidates: list[dict], contract: dict, *, golds: dict[int, str] | None = None) -> dict:
    """Run the full validation pass over a list of candidates.

    ``golds[i]`` may supply the declared gold answer for round-trip purposes
    (the public ``verification`` field doesn't carry it). When absent, the
    round-trip check is skipped with a warning.
    """
    report: dict = {}
    allowed_types = set(contract.get("allowed_types", []))

    for i, cand in enumerate(candidates):
        checks: dict[str, tuple[bool, str]] = {}

        # Schema
        checks["schema"] = _check_schema(cand)
        if not checks["schema"][0]:
            report[str(i)] = {
                "passed": False,
                "checks": {k: {"passed": ok, "reason": r} for k, (ok, r) in checks.items()},
            }
            continue

        # Type compliance (optional, only if proposal includes answer_type)
        atype = cand.get("answer_type")
        if atype is not None:
            if allowed_types and atype not in allowed_types:
                checks["type_allowed"] = (False, f"answer_type {atype!r} not in allowed set {allowed_types}")
            else:
                checks["type_allowed"] = (True, "")
            checker = _TYPE_CHECKERS.get(atype)
            if checker and "answer" in cand:
                checks["type_compliance"] = checker(cand["answer"], contract)

        # Freshness
        checks["freshness"] = _check_freshness(cand["question"])

        # Answer leakage (if we know the gold)
        gold = (golds or {}).get(i) or cand.get("answer")
        if gold:
            checks["no_answer_leak"] = _check_no_answer_leak(cand["question"], gold)

        # Verification lint + round-trip
        snippet = cand["verification"]
        checks["verification_lint"] = _lint_verification(snippet)
        if checks["verification_lint"][0]:
            if gold:
                checks["verification_round_trip"] = _round_trip_verification(snippet, gold)
            else:
                checks["verification_round_trip"] = (True, "(skipped: no gold supplied for round-trip)")
        else:
            checks["verification_round_trip"] = (False, "skipped: lint failed")

        passed = all(ok for ok, _ in checks.values())
        report[str(i)] = {
            "passed": passed,
            "checks": {k: {"passed": ok, "reason": r} for k, (ok, r) in checks.items()},
        }

    return report


def main():
    parser = argparse.ArgumentParser(description="Mechanical validation of closed-form Q/A.")
    parser.add_argument("--input", required=True,
                        help="JSONL of final samples OR JSON list of proposer-style candidates.")
    parser.add_argument("--contract", required=True, help="Answer contract JSON.")
    parser.add_argument("--meta", default=None,
                        help="Optional sidecar *.meta.jsonl carrying `answer` per sample for round-trip.")
    parser.add_argument("--output", default=None, help="Where to write the report (stdout if omitted).")
    args = parser.parse_args()

    input_path = Path(args.input)
    contract = json.loads(Path(args.contract).read_text())

    # Auto-detect input shape: JSONL (one obj per line) vs JSON list
    text = input_path.read_text().strip()
    candidates: list[dict]
    if text.startswith("["):
        candidates = json.loads(text)
    elif text.startswith("{") and "candidates" in json.loads(text.splitlines()[0]).keys():
        candidates = json.loads(text)["candidates"]
    else:
        candidates = [json.loads(line) for line in text.splitlines() if line.strip()]

    # Load gold answers from sidecar meta, if provided
    golds: dict[int, str] = {}
    if args.meta:
        for i, line in enumerate(Path(args.meta).open()):
            if not line.strip():
                continue
            try:
                m = json.loads(line)
                if "answer" in m:
                    golds[i] = m["answer"]
            except Exception:
                pass

    report = validate_candidates(candidates, contract, golds=golds)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text)
    else:
        print(text)

    n_passed = sum(1 for r in report.values() if r["passed"])
    print(f"\n{n_passed}/{len(report)} passed.")


if __name__ == "__main__":
    main()
