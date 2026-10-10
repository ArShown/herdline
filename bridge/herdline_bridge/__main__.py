"""Usage:
  python -m herdline_bridge serve                 start the HTTP bridge
  python -m herdline_bridge token                 create a new phone token (printed once)
  python -m herdline_bridge contacts              list contacts as JSON
  python -m herdline_bridge handoff <old> <new>   record that <new> session took over <old>
"""
import hashlib
import json
import secrets
import sys

if sys.version_info < (3, 11):
    sys.exit('herdline bridge needs Python 3.11+')

from . import config as config_mod
from .api import Api
from .contacts import record_handoff


def main(argv: list[str]) -> None:
    config = config_mod.load()
    cmd = argv[0] if argv else ''
    if cmd == 'serve':
        from .server import serve
        serve(Api(config))
    elif cmd == 'token':
        token = secrets.token_urlsafe(32)
        config.state_dir.mkdir(parents=True, exist_ok=True)
        # Only the hash stays on this machine; the token lives on the phone.
        config.token_file.write_text(hashlib.sha256(token.encode()).hexdigest())
        config.token_file.chmod(0o600)
        print(token)
    elif cmd == 'contacts':
        print(json.dumps(Api(config).list_contacts(), ensure_ascii=False, indent=2))
    elif cmd == 'handoff' and len(argv) == 3:
        record_handoff(config, argv[1], argv[2])
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
