# herdline

Chat with the Claude Code sessions running in your [herdr](https://herdr.dev) panes from your phone, like a messenger contact list. One contact per herdr workspace; when a session hands off to a new one, the contact follows it.

- `bridge/` – Python (standard library only) HTTP bridge on the Mac. Reads session transcripts, sends prompts through herdr.
- `app/` – Expo / React Native client.

## Bridge

```sh
mkdir -p ~/.config/herdline && cp bridge/config.example.toml ~/.config/herdline/config.toml
python3 -m herdline_bridge token      # run inside bridge/; prints the phone token once, stores only its hash
HERDLINE_PYTHON=$(command -v python3.11) pm2 start ecosystem.config.cjs && pm2 save
```

Keep it bound to `127.0.0.1` and expose it to your tailnet with HTTPS: `tailscale serve --bg 8787`. The app then connects to `https://<mac>.<tailnet>.ts.net`. The first run asks you to enable Serve for the tailnet, and Tailscale then fetches a certificate from Let's Encrypt; a VPN that captures all traffic blocks that, so disconnect it until the first request succeeds.

Run the `token` command in a plain terminal, not through an agent session, so the token does not end up in a transcript.

Endpoints (all need `Authorization: Bearer <token>`):

- `GET /api/contacts` – spaces, usage line, and `away` when `away_flag` exists
- `POST /api/spaces` – open a new space
- `GET /api/contacts/<id>/messages?limit=50[&before=<message id>]` – latest messages, or the page before a message
- `POST /api/contacts/<id>/messages` – send text, images and files
- `GET /api/contacts/<id>/agents` – agents the conversation dispatched: its subagents active in the last three hours (nested under the agent that started them) and non-Claude agents, such as codex, running in the same workspace
- `POST /api/contacts/<id>/run` – run one shell command in the session, as `!` does at the computer (one line, only while the session is idle; a message starting with `!` takes the same path). Its output shows in the messages
- `GET /api/contacts/<id>/screen`, `POST /api/contacts/<id>/keys` – see the terminal and answer a dialog
- `POST /api/contacts/<id>/exit` – end the session and delete its uploads
- `GET /api/images/<id>` – an image listed in a message

The phone shows a run button on single-line `! command` suggestions in replies; it asks before running. The bridge token can now run shell commands, so keep the bridge on the tailnet only.

Only user turns typed by a person are shown as yours; messages from other sessions and task notices are left out.

### Spaces opened from the phone

A space opened from the phone starts Claude Code with `HERDLINE=1`. To set something up only for those sessions without sending a first message (the space takes its name from your first message), add a `SessionStart` hook that checks it:

```sh
[ "$HERDLINE" = "1" ] || exit 0
echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}'
```

### Images Claude sends

Images sent with `SendUserFile` are read from their path when the phone asks for them. If the session deletes the file soon after (a scratch folder, say), keep a copy at send time with a `PostToolUse` hook on `SendUserFile`:

```sh
PYTHONPATH=/path/to/herdline/bridge python3.11 -m herdline_bridge keep-sent
```

Copies go to `<state_dir>/sent/<session>/` and are removed when you end the conversation from the phone.

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

To fix the bridge address in the build, put it in `app/.env.local` (not committed); the token is still entered once on the phone:

```sh
EXPO_PUBLIC_HERDLINE_URL=https://<mac>.<tailnet>.ts.net
```

The app is on Expo SDK 56 so it builds with Xcode 26; SDK 57 needs Xcode 27.

### Install on an iPhone

No Expo Go: build a release app with Xcode and install it over USB. A free Apple ID works; sign in once under Xcode → Settings → Accounts.

```sh
cd app
npm run prebuild:ios -- --clean        # only after adding a native module
xcodebuild -workspace ios/Herdline.xcworkspace -scheme Herdline -configuration Release \
  -destination 'id=<iPhone UDID>' -derivedDataPath ios/build \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<team id> CODE_SIGN_STYLE=Automatic build
xcrun devicectl device install app --device <device id> ios/build/Build/Products/Release-iphoneos/Herdline.app
```

`xcrun devicectl list devices` shows the device id, and `xcrun devicectl device info details --device <device id>` shows the UDID. On the phone, trust the developer once under Settings → General → VPN & Device Management.
