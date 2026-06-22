#!/usr/bin/env python3
"""Start agent-driven skill optimization.

Usage:
    python3 scripts/optim.py --repo http://forgejo/skillhone/my-skill.git --iters 5 --patience 2
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

SKILLHONE_HOME = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone"))
SKILLS_DIR = SKILLHONE_HOME / "skills"
HISTORY_FILE = SKILLHONE_HOME / "history.jsonl"
RUNS_DIR = SKILLHONE_HOME / "runs"
WORK_DIR = Path("/tmp/skillhone")  # All temp workdirs go here; symlink to larger disk if needed


def _make_run_id(repo_name: str) -> str:
    """Generate a run ID: <repo_name>_<timestamp>."""
    import datetime
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{repo_name}_{ts}"


def _log_event(action: str, data: dict) -> None:
    """Append one JSON line to ~/.skillhone/history.jsonl."""
    import datetime
    record = {"ts": datetime.datetime.now().isoformat(), "action": action, **data}
    SKILLHONE_HOME.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

# Ensure core/ is importable
sys.path.insert(0, str(SKILLHONE_HOME / "skills" / "skillhone" / "scripts"))
from core.redaction import redact_for_log  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Agent-driven skill optimization")
    parser.add_argument("--repo", required=True,
                        help="Forgejo skill repo URL")
    parser.add_argument("--iters", type=int, default=5,
                        help="max iterations (default: 5)")
    parser.add_argument("--patience", type=int, default=2,
                        help="early-stop patience (default: 2)")
    parser.add_argument("--max-turns", type=int, default=None,
                        help="max agent turns (default: unlimited, relies on patience)")
    parser.add_argument("--max-budget", type=float, default=None,
                        help="max budget in USD (safety cap, default: no limit)")
    args = parser.parse_args()

    # Load settings
    settings_path = Path.home() / ".skillhone" / "settings.json"
    if not settings_path.exists():
        print("ERROR: ~/.skillhone/settings.json not found", file=sys.stderr)
        return 1
    settings = json.loads(settings_path.read_text())

    forgejo_cfg = settings.get("forgejo", {})
    token = forgejo_cfg.get("token", "")
    forgejo_url = forgejo_cfg.get("url", "http://localhost:3000")

    # Clone repos using gitpython
    from core.git_ops import clone as git_clone

    print(f"Cloning skill repo: {args.repo}")
    skill_clone = git_clone(args.repo, token=token)
    print(f"  → {skill_clone}")

    eval_url = args.repo.rstrip("/").removesuffix(".git") + "-eval.git"
    print(f"Cloning eval repo: {eval_url}")
    eval_clone = git_clone(eval_url, token=token)
    print(f"  → {eval_clone}")

    # Setup workspace
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    ws = Path(tempfile.mkdtemp(prefix="ws_", dir=str(WORK_DIR)))

    # Copy skills to workspace
    for skill_name in ("skillhone", "skillhone-evaluation",
                       "skillhone-optimization", "forgejo"):
        src = SKILLS_DIR / skill_name
        dest = ws / ".claude" / "skills" / skill_name
        if src.exists():
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copytree(str(src), str(dest), dirs_exist_ok=True)

    # Promote skill-bundled subagents to `.claude/agents/` so the SDK
    # auto-discovers them. The SDK only scans the project-root agents dir;
    # it does NOT recurse into `.claude/skills/<name>/agents/`.
    agents_dest = ws / ".claude" / "agents"
    agents_dest.mkdir(parents=True, exist_ok=True)
    for skill_dir in (ws / ".claude" / "skills").iterdir():
        agents_src = skill_dir / "agents"
        if agents_src.is_dir():
            for agent_md in agents_src.glob("*.md"):
                shutil.copy2(str(agent_md), str(agents_dest / agent_md.name))

    # Write config
    config_dir = ws / "_data"
    config_dir.mkdir(exist_ok=True)
    repo_name = args.repo.rstrip("/").split("/")[-1].removesuffix(".git")
    json.dump({
        "skill_repo_url": args.repo,
        "eval_repo_url": eval_url,
        "skill_clone_path": str(skill_clone),
        "eval_dir": str(eval_clone),
        "max_iterations": args.iters,
        "patience": args.patience,
        "forgejo_url": forgejo_url,
        "forgejo_owner": forgejo_cfg.get("owner", "skillhone"),
    }, open(config_dir / "config.json", "w"), indent=2)

    (config_dir / "forgejo_config.txt").write_text(
        f"FORGEJO_URL={forgejo_url}\n"
        f"FORGEJO_OWNER={forgejo_cfg.get('owner', 'skillhone')}\n"
        f"FORGEJO_REPO={repo_name}\n"
        f"FORGEJO_TOKEN={token}\n")

    # Log to global history + create run directory for recovery
    run_id = _make_run_id(repo_name)
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    run_state = {
        "run_id": run_id,
        "repo": args.repo,
        "repo_name": repo_name,
        "eval_url": eval_url,
        "skill_clone_path": str(skill_clone),
        "eval_dir": str(eval_clone),
        "workspace": str(ws),
        "max_iterations": args.iters,
        "patience": args.patience,
        "model": settings.get("improver", {}).get("sdk_model_alias", "opus"),
        "forgejo_url": forgejo_url,
        "forgejo_owner": forgejo_cfg.get("owner", "skillhone"),
    }
    (run_dir / "state.json").write_text(json.dumps(run_state, indent=2))
    _log_event("optim_start", {"run_id": run_id, "run_dir": str(run_dir), **run_state})
    print(f"\n  Run: {run_dir}")

    # Build prompt — keep it minimal: only facts/inputs.
    # All workflow rules live in the loaded skills (skillhone-evaluation, skillhone-optimization).
    prompt = (
        f"Optimize the skill at {skill_clone}. "
        f"Eval data at {eval_clone}. Config in _data/config.json. "
        f"Max {args.iters} iterations, patience {args.patience}. "
        f"This is a freshly created skill with basic scripts. "
        f"Use the explorer subagent in skillhone-optimization when you need "
        f"community tools or reference approaches."
    )

    # Run agent
    improver_cfg = settings.get("improver", {})
    model = improver_cfg.get("sdk_model_alias", "opus")
    improver_env = improver_cfg.get("env", {})
    disallowed_tools = improver_cfg.get("disallowed_tools", ["WebSearch"])

    # Verify skills and agents are correctly set up
    skills_dir = ws / ".claude" / "skills"
    agents_dir = ws / ".claude" / "agents"
    loaded_skills = [d.name for d in skills_dir.iterdir() if d.is_dir() and (d / "SKILL.md").exists()] if skills_dir.exists() else []
    loaded_agents = [f.stem for f in agents_dir.glob("*.md")] if agents_dir.exists() else []

    print(f"\nStarting agent (model={model}, max_turns={args.max_turns})")
    print(f"  skills ({len(loaded_skills)}): {loaded_skills}")
    print(f"  agents ({len(loaded_agents)}): {loaded_agents}")
    print(f"  disallowed_tools: {disallowed_tools}")
    print("=" * 60)

    try:
        from claude_agent_sdk import query, ClaudeAgentOptions

        async def _run():
            options = ClaudeAgentOptions(
                cwd=str(ws),
                model=model,
                skills="all",
                setting_sources=["project"],
                disallowed_tools=disallowed_tools,
                permission_mode="bypassPermissions",
                max_turns=args.max_turns,
                env={
                    **improver_env,
                    "FORGEJO_URL": forgejo_url,
                    "FORGEJO_TOKEN": token,
                    "FORGEJO_OWNER": forgejo_cfg.get("owner", "skillhone"),
                    "FORGEJO_REPO": repo_name,
                },
            )
            # Persist every SDK message to <run_dir>/trajectory.jsonl so we can
            # debug what master + subagents actually did (explorer calls, tool
            # uses, PR diffs, etc.). Without this, optim is a black box.
            traj = run_dir / "trajectory.jsonl"
            async for msg in query(prompt=prompt, options=options):
                try:
                    if hasattr(msg, "__dict__"):
                        entry = {"type": type(msg).__name__, **msg.__dict__}
                    elif isinstance(msg, dict):
                        entry = msg
                    else:
                        entry = {"type": type(msg).__name__, "raw": str(msg)[:2000]}
                except Exception:
                    entry = {"type": "unknown", "raw": str(msg)[:2000]}
                with traj.open("a") as _tf:
                    _tf.write(json.dumps(redact_for_log(entry), default=str, ensure_ascii=False) + "\n")

        asyncio.run(_run())
    except KeyboardInterrupt:
        print("\nInterrupted")
        _log_event("optim_end", {"run_id": run_id, "status": "interrupted"})
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        _log_event("optim_end", {"run_id": run_id, "status": "error", "error": str(e)})
        return 1

    _log_event("optim_end", {"run_id": run_id, "status": "completed", "workspace": str(ws)})
    print(f"\nDone. Workspace: {ws}")
    print(f"Run dir: {run_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
