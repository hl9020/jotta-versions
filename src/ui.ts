import * as readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

export function prompt(q: string): Promise<string> {
  return new Promise((r) => rl.question(q, (a) => r(a.trim())));
}

export function close() { rl.close(); }

const ESC = '\x1b[';
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const RESET = `${ESC}0m`;
const CLEAR_LINE = `${ESC}2K\r`;

export const c = { BOLD, DIM, CYAN, GREEN, YELLOW, RED, RESET, CLEAR_LINE };

export function header(text: string) {
  console.log(`\n${BOLD}${CYAN}${text}${RESET}`);
  console.log(`${DIM}${'─'.repeat(Math.min(text.length + 4, 60))}${RESET}`);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(d: string): string {
  if (!d) return '—';
  const m = d.match(/(\d{4})-(\d{2})-(\d{2})-?T?(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return d;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

export async function selectFromList<T>(
  items: T[],
  label: (item: T, idx: number) => string,
  title: string,
): Promise<T | null> {
  if (items.length === 0) {
    console.log(`${DIM}  (empty)${RESET}`);
    return null;
  }
  header(title);
  items.forEach((item, i) => {
    console.log(`  ${YELLOW}${String(i + 1).padStart(2)}${RESET}  ${label(item, i)}`);
  });
  console.log(`  ${DIM} 0  ← Back${RESET}`);
  const ans = await prompt(`\n${CYAN}>${RESET} `);
  const idx = parseInt(ans) - 1;
  if (isNaN(idx) || idx < 0 || idx >= items.length) return null;
  return items[idx];
}

export function spinner(text: string): { stop: (msg?: string) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const iv = setInterval(() => {
    process.stdout.write(`${CLEAR_LINE}${CYAN}${frames[i++ % frames.length]}${RESET} ${text}`);
  }, 80);
  return {
    stop(msg?: string) {
      clearInterval(iv);
      process.stdout.write(`${CLEAR_LINE}${msg ? `${GREEN}✓${RESET} ${msg}` : ''}\n`);
    },
  };
}

export function progressBar(total: number): { update: (bytes: number) => void; done: () => void } {
  const start = Date.now();
  const width = 30;
  const known = total > 0;
  let last = 0;
  const iv = setInterval(() => render(last), 200);

  function render(bytes: number) {
    const elapsed = (Date.now() - start) / 1000 || 0.01;
    const speed = bytes / elapsed;
    const speedStr = formatSize(Math.round(speed)) + '/s';
    if (known) {
      const pct = Math.min(bytes / total, 1);
      const filled = Math.round(width * pct);
      const bar = `${GREEN}${'█'.repeat(filled)}${DIM}${'░'.repeat(width - filled)}${RESET}`;
      process.stdout.write(`${CLEAR_LINE}  ${bar} ${(pct * 100).toFixed(0)}%  ${formatSize(bytes)}/${formatSize(total)}  ${DIM}${speedStr}${RESET}`);
    } else {
      process.stdout.write(`${CLEAR_LINE}  ${CYAN}⟳${RESET} ${formatSize(bytes)}  ${DIM}${speedStr}${RESET}`);
    }
  }

  return {
    update(bytes: number) { last = bytes; },
    done() { clearInterval(iv); render(last); process.stdout.write('\n'); },
  };
}
