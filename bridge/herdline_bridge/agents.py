"""Agents a session has dispatched: its Claude Code subagents, and coding agents running in its workspace."""
import json
import time
from pathlib import Path

# Only agents active this recently are listed; older ones are finished or were cut off.
RECENT_SECONDS = 3 * 60 * 60
# Still unfinished but silent this long: shown as quiet rather than working.
QUIET_SECONDS = 10 * 60
TAIL_BYTES = 128 * 1024
SUMMARY_CHARS = 160
# herdr statuses of a coding agent pane, as the phone shows them.
_PANE_STATES = {'working': 'working', 'blocked': 'blocked', 'idle': 'done', 'done': 'done'}


def _first_line(path: Path) -> dict:
    try:
        with path.open('rb') as f:
            return json.loads(f.readline())
    except (OSError, ValueError):
        return {}


def _last_turn(path: Path) -> tuple[dict | None, str]:
    """The last user/assistant entry, and the last text the agent wrote."""
    size = path.stat().st_size
    with path.open('rb') as f:
        f.seek(max(0, size - TAIL_BYTES))
        lines = f.read().split(b'\n')
    if size > TAIL_BYTES:
        lines = lines[1:]  # first line is cut in the middle
    last, said = None, ''
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get('type') not in ('user', 'assistant'):
            continue
        last = last or entry
        content = (entry.get('message') or {}).get('content')
        if entry['type'] == 'assistant' and isinstance(content, list):
            said = '\n'.join(p.get('text', '') for p in content if isinstance(p, dict) and p.get('type') == 'text').strip()
            if said:
                break
    return last, said


def _finished(entry: dict | None) -> bool:
    """The agent ended its turn with a reply and is not waiting on a tool."""
    if not entry or entry.get('type') != 'assistant':
        return False
    message = entry.get('message') or {}
    content = message.get('content')
    parts = content if isinstance(content, list) else []
    return message.get('stop_reason') == 'end_turn' and not any(
        isinstance(p, dict) and p.get('type') == 'tool_use' for p in parts)


def subagents(transcript: Path, now: float | None = None) -> list[dict]:
    """Subagents of the session whose transcript this is, active within RECENT_SECONDS."""
    now = now or time.time()
    folder = transcript.with_suffix('') / 'subagents'
    rows = []
    for path in folder.glob('agent-*.jsonl'):
        try:
            modified = path.stat().st_mtime
        except OSError:
            continue
        if now - modified > RECENT_SECONDS:
            continue
        agent_id = path.stem[len('agent-'):]
        try:
            meta = json.loads(path.with_suffix('.meta.json').read_text())
        except (OSError, ValueError):
            meta = {}
        last, said = _last_turn(path)
        if _finished(last):
            state = 'done'
        else:
            state = 'working' if now - modified < QUIET_SECONDS else 'quiet'
        rows.append({
            'id': agent_id,
            'kind': 'subagent',
            'name': meta.get('name') or meta.get('agentType') or agent_id,
            'type': meta.get('agentType'),
            'description': meta.get('description'),
            'parent': meta.get('parentAgentId'),
            'state': state,
            'started': _first_line(path).get('timestamp'),
            'active': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(modified)),
            'summary': said[:SUMMARY_CHARS] + ('…' if len(said) > SUMMARY_CHARS else ''),
        })
    return rows


def coding_agents(agents: list[dict], workspace_id: str) -> list[dict]:
    """Agents other than Claude running in the workspace, e.g. codex panes a session opened for a task."""
    return [{
        'id': a.get('pane_id'),
        'kind': a.get('agent'),
        'name': a.get('name') or a.get('pane_id'),
        'type': a.get('agent'),
        'description': None,
        'parent': None,
        'state': _PANE_STATES.get(a.get('agent_status'), 'quiet'),
        'started': None,
        'active': None,
        'summary': '',
    } for a in agents if a.get('workspace_id') == workspace_id and a.get('agent') not in (None, 'claude')]


_ORDER = {'blocked': 0, 'working': 1, 'quiet': 2, 'done': 3}


def overview(transcript: Path | None, agents: list[dict], workspace_id: str) -> list[dict]:
    """Every listed agent once, each followed by the agents it dispatched (`depth` counts the levels)."""
    rows = (subagents(transcript) if transcript else []) + coding_agents(agents, workspace_id)
    by_id = {r['id']: r for r in rows}
    children: dict[str, list[dict]] = {}
    roots = []
    for row in rows:
        if row['parent'] in by_id:
            children.setdefault(row['parent'], []).append(row)
        else:
            roots.append(row)
    ordered: list[dict] = []

    def add(row: dict, depth: int, parent_done: bool) -> None:
        # Once the dispatching agent has finished, nothing under it is still going.
        if parent_done and row['state'] == 'quiet':
            row['state'] = 'done'
        ordered.append({**row, 'depth': depth})
        for child in sorted(children.get(row['id'], []), key=lambda r: r['started'] or ''):
            add(child, depth + 1, row['state'] == 'done')

    for root in sorted(roots, key=lambda r: (_ORDER.get(r['state'], 9), r['started'] or '')):
        add(root, 0, False)
    return ordered
