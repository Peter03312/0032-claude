// 领域类型定义
// 所有长度在内部均以「格」为单位：1 格 = 0.1 毫米（整数）。

export interface DefectDraft {
  id: string;
  from: string; // 毫米，相对条材起点，闭区间起点
  to: string;   // 毫米，闭区间终点
}

export interface StripDraft {
  id: string;
  length: string;    // 毫米
  headTrim: string;  // 头部修齐量，毫米
  defects: DefectDraft[];
}

export interface PieceDraft {
  id: string;
  length: string; // 毫米
  lockedStripId: string | null; // 锁定只限定条材
}

export interface ProblemDraft {
  strips: StripDraft[];
  pieces: PieceDraft[];
  kerf: string;          // 锯缝宽度，毫米
  reuseThreshold: string; // 复用阈值，毫米
}

/** 校验通过后的干净问题（格为单位） */
export interface Problem {
  strips: Strip[];
  pieces: Piece[];
  kerf: number;          // 格
  reuseThreshold: number; // 格
}

export interface Strip {
  id: string;
  length: number;       // L 格，占用 0..L-1
  headTrim: number;     // 格
  defects: Array<{ id: string; from: number; to: number }>;
}

export interface Piece {
  id: string;
  length: number; // 格
  lockedStripId: string | null;
}

/** 一处放置：裁片 pieceId 位于 stripId 的 [start, start+length)，右侧锯缝紧随其后 */
export interface Placement {
  pieceId: string;
  stripId: string;
  start: number; // 格
}

export type RemnantClass = 'reusable' | 'scrap';

export interface Remnant {
  stripId: string;
  from: number; // 格
  to: number;   // 格（区间 [from,to)）
  cells: number;
  class: RemnantClass;
}

export interface Unsat {
  /** lock-capacity: 锁定项造成容量冲突；total-demand: 总需求超过总可用容量；none: 结构性无解 */
  code: 'lock-capacity' | 'total-demand' | 'none';
  message: string;
  offendingLocks?: Array<{ stripId: string; pieceIds: string[]; lockedCells: number; usableCells: number }>;
  totalNeed?: number;
  totalAvailable?: number;
}

export interface Solution {
  placements: Placement[];
  enabledStripIds: string[];
  remnants: Remnant[];
  stripsUsed: number;        // 目标 1：启用条材数
  shortRemnantCells: number; // 目标 2：短于复用阈值的余段总格数
  triples: Array<[string, number, string]>;
}

export type SolveResult =
  | { status: 'solved'; solution: Solution }
  | { status: 'unsat'; unsat: Unsat }
  | { status: 'limit'; message: string };
