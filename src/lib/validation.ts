// 录入校验：草稿（字符串）→ 干净 Problem（格）。就地错误以路径键收集，供界面逐字段反馈。
import type { Problem, ProblemDraft } from './types';
import { parseTenths } from './units';
import { rangesIntersect } from './geometry';

export type ErrorMap = Record<string, string>;

const err = (errors: ErrorMap, key: string, msg: string) => {
  if (!(key in errors)) errors[key] = msg;
};

export function validateProblem(draft: ProblemDraft): { problem?: Problem; errors: ErrorMap } {
  const errors: ErrorMap = {};
  // 第一遍：收集所有标识（含重复），避免「边校验边登记」漏掉后续重复项
  const seenStrips = new Map<string, number>();
  const seenPieces = new Map<string, number>();
  draft.strips.forEach((s, si) => {
    const id = s.id.trim();
    if (id !== '') {
      if (seenStrips.has(id)) {
        err(errors, `strip.${si}.id`, '条材标识必须唯一');
        err(errors, `strip.${seenStrips.get(id)}.id`, '条材标识必须唯一');
      } else seenStrips.set(id, si);
    }
  });
  draft.pieces.forEach((p, pi) => {
    const id = p.id.trim();
    if (id !== '') {
      if (seenPieces.has(id)) {
        err(errors, `piece.${pi}.id`, '裁片标识必须唯一');
        err(errors, `piece.${seenPieces.get(id)}.id`, '裁片标识必须唯一');
      } else seenPieces.set(id, pi);
    }
  });
  const stripIds = new Set(seenStrips.keys());

  draft.strips.forEach((s, si) => {
    const b = `strip.${si}`;
    if (s.id.trim() === '') err(errors, `${b}.id`, '条材标识必填');

    const L = parseTenths(s.length, '条材长度');
    if (!L.ok) err(errors, `${b}.length`, L.message!);

    const h = parseTenths(s.headTrim, '头部修齐量', { allowZero: true });
    if (!h.ok) err(errors, `${b}.headTrim`, h.message!);

    if (L.ok && h.ok && h.cells! >= L.cells!) {
      err(errors, `${b}.headTrim`, '修齐后条材无可用格');
    }

    const seenDef = new Set<string>();
    const parsedDefs: Array<{ id: string; from: number; to: number }> = [];
    s.defects.forEach((d, di) => {
      const db = `${b}.defect.${di}`;
      if (d.id.trim() === '') err(errors, `${db}.id`, '疵点标识必填');
      else if (seenDef.has(d.id.trim())) err(errors, `${db}.id`, '疵点标识在本条材内须唯一');
      else seenDef.add(d.id.trim());

      // 疵点是坐标（占格 0..L-1），起点可以正好在条材起点 0，故允许零
      const f = parseTenths(d.from, '疵点起点', { allowZero: true });
      const t = parseTenths(d.to, '疵点终点', { allowZero: true });
      if (!f.ok) err(errors, `${db}.from`, f.message!);
      if (!t.ok) err(errors, `${db}.to`, t.message!);
      if (f.ok && t.ok) {
        if (t.cells! < f.cells!) err(errors, `${db}.to`, '疵点终点不得早于起点（闭区间）');
        else if (L.ok && t.cells! >= L.cells!) err(errors, `${db}.to`, '疵点超出条材长度（占 0..L-1 格）');
        else {
          parsedDefs.push({ id: d.id.trim(), from: f.cells!, to: t.cells! });
        }
      }
    });

    // 疵点闭区间两两不得重叠（相接允许）
    for (let i = 0; i < parsedDefs.length; i++) {
      for (let j = i + 1; j < parsedDefs.length; j++) {
        const a = parsedDefs[i];
        const c = parsedDefs[j];
        if (rangesIntersect([a.from, a.to + 1], [c.from, c.to + 1])) {
          err(errors, `${b}.defects`, `疵点 ${a.id} 与 ${c.id} 闭区间重叠`);
        }
      }
    }
  });

  const parsedPieces: Problem['pieces'] = [];
  draft.pieces.forEach((p, pi) => {
    const b = `piece.${pi}`;
    if (p.id.trim() === '') err(errors, `${b}.id`, '裁片标识必填');

    const len = parseTenths(p.length, '裁片长度');
    if (!len.ok) err(errors, `${b}.length`, len.message!);

    if (p.lockedStripId !== null && !stripIds.has(p.lockedStripId)) {
      err(errors, `${b}.lock`, '锁定的条材不存在');
    }
    if (len.ok) parsedPieces.push({ id: p.id.trim(), length: len.cells!, lockedStripId: p.lockedStripId });
  });

  const kerf = parseTenths(draft.kerf, '锯缝宽度', { allowZero: true });
  if (!kerf.ok) err(errors, 'kerf', kerf.message!);
  const reuse = parseTenths(draft.reuseThreshold, '复用阈值', { allowZero: true });
  if (!reuse.ok) err(errors, 'reuse', reuse.message!);

  if (Object.keys(errors).length > 0) return { errors };

  return {
    errors: {},
    problem: {
      strips: draft.strips.map((s) => ({
        id: s.id.trim(),
        length: parseTenths(s.length, '').cells!,
        headTrim: parseTenths(s.headTrim, '', { allowZero: true }).cells!,
        defects: s.defects.map((d) => ({
          id: d.id.trim(),
          // 疵点是坐标，允许 0（正好在条材起点）
          from: parseTenths(d.from, '', { allowZero: true }).cells!,
          to: parseTenths(d.to, '', { allowZero: true }).cells!,
        })),
      })),
      pieces: parsedPieces,
      kerf: kerf.cells!,
      reuseThreshold: reuse.cells!,
    },
  };
}
