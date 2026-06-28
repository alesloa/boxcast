# BoxCast

A lightweight, cross-platform desktop app for watching **live TV (IPTV)**, listening to
**internet radio**, and searching/playing **YouTube** — in one polished dark UI.

Built with **Tauri 2** (Rust) + **React** + **Vite** + **Tailwind**. The Rust side runs an
in-process streaming proxy so otherwise-unplayable IPTV streams work in the webview.

- **Live TV** — channels from the open [iptv-org](https://github.com/iptv-org/iptv) catalog.
  Filter live as you type (by name, category/genre, country, or language) from the channel rail,
  plus sidebar filters for category, country, HD, and favorites. Dead streams auto-advance.
- **Radio** — stations from [radio-browser.info](https://www.radio-browser.info/), with a live
  audio visualizer.
- **YouTube** — search + embedded playback (bring your own Data API v3 key).
- **Subtitles** — toggle on/off, pick a track on multi-language streams, and choose the caption
  color (when the stream carries subtitle tracks).
- **Audio language** — switch the audio track on multi-language streams, with a remembered
  preferred language that auto-selects on future channels (set it in Settings).
- **Favorites** — save channels, stations, and videos with ★; each mode has a Favorites tab and
  they persist locally (SQLite).
- **Light & dark themes** — toggle from the title bar; your choice is remembered.
- **Tooltips** on every control, plus keyboard shortcuts (see below).

Runs on **Windows, macOS, and Linux**. Native frameless window with OS-appropriate controls
(macOS traffic lights / Windows-style caption buttons).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Previous / next (channel or station) |
| `M` | Mute / unmute |
| `F` | Fullscreen |

## Why the proxy matters

Most IPTV streams (a) lack CORS headers and (b) require a specific `Referer`/`User-Agent`.
Browsers can't set those and get blocked. The app's Rust proxy fetches upstream with the right
headers and re-serves with permissive CORS; for `.m3u8` manifests it rewrites every child URI so
segments, keys, and variant playlists all flow through it too. The proxy binds to a random free
port on `127.0.0.1` at launch (never a fixed default) and is not exposed off-localhost.

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18 and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable) + the
  [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS

## Develop

```bash
npm install
npm run tauri dev
```

The first run compiles the Rust backend (a few minutes); subsequent runs are fast.

## Build a distributable

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/` (`.dmg`/`.app` on macOS, `.msi`/`.exe` on
Windows, `.deb`/`.AppImage` on Linux).

## YouTube

YouTube search needs a Google **YouTube Data API v3** key. Open **Settings** in the app and paste
your key — it's stored locally (SQLite in the OS app-data dir) and never bundled into the client.
`search.list` costs 100 quota units; the default 10,000/day quota is ~100 searches/day.

## Notes & limitations

- iptv-org streams are community-sourced and a fraction are dead at any time. Dead streams show a
  clean "unavailable" state and auto-advance to the next channel.
- The channel catalog is cached for 24h; refresh it from Settings.
- No EPG/guide, no DVR, no Chromecast in this version.

## Credits

- Channel data: [iptv-org](https://github.com/iptv-org/iptv)
- Radio data: [radio-browser.info](https://www.radio-browser.info/)
- Built with [Tauri](https://tauri.app/), [React](https://react.dev/),
  [hls.js](https://github.com/video-dev/hls.js/)

## License

MIT — see [LICENSE](LICENSE).
