# Features

A complete tour of what the app does, grouped by area. For setup and build
instructions see the [README](README.md).

## Live TV (IPTV)

- **Open channel catalog** — channels are pulled from the community
  [iptv-org](https://github.com/iptv-org/iptv) project. No account, no
  subscription, no API key.
- **Instant rail filter** — a search box in the channel-list header filters as
  you type. Matches on channel name, category/genre, country, and language.
- **Sidebar filters** — narrow the list by category, country, HD-only, and
  favorites.
- **Streaming proxy** — a Rust-side proxy fetches each stream with the correct
  `Referer`/`User-Agent`, re-serves it with permissive CORS, and rewrites HLS
  manifest child URIs so segments, keys, and variant playlists all route
  through it. This is what makes otherwise-unplayable IPTV streams work inside a
  webview.
- **Dead-stream auto-advance** — community streams die constantly. A dead stream
  shows a clean "unavailable" state and automatically skips to the next channel,
  with a cap so it never loops forever on a bad run.
- **Now-playing / program title** — when a stream advertises a program title
  (via HLS timed metadata or playlist titles), it's shown on the player and in
  the status bar.
- **Live stats** — protocol, quality, bitrate, buffer, and volume in the status
  bar.

## Audio language & subtitles

- **Audio-track switching** — multi-language streams expose an audio menu; pick
  the language you want instead of being stuck with whatever the stream defaults
  to (often geo-decided by your IP).
- **Preferred language memory** — set a preferred audio language in Settings and
  it auto-selects on future channels when that language is available.
- **Subtitles / closed captions** — toggle captions on or off, pick a track on
  multi-language streams, and choose the caption color. Only shown when the
  stream actually carries subtitle tracks.

## Radio

- **Open station directory** — stations from
  [radio-browser.info](https://www.radio-browser.info/). No key required.
- **Continuous playback** — streams play uninterrupted (no idle-timeout
  cutoffs).
- **Live audio visualizer** — a reactive visualizer while a station plays.

## YouTube

- **Search + embedded playback** — search YouTube and play results in an
  embedded player.
- **Bring-your-own key** — uses the YouTube Data API v3. Paste your own key in
  Settings; it's stored locally and never bundled into the client.

## Favorites

- **Across all three modes** — star channels, radio stations, and videos.
- **Per-mode Favorites tab** — each mode has its own favorites view.
- **Local persistence** — favorites are stored in a local SQLite database in the
  OS app-data directory, so they survive restarts.

## Interface

- **Polished dark UI** — a custom frameless window with rounded corners.
- **Light & dark themes** — toggle from the title bar; your choice is remembered.
- **Native window controls** — macOS traffic lights and Windows-style caption
  buttons, matched to the host OS.
- **Tooltips everywhere** — every control has a tooltip describing what it does.
- **Keyboard shortcuts:**

  | Key | Action |
  | --- | --- |
  | `Space` | Play / pause |
  | `←` / `→` | Previous / next (channel or station) |
  | `M` | Mute / unmute |
  | `F` | Fullscreen |

## Platforms

Runs on **Windows, macOS, and Linux** from a single Tauri 2 + React codebase.

## Privacy & data

- No telemetry, no analytics, no account.
- Your YouTube API key and your favorites stay on your machine (local SQLite).
- The streaming proxy binds to a random free port on `127.0.0.1` and is never
  exposed off localhost.

## Not included (yet)

- No EPG / program guide.
- No DVR / recording.
- No Chromecast / external-cast support.
