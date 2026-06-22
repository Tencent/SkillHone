"""SkillHone unified path management.

All persistent paths live under ~/.skillhone/, similar to Claude Code's ~/.claude/.
Override root with SKILLHONE_HOME environment variable.
"""
from __future__ import annotations

import os
from pathlib import Path


def get_home() -> Path:
    """Return ~/.skillhone, creating if needed."""
    home = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone"))
    home.mkdir(parents=True, exist_ok=True)
    return home


def get_cache_dir() -> Path:
    """Eval repo cache directory (0700 permissions).

    Previously: /var/lib/skillops_private
    """
    d = get_home() / "cache"
    d.mkdir(parents=True, exist_ok=True)
    try:
        d.chmod(0o700)
    except OSError:
        pass  # May fail on some filesystems
    return d


def get_workspace_dir(iteration: int, run_id: str | None = None) -> Path:
    """Per-iteration agent workspace, isolated per run.

    When run_id is provided, workspaces are stored under the run directory
    to prevent conflicts between concurrent experiments.

    Previously: /tmp/vfs/skillhone_iter{N}
    """
    if run_id:
        d = get_home() / "runs" / run_id / "workspaces" / f"iter-{iteration:02d}"
    else:
        # Legacy fallback (shared across runs — avoid using this)
        d = get_home() / "workspaces" / f"iter{iteration}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_identities_path() -> Path:
    """Forgejo SDLC identity configuration file.

    Priority:
      1. ~/.skillhone/identities.conf (new canonical location)
      2. /opt/forgejo/sdlc_identities.conf (legacy)
      3. /opt/gitea/sdlc_identities.conf (very old legacy)
    """
    home_conf = get_home() / "identities.conf"
    if home_conf.exists():
        return home_conf
    for legacy in (
        Path("/opt/forgejo/sdlc_identities.conf"),
        Path("/opt/gitea/sdlc_identities.conf"),
    ):
        if legacy.exists():
            return legacy
    return home_conf  # Return new path even if not yet created


def get_experiments_dir() -> Path:
    """Experiment results directory."""
    d = get_home() / "experiments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_logs_dir() -> Path:
    """Runtime logs directory."""
    d = get_home() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_config_path() -> Path:
    """Global config.yaml path."""
    return get_home() / "config.yaml"
