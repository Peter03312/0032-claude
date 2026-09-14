import { describe, it, expect } from 'vitest';
import { unavailableRanges, freeRuns, stripFreeRuns, mergeRanges, rangesIntersect } from '../src/lib/geometry';
import type { Strip } from '../src/lib/types';

const strip = (over: Partial<Strip>): Strip => ({
  id: 'S', length: 100, headTrim: 0, defects: [], ...over,
});

describe('格几何', () => {
  it('条材换算长度 L 占 0..L-1 格，头部修齐格不可用', () => {
    const s = strip({ length: 100, headTrim: 5 });
    expect(unavailableRanges(s)).toEqual([[0, 5]]);
    expect(freeRuns(100, [[0, 5]])).toEqual([[5, 100]]);
  });

  it('疵点闭区间各格不可用：[3,5] 占 3,4,5 三格', () => {
    const s = strip({ length: 100, defects: [{ id: 'D1', from: 3, to: 5 }] });
    expect(unavailableRanges(s)).toContainEqual([3, 6]);
    expect(stripFreeRuns(s)).toEqual([[0, 3], [6, 100]]);
  });

  it('头部修齐与疵点合并，相接疵点并为一段，切成极大可用段', () => {
    const s = strip({
      length: 50, headTrim: 2,
      defects: [{ id: 'D1', from: 2, to: 3 }, { id: 'D2', from: 10, to: 12 }],
    });
    expect(unavailableRanges(s)).toEqual([[0, 4], [10, 13]]);
    expect(stripFreeRuns(s)).toEqual([[4, 10], [13, 50]]);
  });

  it('相邻区间合并，区间相交判定正确', () => {
    expect(mergeRanges([[0, 2], [2, 5]])).toEqual([[0, 5]]);
    expect(mergeRanges([[0, 2], [3, 5]])).toEqual([[0, 2], [3, 5]]);
    expect(rangesIntersect([0, 2], [2, 3])).toBe(false);
    expect(rangesIntersect([0, 3], [2, 4])).toBe(true);
  });

  it('疵点到末端格 L-1 时，剩余段终止于 L', () => {
    const s = strip({ length: 20, defects: [{ id: 'D1', from: 18, to: 19 }] });
    expect(stripFreeRuns(s)).toEqual([[0, 18]]);
  });
});
