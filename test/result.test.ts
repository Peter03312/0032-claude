import { describe, it, expect } from 'vitest';
import { buildResultModel, solutionToJson } from '../src/lib/result';
import { solve } from '../src/lib/solver';
import type { Problem } from '../src/lib/types';

const mk = (over: Partial<Problem> = {}): Problem => ({
  strips: [], pieces: [], kerf: 0, reuseThreshold: 100, ...over,
});

describe('结果图算法', () => {
  it('标注落刀坐标（含锯缝后缘）与区域段', () => {
    const p = mk({
      strips: [{ id: 'S1', length: 50, headTrim: 2, defects: [{ id: 'D1', from: 20, to: 21 }] }],
      pieces: [{ id: 'P1', length: 10, lockedStripId: null }],
      kerf: 1,
      reuseThreshold: 1000,
    });
    const r = solve(p);
    expect(r.status).toBe('solved');
    if (r.status !== 'solved') return;
    const model = buildResultModel(p, r.solution);
    const sv = model.strips[0];
    // 首段 [2,20)：裁片起点 2，末端 12，锯缝后缘 13
    expect(sv.cuts[0]).toMatchObject({ pieceId: 'P1', start: 2, end: 12, kerfEnd: 13, startMm: '0.2', endMm: '1.2', kerfEndMm: '1.3' });
    const kinds = sv.segments.map((s) => s.kind);
    expect(kinds).toContain('trim');
    expect(kinds).toContain('defect');
    expect(kinds).toContain('piece');
    expect(kinds).toContain('kerf');
    // 区域段不重叠地铺满整条
    let cursor = 0;
    for (const s of sv.segments) { expect(s.from).toBe(cursor); cursor = s.to; }
    expect(cursor).toBe(50);
    // 疵点段带 id
    expect(sv.segments.find((s) => s.kind === 'defect')!.defectId).toBe('D1');
  });

  it('余段按复用阈值分类，目标值汇总正确', () => {
    const p = mk({
      strips: [{ id: 'S1', length: 100, headTrim: 0, defects: [{ id: 'D1', from: 60, to: 69 }] }],
      pieces: [{ id: 'P1', length: 55, lockedStripId: null }],
      kerf: 0,
      reuseThreshold: 20,
    });
    const r = solve(p);
    expect(r.status).toBe('solved');
    if (r.status !== 'solved') return;
    const model = buildResultModel(p, r.solution);
    expect(model.objective).toMatchObject({ stripsUsed: 1, shortRemnantCells: 5, shortRemnantMm: '0.5' });
    const sv = model.strips[0];
    expect(sv.remnants.map((x) => [x.from, x.to, x.cells, x.class])).toEqual([
      [55, 60, 5, 'scrap'],
      [70, 100, 30, 'reusable'],
    ]);
  });

  it('未启用条材不出现在余段统计中', () => {
    const p = mk({
      strips: [{ id: 'S1', length: 100, headTrim: 0, defects: [] }, { id: 'S2', length: 100, headTrim: 0, defects: [] }],
      pieces: [{ id: 'P1', length: 10, lockedStripId: null }],
      reuseThreshold: 200,
    });
    const r = solve(p);
    expect(r.status).toBe('solved');
    if (r.status !== 'solved') return;
    const model = buildResultModel(p, r.solution);
    const s2 = model.strips.find((s) => s.stripId === 'S2')!;
    expect(s2.enabled).toBe(false);
    expect(s2.remnants).toEqual([]);
    // S1 余 90 < 200 → 短余料 90 格；S2 整根不计
    expect(model.objective.shortRemnantCells).toBe(90);
  });

  it('方案 JSON 含目标值、放置坐标与余段分类', async () => {
    const p = mk({
      strips: [{ id: 'S1', length: 30, headTrim: 0, defects: [] }],
      pieces: [{ id: 'P1', length: 10, lockedStripId: null }],
      kerf: 2,
      reuseThreshold: 100,
    });
    const r = solve(p);
    expect(r.status).toBe('solved');
    if (r.status !== 'solved') return;
    const json = solutionToJson(p, r.solution) as any;
    expect(json.unit).toBe('0.1mm-grid');
    expect(json.objective.stripsUsed).toBe(1);
    expect(json.placements[0]).toMatchObject({ pieceId: 'P1', stripId: 'S1', startCell: 0, startMm: 0, kerfEndCell: 12, kerfEndMm: 1.2 });
    expect(json.remnants[0]).toMatchObject({ fromCell: 12, toCell: 30, lengthMm: 1.8, class: expect.stringMatching(/reusable|scrap/) });
    expect(JSON.parse(JSON.stringify(json))).toBeTruthy();
  });
});
