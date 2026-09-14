// 结果图算法：把解转成可绘制的区域段、落刀坐标与可下载方案 JSON。
import type { Problem, Solution } from './types';
import { unavailableRanges } from './geometry';
import { cellsToMm, mmLabel } from './units';

export type SegmentKind = 'trim' | 'defect' | 'piece' | 'kerf' | 'remnant-reusable' | 'remnant-scrap' | 'empty';

export interface Segment {
  kind: SegmentKind;
  from: number; // 格
  to: number;
  pieceId?: string;
  defectId?: string;
}

export interface CutMark {
  pieceId: string;
  start: number;      // 裁片起点格（左刀）
  end: number;        // 裁片终点格（右刀 = 锯缝左缘）
  kerfEnd: number;    // 锯缝右缘格
  startMm: string;
  endMm: string;
  kerfEndMm: string;
}

export interface StripView {
  stripId: string;
  length: number;
  enabled: boolean;
  segments: Segment[];
  cuts: CutMark[];
  remnants: Solution['remnants'];
}

export interface ResultModel {
  strips: StripView[];
  objective: {
    stripsUsed: number;
    shortRemnantCells: number;
    shortRemnantMm: string;
  };
}

export function buildResultModel(p: Problem, sol: Solution): ResultModel {
  const byStrip = new Map(sol.placements.map((pl) => [pl.stripId, [] as typeof sol.placements]));
  for (const pl of sol.placements) {
    if (!byStrip.has(pl.stripId)) byStrip.set(pl.stripId, []);
    byStrip.get(pl.stripId)!.push(pl);
  }

  const strips: StripView[] = p.strips.map((s) => {
    const enabled = sol.enabledStripIds.includes(s.id);
    const blocked = unavailableRanges(s);
    const placed = (byStrip.get(s.id) ?? []).sort((a, b) => a.start - b.start);

    // 逐格打标后合并相邻同标签段
    const segMap = new Map<number, Segment>();
    const assign = (from: number, to: number, kind: SegmentKind, extra?: Partial<Segment>) => {
      for (let g = from; g < to; g++) {
        segMap.set(g, { kind, from: g, to: g + 1, ...extra });
      }
    };
    for (let g = 0; g < s.length; g++) {
      segMap.set(g, { kind: 'empty', from: g, to: g + 1 });
    }
    for (const [f, t] of blocked) {
      for (let g = f; g < t; g++) {
        segMap.set(g, { kind: g < s.headTrim ? 'trim' : 'defect', from: g, to: g + 1 });
      }
    }
    // 疵点 id 关联（用于悬浮提示）
    for (const d of s.defects) {
      for (let g = d.from; g <= d.to; g++) {
        const sg = segMap.get(g);
        if (sg && sg.kind === 'defect') sg.defectId = d.id;
      }
    }
    for (const pl of placed) {
      const piece = p.pieces.find((pc) => pc.id === pl.pieceId)!;
      assign(pl.start, pl.start + piece.length, 'piece', { pieceId: piece.id });
      if (p.kerf > 0) assign(pl.start + piece.length, pl.start + piece.length + p.kerf, 'kerf', { pieceId: piece.id });
    }
    for (const r of sol.remnants.filter((rm) => rm.stripId === s.id)) {
      assign(r.from, r.to, r.class === 'scrap' ? 'remnant-scrap' : 'remnant-reusable');
    }

    // 合并相邻同标签段
    const segments: Segment[] = [];
    let cur: Segment | null = null;
    for (let g = 0; g < s.length; g++) {
      const sg = segMap.get(g)!;
      if (
        cur &&
        cur.kind === sg.kind &&
        cur.pieceId === sg.pieceId &&
        cur.defectId === sg.defectId &&
        cur.to === g
      ) {
        cur.to = g + 1;
      } else {
        if (cur) segments.push(cur);
        cur = { ...sg };
      }
    }
    if (cur) segments.push(cur);

    const cuts: CutMark[] = placed.map((pl) => {
      const piece = p.pieces.find((pc) => pc.id === pl.pieceId)!;
      const end = pl.start + piece.length;
      return {
        pieceId: piece.id,
        start: pl.start,
        end,
        kerfEnd: end + p.kerf,
        startMm: mmLabel(pl.start),
        endMm: mmLabel(end),
        kerfEndMm: mmLabel(end + p.kerf),
      };
    });

    return {
      stripId: s.id,
      length: s.length,
      enabled,
      segments,
      cuts,
      remnants: sol.remnants.filter((rm) => rm.stripId === s.id),
    };
  });

  return {
    strips,
    objective: {
      stripsUsed: sol.stripsUsed,
      shortRemnantCells: sol.shortRemnantCells,
      shortRemnantMm: mmLabel(sol.shortRemnantCells),
    },
  };
}

export function solutionToJson(p: Problem, sol: Solution): unknown {
  return {
    generatedAt: new Date().toISOString(),
    unit: '0.1mm-grid',
    objective: {
      stripsUsed: sol.stripsUsed,
      shortRemnantCells: sol.shortRemnantCells,
      shortRemnantMm: cellsToMm(sol.shortRemnantCells),
    },
    kerfCells: p.kerf,
    reuseThresholdCells: p.reuseThreshold,
    enabledStrips: sol.enabledStripIds,
    placements: sol.placements.map((pl) => {
      const piece = p.pieces.find((pc) => pc.id === pl.pieceId)!;
      return {
        pieceId: pl.pieceId,
        stripId: pl.stripId,
        startCell: pl.start,
        startMm: cellsToMm(pl.start),
        pieceEndCell: pl.start + piece.length,
        pieceEndMm: cellsToMm(pl.start + piece.length),
        kerfEndCell: pl.start + piece.length + p.kerf,
        kerfEndMm: cellsToMm(pl.start + piece.length + p.kerf),
      };
    }),
    remnants: sol.remnants.map((r) => ({
      stripId: r.stripId,
      fromCell: r.from,
      toCell: r.to,
      fromMm: cellsToMm(r.from),
      toMm: cellsToMm(r.to),
      lengthCells: r.cells,
      lengthMm: cellsToMm(r.cells),
      class: r.class,
    })),
    triples: sol.triples.map(([stripId, start, pieceId]) => ({ stripId, startCell: start, startMm: cellsToMm(start), pieceId })),
  };
}
