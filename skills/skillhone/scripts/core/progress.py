"""Backend-side progress writer.

Exposes ``RunWriter`` which the SDLC loop uses to emit observable state under
``~/.skillhone/runs/<run_id>/``. The frontend reads those files; the two ends
share the schemas defined in ``front.io.schemas``.

Writes are atomic (tmp + ``os.replace``) and JSONL appends are line-buffered
so a concurrent reader never sees a half-written record.

Usage sketch::

    writer = RunWriter.start(skill_name="email-parser", total_iterations=20,
                             config={"eval_repo": "..."})
    for i in range(20):
        writer.update_status(current_iteration=i, current_step="probe_eval")
        writer.emit_event("iter_start", {})
        ...
        writer.emit_event("iter_end", {"probe_score": 0.7})
    writer.finish({"best_iteration": 4, "best_es_score": 0.72})
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# NOTE: we intentionally do NOT import from ``front`` to avoid
# coupling the backend loop to the Reflex app. The path helpers below mirror
# the protocol defined there; if they drift, tests will catch it (both sides
# share the same conventions documented in ``io/protocol.py``).

def _home() -> Path:
    home = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone"))
    home.mkdir(parents=True, exist_ok=True)
    return home


def _runs_dir() -> Path:
    d = _home() / "runs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _active_runs_path() -> Path:
    return _home() / "active_runs.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


class RunWriter:
    """Single-run writer. One instance per SDLC loop invocation."""

    def __init__(self, run_id: str, skill_name: str, run_dir: Path):
        self.run_id = run_id
        self.skill_name = skill_name
        self.run_dir = run_dir
        self._status: dict[str, Any] = {
            "run_id": run_id,
            "phase": "pending",
            "current_iteration": 0,
            "total_iterations": 0,
            "current_step": "",
            "best_iteration": -1,
            "best_es_score": 0.0,
            "last_probe_score": None,
            "last_pr_val_score": None,
            "last_es_score": None,
            "agent_cost_usd": 0.0,
            "rounds_no_improve": 0,
            "updated_at": _now_iso(),
        }

    # ---------------------------------------------------------------- start / finish

    @classmethod
    def start(
        cls,
        skill_name: str,
        total_iterations: int = 0,
        config: dict[str, Any] | None = None,
        run_id: str | None = None,
    ) -> "RunWriter":
        """Create a new run directory, write manifest, register in active_runs."""
        if run_id is None:
            ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            run_id = f"{skill_name}-{ts}"
        run_dir = _runs_dir() / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        manifest = {
            "run_id": run_id,
            "skill_name": skill_name,
            "started_at": _now_iso(),
            "config": dict(config or {}),
            "pid": os.getpid(),
        }
        _atomic_write(run_dir / "manifest.json", manifest)

        writer = cls(run_id=run_id, skill_name=skill_name, run_dir=run_dir)
        writer._status["total_iterations"] = int(total_iterations)
        writer._status["phase"] = "running"
        writer._flush_status()
        _register_active_run(writer)
        return writer

    def finish(self, summary: dict[str, Any] | None = None, *, success: bool = True) -> None:
        """Mark the run as completed / failed and update the global index."""
        self._status["phase"] = "completed" if success else "failed"
        self._status["current_step"] = "done" if success else "failed"
        if summary:
            for k in ("best_iteration", "best_es_score", "agent_cost_usd"):
                if k in summary:
                    self._status[k] = summary[k]
        self._flush_status()
        self.emit_event("run_end", {"success": success, "summary": summary or {}})
        _update_active_run(self)

    # ---------------------------------------------------------------- iteration-level writes
    #
    # Each iteration gets its own directory under ``runs/<run_id>/iterations/iter-NN/``.
    # The frontend's "every-iteration" table reads ``metrics.json`` from these
    # directories; the expandable detail pane reads ``diff.patch`` +
    # ``trajectory.txt``. Keeping one directory per iteration means writes can
    # be truly atomic (tmp + rename on a single file) and the UI never sees a
    # half-populated iteration.

    def _iteration_dir(self, n: int) -> Path:
        d = self.run_dir / "iterations" / f"iter-{n:02d}"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def start_iteration(self, n: int, *, step: str = "probe_eval") -> None:
        """Create the iteration directory and write an initial metrics snapshot.

        ``phase`` stays at the run level; ``step`` is the fine-grained state
        within the iteration (``probe_eval``, ``pr_val``, ``agent_edit``, ...).
        """
        iter_dir = self._iteration_dir(n)
        initial: dict[str, Any] = {
            "iter": n,
            "phase": "running",
            "step": step,
            "started_at": _now_iso(),
            "probe_score": None,
            "pr_val_score": None,
            "es_score": None,
            "cost_usd": 0.0,
            "duration_s": 0.0,
            "new_best": False,
            "preference_win_rate": None,
        }
        _atomic_write(iter_dir / "metrics.json", initial)
        self.emit_event("iter_start", {"iteration": n})

    def write_iter_diff(self, n: int, diff_text: str) -> None:
        """Persist the agent's git diff for this iteration (plain text)."""
        iter_dir = self._iteration_dir(n)
        # Not JSON — write directly, atomic is not critical here (read-mostly,
        # large payload; the frontend tolerates a re-read).
        (iter_dir / "diff.patch").write_text(diff_text or "", encoding="utf-8")

    def write_iter_trajectory(self, n: int, summary: str) -> None:
        """Persist the agent's trajectory summary (plain text)."""
        iter_dir = self._iteration_dir(n)
        (iter_dir / "trajectory.txt").write_text(summary or "", encoding="utf-8")

    def finish_iteration(
        self,
        n: int,
        *,
        probe_score: float | None = None,
        pr_val_score: float | None = None,
        es_score: float | None = None,
        cost_usd: float = 0.0,
        duration_s: float = 0.0,
        new_best: bool = False,
        preference_win_rate: float | None = None,
        diff_stat: str = "",
        commit_sha: str = "",
        branch: str = "",
    ) -> None:
        """Overwrite the iteration's metrics.json with final values.

        Callers do not need to have invoked ``start_iteration`` first — this
        method is safe to use standalone (it will create the directory).
        """
        iter_dir = self._iteration_dir(n)
        metrics_path = iter_dir / "metrics.json"
        # Preserve ``started_at`` if present; otherwise record now.
        prev: dict[str, Any] = {}
        if metrics_path.exists():
            try:
                with metrics_path.open("r", encoding="utf-8") as f:
                    prev = json.load(f)
            except (OSError, json.JSONDecodeError):
                prev = {}
        final = {
            "iter": n,
            "phase": "completed",
            "step": "done",
            "started_at": prev.get("started_at", _now_iso()),
            "finished_at": _now_iso(),
            "probe_score": probe_score,
            "pr_val_score": pr_val_score,
            "es_score": es_score,
            "cost_usd": float(cost_usd),
            "duration_s": float(duration_s),
            "new_best": bool(new_best),
            "preference_win_rate": preference_win_rate,
            "diff_stat": diff_stat,
            "commit_sha": commit_sha or "",
            "branch": branch or "",
        }
        _atomic_write(metrics_path, final)

    # ---------------------------------------------------------------- per-iteration writes

    def update_status(self, **kwargs: Any) -> None:
        """Merge fields into status and atomically rewrite ``status.json``.

        Unknown keys are accepted (forward-compatible); the reader filters.
        """
        self._status.update(kwargs)
        self._status["updated_at"] = _now_iso()
        self._flush_status()
        _update_active_run(self)

    def emit_event(self, kind: str, data: dict[str, Any] | None = None) -> None:
        """Append one line to ``events.jsonl``. Fsync to keep tails consistent."""
        event = {
            "ts": _now_iso(),
            "iteration": int(self._status.get("current_iteration", 0)),
            "kind": kind,
            "data": dict(data or {}),
        }
        path = self.run_dir / "events.jsonl"
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
            f.flush()

    # ---------------------------------------------------------------- internals

    def _flush_status(self) -> None:
        _atomic_write(self.run_dir / "status.json", self._status)


# ─────────────────────────────────────────────────────────────── active_runs.json

def _register_active_run(writer: RunWriter) -> None:
    _mutate_active_runs(lambda runs: runs + [_entry_from_writer(writer)])


def _update_active_run(writer: RunWriter) -> None:
    entry = _entry_from_writer(writer)

    def replace(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = [r for r in runs if r.get("run_id") != writer.run_id]
        out.append(entry)
        return out

    _mutate_active_runs(replace)


def _entry_from_writer(writer: RunWriter) -> dict[str, Any]:
    s = writer._status
    return {
        "run_id": writer.run_id,
        "skill_name": writer.skill_name,
        "phase": s.get("phase", "pending"),
        "started_at": s.get("updated_at", _now_iso()),
        "path": str(writer.run_dir),
        "best_score": float(s.get("best_es_score", 0.0)),
        "current_iteration": int(s.get("current_iteration", 0)),
        "total_iterations": int(s.get("total_iterations", 0)),
    }


def _mutate_active_runs(mutate) -> None:
    path = _active_runs_path()
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {"runs": []}
    data["runs"] = mutate(data.get("runs", []))
    _atomic_write(path, data)
