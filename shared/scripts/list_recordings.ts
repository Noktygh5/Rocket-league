// Lists every recording: when, match length, live play, final score, boss version, whether it was played to the end, and who won.
// Usage (from shared/): npx tsx scripts/list_recordings.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = join(process.cwd(), '..', 'Recordings');
const out: string[] = [];
for (const d of readdirSync(root).filter((x) => existsSync(join(root, x, 'meta.json'))).sort()) {
  const meta = JSON.parse(readFileSync(join(root, d, 'meta.json'), 'utf8'));
  const rows = existsSync(join(root, d, 'telemetry.ndjson')) ? readFileSync(join(root, d, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const ticks = rows.filter((r: any) => r.k === 't');
  const live = ticks.filter((r: any) => r.ph === 1).length * 4 / 120;
  const last = ticks[ticks.length - 1];
  const ended = ticks.some((r: any) => r.ph === 3) || !!meta.endedAt;
  const sc = last?.sc ?? [0, 0];
  const bot = meta.players?.findIndex((p: any) => p.isBot) ?? 1;
  const botGoals = sc[bot], humGoals = sc[1 - bot];
  const result = !ended ? 'unfinished' : botGoals > humGoals ? 'BOSS WON' : botGoals < humGoals ? 'BOSS LOST' : 'draw';
  out.push(`${d.slice(0, 19)}  len ${String(meta.matchLengthSeconds ?? '?').padStart(3)} s  live ${live.toFixed(0).padStart(3)} s  score human ${humGoals}-${botGoals} boss  ${result.padEnd(10)} ${ended ? 'ended' : 'NOT ended'}  ${meta.botVersion ? 'v:' + String(meta.botVersion).slice(0, 4) : 'v:-'}  ${meta.players?.[0]?.name ?? ''}`);
}
console.log(out.join('\n'));
