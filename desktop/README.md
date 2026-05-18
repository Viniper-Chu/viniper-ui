# Viniper UI Desktop

This folder is the first desktop shell for Viniper UI. It keeps the current thin web UI and local Claude Code bridge, then wraps it in an Electron window with tray/background behavior.

## Development

```bash
cd desktop
npm install
npm start
```

The desktop shell starts `../server.py` with `VINIPER_UI_OPEN_BROWSER=0`, waits for `http://127.0.0.1:17373/api/status`, and loads the existing UI into the app window.

## Build

```bash
cd desktop
npm install
npm run dist
```

Build output is written to `desktop/release/`.

## Notes

- User data remains in the normal Viniper UI data directory, not inside the app bundle.
- The window close button hides the app to the tray; the tray menu contains Quit.
- The desktop shell is intentionally thin. Claude Code execution, permissions, skills, sessions, model selection, updates, and attachments still live in the existing local service.
