import { describe, it, expect } from 'vitest';
import { solve, ffdGreedy, buildSolution, prepareProblem, codePointCompare } from '../src/lib/solver';
import type { Problem, Strip, Piece } from '../src/lib/types';

const mk = (over: Partial<Problem> = {}): Problem => ({
  strips: [],
  pieces: [],
  kerf: 0,
  reuseThreshold: 100,
  ...over,
});
const strip = (id: string, length: number, opt: Partial<Strip> = {}): Strip => ({ id, length, headTrim: 0, defects: [], ...opt });
const piece = (id: string, length: number, lockedStripId: string | null = null): Piece => ({ id, length, lockedStripId });

function placementsOf(p: Problem) {
  const r = solve(p);
  if (r.status !== 'solved') throw new Error(`expected solved, got ${r.status === 'unsat' ? r.unsat.message : r.message}`);
  return r.solution;
}

describe('求解器：目标①最少启用条材', () => {
  it('简单两箱可行', () => {
    const p = mk({ strips: [strip('S1', 100), strip('S2', 100)], pieces: [piece('P1', 60), piece('P2', 55), piece('P3', 40)], reuseThreshold: 1000 });
    const s = placementsOf(p);
    expect(s.stripsUsed).toBe(2);
    expect(s.placements).toHaveLength(3);
    // 60+40 装满一根，55 独一根
    const loads = new Map<string, number>();
    for (const pl of s.placements) loads.set(pl.stripId, (loads.get(pl.stripId) ?? 0) + p.pieces.find((x) => x.id === pl.pieceId)!.length);
    expect([...loads.values()].sort((a, b) => a - b)).toEqual([55, 100]);
  });

  it('最长料先放贪心在穷举反例上失败（需 4 条），精确搜索只用 3 条', () => {
    // 穷举得到的最小反例之一：容量 14，物品 8,8,6,5,4,4,3,2,2（总和 42）
    // 最优 3 条：8+4+2 / 8+4+2 / 6+5+3；best-fit 贪心开第 4 条 → 提前报无
    const strips = [strip('S1', 14), strip('S2', 14), strip('S3', 14)];
    const pieces = [
      piece('P8a', 8), piece('P8b', 8), piece('P6', 6), piece('P5', 5),
      piece('P4a', 4), piece('P4b', 4), piece('P3', 3), piece('P2a', 2), piece('P2b', 2),
    ];
    const p = mk({ strips, pieces, reuseThreshold: 1000 });
    const g = ffdGreedy(p);
    expect(g).toBeNull(); // 贪心明明有解却提前报废
    const s = placementsOf(p);
    expect(s.stripsUsed).toBe(3);
    const loads = new Map<string, number>();
    for (const pl of s.placements) loads.set(pl.stripId, (loads.get(pl.stripId) ?? 0) + p.pieces.find((x) => x.id === pl.pieceId)!.length);
    expect([...loads.values()].sort()).toEqual([14, 14, 14]);
    expect(s.shortRemnantCells).toBe(0);
  });
});

describe('求解器：目标②最小化短余料总长', () => {
  it('优先填满：两个 10 容箱与 6,5,5,4 选 6+4 / 5+5 而非 6+5 / 5+4', () => {
    const p = mk({
      strips: [strip('S1', 10), strip('S2', 10)],
      pieces: [piece('P1', 6), piece('P2', 5), piece('P3', 5), piece('P4', 4)],
      reuseThreshold: 1000,
    });
    const s = placementsOf(p);
    expect(s.stripsUsed).toBe(2);
    expect(s.shortRemnantCells).toBe(0);
    const onS1 = s.placements.filter((pl) => pl.stripId === 'S1').map((pl) => pl.pieceId).sort();
    expect(onS1.sort()).toEqual(['P1', 'P4']);
  });

  it('同条材优先装入：30+30=60 装入一条，余 40 按阈值分类', () => {
    const p = mk({
      strips: [strip('S1', 100), strip('S2', 100)],
      pieces: [piece('P1', 30), piece('P2', 30)],
      reuseThreshold: 50,
    });
    const s = placementsOf(p);
    expect(s.stripsUsed).toBe(1); // 先比条材数
    expect(s.shortRemnantCells).toBe(40); // 余 40 < 50 → 短余料
  });

  it('复用阈值边界：余段长度 >= 阈值即可复用', () => {
    const p = mk({
      strips: [strip('S1', 100)],
      pieces: [piece('P1', 50)],
      reuseThreshold: 50,
    });
    const s = placementsOf(p);
    expect(s.shortRemnantCells).toBe(0);
    expect(s.remnants[0]).toMatchObject({ from: 50, to: 100, class: 'reusable' });
  });

  it('余段为极大连续可用段，疵点后残留分别分类', () => {
    const p = mk({
      strips: [strip('S1', 100, { defects: [{ id: 'D1', from: 60, to: 69 }] })], // runs [0,60),[70,100)
      pieces: [piece('P1', 55)],
      reuseThreshold: 20,
    });
    const s = placementsOf(p);
    // 放 [0,55)：余段 [55,60)=5 scrap；空 run [70,100)=30 reusable
    const scraps = s.remnants.filter((r) => r.class === 'scrap').map((r) => r.cells);
    const reusable = s.remnants.filter((r) => r.class === 'reusable').map((r) => r.cells);
    expect(scraps).toEqual([5]);
    expect(reusable).toEqual([30]);
    expect(s.shortRemnantCells).toBe(5);
  });
});

