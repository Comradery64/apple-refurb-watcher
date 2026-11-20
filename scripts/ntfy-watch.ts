import { fetchProducts } from '../src/lib/scraper';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

type State = { checkedAt?: string; matches: string[]; failures?: number; failureNotified?: boolean; heartbeatAt?: string };
const statePath = process.env.WATCHER_STATE_PATH || path.join(process.cwd(), 'data', 'ntfy-watch.json');
const notify = (title: string, message: string, url?: string) => {
  const args = ['-title', title, '-message', message, '-sound', 'Glass'];
  if (url) args.push('-open', url);
  execFileSync('/opt/homebrew/bin/terminal-notifier', args);
};
async function save(state: State) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, statePath);
}
async function main() {
  let state: State = { matches: [] };
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  try {
    if (process.env.WATCHER_TEST_FAILURE === '1') throw new Error('Simulated failure');
    const products = await fetchProducts('us');
    if (!products.length) throw new Error('Apple returned no products');
    const wanted = [
      { model: 'MacBook Pro', screenSize: '14"', chip: 'M5 Pro', memory: '64 GB', storage: '1 TB', color: 'space black', year: '2026' },
      { model: 'MacBook Pro', screenSize: '16"', chip: 'M5 Pro', memory: '64 GB', storage: '1 TB', color: 'space black', year: '2026' },
      { model: 'MacBook Air', screenSize: '13"', chip: 'M5', memory: '32 GB', storage: '1 TB', color: 'midnight' },
      { model: 'MacBook Air', screenSize: '15"', chip: 'M5', memory: '32 GB', storage: '1 TB', color: 'midnight' },
    ];
    const matches = products.filter(p => wanted.some(w => Object.entries(w).every(([k, v]) => String((p.specs as unknown as Record<string, string>)[k]).toLowerCase() === v.toLowerCase())));
    for (const p of matches.filter(p => !state.matches.includes(p.partNumber))) {
      notify('Apple refurbished Mac available', `${p.title} — $${p.refurbPrice}`, p.url);
    }
    const now = new Date();
    state.checkedAt = now.toISOString();
    state.matches = matches.map(p => p.partNumber);
    state.failures = 0;
    state.failureNotified = false;
    await save(state);
    console.log(`Checked ${products.length} products; ${matches.length} matching.`);
  } catch (error) {
    state.failures = (state.failures || 0) + 1;
    if (state.failures >= 3 && !state.failureNotified) {
      try {
        notify('Apple Refurb Watcher needs attention', `Three checks failed. Last successful check: ${state.checkedAt ? new Date(state.checkedAt).toLocaleString() : 'none'}.`);
        state.failureNotified = true;
      } catch (notificationError) { console.error('Failure notification failed:', notificationError); }
    }
    await save(state);
    throw error;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
