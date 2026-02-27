import { connect } from 'node:http2';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GRPC_TIMEOUT_MS = 5000;

function getDaemonPort(): number {
  const paths = [
    join(process.env.APPDATA ?? '', 'Jottacloud', 'ServiceDiscovery', 'jottad'),
    join(process.env.HOME ?? '', '.config', 'jottacloud', 'ServiceDiscovery', 'jottad'),
  ];
  for (const p of paths) {
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      if (data.Port) return data.Port;
    } catch { /* next */ }
  }
  return 14443;
}

function grpcCall(path: string): Promise<Buffer> {
  const port = getDaemonPort();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.close(); reject(new Error('Daemon timeout')); }, GRPC_TIMEOUT_MS);
    const client = connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
    client.on('error', (e) => { clearTimeout(timer); reject(e); });
    const req = client.request({
      ':method': 'POST',
      ':path': path,
      'content-type': 'application/grpc',
      'te': 'trailers',
    });
    let data = Buffer.alloc(0);
    req.on('data', (c: Buffer) => { data = Buffer.concat([data, c]); });
    req.on('end', () => { clearTimeout(timer); client.close(); resolve(data); });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end(Buffer.alloc(5));
  });
}

export async function getAccessToken(): Promise<string> {
  const raw = await grpcCall('/api.Jotta/GetAccessToken');
  if (raw.length <= 5) throw new Error('Daemon returned empty response');
  const text = raw.subarray(5).toString('utf8');
  const m = text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (!m) throw new Error('No JWT found in daemon response');
  return m[0];
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