describe('求解器：目标③放置三元组字典序', () => {
  it('并列时小标识裁片落在字典序最小的条材，且段内按标识升序左叠', () => {
    const p = mk({
      strips: [strip('S1', 10), strip('S2', 10)],
      pieces: [piece('P1', 4), piece('P2', 6)],
      reuseThreshold: 1000,
    });
    const s = placementsOf(p);
    // 4+6 装满一条，短余料都为 0；字典序取 S1，段内 P1 在左、P2 在右
    expect(s.placements.find((pl) => pl.pieceId === 'P1')).toMatchObject({ stripId: 'S1', start: 0 });
    expect(s.placements.find((pl) => pl.pieceId === 'P2')).toMatchObject({ stripId: 'S1', start: 4 });
    expect(s.enabledStripIds).toEqual(['S1']);
    expect(s.triples).toEqual([['S1', 0, 'P1'], ['S1', 4, 'P2']]);
  });

  it('codePointCompare 按码点比较', () => {
    expect(codePointCompare('a', 'b')).toBeLessThan(0);
    expect(codePointCompare('P10', 'P2')).toBeLessThan(0);
    expect(codePointCompare('P1', 'P10')).toBeLessThan(0);
  });
});

describe('锯缝：右侧锯缝占格且不得碰不可用格', () => {
  it('锯缝计入容量：6+2+6+2+8+2=26 > 22 总量，无解', () => {
    const p = mk({
      strips: [strip('S1', 22)],
      pieces: [piece('P1', 6), piece('P2', 6), piece('P3', 8)],
      kerf: 2,
      reuseThreshold: 1000,
    });
    const r = solve(p);
    expect(r.status).toBe('unsat');
    if (r.status === 'unsat') expect(r.unsat.code).toBe('total-demand');
  });

  it('漏算锯缝会把方案落进疵点：裁片恰好顶到疵点时右侧锯缝越界 → 必须换段', () => {
    // 条材 [0,110)，疵点 [50,54] → runs [0,50),[55,110)
    // 裁片 48 + 锯缝 2 = 50 重量：P1 恰好贴疵点（锯缝格 [48,50) 合法）；
    // P2 若忽略锯缝看似可从 52 放（锯缝会压住疵点 52,53,54）→ 必须从 55 起
    const p = mk({
      strips: [strip('S1', 110, { defects: [{ id: 'D1', from: 50, to: 54 }] })],
      pieces: [piece('P1', 48), piece('P2', 48)],
      kerf: 2,
      reuseThreshold: 1000,
    });
    const s = placementsOf(p);
    const byId = Object.fromEntries(s.placements.map((pl) => [pl.pieceId, pl]));
    expect(byId.P1).toMatchObject({ stripId: 'S1', start: 0 });
    expect(byId.P1.start + 48 + 2).toBe(50);
    expect(byId.P2.start).toBe(55);
    expect(byId.P2.start + 48 + 2).toBe(105);
  });

  it('锯缝为 0 时同一裁片可贴段末', () => {
    const p = mk({
      strips: [strip('S1', 50, { defects: [{ id: 'D1', from: 50, to: 50 }].slice(0, 0) })],
      pieces: [piece('P1', 50)],
      kerf: 0,
      reuseThreshold: 1000,
    });
    const s = placementsOf(p);
    expect(s.placements[0]).toMatchObject({ stripId: 'S1', start: 0 });
  });

  it('buildSolution 给出的相邻裁片间恰有一个锯缝', () => {
    const p = mk({
      strips: [strip('S1', 30)],
      pieces: [piece('P1', 10), piece('P2', 10)],
      kerf: 2,
      reuseThreshold: 1000,
    });
    const s = placementsOf(p);
    const a = s.placements.find((x) => x.pieceId === 'P1')!;
    const b = s.placements.find((x) => x.pieceId === 'P2')!;
    expect(b.start - (a.start + 10)).toBe(2);
  });
});

