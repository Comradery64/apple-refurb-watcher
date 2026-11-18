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
    const matches = products.filter(p => p.specs.model === 'MacBook Pro' && /14/.test(p.specs.screenSize) && p.specs.memory === '64 GB' && p.specs.storage === '1 TB' && p.specs.color.toLowerCase() === 'space black' && p.specs.year === '2026');
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
