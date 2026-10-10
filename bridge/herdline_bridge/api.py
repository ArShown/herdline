"""Request handling, kept apart from the HTTP server so it can be tested directly."""
import hashlib
import hmac
import json
import secrets
from pathlib import Path
from urllib.parse import unquote

from . import contacts as contacts_mod
from . import transcripts
from .config import Config
from .herdr import Herdr, HerdrError

# Keys the phone may press in a pane: enough to answer a confirmation dialog.
ALLOWED_KEYS = {'enter', 'esc', 'up', 'down', 'tab', 'y', 'n', *map(str, range(1, 10))}


class Api:
    def __init__(self, config: Config, herdr: Herdr | None = None):
        self.config = config
        self.herdr = herdr or Herdr()

    def authorized(self, header: str | None) -> bool:
        try:
            expected = self.config.token_file.read_text().strip()
        except OSError:
            return False
        if not expected or not header or not header.startswith('Bearer '):
            return False
        given = hashlib.sha256(header[len('Bearer '):].encode()).hexdigest()
        return hmac.compare_digest(given, expected)

    def handle(self, method: str, path: str, query: dict, body: dict | None) -> tuple[int, dict]:
        parts = [unquote(p) for p in path.strip('/').split('/')]
        if parts == ['api', 'spaces'] and method == 'POST':
            return self.create_space()
        if parts[:2] != ['api', 'contacts']:
            return 404, {'error': 'not_found'}
        if len(parts) == 2 and method == 'GET':
            return 200, {'contacts': self.list_contacts()}
        if len(parts) != 4:
            return 404, {'error': 'not_found'}
        contact = self._find(parts[2])
        if contact is None:
            return 404, {'error': 'contact_not_found'}
        route = (method, parts[3])
        if route == ('GET', 'messages'):
            return 200, self.messages(contact, int(query.get('limit', 50)))
        if route == ('POST', 'messages'):
            return self.send(contact, (body or {}).get('text', ''))
        if route == ('GET', 'screen'):
            return 200, {'text': self.herdr.screen(contact.pane)}
        if route == ('POST', 'keys'):
            return self.keys(contact, (body or {}).get('keys', []))
        return 404, {'error': 'not_found'}

    def _find(self, contact_id: str):
        for contact in contacts_mod.resolve_all(self.herdr, self.config):
            if contact.id == contact_id:
                return contact
        return None

    def list_contacts(self) -> list[dict]:
        rows = []
        for contact in contacts_mod.resolve_all(self.herdr, self.config):
            path = contacts_mod.transcript(self.config, contact)
            last = transcripts.tail(path, 1) if path else []
            rows.append({
                'id': contact.id,
                'name': contact.name,
                'status': contact.status,
                'title': contact.title,
                'context_used': contacts_mod.context_used(self.config, contact.session_id),
                'preview': last[-1] if last else None,
            })
        return rows

    def messages(self, contact, limit: int) -> dict:
        path = contacts_mod.transcript(self.config, contact)
        return {
            'status': contact.status,
            'session_id': contact.session_id,
            'messages': transcripts.tail(path, min(limit, 200)) if path else [],
        }

    def send(self, contact, text: str) -> tuple[int, dict]:
        text = text.strip()
        if not text:
            return 400, {'error': 'empty_text'}
        try:
            self.herdr.prompt(contact.pane, text)
        except HerdrError as e:
            # agent_blocked: the session waits on a dialog; the phone shows the screen instead.
            return 409, {'error': e.code, 'message': str(e)}
        return 202, {'accepted': True, 'session_id': contact.session_id}

    def keys(self, contact, keys: list[str]) -> tuple[int, dict]:
        if not keys or any(k not in ALLOWED_KEYS for k in keys):
            return 400, {'error': 'key_not_allowed', 'allowed': sorted(ALLOWED_KEYS)}
        self.herdr.send_keys(contact.pane, keys)
        return 200, {'sent': keys}

    def _pick_account(self) -> str | None:
        """The account with the most weekly quota left, per the usage files the status line writes."""
        used = {}
        for name, path in self.config.usage_files.items():
            try:
                used[name] = json.loads(path.read_text())['seven_day']['used_percentage']
            except (OSError, ValueError, KeyError, TypeError):
                continue
        candidates = [n for n in self.config.accounts if n in used]
        if candidates:
            return min(candidates, key=lambda n: used[n])
        return next(iter(self.config.accounts), None)

    def create_space(self) -> tuple[int, dict]:
        """Open a new space in the configured folder; the bridge picks the name and account."""
        if self.config.space_cwd is None:
            return 400, {'error': 'space_cwd_not_set'}
        labels = {w.get('label') for w in self.herdr.workspaces()}
        number = 1
        while f'Space {number}' in labels:
            number += 1
        name = f'Space {number}'
        account = self._pick_account()
        env = {}
        config_dir = self.config.accounts.get(account) if account else None
        if config_dir and config_dir != Path.home() / '.claude':
            env['CLAUDE_CONFIG_DIR'] = str(config_dir)
        workspace_id, pane = self.herdr.create_workspace(str(self.config.space_cwd), name, env)
        status = self.herdr.start_claude(f'space-{number}-{secrets.token_hex(2)}', pane, self.config.claude_args)
        return 201, {'id': workspace_id, 'name': name, 'status': status, 'account': account}