describe('疵点与头部修齐', () => {
  it('头部修齐后首段从 headTrim 开始', () => {
    const p = mk({
      strips: [strip('S1', 100, { headTrim: 7 })],
      pieces: [piece('P1', 10)],
      kerf: 0,
      reuseThreshold: 1000,
    });
    const s = placementsOf(p);
    expect(s.placements[0].start).toBe(7);
  });

  it('疵点分割后长裁片必须换条材', () => {
    const p = mk({
      strips: [strip('S1', 100, { defects: [{ id: 'D1', from: 40, to: 44 }] }), strip('S2', 100)],
      pieces: [piece('P1', 60)],
      kerf: 0,
      reuseThreshold: 1000,
    });
    const s = placementsOf(p);
    expect(s.placements[0].stripId).toBe('S2');
  });
});

describe('锁定：只限定条材，起点仍由求解器选', () => {
  it('锁定裁片放指定条材，起点自动找最优，装不下的裁片去别的条材', () => {
    const p = mk({
      strips: [strip('S1', 100), strip('S2', 100)],
      pieces: [piece('P1', 80, 'S2'), piece('P2', 30)],
      kerf: 0,
      reuseThreshold: 1000,
    });
    const s = placementsOf(p);
    // P1 锁定 S2（余 20 装不下 P2），P2 必须启用 S1
    expect(s.placements.find((x) => x.pieceId === 'P1')!.stripId).toBe('S2');
    expect(s.placements.find((x) => x.pieceId === 'P2')!.stripId).toBe('S1');
    expect(s.stripsUsed).toBe(2);
  });

  it('锁定项容量冲突明确标出，不返回半成品', () => {
    const p = mk({
      strips: [strip('S1', 100), strip('S2', 100)],
      pieces: [piece('P1', 60, 'S1'), piece('P2', 60, 'S1')],
      kerf: 2,
    });
    const r = solve(p);
    expect(r.status).toBe('unsat');
    if (r.status === 'unsat') {
      expect(r.unsat.code).toBe('lock-capacity');
      expect(r.unsat.offendingLocks![0].stripId).toBe('S1');
      expect(r.unsat.offendingLocks![0].lockedCells).toBe(124);
      expect(r.unsat.offendingLocks![0].usableCells).toBe(100);
    }
  });

  it('锁定裁片含锯缝超过该条材最大段时诊断为锁定冲突', () => {
    const p = mk({
      strips: [strip('S1', 100, { defects: [{ id: 'D1', from: 20, to: 60 }] })], // runs 20,39
      pieces: [piece('P1', 38, 'S1')],
      kerf: 2, // 重量 40 > 39
    });
    const r = solve(p);
    expect(r.status).toBe('unsat');
    if (r.status === 'unsat') expect(r.unsat.code).toBe('lock-capacity');
  });
});

describe('无解诊断', () => {
  it('总需求超容给出 total-demand 与具体数字', () => {
    const p = mk({ strips: [strip('S1', 10)], pieces: [piece('P1', 6), piece('P2', 6)], kerf: 0 });
    const r = solve(p);
    expect(r.status).toBe('unsat');
    if (r.status === 'unsat') {
      expect(r.unsat.code).toBe('total-demand');
      expect(r.unsat.totalNeed).toBe(12);
      expect(r.unsat.totalAvailable).toBe(10);
    }
  });

  it('单裁片超过任何段给出 none 诊断', () => {
    const p = mk({ strips: [strip('S1', 10)], pieces: [piece('P1', 11)], kerf: 0 });
    const r = solve(p);
    expect(r.status).toBe('unsat');
    if (r.status === 'unsat') expect(r.unsat.code).toBe('none');
  });
});

describe('buildSolution 余料核算一致性', () => {
  it('空问题得到 0 条材、0 余料', () => {
    const p = mk({ strips: [strip('S1', 100)] });
    const prep = prepareProblem(p);
    const s = buildSolution(p, prep, prep.bins.map(() => []));
    expect(s.stripsUsed).toBe(0);
    expect(s.shortRemnantCells).toBe(0);
    expect(s.remnants).toEqual([]);
  });

  it('零裁片直接返回空解', () => {
    const p = mk({ strips: [strip('S1', 100), strip('S2', 50)], pieces: [] });
    const r = solve(p);
    expect(r.status).toBe('solved');
    if (r.status === 'solved') {
      expect(r.solution.stripsUsed).toBe(0);
      expect(r.solution.placements).toEqual([]);
      expect(r.solution.enabledStripIds).toEqual([]);
    }
  });

  it('所有条材无可用格但有裁片 → total-demand 而非半成品', () => {
    const p = mk({ strips: [strip('S1', 10, { headTrim: 10 })], pieces: [piece('P1', 1)] });
    const r = solve(p);
    expect(r.status).toBe('unsat');
    if (r.status === 'unsat') expect(r.unsat.code).toBe('total-demand');
  });
});
