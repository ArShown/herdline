# herdline

Chat with the Claude Code sessions running in your [herdr](https://herdr.dev) panes from your phone, like a messenger contact list. One contact per herdr workspace; when a session hands off to a new one, the contact follows it.

- `bridge/` – Python (standard library only) HTTP bridge on the Mac. Reads session transcripts, sends prompts through herdr.
- `app/` – Expo / React Native client.

## Bridge

```sh
mkdir -p ~/.config/herdline && cp bridge/config.example.toml ~/.config/herdline/config.toml
python3 -m herdline_bridge token      # run inside bridge/; prints the phone token once, stores only its hash
pm2 start ecosystem.config.cjs
```

Keep it bound to `127.0.0.1` and expose it to your tailnet with HTTPS: `tailscale serve --bg 8787`. The app then connects to `https://<mac>.<tailnet>.ts.net`.

Endpoints (all need `Authorization: Bearer <token>`): `GET /api/contacts`, `GET|POST /api/contacts/<id>/messages`, `GET /api/contacts/<id>/screen`, `POST /api/contacts/<id>/keys`.

### Context usage

The bridge shows how full each session's context is. Make your Claude Code status line script write it:

```sh
sid=$(echo "$input" | jq -r '.session_id // empty')
ctx=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
[ -n "$sid" ] && [ -n "$ctx" ] && echo "{\"used_percentage\":$ctx}" > ~/.claude/state/ctx/$sid.json
```

### Handoff

When a new session takes over from an old one in the same workspace, the bridge picks the one that talked most recently. Record it explicitly to be sure:

```sh
python3 -m herdline_bridge handoff <old_session_id> <new_session_id>
```

### Tests

```sh
cd bridge && python3 -m unittest
```

## App

```sh
cd app && npm install && npm run typecheck
```
