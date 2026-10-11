"""Request handling, kept apart from the HTTP server so it can be tested directly."""
import base64
import hashlib
import hmac
import json
import re
import secrets
import shutil
import shlex
import subprocess
import time
from pathlib import Path
from urllib.parse import unquote

from . import contacts as contacts_mod
from . import transcripts
from .config import Config
from .herdr import Herdr, HerdrError

USAGE_TTL = 60
EXIT_WAIT_STEPS = 10
EXIT_WAIT_SECONDS = 0.5
MAX_ATTACHMENTS = 6
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_FILE_BYTES = 20 * 1024 * 1024
# Images the phone may fetch: only those the bridge itself listed, newest kept.
IMAGE_REGISTRY_SIZE = 500

# Keys the phone may press in a pane: enough to answer a confirmation dialog.
ALLOWED_KEYS = {'enter', 'esc', 'up', 'down', 'tab', 'y', 'n', *map(str, range(1, 10))}


class Binary:
    def __init__(self, data: bytes, content_type: str):
        self.data = data
        self.content_type = content_type


class Api:
    def __init__(self, config: Config, herdr: Herdr | None = None):
        self.config = config
        self.herdr = herdr or Herdr()
        self._usage: tuple[float, str | None] | None = None
        self._images: dict[str, dict] = {}

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
        if len(parts) == 3 and parts[:2] == ['api', 'images'] and method == 'GET':
            return self.image(parts[2])
        if parts[:2] != ['api', 'contacts']:
            return 404, {'error': 'not_found'}
        if len(parts) == 2 and method == 'GET':
            return 200, {'contacts': self.list_contacts(), 'usage': self.usage()}
        if len(parts) != 4:
            return 404, {'error': 'not_found'}
        contact = self._find(parts[2])
        if contact is None:
            return 404, {'error': 'contact_not_found'}
        route = (method, parts[3])
        if route == ('GET', 'messages'):
            return 200, self.messages(contact, int(query.get('limit', 50)))
        if route == ('POST', 'messages'):
            body = body or {}
            return self.send(contact, body.get('text', ''), body.get('images') or [], body.get('files') or [])
        if route == ('GET', 'screen'):
            return 200, {'text': self.herdr.screen(contact.pane)}
        if route == ('POST', 'keys'):
            return self.keys(contact, (body or {}).get('keys', []))
        if route == ('POST', 'exit'):
            return self.exit(contact, bool((body or {}).get('force')))
        return 404, {'error': 'not_found'}

    def usage(self) -> str | None:
        """Output of usage_command, refreshed at most once a minute."""
        if not self.config.usage_command:
            return None
        now = time.monotonic()
        if self._usage and now - self._usage[0] < USAGE_TTL:
            return self._usage[1]
        try:
            done = subprocess.run(shlex.split(self.config.usage_command), capture_output=True, text=True, timeout=10)
            text = done.stdout.strip() or None
        except (OSError, subprocess.TimeoutExpired):
            text = self._usage[1] if self._usage else None
        self._usage = (now, text)
        return text

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
                'account': self.config.account_of(path),
                'preview': self._public(last[-1], with_images=False) if last else None,
            })
        return rows

    def messages(self, contact, limit: int) -> dict:
        path = contacts_mod.transcript(self.config, contact)
        return {
            'status': contact.status,
            'session_id': contact.session_id,
            'account': self.config.account_of(path),
            'messages': [self._public(m, contact.session_id) for m in transcripts.tail(path, min(limit, 200))] if path else [],
        }

    def _public(self, message: dict, session_id: str | None = None, with_images: bool = True) -> dict:
        """A message as the phone sees it: images become URLs it may fetch."""
        out = {k: v for k, v in message.items() if k != 'images'}
        images = message.get('images') or []
        if with_images:
            out['images'] = [self._register(image, session_id) for image in images]
        elif not out['text']:
            out['text'] = '[圖片]' if images else '[檔案] ' + ', '.join(message.get('files') or [])
        return out

    def _register(self, image: dict, session_id: str | None = None) -> str:
        key = image.get('path') or image.get('data', '')
        image_id = hashlib.sha256(key.encode()).hexdigest()[:24]
        self._images.pop(image_id, None)
        self._images[image_id] = {**image, 'session': session_id}
        while len(self._images) > IMAGE_REGISTRY_SIZE:
            self._images.pop(next(iter(self._images)))
        return f'/api/images/{image_id}'

    def image(self, image_id: str) -> tuple[int, object]:
        image = self._images.get(image_id)
        if image is None:
            return 404, {'error': 'not_found'}
        if image['kind'] == 'base64':
            try:
                return 200, Binary(base64.b64decode(image['data']), image.get('media_type') or 'image/png')
            except (ValueError, TypeError):
                return 404, {'error': 'not_found'}
        path = Path(image['path'])
        content_type = transcripts.IMAGE_TYPES.get(path.suffix.lower())
        if content_type is None or not path.is_file():
            return 404, {'error': 'not_found'}
        return 200, Binary(path.read_bytes(), content_type)

    def _uploads(self, session_id: str) -> Path:
        # One folder per conversation, removed when the conversation exits.
        return self.config.state_dir / 'uploads' / session_id

    def _save_upload(self, session_id: str, encoded: str, name: str, limit: int) -> Path | None:
        try:
            data = base64.b64decode(encoded or '', validate=True)
        except (ValueError, TypeError):
            return None
        if not data or len(data) > limit:
            return None
        uploads = self._uploads(session_id)
        uploads.mkdir(parents=True, exist_ok=True)
        # Keep the original name readable but safe: no folders, no spaces.
        safe = re.sub(r'[^\w.\-]+', '_', Path(name).name).strip('._') or 'file'
        path = uploads / f'{transcripts.UPLOAD_PREFIX_FORMAT.format(time.strftime("%Y%m%d-%H%M%S"), secrets.token_hex(4))}{safe}'
        path.write_bytes(data)
        return path

    def _save_image(self, session_id: str, image: dict) -> Path | None:
        ext = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/heic': '.heic', 'image/webp': '.webp'}.get(image.get('type'))
        return self._save_upload(session_id, image.get('data'), f'image{ext}', MAX_IMAGE_BYTES) if ext else None

    def send(self, contact, text: str, images: list[dict], files: list[dict]) -> tuple[int, dict]:
        text = text.strip()
        if not text and not images and not files:
            return 400, {'error': 'empty_text'}
        if len(images) + len(files) > MAX_ATTACHMENTS:
            return 400, {'error': 'too_many_attachments'}
        session = contact.session_id
        image_paths = [self._save_image(session, image) for image in images]
        file_paths = [self._save_upload(session, f.get('data'), f.get('name') or 'file', MAX_FILE_BYTES) for f in files]
        if None in image_paths or None in file_paths:
            return 400, {'error': 'bad_attachment'}
        # The session reads attachments from these paths.
        text = '\n'.join([text, *(f'[image: {p}]' for p in image_paths), *(f'[file: {p}]' for p in file_paths)]).strip()
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

    def exit(self, contact, force: bool) -> tuple[int, dict]:
        """End the conversation: let Claude Code quit cleanly, then close what is left of the space."""
        if contact.status == 'working' and not force:
            return 409, {'error': 'busy'}
        try:
            self.herdr.prompt(contact.pane, '/exit')
        except HerdrError:
            pass  # a blocked or stuck session is closed with its pane below
        session = contact.session_id
        for _ in range(EXIT_WAIT_STEPS):
            if not any(a.get('agent_session', {}).get('value') == session for a in self.herdr.agents()):
                break
            time.sleep(EXIT_WAIT_SECONDS)
        # Other agents (e.g. coding agents started from this space) keep running; only then keep the space.
        others = [a for a in self.herdr.agents()
                  if a.get('workspace_id') == contact.workspace_id and a.get('pane_id') != contact.pane]
        if others:
            try:
                self.herdr.close_pane(contact.pane)
            except HerdrError:
                pass
            closed = 'pane'
        else:
            self.herdr.close_workspace(contact.workspace_id)
            closed = 'space'
        self._clean_up(session)
        return 200, {'closed': closed}

    def _clean_up(self, session_id: str) -> None:
        """Drop what the bridge kept for an ended conversation: uploaded files and cached data."""
        uploads = self._uploads(session_id)
        shutil.rmtree(uploads, ignore_errors=True)
        for image_id, image in list(self._images.items()):
            if image.get('session') == session_id or str(image.get('path', '')).startswith(str(uploads)):
                del self._images[image_id]
        transcripts.forget(session_id)

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
