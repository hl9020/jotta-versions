import { get } from 'node:https';
import { createWriteStream } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { getAccessToken } from './daemon.js';

const JFS_BASE = 'https://jfs.jottacloud.com/jfs';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export interface Device {
  name: string;
  displayName: string;
  type: string;
  size: number;
}

export interface Revision {
  number: number;
  state: string;
  created: string;
  modified: string;
  size: number;
  md5: string;
  mime: string;
}

export interface FolderEntry {
  name: string;
  kind: 'file' | 'folder';
  size?: number;
  modified?: string;
}

function encodePath(p: string): string {
  return p.split('/').map(s => encodeURIComponent(s)).join('/');
}

function jfsGet(token: string, path: string): Promise<string> {
  const url = `${JFS_BASE}/${encodePath(path)}`;
  return new Promise((resolve, reject) => {
    get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      if (res.statusCode === 404) { reject(new Error(`Not found: ${path}`)); return; }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let body = '';
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

export function jfsDownload(token: string, path: string, outPath: string, revision?: number, onProgress?: (bytes: number, total: number) => void): Promise<number> {
  let url = `${JFS_BASE}/${encodePath(path)}?mode=bin`;
  if (revision !== undefined) url += `&revision=${revision}`;
  return new Promise((resolve, reject) => {
    get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const total = Number(res.headers['content-length'] || 0);
      let bytes = 0;
      const ws = createWriteStream(outPath);
      res.on('data', (c: Buffer) => { bytes += c.length; onProgress?.(bytes, total); });
      res.pipe(ws);
      ws.on('finish', () => resolve(bytes));
      ws.on('error', reject);
    }).on('error', reject);
  });
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export function getUsernameFromToken(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const sub = payload.sub as string;
  return sub.split(':').pop()!;
}

function textVal(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && '#text' in v) return String((v as Record<string, unknown>)['#text']).trim();
  return String(v ?? '').trim();
}

export async function listDevices(token: string, username: string): Promise<Device[]> {
  const xml = await jfsGet(token, username);
  const parsed = parser.parse(xml);
  const devs = asArray(parsed.user?.devices?.device);
  return devs.map((d: Record<string, unknown>) => ({
    name: textVal(d.name),
    displayName: textVal(d.display_name),
    type: String(d.type ?? ''),
    size: Number(d.size) || 0,
  }));
}

export async function listFolder(token: string, path: string): Promise<FolderEntry[]> {
  const xml = await jfsGet(token, path);
  const parsed = parser.parse(xml);
  const entries: FolderEntry[] = [];

  // Mountpoints → listed as sub-items on device level
  for (const mp of asArray(parsed.device?.mountPoints?.mountPoint)) {
    entries.push({ name: textVal(mp.name), kind: 'folder' });
  }

  // Folders + files from mountPoint or folder level
  for (const src of [parsed.mountPoint, parsed.folder]) {
    if (!src) continue;
    for (const f of asArray(src.folders?.folder)) {
      entries.push({ name: textVal(f['@_name'] ?? f.name), kind: 'folder' });
    }
    for (const f of asArray(src.files?.file)) {
      const rev = f.currentRevision ?? f.latestRevision;
      entries.push({
        name: textVal(f['@_name'] ?? f.name),
        kind: 'file',
        size: Number(rev?.size) || undefined,
        modified: rev?.modified ? String(rev.modified) : undefined,
      });
    }
  }
  return entries;
}

function parseRevision(r: Record<string, unknown>): Revision {
  return {
    number: Number(r.number),
    state: String(r.state ?? ''),
    created: String(r.created ?? ''),
    modified: String(r.modified ?? ''),
    size: Number(r.size) || 0,
    md5: String(r.md5 ?? ''),
    mime: String(r.mime ?? ''),
  };
}

export async function listRevisions(token: string, path: string): Promise<{ name: string; revisions: Revision[] }> {
  const xml = await jfsGet(token, path);
  const parsed = parser.parse(xml);
  const file = parsed.file;
  if (!file) throw new Error('Not a file: ' + path);

  const revs: Revision[] = [];
  if (file.currentRevision) revs.push(parseRevision(file.currentRevision));
  for (const r of asArray(file.revisions?.revision)) {
    revs.push(parseRevision(r));
  }
  revs.sort((a, b) => b.number - a.number);
  return { name: String(file['@_name'] ?? '').trim(), revisions: revs };
}
