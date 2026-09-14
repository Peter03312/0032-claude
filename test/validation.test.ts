import { describe, it, expect } from 'vitest';
import { validateProblem } from '../src/lib/validation';
import type { ProblemDraft } from '../src/lib/types';

const base = (): ProblemDraft => ({
  kerf: '1.0',
  reuseThreshold: '50.0',
  strips: [
    { id: 'S1', length: '100.0', headTrim: '2.0', defects: [{ id: 'D1', from: '20.0', to: '21.0' }] },
  ],
  pieces: [{ id: 'P1', length: '10.0', lockedStripId: null }],
});

describe('编辑器录入校验', () => {
  it('合法草稿换算为整数格问题', () => {
    const { problem, errors } = validateProblem(base());
    expect(Object.keys(errors)).toHaveLength(0);
    expect(problem!.kerf).toBe(10);
    expect(problem!.reuseThreshold).toBe(500);
    expect(problem!.strips[0]).toMatchObject({ id: 'S1', length: 1000, headTrim: 20 });
    expect(problem!.strips[0].defects[0]).toMatchObject({ from: 200, to: 210 });
    expect(problem!.pieces[0].length).toBe(100);
  });

  it('重复条材/裁片标识、精度、越界逐一报错', () => {
    const d = base();
    d.strips.push({ id: 'S1', length: 'x', headTrim: '0', defects: [] });
    d.pieces[0].lockedStripId = 'NOPE';
    d.kerf = '1.25';
    const { errors } = validateProblem(d);
    expect(errors['strip.1.id']).toContain('唯一');
    expect(errors['strip.1.length']).toBeTruthy();
    expect(errors['piece.0.lock']).toContain('不存在');
    expect(errors['kerf']).toContain('0.1');
  });

  it('头部修齐耗尽条材、疵点超界、区间反向、疵点重叠均报错', () => {
    const d = base();
    d.strips[0].headTrim = '100.0';
    d.strips[0].defects = [
      { id: 'D1', from: '30.0', to: '29.0' },
      { id: 'D2', from: '30.0', to: '30.0' },
    ];
    const { errors } = validateProblem(d);
    expect(errors['strip.0.headTrim']).toContain('无可用格');
    expect(errors['strip.0.defect.0.to']).toContain('不得早于起点');
    // 反向区间不参与重叠判断；单格 [30,30] 合法
    expect(errors['strip.0.defects']).toBeUndefined();

    const d2 = base();
    d2.strips[0].defects = [
      { id: 'D1', from: '30.0', to: '32.0' },
      { id: 'D2', from: '31.0', to: '33.0' },
    ];
    expect(validateProblem(d2).errors['strip.0.defects']).toContain('重叠');

    const d3 = base();
    d3.strips[0].defects = [{ id: 'D1', from: '99.5', to: '100.0' }];
    expect(validateProblem(d3).errors['strip.0.defect.0.to']).toContain('超出条材');
  });

  it('相接疵点（闭区间端点相邻）允许', () => {
    const d = base();
    d.strips[0].defects = [
      { id: 'D1', from: '30.0', to: '31.0' },
      { id: 'D2', from: '31.1', to: '32.0' },
    ];
    expect(validateProblem(d).errors['strip.0.defects']).toBeUndefined();
  });

  it('空标识、负数与零长度报错', () => {
    const d = base();
    d.strips[0].id = '  ';
    d.pieces[0].length = '0';
    const { errors } = validateProblem(d);
    expect(errors['strip.0.id']).toContain('必填');
    expect(errors['piece.0.length']).toContain('大于 0');
  });
});
