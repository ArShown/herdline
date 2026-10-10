import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(os.environ.get('HERDLINE_CONFIG', '~/.config/herdline/config.toml')).expanduser()


def _claude_dirs() -> list[Path]:
    # ~/.claude plus any ~/.claude-* used as CLAUDE_CONFIG_DIR for another account.
    home = Path.home()
    return [d for d in [home / '.claude', *sorted(home.glob('.claude-*'))] if (d / 'projects').is_dir()]


@dataclass
class Config:
    host: str = '127.0.0.1'
    port: int = 8787
    # Claude Code config directories whose projects/ hold session transcripts.
    config_dirs: list[Path] = field(default_factory=_claude_dirs)
    # Where the status line writes <session_id>.json with used_percentage.
    context_dir: Path = Path('~/.claude/state/ctx').expanduser()
    state_dir: Path = Path('~/.local/state/herdline').expanduser()
    # Workspace label -> name shown on the phone.
    aliases: dict[str, str] = field(default_factory=dict)
    # Folder every space opened from the phone starts in; unset disables opening spaces.
    space_cwd: Path | None = None
    # Account name -> JSON with seven_day.used_percentage; a new space uses the account with most left.
    usage_files: dict[str, Path] = field(default_factory=dict)
    # Command whose one-line output is shown above the list (e.g. the one in herdr's tab_bar_right).
    usage_command: str | None = None
    # Arguments for `claude` when the phone opens a new space.
    claude_args: list[str] = field(default_factory=lambda: ['--permission-mode', 'auto'])

    # Config directory name (e.g. "claude-b") -> label shown on the phone.
    account_labels: dict[str, str] = field(default_factory=dict)

    @property
    def accounts(self) -> dict[str, Path]:
        """Account name -> Claude Code config directory."""
        return {d.name.lstrip('.'): d for d in self.config_dirs}

    def account_of(self, transcript: Path | None) -> str | None:
        """Label of the account whose config directory holds this transcript."""
        for name, directory in self.accounts.items():
            if transcript and transcript.is_relative_to(directory):
                return self.account_labels.get(name, name)
        return None

    @property
    def token_file(self) -> Path:
        return self.state_dir / 'token.sha256'

    @property
    def successors_file(self) -> Path:
        return self.state_dir / 'successors.json'


def load(path: Path = DEFAULT_PATH) -> Config:
    if not path.exists():
        return Config()
    raw = tomllib.loads(path.read_text())
    config = Config()
    for key in ('host', 'port'):
        if key in raw:
            setattr(config, key, raw[key])
    for key in ('context_dir', 'state_dir'):
        if key in raw:
            setattr(config, key, Path(raw[key]).expanduser())
    if 'config_dirs' in raw:
        config.config_dirs = [Path(p).expanduser() for p in raw['config_dirs']]
    if 'space_cwd' in raw:
        config.space_cwd = Path(raw['space_cwd']).expanduser()
    config.usage_files = {k: Path(v).expanduser() for k, v in raw.get('usage_files', {}).items()}
    config.usage_command = raw.get('usage_command')
    if 'claude_args' in raw:
        config.claude_args = list(raw['claude_args'])
    config.aliases = dict(raw.get('aliases', {}))
    config.account_labels = dict(raw.get('account_labels', {}))
    return config
