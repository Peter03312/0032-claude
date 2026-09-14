import { useState } from 'react';
import type { ProblemDraft, StripDraft, PieceDraft, DefectDraft } from '../lib/types';
import type { ErrorMap } from '../lib/validation';

export interface DragPayload {
  pieceId: string;
}

interface EditorProps {
  draft: ProblemDraft;
  errors: ErrorMap;
  onChange: (f: (d: ProblemDraft) => ProblemDraft) => void;
  onAddStrip: () => void;
  onAddPiece: () => void;
  onDropPiece: (payload: DragPayload, stripId: string | null) => void;
}

export function Editor({ draft, errors, onChange, onAddStrip, onAddPiece, onDropPiece }: EditorProps) {
  const [dragOver, setDragOver] = useState<string | null>(null);

  const update = (f: (d: ProblemDraft) => void) => onChange((d) => { f(d); return d; });
  const errText = (key: string) => errors[key];

  const handleDragStart = (e: React.DragEvent, pieceId: string) => {
    e.dataTransfer.setData('text/x-piece', JSON.stringify({ pieceId } satisfies DragPayload));
    e.dataTransfer.effectAllowed = 'move';
  };
  const drop = (e: React.DragEvent, stripId: string | null) => {
    e.preventDefault();
    setDragOver(null);
    try {
      const payload = JSON.parse(e.dataTransfer.getData('text/x-piece')) as DragPayload;
      onDropPiece(payload, stripId);
    } catch {
      /* 非本应用拖动，忽略 */
    }
  };

  return (
    <div className="editor">
      <section className="panel globals">
        <h2>全局参数</h2>
        <label>
          锯缝宽度（mm）
          <input
            type="number"
            step="0.1"
            min="0"
            value={draft.kerf}
            data-testid="kerf-input"
            onChange={(e) => update((d) => { d.kerf = e.target.value; })}
          />
        </label>
        {errText('kerf') && <span className="field-error" data-testid="kerf-error">{errText('kerf')}</span>}
        <label>
          复用阈值（mm，余段短于此记为短余料）
          <input
            type="number"
            step="0.1"
            min="0"
            value={draft.reuseThreshold}
            data-testid="reuse-input"
            onChange={(e) => update((d) => { d.reuseThreshold = e.target.value; })}
          />
        </label>
        {errText('reuse') && <span className="field-error" data-testid="reuse-error">{errText('reuse')}</span>}
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="panel-title">
            <h2>条材仓库</h2>
            <button type="button" onClick={onAddStrip} data-testid="add-strip">＋ 新条材</button>
          </div>
          {draft.strips.length === 0 && <p className="hint" data-testid="empty-strips">空仓库：请先添加条材，再录入其头部修齐量与疵点闭区间。</p>}
          <div className="strip-list">
            {draft.strips.map((s, si) => (
              <StripCard
                key={si}
                strip={s}
                index={si}
                error={errText}
                dragOver={dragOver === s.id}
                onDragOver={(e) => { e.preventDefault(); setDragOver(s.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => drop(e, s.id)}
                onChange={(f) => update((d) => f(d.strips[si]))}
                onRemove={() => update((d) => { d.strips.splice(si, 1); d.pieces.forEach((p) => { if (p.lockedStripId === s.id) p.lockedStripId = null; }); })}
                onAddDefect={() => update((d) => {
                  const sd = d.strips[si];
                  const used = new Set(sd.defects.map((x) => x.id));
                  let n = sd.defects.length + 1;
                  while (used.has(`D${n}`)) n++;
                  sd.defects.push({ id: `D${n}`, from: '', to: '' });
                })}
                onRemoveDefect={(di) => update((d) => { d.strips[si].defects.splice(di, 1); })}
              />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>裁片（不可拼接）</h2>
            <button type="button" onClick={onAddPiece} data-testid="add-piece">＋ 新裁片</button>
          </div>
          {draft.pieces.length === 0 && <p className="hint" data-testid="empty-pieces">还没有裁片。拖到左侧条材即可锁定；也可用下拉框选择锁定条材。</p>}
          <div
            className={`tray ${dragOver === '__none__' ? 'dragover' : ''}`}
            data-testid="unlock-tray"
            onDragOver={(e) => { e.preventDefault(); setDragOver('__none__'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => drop(e, null)}
          >
            <div className="tray-label">拖到这里解除锁定</div>
            <div className="piece-list">
              {draft.pieces.map((p, pi) => (
                <PieceRow
                  key={pi}
                  piece={p}
                  index={pi}
                  stripOptions={draft.strips.map((s) => s.id)}
                  error={errText}
                  onDragStart={(e) => handleDragStart(e, p.id)}
                  onChange={(f) => update((d) => f(d.pieces[pi]))}
                  onRemove={() => update((d) => { d.pieces.splice(pi, 1); })}
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

interface StripCardProps {
  strip: StripDraft;
  index: number;
  error: (key: string) => string | undefined;
  dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onChange: (f: (s: StripDraft) => void) => void;
  onRemove: () => void;
  onAddDefect: () => void;
  onRemoveDefect: (di: number) => void;
}

function StripCard(props: StripCardProps) {
  const { strip: s, index: si, error } = props;
  return (
    <div
      className={`strip-card ${props.dragOver ? 'dragover' : ''}`}
      data-testid={`strip-card-${si}`}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      <div className="card-head">
        <label>
          标识
          <input
            value={s.id}
            data-testid={`strip-id-${si}`}
            onChange={(e) => props.onChange((x) => { x.id = e.target.value; })}
          />
        </label>
        <label>
          长度（mm）
          <input
            type="number"
            step="0.1"
            min="0"
            value={s.length}
            data-testid={`strip-length-${si}`}
            onChange={(e) => props.onChange((x) => { x.length = e.target.value; })}
          />
        </label>
        <label>
          头部修齐（mm）
          <input
            type="number"
            step="0.1"
            min="0"
            value={s.headTrim}
            data-testid={`strip-trim-${si}`}
            onChange={(e) => props.onChange((x) => { x.headTrim = e.target.value; })}
          />
        </label>
        <button type="button" className="ghost danger" onClick={props.onRemove} data-testid={`strip-remove-${si}`}>删除</button>
      </div>
      {error(`strip.${si}.id`) && <span className="field-error">{error(`strip.${si}.id`)}</span>}
      {error(`strip.${si}.length`) && <span className="field-error">{error(`strip.${si}.length`)}</span>}
      {error(`strip.${si}.headTrim`) && <span className="field-error">{error(`strip.${si}.headTrim`)}</span>}

      <div className="defects">
        <div className="defects-head">
          <span>疵点闭区间（mm，端点含）</span>
          <button type="button" className="ghost" onClick={props.onAddDefect} data-testid={`add-defect-${si}`}>＋ 疵点</button>
        </div>
        {s.defects.map((d, di) => (
          <DefectRow
            key={d.id + di}
            defect={d}
            index={di}
            stripIndex={si}
            error={error}
            onChange={(f) => props.onChange((x) => f(x.defects[di]))}
            onRemove={() => props.onRemoveDefect(di)}
          />
        ))}
        {error(`strip.${si}.defects`) && <span className="field-error">{error(`strip.${si}.defects`)}</span>}
      </div>
      <div className="drop-hint">拖裁片到此以锁定于本条材</div>
    </div>
  );
}

function DefectRow(props: {
  defect: DefectDraft;
  index: number;
  stripIndex: number;
  error: (key: string) => string | undefined;
  onChange: (f: (d: DefectDraft) => void) => void;
  onRemove: () => void;
}) {
  const { defect: d, index: di, stripIndex: si, error } = props;
  const base = `strip.${si}.defect.${di}`;
  return (
    <div className="defect-row" data-testid={`defect-row-${si}-${di}`}>
      <input
        className="tiny"
        value={d.id}
        aria-label="疵点标识"
        data-testid={`defect-id-${si}-${di}`}
        onChange={(e) => props.onChange((x) => { x.id = e.target.value; })}
      />
      <input
        className="num"
        type="number"
        step="0.1"
        placeholder="起"
        value={d.from}
        aria-label="疵点起点"
        data-testid={`defect-from-${si}-${di}`}
        onChange={(e) => props.onChange((x) => { x.from = e.target.value; })}
      />
      <span className="range-sep">–</span>
      <input
        className="num"
        type="number"
        step="0.1"
        placeholder="止"
        value={d.to}
        aria-label="疵点终点"
        data-testid={`defect-to-${si}-${di}`}
        onChange={(e) => props.onChange((x) => { x.to = e.target.value; })}
      />
      <button type="button" className="ghost danger tiny-btn" onClick={props.onRemove} data-testid={`defect-remove-${si}-${di}`}>×</button>
      <div className="row-errors">
        {error(`${base}.id`) && <span className="field-error">{error(`${base}.id`)}</span>}
        {error(`${base}.from`) && <span className="field-error">{error(`${base}.from`)}</span>}
        {error(`${base}.to`) && <span className="field-error">{error(`${base}.to`)}</span>}
      </div>
    </div>
  );
}

interface PieceRowProps {
  piece: PieceDraft;
  index: number;
  stripOptions: string[];
  error: (key: string) => string | undefined;
  onDragStart: (e: React.DragEvent) => void;
  onChange: (f: (p: PieceDraft) => void) => void;
  onRemove: () => void;
}

function PieceRow(props: PieceRowProps) {
  const { piece: p, index: pi, error } = props;
  return (
    <div className="piece-row" draggable onDragStart={props.onDragStart} data-testid={`piece-row-${pi}`}>
      <span className="drag-grip" aria-hidden="true">⠿</span>
      <label>
        标识
        <input
          value={p.id}
          data-testid={`piece-id-${pi}`}
          onChange={(e) => props.onChange((x) => { x.id = e.target.value; })}
        />
      </label>
      <label>
        长度（mm）
        <input
          type="number"
          step="0.1"
          min="0"
          value={p.length}
          data-testid={`piece-length-${pi}`}
          onChange={(e) => props.onChange((x) => { x.length = e.target.value; })}
        />
      </label>
      <label>
        锁定条材
        <select
          value={p.lockedStripId ?? ''}
          data-testid={`piece-lock-${pi}`}
          onChange={(e) => props.onChange((x) => { x.lockedStripId = e.target.value === '' ? null : e.target.value; })}
        >
          <option value="">不锁定</option>
          {props.stripOptions.map((sid, oi) => (
            <option key={`${oi}-${sid}`} value={sid}>{sid}</option>
          ))}
        </select>
      </label>
      <button type="button" className="ghost danger" onClick={props.onRemove} data-testid={`piece-remove-${pi}`}>删除</button>
      <div className="row-errors">
        {error(`piece.${pi}.id`) && <span className="field-error">{error(`piece.${pi}.id`)}</span>}
        {error(`piece.${pi}.length`) && <span className="field-error">{error(`piece.${pi}.length`)}</span>}
        {error(`piece.${pi}.lock`) && <span className="field-error">{error(`piece.${pi}.lock`)}</span>}
      </div>
    </div>
  );
}
