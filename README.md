# OctoTray

**OctoTray** is a minimal cross-platform **Electron tray app** that keeps your [OctoPrint](https://octoprint.org/) printer in sight: live temperatures, job progress, and time estimates—without keeping a browser tab open.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Menu bar / system tray icon** with optional **@2x** asset for sharp displays  
- **Left-click** (macOS) or **menu → Open status panel** for a compact **status popover** (state, bed & hotend temps with setpoint progress, job file, % complete, elapsed / remaining time)  
- **Right-click** for a short menu: open panel, **Configure…**, config **Paths**, **Quit**  
- **Settings** window: OctoPrint **URL**, **API key**, **poll interval**—saved under the OS user data folder (not in the repo)  
- **Automatic polling** (default 5s, configurable) with request timeout  
- **Dynamic popover height** so there’s no empty space under the content- Tray **tooltip** shows server host and poll hint  

---

## Download (installable builds)

Prebuilt installers are attached to **GitHub Releases** whenever a commit is pushed to **`main`**.

| OS | Typical artifacts |
|-----------|-------------------|
| **macOS** | `.dmg`, `.zip` (often Apple Silicon; Intel may use Rosetta or a local build) |
| **Windows** | `.exe` (NSIS installer), portable `.exe` |
| **Linux**   | `.AppImage`, `.deb` |

1. Open the **Releases** page in this GitHub repository.  
2. Pick the latest **`v*.*.*-build.*`** release (created on each push to `main`).  
3. Download the file for your OS and install or run as usual.

> **macOS unsigned builds:** If Gatekeeper blocks the app, use **System Settings → Privacy & Security** to allow it, or right-click → **Open** the first time.

---

## Configuration

On first run, open **Configure…** from the tray menu and set:

| Field | Description |
|--------|-------------|
| **OctoPrint URL** | e.g. `http://octopi.local` or `http://127.0.0.1:5000` (scheme added if omitted) |
| **API key** | From OctoPrint: **Settings → API** |
| **Poll interval** | Seconds between refreshes (2–300) |
| **Launch at sign-in** | Starts OctoTray when you log in (uses the OS login-items API; you may still need to allow the app in **System Settings → Login Items** on macOS or **Startup apps** on Windows) |

Settings are stored in the app **user data** directory (e.g. macOS: `~/Library/Application Support/octotray/config.json`). Environment variables **`OCTOPRINT_URL`**, **`OCTOPRINT_API_KEY`**, **`OCTOPRINT_POLL_MS`** override file settings when set.

Copy **`config.example.json`** as a template if you edit JSON by hand.

---

## Tray icons

Place these next to the app entry (project root for dev, or bundled in packaged app):

- **`tray.png`** — **22×22** @1x (required)  
- **`tray@2x.png`** — **44×44** @2x (optional)

Large or non-square images are resized to a square tray size automatically.

---

## Development

```bash
git clone https://github.com/<your-org>/octotray.git
cd octotray
npm ci
npm start
```

### Package locally

```bash
npm run dist # Current OS only (or pass --mac / --win / --linux)
npm run pack        # Unpacked dir for debugging
```

---

## Tech stack

- [Electron](https://www.electronjs.org/)  
- [electron-builder](https://www.electron.build/) for **DMG**, **ZIP**, **NSIS**, **portable EXE**, **AppImage**, **deb**  
- OctoPrint REST API: `/api/printer`, `/api/job`  

---

## CI / releases

The workflow **`.github/workflows/release.yml`** runs on every push to **`main`**:

1. Builds **macOS**, **Windows**, and **Linux** artifacts in parallel.  
2. Creates a **GitHub Release** with tag `v<package.json-version>-build.<run_number>` and uploads all built files.

Ensure **Actions** → **General** → **Workflow permissions** allows **read and write** for `contents` (default for the automatic job token). Do **not** create repository secrets named with the `GITHUB_` prefix (GitHub rejects them). If the default token cannot create releases in your org, add an optional secret **`RELEASE_TOKEN`** (a PAT with `contents: write`)—the workflow uses `RELEASE_TOKEN` when set, otherwise `github.token`.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Disclaimer

OctoTray is an independent tool and is not affiliated with OctoPrint. Use at your own risk near hot printers and networks.
