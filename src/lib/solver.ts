// 精确排料求解器。
//
// 模型化简（已证明）：一条条材扣除头部修齐与疵点闭区间后得到若干初始极大
// 连续可用段（run）。裁片重量 = 裁片格数 + 右侧锯缝格数。在 run 内，把裁片
// 按标识升序从段首依次左叠即可同时达到：① 最小短余料；② 放置三元组字典序
// 最小——因为把任一「两侧皆空」的裁片向左滑到端点不会增加余料代价，且能
// 单调减小 (起点, 裁片标识) 序列。于是问题归约为带锁的一维装箱：
//   目标1：最少启用条材（至少装入一个裁片的条材）；
//   目标2：启用条材内短于复用阈值的余段总长最小；
//   目标3：放置三元组 (条材标识, 起点, 裁片标识) 序列字典序最小。
import type { Problem, Solution, Placement, Remnant, SolveResult, Unsat } from './types';
import { stripFreeRuns } from './geometry';

interface Bin {
  stripIdx: number;
  runIdx: number;
  from: number;
  to: number;
  capacity: number;
}

export interface PreparedProblem {
  bins: Bin[];
  stripBins: number[][]; // 每条材包含的 bin 下标
  weights: number[];     // 每个裁片的重量 = 长度 + 锯缝
  order: number[];       // 求解处理顺序：重量降序，标识次序兜底
}

export function prepareProblem(p: Problem): PreparedProblem {
  const bins: Bin[] = [];
  const stripBins: number[][] = p.strips.map(() => []);
  p.strips.forEach((s, si) => {
    const runs = stripFreeRuns(s);
    runs.forEach(([from, to], ri) => {
      stripBins[si].push(bins.length);
      bins.push({ stripIdx: si, runIdx: ri, from, to, capacity: to - from });
    });
  });
  const weights = p.pieces.map((pc) => pc.length + p.kerf);
  const order = p.pieces
    .map((_, i) => i)
    .sort((a, b) => {
      const byWeight = weights[b] - weights[a];
      return byWeight !== 0 ? byWeight : codePointCompare(p.pieces[a].id, p.pieces[b].id);
    });
  return { bins, stripBins, weights, order };
}

export function codePointCompare(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const d = A[i].codePointAt(0)! - B[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return A.length - B.length;
}

function compareTriples(a: Solution['triples'], b: Solution['triples']): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d1 = codePointCompare(a[i][0], b[i][0]);
    if (d1 !== 0) return d1;
    if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
    const d2 = codePointCompare(a[i][2], b[i][2]);
    if (d2 !== 0) return d2;
  }
  return a.length - b.length;
}

/** 由「每个 bin 装了哪些裁片」构造规范解：bin 内裁片按标识升序、从段首左叠 */
export function buildSolution(p: Problem, prep: PreparedProblem, binPieces: string[][]): Solution {
  const placements: Placement[] = [];
  const remnants: Remnant[] = [];
  const enabledStrips = new Set<number>();

  prep.bins.forEach((bin, bi) => {
    if (binPieces[bi].length > 0) enabledStrips.add(bin.stripIdx);
  });

  prep.bins.forEach((bin, bi) => {
    const ids = [...binPieces[bi]].sort(codePointCompare);
    let usedWeight = 0;
    for (const id of ids) {
      const piece = p.pieces.find((pc) => pc.id === id)!;
      placements.push({
        pieceId: id,
        stripId: p.strips[bin.stripIdx].id,
        start: bin.from + usedWeight,
      });
      usedWeight += piece.length + p.kerf;
    }
    if (enabledStrips.has(bin.stripIdx)) {
      const leftover = bin.capacity - usedWeight;
      if (leftover > 0) {
        const rem: Remnant = {
          stripId: p.strips[bin.stripIdx].id,
          from: bin.from + usedWeight,
          to: bin.to,
          cells: leftover,
          class: leftover < p.reuseThreshold ? 'scrap' : 'reusable',
        };
        remnants.push(rem);
      }
    }
  });

  let shortRemnantCells = 0;
  for (const r of remnants) if (r.class === 'scrap') shortRemnantCells += r.cells;

  const triples = placements
    .map((pl): Solution['triples'][number] => [pl.stripId, pl.start, pl.pieceId])
    .sort((a, b) =>
      codePointCompare(a[0], b[0]) || a[1] - b[1] || codePointCompare(a[2], b[2]),
    );

  return {
    placements,
    enabledStripIds: p.strips.filter((_, si) => enabledStrips.has(si)).map((s) => s.id),
    remnants,
    stripsUsed: enabledStrips.size,
    shortRemnantCells,
    triples,
  };
}

