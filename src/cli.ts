#!/usr/bin/env node
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, normalize } from 'node:path';
import { getAccessToken, isDaemonRunning } from './daemon.js';
import { getUsernameFromToken, listDevices, listFolder, listRevisions, jfsDownload } from './api.js';
import { selectFromList, header, formatSize, formatDate, spinner, progressBar, close, prompt, c } from './ui.js';
import type { Device, FolderEntry, Revision } from './api.js';

const DOWNLOAD_DIR = resolve('./downloads');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function safePath(base: string, ...segments: string[]): string {
  const full = normalize(join(base, ...segments));
  if (!full.startsWith(normalize(base))) throw new Error('Path traversal detected');
  return full;
}

async function main() {
  console.log(`\n${c.BOLD}jotta-versions${c.RESET} ${c.DIM}v${pkg.version}${c.RESET}`);
  console.log(`${c.DIM}Browse & download file revisions from Jottacloud${c.RESET}\n`);

  // Check daemon
  const sp = spinner('Connecting to Jottacloud daemon...');
  if (!(await isDaemonRunning())) {
    sp.stop();
    console.log(`${c.RED}✗${c.RESET} Cannot connect to jottad daemon.`);
    console.log(`${c.DIM}  Windows/macOS: Start the Jottacloud desktop app.${c.RESET}`);
    console.log(`${c.DIM}  Linux: Run "systemctl --user start jottad"${c.RESET}`);
    process.exit(1);
  }

  const token = await getAccessToken();
  const username = getUsernameFromToken(token);
  sp.stop(`Connected as ${c.CYAN}${username}${c.RESET}`);

  // Device selection
  const devices = await listDevices(token, username);
  const device = await selectFromList<Device>(
    devices,
    (d) => `${c.BOLD}${d.displayName}${c.RESET} ${c.DIM}(${d.type}, ${formatSize(d.size)})${c.RESET}`,
    'Select device',
  );
  if (!device) { close(); return; }

  // Browse loop
  let currentPath = `${username}/${device.name}`;
  const pathStack: string[] = [];

  while (true) {
    const freshToken = await getAccessToken();
    const sp2 = spinner('Loading...');
    let entries: FolderEntry[];
    try {
      entries = await listFolder(freshToken, currentPath);
    } catch (e) {
      sp2.stop();
      console.log(`${c.RED}✗${c.RESET} ${(e as Error).message}`);
      if (pathStack.length > 0) { currentPath = pathStack.pop()!; continue; }
      break;
    }
    sp2.stop();

    const displayPath = currentPath.replace(username + '/', '');
    const selected = await selectFromList<FolderEntry>(
      entries,
      (e) => {
        if (e.kind === 'folder') return `${c.CYAN}📁 ${e.name}/${c.RESET}`;
        const sz = e.size ? formatSize(e.size) : '';
        const mod = e.modified ? formatDate(e.modified) : '';
        return `📄 ${e.name} ${c.DIM}${sz} ${mod}${c.RESET}`;
      },
      `📂 ${displayPath}`,
    );

    if (!selected) {
      if (pathStack.length > 0) { currentPath = pathStack.pop()!; continue; }
      break;
    }

    if (selected.kind === 'folder') {
      pathStack.push(currentPath);
      currentPath = `${currentPath}/${selected.name}`;
      continue;
    }

    // File selected → show revisions
    const relativePath = currentPath.replace(username + '/', '');
    await showRevisions(freshToken, `${currentPath}/${selected.name}`, relativePath);
  }

  close();
}

async function showRevisions(token: string, filePath: string, relativePath: string) {
  const sp = spinner('Loading revisions...');
  const { name, revisions } = await listRevisions(token, filePath);
  sp.stop(`${c.BOLD}${name}${c.RESET} – ${revisions.length} revision(s)`);

  if (revisions.length === 0) {
    console.log(`${c.DIM}  No revisions found.${c.RESET}`);
    return;
  }

  while (true) {
    const rev = await selectFromList<Revision>(
      revisions,
      (r, i) => {
        const current = i === 0 ? ` ${c.GREEN}(current)${c.RESET}` : '';
        return `Rev ${c.BOLD}${r.number}${c.RESET}  ${formatSize(r.size)}  ${formatDate(r.modified)}  ${c.DIM}${r.md5.substring(0, 8)}${c.RESET}${current}`;
      },
      `Revisions of ${name}`,
    );

    if (!rev) return;

    // Build download path: ./downloads/{relative-path}/filename.revN.ext
    const revName = rev.number === revisions[0].number
      ? name
      : name.replace(/(\.[^.]+)$/, `.rev${rev.number}$1`);
    const outDir = safePath(DOWNLOAD_DIR, relativePath);
    mkdirSync(outDir, { recursive: true });
    const outPath = safePath(DOWNLOAD_DIR, relativePath, revName);

    if (existsSync(outPath)) {
      const overwrite = await prompt(`  ${c.YELLOW}File exists. Overwrite?${c.RESET} [y/N] `);
      if (overwrite.toLowerCase() !== 'y') continue;
    }

    const prog = progressBar(rev.size);
    try {
      const freshToken = await getAccessToken();
      const bytes = await jfsDownload(freshToken, filePath, outPath, rev.number, (b, t) => prog.update(b));
      prog.done();
      console.log(`\n  ${c.GREEN}████ DOWNLOADED ████${c.RESET}  Rev ${c.BOLD}${rev.number}${c.RESET} of ${c.BOLD}${name}${c.RESET} (${formatSize(bytes)}) → ${c.BOLD}${outPath}${c.RESET}\n`);
    } catch (e) {
      prog.done();
      console.log(`${c.RED}✗${c.RESET} Download failed: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(`${c.RED}✗${c.RESET} ${e.message}`);
  process.exit(1);
});
