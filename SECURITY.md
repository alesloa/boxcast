# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately through GitHub:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (GitHub private security advisories).

This keeps the report private until a fix is available. You'll get a response
through the advisory thread.

When reporting, please include:

- A description of the issue and its impact.
- Steps to reproduce (a proof of concept if you have one).
- The version / commit you tested against and your OS.

## Scope

This is a desktop app that fetches third-party stream catalogs (iptv-org,
radio-browser) and proxies media locally. Useful things to look at:

- The local streaming proxy (`src-tauri/src/proxy.rs`) — it only binds to a
  random free port on `127.0.0.1` and should never be reachable off localhost.
- Handling of untrusted upstream responses (manifests, segments).
- Any path where a remote catalog value could reach the webview unsanitized.

## Supported versions

This project is pre-1.0. Security fixes are made against the latest `main`.