/** 对照贪心：最长料先放，best-fit，装不进才开新条材；可能提前判废。 */
export function ffdGreedy(p: Problem): Solution | null {
  const prep = prepareProblem(p);
  if (prep.bins.length === 0) return p.pieces.length === 0 ? emptySolution(p, prep) : null;
  const rem = prep.bins.map((b) => b.capacity);
  const binPieces = prep.bins.map(() => [] as string[]);

  // 锁定裁片先放，避免占掉锁定条材的容量；其余按重量降序
  const seq = [
    ...prep.order.filter((i) => p.pieces[i].lockedStripId !== null),
    ...prep.order.filter((i) => p.pieces[i].lockedStripId === null),
  ];
  for (const pi of seq) {
    const piece = p.pieces[pi];
    const w = prep.weights[pi];
    const candidates = prep.bins
      .map((b, bi) => ({ b, bi }))
      .filter(({ b }) =>
        piece.lockedStripId === null || p.strips[b.stripIdx].id === piece.lockedStripId,
      )
      .filter(({ bi }) => rem[bi] >= w)
      .sort((x, y) => rem[x.bi] - rem[y.bi] || x.bi - y.bi);
    if (candidates.length === 0) return null;
    const { bi } = candidates[0];
    rem[bi] -= w;
    binPieces[bi].push(piece.id);
  }
  return buildSolution(p, prep, binPieces);
}

function emptySolution(p: Problem, prep: PreparedProblem): Solution {
  return buildSolution(
    p,
    prep,
    prep.bins.map(() => []),
  );
}

const NODE_LIMIT = 30_000_000;
const TIME_LIMIT_MS = 10_000;

