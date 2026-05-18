# Viniper UI

Viniper UI is a thin local web UI for running Claude Code with an Anthropic-compatible provider such as DeepSeek.

It keeps the original Claude Code execution model: prompts are sent to the Claude Code CLI, tool use remains in Claude Code, and the UI only adds a cleaner chat surface, sessions, permissions, attachments, model switching, context compression hints, and release updates.

## Features

- Thin wrapper around the Claude Code CLI.
- DeepSeek model profile support.
- Session restore on reopen.
- Light and dark themes.
- Permission mode selector.
- Expandable thinking/tool trace panel.
- Attachments saved as files and passed to Claude Code by path, not pasted into chat text.
- Built-in update checking through GitHub Releases.

## Install

Requirements:

- Python 3.10+
- Claude Code CLI available as `claude`
- A compatible provider configured in `~/.claude/settings.json` or environment variables

Windows:

```powershell
python -m pip install -r requirements.txt
python server.py
```

macOS/Linux:

```bash
python3 -m pip install -r requirements.txt
python3 server.py
```

Open:

```text
http://127.0.0.1:17373
```

## Provider Config

Viniper UI reads the same environment style used by Claude Code:

- `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`

Do not commit API keys.

## Updates

Updates are powered by GitHub Releases. A release should upload:

- `ViniperUI-vX.Y.Z.zip`
- `latest.json`

The installed app checks `update_source.json` or `VINIPER_UI_UPDATE_MANIFEST_URL`.

Example `update_source.json`:

```json
{
  "repository": "your-github-name/viniper-ui",
  "manifest_url": "https://github.com/your-github-name/viniper-ui/releases/latest/download/latest.json",
  "channel": "stable"
}
```

Runtime data is stored outside the install directory by default:

- Windows: `%APPDATA%\Viniper UI`
- macOS: `~/Library/Application Support/Viniper UI`
- Linux: `~/.local/share/viniper-ui`

On first launch, Viniper UI migrates any old install-local `data/` folder into this user data directory. The update installer only replaces app files such as `server.py`, `requirements.txt`, `VERSION`, `update_source.json`, `start.bat`, and `static/`. It does not touch sessions, attachments, API keys, or local Claude settings.

## Build A Release

```bash
python scripts/build_release.py --version 0.1.0 --repo your-github-name/viniper-ui
python scripts/verify_release.py
```

Artifacts are written to `dist/`.

If this repository is on GitHub, pushing a tag like `v0.1.1` also triggers `.github/workflows/release.yml`, which builds the update zip and uploads `latest.json` to the GitHub Release.

## Development Notes

This project intentionally stays a thin UI. Do not add an extra agent layer that changes Claude Code behavior. When adding features, keep user data outside release artifacts and update `VERSION` before publishing.
