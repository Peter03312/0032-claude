import { describe, it, expect } from 'vitest';
import { parseTenths, mmLabel } from '../src/lib/units';

describe('单位换算：0.1mm 整数倍 → 整数格', () => {
  it('接受合法的 0.1 倍数并换算为格', () => {
    expect(parseTenths('1.2', 'x').cells).toBe(12);
    expect(parseTenths('0', 'x', { allowZero: true }).cells).toBe(0);
    expect(parseTenths('100', 'x').cells).toBe(1000);
    expect(parseTenths('  3.5 ', 'x').cells).toBe(35);
    expect(parseTenths('12.30', 'x').cells).toBe(123);
  });

  it('拒绝非 0.1 整数倍、负数、空值与非数字', () => {
    expect(parseTenths('1.23', 'x').ok).toBe(false);
    expect(parseTenths('0.05', 'x').ok).toBe(false);
    expect(parseTenths('-1', 'x').ok).toBe(false);
    expect(parseTenths('', 'x').ok).toBe(false);
    expect(parseTenths('abc', 'x').ok).toBe(false);
    // 默认不允许零长度
    expect(parseTenths('0', 'x').ok).toBe(false);
  });

  it('格坐标毫米标签保留一位小数', () => {
    expect(mmLabel(0)).toBe('0.0');
    expect(mmLabel(12)).toBe('1.2');
    expect(mmLabel(1234)).toBe('123.4');
  });
});
