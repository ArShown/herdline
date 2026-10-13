"""A contact is a herdr workspace; its on-duty session is the main Claude pane there."""
import json
import re
from dataclasses import dataclass
from pathlib import Path

from . import transcripts
from .config import Config
from .herdr import Herdr


# A space opened from the phone is called "Space N" until its session gets a task title.
AUTO_NAME = re.compile(r'Space \d+')
UNSET_TITLES = {'', 'claude code'}


@dataclass
class Contact:
    id: str  # herdr workspace id; stays the same when the space is renamed
    name: str
    workspace_id: str
    session_id: str
    pane: str
    status: str
    title: str | None


def load_successors(config: Config) -> dict[str, str]:
    try:
        return json.loads(config.successors_file.read_text())
    except (OSError, ValueError):
        return {}


def record_handoff(config: Config, old_session: str, new_session: str) -> None:
    successors = load_successors(config)
    successors[old_session] = new_session
    config.state_dir.mkdir(parents=True, exist_ok=True)
    config.successors_file.write_text(json.dumps(successors, indent=2))


def _on_duty(agents: list[dict], successors: dict[str, str], config: Config) -> dict:
    sessions = {a['agent_session']['value'] for a in agents}
    # An explicit handoff record wins: drop any session whose successor is here.
    remaining = [a for a in agents if successors.get(a['agent_session']['value']) not in sessions]
    if len(remaining) == 1:
        return remaining[0]
    # Otherwise the session that talked most recently.
    return max(remaining or agents, key=lambda a: transcripts.mtime(
        transcripts.find(config.config_dirs, a['agent_session']['value'])))


def _latest(config: Config, session_id: str) -> str:
    """Follow the conversation when Claude carried it on in a new session; herdr keeps the old id."""
    seen = {session_id}
    while True:
        nxt = transcripts.continued_in(transcripts.find(config.config_dirs, session_id))
        if not nxt or nxt in seen or not transcripts.find(config.config_dirs, nxt):
            return session_id
        seen.add(nxt)
        session_id = nxt


def resolve_all(herdr: Herdr, config: Config) -> list[Contact]:
    labels = {w['workspace_id']: w.get('label') or w['workspace_id'] for w in herdr.workspaces()}
    by_workspace: dict[str, list[dict]] = {}
    for agent in herdr.agents():
        if agent.get('agent') == 'claude' and agent.get('agent_session', {}).get('value'):
            by_workspace.setdefault(agent['workspace_id'], []).append(agent)
    successors = load_successors(config)
    contacts = []
    for workspace_id, agents in by_workspace.items():
        agent = _on_duty(agents, successors, config)
        label = labels.get(workspace_id, workspace_id)
        title = (agent.get('terminal_title_stripped') or '').strip()
        if AUTO_NAME.fullmatch(label) and title.lower() not in UNSET_TITLES:
            # Like the Claude app: once the session knows its task, the space takes that name.
            herdr.rename_workspace(workspace_id, title)
            label = title
        contacts.append(Contact(
            id=workspace_id,
            name=config.aliases.get(label, label),
            workspace_id=workspace_id,
            session_id=_latest(config, agent['agent_session']['value']),
            pane=agent['pane_id'],
            status=agent.get('agent_status', 'unknown'),
            title=agent.get('terminal_title_stripped'),
        ))
    return sorted(contacts, key=lambda c: c.name)


def context_used(config: Config, session_id: str) -> int | None:
    try:
        return json.loads((config.context_dir / f'{session_id}.json').read_text())['used_percentage']
    except (OSError, ValueError, KeyError):
        return None


def transcript(config: Config, contact: Contact) -> Path | None:
    return transcripts.find(config.config_dirs, contact.session_id)
