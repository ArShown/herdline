"""Read chat messages from Claude Code session transcripts (.jsonl), from the end."""
import json
import os
import re
from pathlib import Path

CHUNK = 256 * 1024
MAX_BYTES = 4 * 1024 * 1024
_REMINDER = re.compile(r'<system-reminder>.*?</system-reminder>', re.S)
IMAGE_MARK = re.compile(r'\[image: (\S+)\]')
IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'}

_paths: dict[str, Path] = {}
_cache: dict[Path, tuple[int, float, int, list[dict]]] = {}


def find(config_dirs: list[Path], session_id: str) -> Path | None:
    cached = _paths.get(session_id)
    if cached and cached.exists():
        return cached
    for config_dir in config_dirs:
        for path in (config_dir / 'projects').glob(f'*/{session_id}.jsonl'):
            _paths[session_id] = path
            return path
    return None


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    parts = []
    for part in content or []:
        if isinstance(part, dict) and part.get('type') == 'text':
            parts.append(part.get('text', ''))
    return '\n'.join(parts)


def _images_of(content) -> list[dict]:
    """Images in a message: pasted ones (base64) and files sent with the SendUserFile tool."""
    images = []
    for part in content if isinstance(content, list) else []:
        if not isinstance(part, dict):
            continue
        source = part.get('source') or {}
        if part.get('type') == 'image' and source.get('type') == 'base64':
            images.append({'kind': 'base64', 'media_type': source.get('media_type'), 'data': source.get('data')})
        elif part.get('type') == 'tool_use' and part.get('name') == 'SendUserFile':
            for path in (part.get('input') or {}).get('files') or []:
                if Path(path).suffix.lower() in IMAGE_TYPES:
                    images.append({'kind': 'file', 'path': path})
    return images


def to_message(entry: dict) -> dict | None:
    kind = entry.get('type')
    # isCompactSummary: the summary Claude Code injects after compacting, not something the user said.
    if kind not in ('user', 'assistant') or entry.get('isMeta') or entry.get('isCompactSummary'):
        return None
    content = (entry.get('message') or {}).get('content')
    if kind == 'user' and isinstance(content, list) and any(
            isinstance(p, dict) and p.get('type') == 'tool_result' for p in content):
        return None
    text = _REMINDER.sub('', _text_of(content)).strip()
    # Slash-command echoes and harness notices are not part of the conversation.
    if text.startswith('<'):
        return None
    images = _images_of(content)
    # Images the phone attached are sent as "[image: /path]" lines.
    images += [{'kind': 'file', 'path': p} for p in IMAGE_MARK.findall(text)]
    text = IMAGE_MARK.sub('', text).strip()
    if kind == 'assistant' and not text:
        text = next((p.get('input', {}).get('caption', '') for p in content or []
                     if isinstance(p, dict) and p.get('name') == 'SendUserFile'), '')
    if not text and not images:
        return None
    return {'id': entry.get('uuid'), 'role': kind, 'text': text, 'ts': entry.get('timestamp'), 'images': images}


def _parse(lines: list[bytes]) -> list[dict]:
    messages = []
    for line in lines:
        try:
            message = to_message(json.loads(line))
        except ValueError:
            continue
        if message:
            messages.append(message)
    return messages


def tail(path: Path, limit: int = 50) -> list[dict]:
    """Return up to `limit` latest messages, reading only as much of the file as needed."""
    stat = path.stat()
    hit = _cache.get(path)
    if hit and hit[0] == stat.st_size and hit[1] == stat.st_mtime and hit[2] >= limit:
        return hit[3][-limit:]
    with path.open('rb') as f:
        size = stat.st_size
        read = min(size, CHUNK)
        while True:
            f.seek(size - read)
            lines = f.read(read).split(b'\n')
            if read < size:
                lines = lines[1:]  # first line is cut in the middle
            messages = _parse([line for line in lines if line.strip()])
            if len(messages) >= limit or read >= size or read >= MAX_BYTES:
                break
            read = min(size, read * 2, MAX_BYTES)
    _cache[path] = (stat.st_size, stat.st_mtime, limit, messages)
    return messages[-limit:]


def mtime(path: Path | None) -> float:
    try:
        return os.stat(path).st_mtime if path else 0.0
    except OSError:
        return 0.0
