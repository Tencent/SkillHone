"""Shared helpers for forgejo scripts (config loading, client init)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from forgejo_client import ForgejoClient


def get_config(role: str = "", repo_override: str = "") -> dict[str, str]:
    """Read config: env vars → ~/.skillhone/ → _data/forgejo_config.txt."""
    cfg = {
        "url": os.environ.get("FORGEJO_URL", ""),
        "token": os.environ.get("FORGEJO_TOKEN", ""),
        "owner": os.environ.get("FORGEJO_OWNER", ""),
        "repo": os.environ.get("FORGEJO_REPO", ""),
    }

    skillhone_home = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone"))
    settings_path = skillhone_home / "settings.json"
    identities_path = skillhone_home / "identities.conf"

    if settings_path.exists() and (not cfg["url"] or not cfg["owner"] or not cfg["token"]):
        try:
            settings = json.loads(settings_path.read_text())
            forgejo_cfg = settings.get("forgejo", {})
            if not cfg["url"]:
                cfg["url"] = forgejo_cfg.get("url", "")
            if not cfg["owner"]:
                cfg["owner"] = forgejo_cfg.get("owner", "")
            if not cfg["token"] and not role:
                cfg["token"] = forgejo_cfg.get("token", "")
        except (json.JSONDecodeError, OSError):
            pass

    if identities_path.exists() and not cfg["token"]:
        try:
            import configparser
            parser = configparser.ConfigParser()
            parser.read(str(identities_path))
            for try_role in ([role] if role else []) + ["developer", "skillhone"]:
                if try_role in parser:
                    cfg["token"] = parser[try_role].get("token", "")
                    if cfg["token"]:
                        break
        except Exception:
            pass

    if not cfg["url"] or not cfg["token"]:
        for config_path in ["_data/forgejo_config.txt", "../_data/forgejo_config.txt"]:
            if os.path.exists(config_path):
                with open(config_path) as f:
                    for line in f:
                        line = line.strip()
                        if "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip().lower()
                            if k == "forgejo_url" and not cfg["url"]:
                                cfg["url"] = v.strip()
                            elif k == "forgejo_token" and not cfg["token"]:
                                cfg["token"] = v.strip()
                            elif k == "forgejo_owner" and not cfg["owner"]:
                                cfg["owner"] = v.strip()
                            elif k == "forgejo_repo" and not cfg["repo"]:
                                cfg["repo"] = v.strip()
                break

    if repo_override:
        cfg["repo"] = repo_override
    return cfg


def get_client(role: str = "", repo: str = "") -> ForgejoClient:
    """Get configured ForgejoClient or exit with error."""
    cfg = get_config(role=role, repo_override=repo)
    if not cfg["url"]:
        print("ERROR: FORGEJO_URL not set", file=sys.stderr)
        sys.exit(1)
    if not cfg["token"]:
        print("ERROR: FORGEJO_TOKEN not set", file=sys.stderr)
        sys.exit(1)
    return ForgejoClient(url=cfg["url"], token=cfg["token"],
                         owner=cfg["owner"], repo=cfg["repo"])
