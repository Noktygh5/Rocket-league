// Lab: shot accuracy. Every boss touch that sends the ball toward the opponent's goal at 1,300+ uu/s is a shot; the ball is then predicted with
// no cars and classified: on target (crosses the line inside the posts), wide (outside), or blocked/short (never reaches the line in 4 s).
// Opponent: none (parked far away) or a keeper (Hard bot in goal). Usage: npx tsx scripts/lab_shots.ts [opponent=parked|keeper] [matches=6] [seconds=90] [seedBase=1]
import { GameSim, Phase, createBot, defaultConfig, ARENA } from '../src';
import { BallPath, predictBall } from '../src/bot/predict';
const opp = process.argv[2] ?? 'parked', n = Number(process.argv[3] ?? 6), secs = Number(process.argv[4] ?? 90), seedBase = Number(process.argv[5] ?? 1), L = ARENA.halfLength, GH = ARENA.goal.halfWidth;
const path = new BallPath(); let on = 0, wide = 0, short = 0, push = 0, goals = 0; const wideBy: number[] = [];
for (let i = 0; i < n; i++) {
  const bi = i % 2, oi = 1 - bi, att = bi === 0 ? 1 : -1;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 400 + seedBase + i), matchLength: secs, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, bi, 400 + seedBase + i);
  const other: any = opp === 'keeper' ? createBot('hard', sim, oi, 450 + seedBase + i) : null;
  const k = sim.cars[bi], o = sim.cars[oi];
  let t = 0, lastTouch = -1;
  while (sim.phase !== Phase.Ended && t < secs * 120 + 7200) {
    boss.think(); other?.think(); if (!other && sim.phase === Phase.Playing) { o.pos.x = 3500; o.pos.y = -att * (L - 600); o.vel.x = o.vel.y = 0; } sim.step(); t++;
    if (sim.overtime) break;
    if (sim.phase !== Phase.Playing) { lastTouch = k.lastTouchTick; continue; }
    if (k.lastTouchTick !== lastTouch && k.lastTouchTick >= 0) {
      lastTouch = k.lastTouchTick;
      const b = sim.ball; const sp = Math.hypot(b.vel.x, b.vel.y);
      if (b.vel.y * att > 0 && sp > 1300 && b.pos.y * att > 0) {
        predictBall(path, b, 4, 2);
        let res = 'short';
        if (path.goalSide === att) res = 'on';
        else {
          let best = -1e9, bx = 0;
          for (let j = 0; j < path.n; j++) if (path.y[j] * att > best) { best = path.y[j] * att; bx = path.x[j]; }
          if (best > L - 300) { if (Math.abs(bx) - GH > 1500) res = 'push'; else { res = 'wide'; wideBy.push(Math.abs(bx) - GH); } }
        }
        if (res === 'on') on++; else if (res === 'wide') wide++; else if (res === 'short') short++; else push++;
      }
    }
  }
  goals += sim.score[bi];
}
const tot = on + wide;
wideBy.sort((a, b) => a - b);
console.log(`boss shots vs ${opp}: ${tot} (${on} on target, ${wide} wide of the post by under 1,500 uu; not counted: ${push} pushes up the wall, ${short} stopped short), goals ${goals}; wide shots miss the post by a median ${wideBy.length ? wideBy[Math.floor(wideBy.length / 2)].toFixed(0) : '-'} uu`);
