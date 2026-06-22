"""SkillHone: task-agnostic multi-agent SDLC skill evolution.

All configuration is stored under ~/.skillhone/ (similar to ~/.claude/).
  - ~/.skillhone/settings.json  — JSON5 config (models, APIs, params)
  - ~/.skillhone/identities.conf — Forgejo SDLC role credentials
  - ~/.skillhone/cache/         — eval repo cache (0700)
  - ~/.skillhone/workspaces/    — agent iteration workspaces
  - ~/.skillhone/experiments/   — experiment results
  - ~/.skillhone/logs/          — runtime logs

Override root with SKILLHONE_HOME env var.
"""
from __future__ import annotations

from .paths import (  # noqa: F401
    get_home,
    get_cache_dir,
    get_workspace_dir,
    get_identities_path,
    get_experiments_dir,
    get_logs_dir,
    get_config_path,
)

from .config import cfg  # noqa: F401
