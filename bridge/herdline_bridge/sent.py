"""Copies of images Claude sends with SendUserFile, so the phone can still show them after the file is deleted."""
import re
import shutil
from pathlib import Path

from . import transcripts

_SAFE_ID = re.compile(r'[\w-]+')


def folder(state_dir: Path, session_id: str) -> Path:
    return state_dir / 'sent' / session_id


def keep(state_dir: Path, hook_input: dict) -> None:
    """PostToolUse hook: copy the images of one SendUserFile call while they still exist."""
    if hook_input.get('tool_name') != 'SendUserFile':
        return
    session_id = hook_input.get('session_id') or ''
    tool_use_id = hook_input.get('tool_use_id') or ''
    if not _SAFE_ID.fullmatch(session_id) or not _SAFE_ID.fullmatch(tool_use_id):
        return
    target = folder(state_dir, session_id)
    for index, path in enumerate((hook_input.get('tool_input') or {}).get('files') or []):
        if Path(path).suffix.lower() in transcripts.IMAGE_TYPES and Path(path).is_file():
            target.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target / transcripts.sent_name(tool_use_id, index, path))
