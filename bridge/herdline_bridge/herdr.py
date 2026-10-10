"""The only module that talks to herdr; swap it to support another multiplexer."""
import json
import subprocess


class HerdrError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _run(args: list[str]) -> str:
    done = subprocess.run(['herdr', *args], capture_output=True, text=True, timeout=30)
    if done.returncode != 0:
        try:
            error = json.loads(done.stdout or done.stderr)['error']
            raise HerdrError(error.get('code', 'unknown'), error.get('message', ''))
        except (ValueError, KeyError, TypeError):
            raise HerdrError('unknown', (done.stderr or done.stdout).strip()) from None
    return done.stdout


class Herdr:
    def __init__(self, run=_run):
        self._run = run

    def _json(self, *args: str) -> dict:
        return json.loads(self._run(list(args)))['result']

    def agents(self) -> list[dict]:
        return self._json('agent', 'list')['agents']

    def workspaces(self) -> list[dict]:
        return self._json('workspace', 'list')['workspaces']

    def prompt(self, pane: str, text: str) -> None:
        # Returns once the text is submitted; callers poll for the reply.
        self._run(['agent', 'prompt', pane, text])

    def screen(self, pane: str, lines: int = 40) -> str:
        return self._run(['agent', 'read', pane, '--source', 'visible', '--lines', str(lines)])

    def send_keys(self, pane: str, keys: list[str]) -> None:
        self._run(['agent', 'send-keys', pane, *keys])
