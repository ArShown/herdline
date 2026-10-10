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

    def close_pane(self, pane: str) -> None:
        self._run(['pane', 'close', pane])

    def close_workspace(self, workspace_id: str) -> None:
        self._run(['workspace', 'close', workspace_id])

    def rename_workspace(self, workspace_id: str, label: str) -> None:
        self._run(['workspace', 'rename', workspace_id, label])

    def create_workspace(self, cwd: str, label: str, env: dict[str, str]) -> tuple[str, str]:
        args = ['workspace', 'create', '--cwd', cwd, '--label', label, '--no-focus']
        for key, value in env.items():
            args += ['--env', f'{key}={value}']
        result = self._json(*args)
        return result['workspace']['workspace_id'], result['root_pane']['pane_id']

    def start_claude(self, name: str, pane: str, claude_args: list[str]) -> str:
        """Start Claude Code in the pane; returns its status (blocked if a dialog is waiting)."""
        try:
            agent = self._json('agent', 'start', name, '--kind', 'claude', '--pane', pane, '--', *claude_args)['agent']
            return agent.get('agent_status', 'unknown')
        except HerdrError as e:
            # e.g. the folder-trust dialog; the phone answers it from the screen view.
            if e.code == 'agent_not_ready':
                return 'blocked'
            raise
