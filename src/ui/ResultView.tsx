import { useMemo, useState } from 'react';
import type { ProblemDraft, SolveResult } from '../lib/types';
import { validateProblem } from '../lib/validation';
import { buildResultModel, solutionToJson, type ResultModel } from '../lib/result';
import { mmLabel } from '../lib/units';

const ROW_H = 46;
const PAD_LEFT = 92;
const RULER_H = 26;
const CUT_H = 70;
// 最长条材右端外侧还要放末端刻度与「xxx mm」长度标签，留足空间避免被裁
const RIGHT_PAD = 78;

function niceStep(pxPerCell: number): number {
  // 目标标签间距约 90px
  const candidates = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  for (const c of candidates) if (c * pxPerCell >= 90) return c;
  return 10000;
}

function hueOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

export function ResultView({ draft, out }: { draft: ProblemDraft; out: SolveResult }) {
  const [zoom, setZoom] = useState(1);

  const built = useMemo(() => {
    const v = validateProblem(draft);
    if (!v.problem) return null;
    if (out.status === 'solved') return { problem: v.problem, model: buildResultModel(v.problem, out.solution), solved: true as const, out };
    return { problem: v.problem, solved: false as const, out };
  }, [draft, out]);

  if (!built) return null;

  if (out.status === 'limit') {
    return (
      <section className="result" data-testid="result-limit">
        <div className="banner limit">搜索终止：{out.message}。未展示半成品方案。</div>
      </section>
    );
  }

  if (out.status === 'unsat') {
    return (
      <section className="result" data-testid="result-unsat">
        <div className="banner unsat">
          <strong>无解：</strong>{out.unsat.message}
          {out.unsat.totalNeed !== undefined && (
            <div className="diag">
              总需求 {mmLabel(out.unsat.totalNeed)} mm，总可用 {mmLabel(out.unsat.totalAvailable ?? 0)} mm
            </div>
          )}
          {out.unsat.offendingLocks?.map((o) => (
            <div className="diag" key={o.stripId} data-testid={`offending-lock-${o.stripId}`}>
              涉及锁定裁片：{o.pieceIds.join('、')}
            </div>
          ))}
          <div className="diag subtle">未展示任何半成品方案。</div>
        </div>
      </section>
    );
  }

  const { problem, model } = built as { problem: NonNullable<typeof built.problem>; model: ResultModel; solved: true; out: typeof out };
  const maxLen = Math.max(...model.strips.map((s) => s.length), 1);
  const pxPerCell = 3 * zoom;
  const width = maxLen * pxPerCell;
  const step = niceStep(pxPerCell);
  const shortTotal = model.strips.reduce((n, s) => n + s.remnants.filter((r) => r.class === 'scrap').reduce((a, r) => a + r.cells, 0), 0);

  const downloadJson = () => {
    const text = JSON.stringify(solutionToJson(problem, out.solution), null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    // jsdom 下 Blob.text() 不可用，保留原始文本以便测试读取（浏览器忽略此自有属性）
    (blob as Blob & { jsonText?: string }).jsonText = text;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nesting-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="result" data-testid="result-view">
      <div className="result-head">
        <div className="objectives" data-testid="objectives">
          <span className="obj">目标①启用条材 <b>{model.objective.stripsUsed}</b> / {model.strips.length}</span>
          <span className="obj">目标②短余料合计 <b>{model.objective.shortRemnantMm} mm</b>（{shortTotal} 格）</span>
        </div>
        <div className="zoom-controls">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))} data-testid="zoom-out">－</button>
          <span data-testid="zoom-level">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} data-testid="zoom-in">＋</button>
          <button type="button" onClick={() => setZoom(1)}>复位</button>
          <button type="button" className="primary" onClick={downloadJson} data-testid="download-json">下载方案 JSON</button>
        </div>
      </div>

      <Legend />

      <div className="svg-scroll" data-testid="svg-scroll">
        <svg width={PAD_LEFT + width + RIGHT_PAD} height={RULER_H + model.strips.length * (ROW_H + CUT_H + 14) + 10} data-testid="plan-svg">
          <defs>
            <pattern id="hatch-kerf" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#fdf0d5" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#c08a2c" strokeWidth="2" />
            </pattern>
            <pattern id="hatch-trim" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <rect width="6" height="6" fill="#d9d2c8" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#8a7f72" strokeWidth="2" />
            </pattern>
            <pattern id="hatch-defect" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#8c2f39" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#4a1218" strokeWidth="2.5" />
            </pattern>
          </defs>

          {/* 标尺 */}
          {Array.from({ length: Math.floor(maxLen / step) + 1 }, (_, i) => i * step).filter((c) => c <= maxLen).map((c) => (
            <g key={`r${c}`}>
              <line x1={PAD_LEFT + c * pxPerCell} y1={RULER_H - 10} x2={PAD_LEFT + c * pxPerCell} y2={RULER_H} stroke="#666" />
              <text x={PAD_LEFT + c * pxPerCell} y={RULER_H - 14} fontSize="10" textAnchor="middle" fill="#444">{mmLabel(c)}</text>
            </g>
          ))}

          {model.strips.map((sv, si) => {
            const y0 = RULER_H + si * (ROW_H + CUT_H + 14);
            const stripDef = problem.strips.find((x) => x.id === sv.stripId)!;
            // 每根条材按自身换算长度等比缩放（以最长条材为基准），短料明显更短
            const stripW = sv.length * pxPerCell;
            return (
              <g key={sv.stripId} data-testid={`svg-strip-${si}`} opacity={sv.enabled ? 1 : 0.55}>
                <text x={4} y={y0 + ROW_H / 2 + 4} fontSize="12" fontWeight="bold" fill="#222">
                  {sv.stripId}{!sv.enabled && '（未启用）'}
                </text>
                <rect x={PAD_LEFT} y={y0} width={stripW} height={ROW_H} fill="#f7f4ee" stroke="#bbb" />
                {/* 条材末端刻度线，直观显示真实长度差异 */}
                <line x1={PAD_LEFT + stripW} y1={y0 - 2} x2={PAD_LEFT + stripW} y2={y0 + ROW_H + 2} stroke="#555" strokeWidth="1.2" />
                <text x={PAD_LEFT + stripW + 4} y={y0 + ROW_H / 2 + 3} fontSize="9" fill="#555" data-testid={`strip-len-${sv.stripId}`}>
                  {mmLabel(sv.length)}mm
                </text>
                {sv.segments.map((seg, gi) => {
                  const x = PAD_LEFT + seg.from * pxPerCell;
                  const w = Math.max((seg.to - seg.from) * pxPerCell, 0.5);
                  let fill = 'transparent';
                  let title = '';
                  if (seg.kind === 'piece') { fill = `hsl(${hueOf(seg.pieceId!)} 55% 72%)`; title = `裁片 ${seg.pieceId}`; }
                  if (seg.kind === 'kerf') { fill = 'url(#hatch-kerf)'; title = `锯缝（裁片 ${seg.pieceId} 右侧）`; }
                  if (seg.kind === 'trim') { fill = 'url(#hatch-trim)'; title = '头部修齐（不可用）'; }
                  if (seg.kind === 'defect') { fill = 'url(#hatch-defect)'; title = `疵点 ${seg.defectId ?? ''}（闭区间，不可用）`; }
                  if (seg.kind === 'remnant-reusable') { fill = 'rgba(74,140,90,0.22)'; title = `可复用余段 ${mmLabel(seg.from)}–${mmLabel(seg.to)}`; }
                  if (seg.kind === 'remnant-scrap') { fill = 'rgba(90,90,90,0.28)'; title = `短余料 ${mmLabel(seg.from)}–${mmLabel(seg.to)}`; }
                  return (
                    <rect key={gi} x={x} y={y0} width={w} height={ROW_H} fill={fill}
                      stroke={seg.kind === 'remnant-reusable' ? '#2f7a43' : seg.kind === 'remnant-scrap' ? '#555' : 'rgba(0,0,0,0.18)'}
                      strokeWidth={seg.kind === 'piece' ? 1 : 0.5}
                      data-testkind={seg.kind}
                    >
                      <title>{title}</title>
                    </rect>
                  );
                })}
                {/* 裁片标识 */}
                {sv.segments.filter((s) => s.kind === 'piece').map((seg, gi) => {
                  const w = (seg.to - seg.from) * pxPerCell;
                  if (w < 22) return null;
                  return <text key={`pl${gi}`} x={PAD_LEFT + seg.from * pxPerCell + w / 2} y={y0 + ROW_H / 2 + 4} fontSize="11" textAnchor="middle" fill="#202020">{seg.pieceId}</text>;
                })}
                {/* 落刀坐标 */}
                {sv.cuts.map((cut) => (
                  <g key={cut.pieceId} data-testid={`cut-${sv.stripId}-${cut.pieceId}`}>
                    <line x1={PAD_LEFT + cut.start * pxPerCell} y1={y0 + ROW_H} x2={PAD_LEFT + cut.start * pxPerCell} y2={y0 + ROW_H + 12} stroke="#1c4e80" strokeWidth="1.4" />
                    <line x1={PAD_LEFT + cut.end * pxPerCell} y1={y0 + ROW_H} x2={PAD_LEFT + cut.end * pxPerCell} y2={y0 + ROW_H + 12} stroke="#b32a2a" strokeWidth="1.4" />
                    <text x={PAD_LEFT + cut.start * pxPerCell + 2} y={y0 + ROW_H + 24} fontSize="9" fill="#1c4e80">
                      {cut.pieceId}: {cut.startMm}
                    </text>
                    <text x={PAD_LEFT + cut.end * pxPerCell + 2} y={y0 + ROW_H + 36} fontSize="9" fill="#b32a2a">
                      刀 {cut.endMm}{cut.kerfEndMm !== cut.endMm ? `→${cut.kerfEndMm}` : ''}
                    </text>
                  </g>
                ))}
                {/* 未启用条材也标注疵点说明 */}
                {!sv.enabled && stripDef.defects.map((d) => (
                  <text key={d.id} x={PAD_LEFT + ((d.from + d.to + 1) / 2) * pxPerCell} y={y0 + ROW_H / 2 + 4} fontSize="10" textAnchor="middle" fill="#fff" fontWeight="bold">{d.id}</text>
                ))}
                {/* 余段长度标注 */}
                {sv.remnants.map((r, ri) => (
                  <text key={ri} x={PAD_LEFT + (r.from + r.to) / 2 * pxPerCell} y={y0 - 4} fontSize="9" textAnchor="middle"
                    fill={r.class === 'scrap' ? '#666' : '#2f7a43'} data-testid={`remnant-label-${sv.stripId}-${ri}`}>
                    {r.class === 'scrap' ? '短余料' : '可复用'} {mmLabel(r.cells)}mm
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      <CutTable model={model} />
    </section>
  );
}

function Legend() {
  const items: Array<[string, string, string]> = [
    ['裁片', `hsl(200 55% 72%)`, ''],
    ['锯缝', 'url(#hatch-kerf)', ''],
    ['头部修齐', 'url(#hatch-trim)', ''],
    ['疵点闭区间', 'url(#hatch-defect)', ''],
    ['可复用余段', 'rgba(74,140,90,0.22)', '#2f7a43'],
    ['短余料', 'rgba(90,90,90,0.28)', '#555'],
  ];
  return (
    <div className="legend">
      {items.map(([label, fill, stroke]) => (
        <span key={label} className="legend-item">
          <svg width="18" height="12"><rect x="0" y="0" width="18" height="12" fill={fill} stroke={stroke || '#999'} /></svg>
          {label}
        </span>
      ))}
      <span className="legend-item"><span className="cut-legend blue" />蓝线=裁片起点</span>
      <span className="legend-item"><span className="cut-legend red" />红线=落刀口（锯缝后缘坐标另标）</span>
    </div>
  );
}

function CutTable({ model }: { model: ResultModel }) {
  const rows = model.strips.flatMap((s) => s.cuts.map((c) => ({ stripId: s.stripId, ...c })));
  return (
    <table className="cut-table" data-testid="cut-table">
      <thead>
        <tr><th>裁片</th><th>条材</th><th>起点 mm</th><th>裁片末端/左刀口 mm</th><th>锯缝后缘 mm</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.stripId}-${r.pieceId}`}>
            <td>{r.pieceId}</td><td>{r.stripId}</td><td>{r.startMm}</td><td>{r.endMm}</td><td>{r.kerfEndMm}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
