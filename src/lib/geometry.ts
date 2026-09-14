// 格几何：不可用格（头部修齐 + 疵点闭区间）、初始可用极大连续段、并集/减法。
import type { Strip } from './types';

export type Range = [number, number]; // 半开区间 [from, to)

/** 疵点闭区间 [from,to]（格）→ 半开 [from, to+1) */
export function defectRange(from: number, to: number): Range {
  return [from, to + 1];
}

/** 收集一条条材的不可用半开区间：头部修齐 [0, headTrim) 与疵点闭区间 */
export function unavailableRanges(strip: Strip): Range[] {
  const ranges: Range[] = [];
  if (strip.headTrim > 0) ranges.push([0, strip.headTrim]);
  for (const d of strip.defects) ranges.push(defectRange(d.from, d.to));
  return mergeRanges(ranges);
}

/** 区间并集（重叠或相接合并） */
export function mergeRanges(input: Range[]): Range[] {
  if (input.length === 0) return [];
  const sorted = [...input].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [[sorted[0][0], sorted[0][1]]];
  for (const [f, t] of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (f <= last[1]) last[1] = Math.max(last[1], t);
    else out.push([f, t]);
  }
  return out;
}

/** 区间相交测试（半开） */
export function rangesIntersect(a: Range, b: Range): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/** 从 [0,length) 中扣除不可用区间，得到初始极大连续可用段 */
export function freeRuns(length: number, blocked: Range[]): Range[] {
  const runs: Range[] = [];
  let cursor = 0;
  for (const [f, t] of mergeRanges(blocked)) {
    if (f > cursor) runs.push([cursor, Math.min(f, length)]);
    cursor = Math.max(cursor, Math.min(t, length));
    if (cursor >= length) break;
  }
  if (cursor < length) runs.push([cursor, length]);
  return runs;
}

export function stripFreeRuns(strip: Strip): Range[] {
  return freeRuns(strip.length, unavailableRanges(strip));
}

/** 区间长度（格数） */
export function rangeSize(r: Range): number {
  return r[1] - r[0];
}
