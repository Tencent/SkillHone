"""SkillHone structured logging setup.

Two-layer logging:
  - Global: ~/.skillhone/logs/skillhone.log (RotatingFileHandler, 10MB × 5)
  - Per-run: ~/.skillhone/runs/<run_id>/run.log

Console only shows WARNING+ to avoid cluttering terminal (print statements
still show progress). All levels written to files for searchability.

Usage::

    from skillhone.core.logging_setup import setup_logging
    logger = setup_logging(run_id="deep-research-20260508")
    logger.info("Probe score: 0.72")
    logger.warning("PR-Val split missing, skipping")
    logger.error("Eval subprocess crashed: ...")
"""
from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logging(run_id: str | None = None, level: str = "INFO") -> logging.Logger:
    """Configure structured logging for SkillHone.

    Args:
        run_id: If provided, also writes to runs/<run_id>/run.log.
        level: Minimum log level (default INFO).

    Returns:
        Configured logger instance (name="skillhone").
    """
    from skillhone.core.paths import get_home, get_logs_dir

    logger = logging.getLogger("skillhone")
    if logger.handlers:
        return logger  # Already configured — avoid duplicate handlers

    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)-5s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Global rotating log
    logs_dir = get_logs_dir()
    global_handler = RotatingFileHandler(
        logs_dir / "skillhone.log",
        maxBytes=10_000_000,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    global_handler.setFormatter(fmt)
    logger.addHandler(global_handler)

    # Per-run log (if run_id provided)
    if run_id:
        run_dir = get_home() / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        run_handler = logging.FileHandler(
            run_dir / "run.log", encoding="utf-8"
        )
        run_handler.setFormatter(fmt)
        logger.addHandler(run_handler)

    # Console handler — WARNING+ only (prints still handle user-facing progress)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.WARNING)
    console_handler.setFormatter(fmt)
    logger.addHandler(console_handler)

    return logger
