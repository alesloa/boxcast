# Contributing

Thanks for your interest in improving this project.

## Getting set up

You'll need Node.js ≥ 18 + npm and a stable Rust toolchain, plus the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev
```

## Before opening a pull request

Run the checks locally:

```bash
npm run lint:types                       # TypeScript: tsc --noEmit
cd src-tauri && cargo test --no-default-features   # Rust unit tests
npm run build:vite                       # frontend production build
```

Please keep PRs focused — one logical change per PR is much easier to review.

## Style

- TypeScript + React on the frontend, Rust on the backend.
- Match the existing formatting and naming in the files you touch.
- No telemetry, no analytics, no bundled API keys or secrets.

## Reporting bugs

Open an issue with steps to reproduce, your OS, and the app version/commit.
For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.
