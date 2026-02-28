#!/usr/bin/env node
import { mkdirSync, existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { getAccessToken, isDaemonRunning } from './daemon.js';
import { getUsernameFromToken, listDevices, listFolder, listRevisions, jfsDownload } from './api.js';
import { selectFromList, header, formatSize, formatDate, spinner, progressBar, close, prompt, c } from './ui.js';
import type { Device, FolderEntry, Revision } from './api.js';

const JOTTA_DB = join(process.env.APPDATA || '', 'Jottacloud', 'appdata');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

interface PathMappings { [folder: string]: string }

let syncMappingsCache: PathMappings | null = null;

function readJottaSyncMappings(): PathMappings {
  if (syncMappingsCache) return syncMappingsCache;
  const mappings: PathMappings = {};
  try {
    const ctx = JSON.parse(readFileSync(join(JOTTA_DB, 'context'), 'utf8'));
    const dbPath = join(JOTTA_DB, ctx.Name, 'db');
    const fd = openSync(dbPath, 'r');
    const buf = Buffer.alloc(statSync(dbPath).size);
    readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const text = buf.toString('utf8');
    const re = /"Path":\s*"([^"]+)",\s*"Name":\s*"([^"]+)",\s*"FilesystemID"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      mappings[m[2]] = m[1].replace(/\//g, '\\');
    }
  } catch { /* Jottacloud app not installed or db inaccessible */ }
  syncMappingsCache = mappings;
  return mappings;
}

async function resolveLocalRoot(topFolder: string): Promise<string | null> {
  const mappings = readJottaSyncMappings();
  if (mappings[topFolder] && existsSync(mappings[topFolder])) return mappings[topFolder];

  // Fallback: manual input
  console.log(`${c.YELLOW}?${c.RESET} Local path for ${c.BOLD}${topFolder}${c.RESET} not found in Jottacloud config.`);
  const manual = await prompt(`  Enter local path (or empty to skip): `);
  if (!manual) return null;
  const resolved = resolve(manual);
  if (!existsSync(resolved)) {
    console.log(`${c.RED}✗${c.RESET} Path does not exist.`);
    return null;
  }
  return resolved;
}

async function main() {
  console.log(`\n${c.BOLD}jotta-versions${c.RESET} ${c.DIM}v${pkg.version}${c.RESET}`);
  console.log(`${c.DIM}Browse & restore file revisions from Jottacloud${c.RESET}\n`);

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

  const devices = await listDevices(token, username);
  const device = await selectFromList<Device>(
    devices,
    (d) => `${c.BOLD}${d.displayName}${c.RESET} ${c.DIM}(${d.type}, ${formatSize(d.size)})${c.RESET}`,
    'Select device',
  );
  if (!device) { close(); return; }

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

    const fullRelative = currentPath.replace(username + '/', '');
    const parts = fullRelative.split('/');
    const topFolder = parts[1];
    const subPath = parts.slice(2).join('/');
    await showRevisions(freshToken, `${currentPath}/${selected.name}`, topFolder, subPath);
  }

  close();
}

async function showRevisions(token: string, filePath: string, topFolder: string, subPath: string) {
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

    const localRoot = await resolveLocalRoot(topFolder);
    if (!localRoot) {
      console.log(`${c.RED}✗${c.RESET} Cannot restore without local path.`);
      continue;
    }

    const targetDir = subPath ? join(localRoot, subPath) : localRoot;
    const originalPath = join(targetDir, name);
    const revName = name.replace(/(\.[^.]+)$/, `.rev${rev.number}$1`);
    const revPath = join(targetDir, revName);

    console.log(`\n  ${c.BOLD}Target:${c.RESET} ${targetDir}`);
    if (existsSync(originalPath)) {
      console.log(`  ${c.YELLOW}⚠${c.RESET} File ${c.BOLD}${name}${c.RESET} exists at target.`);
    }
    console.log(`  ${c.CYAN}[O]${c.RESET} Overwrite → ${c.DIM}${originalPath}${c.RESET}`);
    console.log(`  ${c.CYAN}[R]${c.RESET} Save as revision → ${c.DIM}${revPath}${c.RESET}`);
    console.log(`  ${c.DIM}[C] Cancel${c.RESET}`);
    const choice = await prompt(`\n  ${c.CYAN}>${c.RESET} `);

    let outPath: string;
    if (choice.toLowerCase() === 'o') outPath = originalPath;
    else if (choice.toLowerCase() === 'r') outPath = revPath;
    else continue;

    mkdirSync(dirname(outPath), { recursive: true });

    const prog = progressBar(rev.size);
    try {
      const freshToken = await getAccessToken();
      const bytes = await jfsDownload(freshToken, filePath, outPath, rev.number, (b) => prog.update(b));
      prog.done();
      console.log(`\n  ${c.GREEN}████ RESTORED ████${c.RESET}  Rev ${c.BOLD}${rev.number}${c.RESET} of ${c.BOLD}${name}${c.RESET} (${formatSize(bytes)}) → ${c.BOLD}${outPath}${c.RESET}\n`);
    } catch (e) {
      prog.done();
      console.log(`${c.RED}✗${c.RESET} Restore failed: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(`${c.RED}✗${c.RESET} ${e.message}`);
  process.exit(1);
});
