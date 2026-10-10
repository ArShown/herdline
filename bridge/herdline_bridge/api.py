"""Request handling, kept apart from the HTTP server so it can be tested directly."""
import hashlib
import hmac
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
