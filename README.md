# jotta-versions

Browse and download **file revisions** from Jottacloud – directly from the terminal.

Jottacloud keeps up to 5 versions of every file, but the only way to access them is through the web interface with 2FA login every time. This tool fixes that by talking directly to the local Jottacloud daemon - **zero config, zero login, zero hassle**.

## How it works

The Jottacloud desktop app (Windows/macOS) or CLI daemon (Linux) runs a local daemon (`jottad`) that manages authentication. This tool:

1. Reads the daemon port from the ServiceDiscovery file (port is dynamic!)
2. Connects to the daemon via gRPC over HTTP/2
3. Gets a fresh access token (no credentials needed)
4. Uses the Jottacloud JFS REST API to browse files and download revisions

**No API keys. No tokens. No config files.** Just `jottad` running in the background.

## Requirements

- **Windows/macOS:** [Jottacloud desktop app](https://www.jottacloud.com/download) installed and logged in
- **Linux:** [Jottacloud CLI](https://docs.jottacloud.com/en/articles/1436834-jottacloud-command-line-tool) installed with `jottad` running (`systemctl --user start jottad`)
- Node.js 20+

## Installation

```bash
npm install -g jotta-versions
```

Or run directly without installing:

```bash
npx jotta-versions
```

## Usage

```bash
jotta-versions
```

The interactive browser guides you through:

```
jotta-versions v0.1.0
Browse & download file revisions from Jottacloud

✓ Connected as a1b2c3d4e5f6g7h8

Select device
─────────────────
   1  My-Laptop (LAPTOP, 1.2 TB)
   2  Jotta (JOTTA, 42.0 GB)
   0  ← Back

> 1

📂 MY-LAPTOP/Documents
─────────────────────────
   1  📁 my-project/
   2  📁 another-project/
   0  ← Back

> 1

📂 MY-LAPTOP/Documents/my-project
──────────────────────────────────
   1  📁 src/
   2  📄 package.json      916 B  2026-01-12 22:13:49
   3  📄 hero-image.psd  48.2 MB  2026-01-10 14:05:22
   0  ← Back

> 3

Revisions of hero-image.psd
─────────────────────────────
   1  Rev 3  48.2 MB  2026-01-10 14:05:22  a8c3f012 (current)
   2  Rev 2  45.7 MB  2026-01-09 11:32:01  7e19bb4d
   3  Rev 1  42.1 MB  2026-01-08 09:15:44  f3e28d19
   0  ← Back

> 3

  ██████████████░░░░░░░░░░░░░░░░ 45%  19.0 MB/42.1 MB  8.4 MB/s
  ██████████████████████████████ 100%  42.1 MB/42.1 MB  9.1 MB/s

  ████ DOWNLOADED ████  Rev 1 of hero-image.psd (42.1 MB) → downloads/MY-LAPTOP/Documents/my-project/hero-image.rev1.psd
```

Downloaded files are saved to `./downloads/` mirroring the remote folder structure:

```
./downloads/
  MY-LAPTOP/Documents/my-project/
    hero-image.rev1.psd
    hero-image.rev2.psd
```

## Features

- **Zero config** - authenticates via the local Jottacloud daemon, no credentials needed
- **Interactive browser** - navigate devices, folders, and files with a simple menu
- **Progress bar** - real-time download progress with speed and percentage
- **Stream-to-disk** - downloads are streamed directly to disk, no file size limits
- **Overwrite protection** - prompts before replacing existing downloads
- **Path traversal protection** - validates all download paths stay within the output directory

## How the reverse engineering was done

The Jottacloud desktop app bundles a local gRPC daemon that the CLI and desktop UI use internally. By extracting the service definitions from the binary, we discovered 230 gRPC endpoints - including `ListRevisions` and `GetAccessToken` which are not exposed in the official CLI.

The file versioning data is then fetched via the legacy JFS REST API (`jfs.jottacloud.com`), which returns XML with full revision history. Older revisions can be downloaded with `?mode=bin&revision=N`.

## License

MIT

## Disclaimer

This is a community project, not affiliated with or endorsed by Jottacloud/Jotta AS. Use at your own risk.
