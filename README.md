# jotta-versions

Browse and **restore file revisions** from Jottacloud – directly from the terminal.

Jottacloud keeps up to 5 versions of every file, but the only way to access them is through the web interface with 2FA login every time. This tool fixes that by talking directly to the local Jottacloud daemon and restoring revisions to their **original location** on disk - **zero config, zero login, zero hassle**.

## How it works

The Jottacloud desktop app (Windows/macOS) or CLI daemon (Linux) runs a local daemon (`jottad`) that manages authentication. This tool:

1. Reads the daemon port from the ServiceDiscovery file (port is dynamic!)
2. Connects to the daemon via gRPC over HTTP/2
3. Gets a fresh access token (no credentials needed)
4. Reads sync folder mappings from the Jottacloud BoltDB to resolve local paths
5. Uses the Jottacloud JFS REST API to browse files and restore revisions

**No API keys. No tokens. No config files.** Just `jottad` running in the background.

## Platform support

| Platform | Status | Notes |
|----------|--------|-------|
| Windows | ✅ Verified | Tested with Jottacloud desktop app |
| macOS | ⚠️ Untested | Should work – paths auto-detected from `~/Library/Application Support/Jottacloud/` |
| Linux | ⚠️ Untested | Should work – paths auto-detected from `~/.config/Jottacloud/` |

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
Browse & restore file revisions from Jottacloud

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

  Target: D:\Projects\my-project
  ⚠ File hero-image.psd exists at target.
  [O] Overwrite → D:\Projects\my-project\hero-image.psd
  [R] Save as revision → D:\Projects\my-project\hero-image.rev1.psd
  [C] Cancel

  > r

  ██████████████████████████████ 100%  42.1 MB/42.1 MB  9.1 MB/s

  ████ RESTORED ████  Rev 1 of hero-image.psd (42.1 MB) → D:\Projects\my-project\hero-image.rev1.psd
```

Revisions are restored to their **original location** on disk. The tool reads sync folder mappings directly from the Jottacloud desktop app's local database to resolve the correct paths. You choose to either **overwrite** the current file or save it as a `.revN` copy next to the original.

## Features

- **Zero config** - authenticates via the local Jottacloud daemon, no credentials needed
- **Restore to original path** - reads sync mappings from Jottacloud's local DB to find the correct location
- **Overwrite or revision copy** - choose to replace the file or save as `.revN` next to the original
- **Interactive browser** - navigate devices, folders, and files with a simple menu
- **Progress bar** - real-time download progress with speed and percentage
- **Stream-to-disk** - downloads are streamed directly to disk, no file size limits

## How the reverse engineering was done

The Jottacloud desktop app bundles a local gRPC daemon that the CLI and desktop UI use internally. By extracting the service definitions from the binary, we discovered 230 gRPC endpoints - including `ListRevisions` and `GetAccessToken` which are not exposed in the official CLI.

The file versioning data is then fetched via the legacy JFS REST API (`jfs.jottacloud.com`), which returns XML with full revision history. Older revisions can be downloaded with `?mode=bin&revision=N`.

## License

MIT

## Disclaimer

This is a community project, not affiliated with or endorsed by Jottacloud/Jotta AS. Use at your own risk.
