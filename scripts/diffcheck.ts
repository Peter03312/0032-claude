// 求解器正确性的随机差分测试：与独立暴力枚举器对照三个目标层级。
// 用法：npx vite-node scripts/diffcheck.ts（不在 vitest 套件内）
import { solve } from '../src/lib/solver';
import type { Problem, Strip, Piece } from '../src/lib/types';
import { stripFreeRuns } from '../src/lib/geometry';

interface RunInfo { si: number; from: number; to: number; cap: number }

// 独立暴力：枚举每片落到哪个 run；叶节点按规范几何（run 内裁片标识升序左叠）计分
function brute(p: Problem) {
  const runsPerStrip = p.strips.map((s) => stripFreeRuns(s));
  const runs: RunInfo[] = [];
  p.strips.forEach((s, si) => runsPerStrip[si].forEach(([from, to]) => runs.push({ si, from, to, cap: to - from })));
  const w = p.pieces.map((pc) => pc.length + p.kerf);

  const canonTriples = (assign: number[][]) => {
    const triples: Array<[string, number, string]> = [];
    const used = runs.map(() => 0);
    let f2 = 0;
    runs.forEach((run, ri) => {
      const ids = assign[ri].map((idx) => p.pieces[idx].id).sort();
      let u = 0;
      for (const id of ids) {
        const idx = p.pieces.findIndex((pc) => pc.id === id);
        triples.push([p.strips[run.si].id, run.from + u, id]);
        u += w[idx];
      }
      used[ri] = u;
    });
    const enabledStrip = new Set<number>();
    assign.forEach((a, ri) => { if (a.length > 0) enabledStrip.add(runs[ri].si); });
    runs.forEach((run, ri) => {
      const leftover = run.cap - used[ri];
      if (leftover > 0 && enabledStrip.has(run.si) && leftover < p.reuseThreshold) f2 += leftover;
    });
    triples.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0)));
    return { f1: enabledStrip.size, f2, triples };
  };

  const cmpTriples = (a: Array<[string, number, string]>, b: Array<[string, number, string]>) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i][0] !== b[i][0]) return a[i][0] < b[i][0] ? -1 : 1;
      if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
      if (a[i][2] !== b[i][2]) return a[i][2] < b[i][2] ? -1 : 1;
    }
    return a.length - b.length;
  };

  let best: { f1: number; f2: number; triples: Array<[string, number, string]> } | null = null;
  const assign: number[][] = runs.map(() => []);
  const used = runs.map(() => 0);

  const go = (i: number) => {
    if (i === p.pieces.length) {
      const cand = canonTriples(assign);
      const better = !best || cand.f1 < best.f1 ||
        (cand.f1 === best.f1 && cand.f2 < best.f2) ||
        (cand.f1 === best.f1 && cand.f2 === best.f2 && cmpTriples(cand.triples, best.triples) < 0);
      if (better) best = cand;
      return;
    }
    const pc = p.pieces[i];
    runs.forEach((run, ri) => {
      if (pc.lockedStripId && p.strips[run.si].id !== pc.lockedStripId) return;
      if (run.cap - used[ri] < w[i]) return;
      used[ri] += w[i];
      assign[ri].push(i);
      go(i + 1);
      assign[ri].pop();
      used[ri] -= w[i];
    });
  };
  go(0);
  return best;
}

// 确定性 LCG
let seed = 20260913;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };

const genStrips = (): Strip[] => {
  const n = 1 + Math.floor(rnd() * 3);
  return Array.from({ length: n }, (_, i): Strip => {
    const L = 15 + Math.floor(rnd() * 70);
    const headTrim = rnd() < 0.4 ? Math.floor(rnd() * 5) : 0;
    const defects: Strip['defects'] = [];
    let cursor = headTrim;
    while (rnd() < 0.5) {
      const f = cursor + Math.floor(rnd() * 8);
      const t = f + Math.floor(rnd() * 4);
      if (t < L - 1) defects.push({ id: `D${defects.length + 1}`, from: f, to: t });
      cursor = t + 2 + Math.floor(rnd() * 6);
      if (cursor >= L - 2) break;
    }
    return { id: `S${i + 1}`, length: L, headTrim, defects };
  });
};

let tested = 0;
let unsatCount = 0;
for (let iter = 0; iter < 800; iter++) {
  const strips = genStrips();
  const np = 1 + Math.floor(rnd() * 8);
  const pieces: Piece[] = Array.from({ length: np }, (_, i) => {
    const len = 2 + Math.floor(rnd() * 30);
    const lock = rnd() < 0.35 ? strips[Math.floor(rnd() * strips.length)].id : null;
    return { id: `P${i + 1}`, length: len, lockedStripId: lock };
  });
  const p: Problem = {
    strips, pieces,
    kerf: rnd() < 0.6 ? Math.floor(rnd() * 3) : 0,
    reuseThreshold: [0, 5, 15, 30, 100][Math.floor(rnd() * 5)],
  };
  const r = solve(p);
  const b = brute(p);
  if (b === null) {
    unsatCount++;
    if (r.status !== 'unsat' && r.status !== 'limit') throw new Error(`iter ${iter}: 暴力无解但求解器给解`);
    continue;
  }
  if (r.status !== 'solved') throw new Error(`iter ${iter}: 暴力有解但求解器报 ${r.status}`);
  const s = r.solution;
  if (s.stripsUsed !== b.f1) throw new Error(`iter ${iter}: f1 ${s.stripsUsed} != ${b.f1}\n${JSON.stringify(p)}`);
  if (s.shortRemnantCells !== b.f2) throw new Error(`iter ${iter}: f2 ${s.shortRemnantCells} != ${b.f2}\n${JSON.stringify(p)}`);
  if (JSON.stringify(s.triples) !== JSON.stringify(b.triples)) {
    throw new Error(`iter ${iter}: triples mismatch\n${JSON.stringify(s.triples)}\n${JSON.stringify(b.triples)}\n${JSON.stringify(p)}`);
  }
  tested++;
}
console.log(`差分测试通过：${tested} 个有解 + ${unsatCount} 个无解随机实例，f1/f2/三元组字典序与暴力枚举完全一致`);
