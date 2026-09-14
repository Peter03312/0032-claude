// 尺寸解析：仅接受 0.1 毫米整数倍，换算为整数格。
// 1 格 = 0.1mm；长度 L 占 0..L-1 格。

export interface ParseResult {
  ok: boolean;
  cells?: number;
  message?: string;
}

const TOL = 1e-6;

/** 将毫米字符串解析为格数（×10 取整），非法或非 0.1 整数倍时给出就地错误信息 */
export function parseTenths(raw: string, fieldLabel: string, opts: { allowZero?: boolean } = {}): ParseResult {
  const t = raw.trim();
  if (t === '') return { ok: false, message: `${fieldLabel}必填` };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, message: `${fieldLabel}必须是数字` };
  if (n < 0) return { ok: false, message: `${fieldLabel}不得为负` };
  if (n === 0 && !opts.allowZero) return { ok: false, message: `${fieldLabel}必须大于 0` };
  const cells = Math.round(n * 10);
  if (Math.abs(n * 10 - cells) > TOL) {
    return { ok: false, message: `${fieldLabel}只接受 0.1 毫米整数倍` };
  }
  return { ok: true, cells };
}

export function cellsToMm(cells: number): number {
  return cells / 10;
}

/** 格坐标 → 毫米文字（保留一位小数） */
export function mmLabel(cells: number): string {
  return (cells / 10).toFixed(1);
}

/** 整数格校验（用于从格反推合法性测试） */
export function isTenthsValue(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 10 - Math.round(n * 10)) <= TOL;
}