export function solve(problem: Problem): SolveResult {
  const p = problem;
  if (p.pieces.length === 0) {
    return { status: 'solved', solution: buildSolution(p, prepareProblem(p), prepareProblem(p).bins.map(() => [])) };
  }

  const prep = prepareProblem(p);
  const { bins, weights, order } = prep;
  const B = bins.length;
  const S = p.strips.length;

  if (B === 0) {
    return {
      status: 'unsat',
      unsat: { code: 'total-demand', message: '所有条材均无可用格，但存在待放裁片', totalNeed: weights.reduce((a, b) => a + b, 0), totalAvailable: 0 },
    };
  }

  // ---- 入搜索前的容量诊断 -------------------------------------------------
  const maxCap = Math.max(...bins.map((b) => b.capacity));
  for (const pi of order) {
    if (weights[pi] > maxCap) {
      const pc = p.pieces[pi];
      if (pc.lockedStripId !== null) {
        return { status: 'unsat', unsat: lockDiag(p, prep, [p.strips.findIndex((s) => s.id === pc.lockedStripId)]) };
      }
      return {
        status: 'unsat',
        unsat: { code: 'none', message: `裁片 ${pc.id}（含锯缝 ${weights[pi]} 格）放不进任何可用段（最长仅 ${maxCap} 格）` },
      };
    }
  }

  // 每个锁定条材：锁定裁片总需求 ≤ 该条材总可用格
  const badLockStrips = new Set<number>();
  p.strips.forEach((s, si) => {
    const need = p.pieces
      .filter((pc) => pc.lockedStripId === s.id)
      .reduce((sum, pc) => sum + pc.length + p.kerf, 0);
    const cap = prep.stripBins[si].reduce((sum, bi) => sum + bins[bi].capacity, 0);
    if (need > cap) badLockStrips.add(si);
  });
  if (badLockStrips.size > 0) {
    return { status: 'unsat', unsat: lockDiag(p, prep, [...badLockStrips]) };
  }

  const totalNeed = weights.reduce((a, b) => a + b, 0);
  const totalAvailable = bins.reduce((a, b) => a + b.capacity, 0);
  if (totalNeed > totalAvailable) {
    return {
      status: 'unsat',
      unsat: {
        code: 'total-demand',
        message: `总需求 ${(totalNeed / 10).toFixed(1)} mm（${totalNeed} 格，含锯缝）超过全部可用容量 ${(totalAvailable / 10).toFixed(1)} mm（${totalAvailable} 格）`,
        totalNeed,
        totalAvailable,
      },
    };
  }

  // ---- 两阶段精确搜索 -----------------------------------------------------
  // 阶段1：只优化 (f1, f2)，对称键忽略装入件身份（f2 只依赖最终余量，与身份
  //   无关），可大幅合并分支快速确定最优 f1/f2。
  // 阶段2：固定最优 f1/f2，对称键含装入件多重集，完整枚举取三元组字典序最小。
  let best: Solution | null = ffdGreedy(p);
  let bestF1 = best ? best.stripsUsed : S + 1;
  let bestF2 = best ? best.shortRemnantCells : Infinity;
  // 总是先跑阶段1证明最优 f1/f2（贪心解仅作上界），再跑阶段2取字典序。
  let phase: 1 | 2 = 1;

  // 后缀锁定条材集合（按处理顺序）
  const suffixLocks: Set<number>[] = order.map(() => new Set<number>());
  for (let k = order.length - 1; k >= 0; k--) {
    if (k < order.length - 1) suffixLocks[k] = new Set(suffixLocks[k + 1]);
    const lockId = p.pieces[order[k]].lockedStripId;
    if (lockId !== null) suffixLocks[k].add(p.strips.findIndex((s) => s.id === lockId));
  }

  // 条材几何签名：初始可用段完整位置 [from,to) 的多重集。几何完全相同的条材
  // 才是同构（只比容量会漏掉段起点差异，导致错误合并并列方案）。
  const stripSig = prep.stripBins.map((bis) =>
    bis.map((bi) => `${bins[bi].from}-${bins[bi].to}`).sort().join(','),
  );

  // 每条材「后缀将锁定到它的裁片标识多重集」。几何同构的两条材，只有后缀锁
  // 也相同才可在阶段1安全合并；否则锁定件将来的归属会让二者不等价。
  const stripLockSig = p.strips.map((s) =>
    p.pieces
      .filter((pc) => pc.lockedStripId === s.id)
      .map((pc) => pc.id)
      .sort()
      .join(','),
  );

  const rem = bins.map((b) => b.capacity);
  const enabled = new Array(S).fill(false);
  const binPieces: string[][] = bins.map(() => []);
  let usedStrips = 0;
  let nodes = 0;
  let limitHit = false;
  const startedAt = Date.now();
  // 阶段1置换表：同一深度下，未来只取决于「各 bin 余量 + 已启用条材集合」
  // （f1/f2 只依赖余量与启用集，与到达路径无关）。
  const memo = new Set<string>();

  const suffixTotal = order.map((_, idx) => {
    let sum = 0;
    for (let j = idx; j < order.length; j++) sum += weights[order[j]];
    return sum;
  });
  const stripTotalCap = prep.stripBins.map((bis) =>
    bis.reduce((sum, bi) => sum + bins[bi].capacity, 0),
  );
  const optionalStripsDesc = p.strips
    .map((_, si) => si)
    .sort((a, b) => stripTotalCap[b] - stripTotalCap[a]);

  // f1 下界（条材级体积放松，可证明合法）：后缀总重先由已启用条材全部 run 残量
  // 抵扣，强制锁定的未启用条材按总容量抵扣且条数固定计入，其余可选条材按总容量
  // 降序抵扣，每抵一条计一次 f1。放松了单件尺寸与 run 分割，只会少算条数。
  const lowerBoundStrips = (k: number, forcedNew: Set<number>): number => {
    let freeCapacity = 0;
    for (let si = 0; si < S; si++) {
      if (!enabled[si]) continue;
      for (const bi of prep.stripBins[si]) freeCapacity += rem[bi];
    }
    let residual = suffixTotal[k] - freeCapacity;
    for (const si of forcedNew) residual -= stripTotalCap[si];

    let extra = forcedNew.size;
    if (residual > 0) {
      for (const si of optionalStripsDesc) {
        if (enabled[si] || forcedNew.has(si)) continue;
        residual -= stripTotalCap[si];
        extra++;
        if (residual <= 0) break;
      }
    }
    return usedStrips + extra;
  };

  const dfs = (k: number): void => {
    if (limitHit) return;
    if (++nodes > NODE_LIMIT || ((nodes & 0x3fff) === 0 && Date.now() - startedAt > TIME_LIMIT_MS)) {
      limitHit = true;
      return;
    }
    if (k === order.length) {
      const cand = buildSolution(p, prep, binPieces);
      if (phase === 1) {
        if (
          best === null ||
          cand.stripsUsed < bestF1 ||
          (cand.stripsUsed === bestF1 && cand.shortRemnantCells < bestF2)
        ) {
          best = cand;
          bestF1 = cand.stripsUsed;
          bestF2 = cand.shortRemnantCells;
        }
      } else if (
        cand.stripsUsed === bestF1 &&
        cand.shortRemnantCells === bestF2 &&
        (best === null || best.stripsUsed !== bestF1 || best.shortRemnantCells !== bestF2 ||
          compareTriples(cand.triples, best.triples) < 0)
      ) {
        best = cand;
      }
      return;
    }

    const pi = order[k];
    const piece = p.pieces[pi];
    const w = weights[pi];

    // 阶段1置换表：固定深度 k 下，未来搜索只依赖各 bin 余量与已启用条材集合，
    // 与到达路径无关（已装件身份不影响 f1/f2，且后续件是固定的后缀）。
    if (phase === 1) {
      let emask = 0;
      for (let si = 0; si < S; si++) if (enabled[si]) emask |= 1 << si;
      const key = `${k}|${emask}|${rem.join(',')}`;
      if (memo.has(key)) return;
      memo.add(key);
    }

    // 剪枝①：乐观总容量
    let cap = 0;
    for (let si = 0; si < S; si++) {
      for (const bi of prep.stripBins[si]) {
        cap += enabled[si] ? rem[bi] : bins[bi].capacity;
      }
    }
    if (suffixTotal[k] > cap) return;

    // 剪枝②：后缀锁定而未启用的条材必然计入
    const forcedNew = new Set<number>();
    for (const si of suffixLocks[k]) if (!enabled[si]) forcedNew.add(si);

    // 剪枝③：锁定条材须容得下后缀锁给它的裁片
    for (const si of forcedNew) {
      let need = 0;
      for (let j = k; j < order.length; j++) {
        const pj = p.pieces[order[j]];
        if (pj.lockedStripId === p.strips[si].id) need += weights[order[j]];
      }
      if (need > stripTotalCap[si]) return;
    }

    // 剪枝④：f1 下界
    if (lowerBoundStrips(k, forcedNew) > bestF1) return;

    if (phase === 2) {
      // 最终必须恰好 bestF1 条（后缀锁定的未启用条材也必计入）
      if (usedStrips + forcedNew.size > bestF1) return;
    }

    const lockSi = piece.lockedStripId === null ? null : p.strips.findIndex((s2) => s2.id === piece.lockedStripId);
    const raw: number[] = [];
    for (let bi = 0; bi < B; bi++) {
      if (rem[bi] < w) continue;
      if (lockSi !== null && bins[bi].stripIdx !== lockSi) continue;
      raw.push(bi);
    }
    // 已启用条材优先（少开条材）；组内按 (条材标识, 段起点) 先探索字典序小解
    raw.sort((x, y) => {
      const ex = enabled[bins[x].stripIdx] ? 0 : 1;
      const ey = enabled[bins[y].stripIdx] ? 0 : 1;
      if (ex !== ey) return ex - ey;
      const idc = codePointCompare(p.strips[bins[x].stripIdx].id, p.strips[bins[y].stripIdx].id);
      return idc || bins[x].from - bins[y].from;
    });

    // 对称剪枝：
    //  阶段1（只优化 f1/f2）：把本片放进一根全新条材（未启用、各 bin 皆空）时，
    //    只在「几何签名相同、后缀锁签名相同、且同族条材全部全新」的条材间合并，
    //    且用 run 起点区分对应 run（同条材不同 run 绝不合并）。
    //  阶段2（取三元组字典序）：全新条材合并不安全（大片占据后小片无处可去会
    //    改变条材归属），因此不做任何跨条材合并，完整枚举。
    const cands: number[] = [];
    const seenFresh = new Set<string>();
    for (const bi of raw) {
      const si = bins[bi].stripIdx;
      if (phase === 1 &&
          lockSi === null &&
          !enabled[si] &&
          prep.stripBins[si].every((q) => binPieces[q].length === 0)) {
        let familyOk = true;
        for (let sj = 0; sj < S; sj++) {
          if (sj === si) continue;
          if (stripSig[sj] !== stripSig[si] || stripLockSig[sj] !== stripLockSig[si]) continue;
          if (enabled[sj] || prep.stripBins[sj].some((q) => binPieces[q].length > 0)) {
            familyOk = false;
            break;
          }
        }
        if (familyOk) {
          const key = `${stripSig[si]}|${stripLockSig[si]}|from${bins[bi].from}`;
          if (seenFresh.has(key)) continue;
          seenFresh.add(key);
        }
      }
      cands.push(bi);
    }

    for (const bi of cands) {
      const bin = bins[bi];
      const wasEnabled = enabled[bin.stripIdx];
      rem[bi] -= w;
      binPieces[bi].push(piece.id);
      if (!wasEnabled) {
        enabled[bin.stripIdx] = true;
        usedStrips++;
      }
      dfs(k + 1);
      binPieces[bi].pop();
      rem[bi] += w;
      if (!wasEnabled) {
        enabled[bin.stripIdx] = false;
        usedStrips--;
      }
    }
  };

  // 阶段1：求最优 f1/f2
  dfs(0);
  if (limitHit) {
    return {
      status: 'limit',
      message: `精确搜索超过预算（${TIME_LIMIT_MS / 1000} 秒），这通常是接近满载的纯装箱紧实例；请减少裁片数、加大条材或调整锁定后重试`,
    };
  }
  if (best === null) {
    return {
      status: 'unsat',
      unsat: { code: 'none', message: '总容量虽然足够，但受疵点分割与锁定约束，没有任何可行落刀方案' },
    };
  }

  // 阶段2：固定最优 f1/f2，重置搜索状态做完整枚举取三元组字典序最小
  for (let bi = 0; bi < B; bi++) {
    rem[bi] = bins[bi].capacity;
    binPieces[bi] = [];
  }
  enabled.fill(false);
  usedStrips = 0;
  const phase1Best = best;
  // 阶段2获得独立的时间/节点预算
  limitHit = false;
  nodes = 0;
  phase = 2; dfs(0);

  if (limitHit) {
    // 阶段2超时：返回阶段1的最优 f1/f2 解（三元组未必字典序最小）不可接受，
    // 但保证 f1/f2 已最优；按需求「不展示半成品」，这里报 limit。
    return {
      status: 'limit',
      message: `已确定最优条材数（${phase1Best.stripsUsed}）与短料量（${(phase1Best.shortRemnantCells / 10).toFixed(1)} mm），但并列方案过多，预算内无法完成字典序收敛；请减少裁片数后重试`,
    };
  }
  return { status: 'solved', solution: best };
}

function lockDiag(p: Problem, prep: PreparedProblem, stripIdxs: number[]): Unsat {
  const offendingLocks = stripIdxs.map((si) => {
    const ids = p.pieces.filter((pc) => pc.lockedStripId === p.strips[si].id).map((pc) => pc.id);
    const lockedCells = p.pieces
      .filter((pc) => pc.lockedStripId === p.strips[si].id)
      .reduce((sum, pc) => sum + pc.length + p.kerf, 0);
    const usableCells = prep.stripBins[si].reduce((sum, bi) => sum + prep.bins[bi].capacity, 0);
    return { stripId: p.strips[si].id, pieceIds: ids, lockedCells, usableCells };
  });
  const detail = offendingLocks
    .map((o) => {
      const needMm = (o.lockedCells / 10).toFixed(1);
      const capMm = (o.usableCells / 10).toFixed(1);
      return `条材 ${o.stripId}：锁定 [${o.pieceIds.join('、')}] 需 ${needMm} mm（${o.lockedCells} 格，含锯缝），可用仅 ${capMm} mm（${o.usableCells} 格）`;
    })
    .join('；');
  return {
    code: 'lock-capacity',
    message: `锁定项造成容量冲突——${detail}`,
    offendingLocks,
  };
}
