# Command-line reference

`nippletuner` controls NippleTuner from a terminal, a script or a keyboard shortcut: switch profiles, turn tuning off and on, show the window, and so on.

← [Back to README](../README.md) · [Quick start guide](quick-start.md)

---

## Setup

The command is `bin/nippletuner` in the project folder (it runs `dist/cli.cjs`, so run `npm run build` first). To use it from anywhere:

```sh
bin/nippletuner install-cli
```

This links it into `~/.local/bin/nippletuner`. That folder is usually on your `PATH` once you've logged out and back in.

`nippletuner` needs Node.js 18+. It finds Node even when started from a hotkey or launcher, where your shell's `PATH` (for example nvm's) isn't loaded.

## Commands

| Command | What it does |
|---|---|
| `nippletuner status` | Shows what's applied, the device in use, whether a test is running, and whether the window is open. |
| `nippletuner list` | Lists saved profiles, numbered. `*` marks the applied one. |
| `nippletuner apply <profile>` | Applies a profile (`set` works too). See [Choosing a profile](#choosing-a-profile). |
| `nippletuner next` | Applies the next profile in the list (wraps around). |
| `nippletuner prev` | Applies the previous profile. |
| `nippletuner toggle` | Turns off if a profile is applied; otherwise re-applies the last one. |
| `nippletuner off` | Stops applying any profile; the TrackPoint goes back to normal. |
| `nippletuner show` | Shows the window. Starts NippleTuner first if it isn't running. |
| `nippletuner hide` | Hides the window (NippleTuner keeps running in the tray). |
| `nippletuner toggle-window` | Shows or hides the window. |
| `nippletuner start` | Starts NippleTuner in the tray, if it isn't already running. |
| `nippletuner quit` | Quits NippleTuner. |
| `nippletuner install-cli` | Links the command into `~/.local/bin`. |
| `nippletuner help` | Prints the command list. |

### Options

| Option | Effect |
|---|---|
| `--quiet` | Don't show a desktop notification for the change. By default, profile changes pop up a short notification from the tray, which is handy with hotkeys. |
| `--json` | Print a machine-readable result: `{"ok": true, "message": "...", "data": ...}`. |

The exit code is `0` on success and `1` on failure, for example an unknown profile.

### Choosing a profile

A profile can be given as:

- its **number** from `nippletuner list`, for example `nippletuner apply 2`
- its **name**, exact or any letter case: `nippletuner apply gaming`
- the **start of its name**, as long as only one profile matches: `nippletuner apply gam`

Names with spaces work without quotes: `nippletuner apply Night Mode`. If the start of a name matches several profiles, NippleTuner says which ones, so you can be more specific.

## When NippleTuner isn't running

The CLI talks to the running app. If it isn't running:

- **With the background service on** (Preferences → *Keep Applied Profile Running When Closed*): `apply`, `next`, `prev`, `toggle` and `off` still work. They update what the service applies, so hotkeys keep working with the app closed.
- **Without the service:** profile commands explain that there's nothing to change, and suggest `nippletuner start` or turning the service on.
- `status` and `list` always work. `show` starts the app.

## Hotkeys

On **Cinnamon** (Linux Mint):

1. Open **System Settings → Keyboard → Shortcuts → Custom Shortcuts** and click **Add custom shortcut**.
2. Give it a name, for example *Next TrackPoint profile*, and the command `nippletuner next`. If you didn't run `install-cli`, use the full path, `/path/to/NippleTuner/bin/nippletuner next`.
3. Click the shortcut's binding and press the keys you want.

Other desktops (GNOME, KDE, XFCE) have the same idea under *Keyboard → Shortcuts*.

Suggested bindings:

| Keys (example) | Command |
|---|---|
| <kbd>Super</kbd>+<kbd>F9</kbd> | `nippletuner prev` |
| <kbd>Super</kbd>+<kbd>F10</kbd> | `nippletuner next` |
| <kbd>Super</kbd>+<kbd>F11</kbd> | `nippletuner toggle` |
| <kbd>Super</kbd>+<kbd>F12</kbd> | `nippletuner toggle-window` |

## Examples

```sh
# Cycle profiles silently
nippletuner next --quiet

# Apply a profile when an app starts, and turn tuning off when it closes
nippletuner apply Gaming && some-game; nippletuner off

# Get the applied profile's name in a script
nippletuner status --json | jq -r '.data.applied.name // "none"'
```

## How it works

The app listens on a Unix socket only your user can use: `$XDG_RUNTIME_DIR/nippletuner-<uid>.sock`, usually `/run/user/1000/…`. Each command sends one JSON request and prints the reply. Nothing listens on the network.

---

← [Back to README](../README.md) · [Quick start guide](quick-start.md)
