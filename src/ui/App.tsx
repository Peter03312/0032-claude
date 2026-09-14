import { useMemo, useState } from 'react';
import type { ProblemDraft, SolveResult } from '../lib/types';
import { validateProblem } from '../lib/validation';
import { solve } from '../lib/solver';
import { Editor, type DragPayload } from './Editor';
import { ResultView } from './ResultView';

const initialDraft: ProblemDraft = {
  strips: [],
  pieces: [],
  kerf: '1.0',
  reuseThreshold: '100.0',
};

let idCounter = 0;
const nextId = (prefix: string, taken: Set<string>): string => {
  idCounter++;
  let candidate = `${prefix}${idCounter}`;
  while (taken.has(candidate)) {
    idCounter++;
    candidate = `${prefix}${idCounter}`;
  }
  return candidate;
};

export function App() {
  const [draft, setDraft] = useState<ProblemDraft>(initialDraft);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<{ snapshot: ProblemDraft; out: SolveResult } | null>(null);

  const validation = useMemo(() => validateProblem(draft), [draft]);
  const showErrors = attempted;

  const patchDraft = (f: (d: ProblemDraft) => ProblemDraft) => {
    setDraft((d) => {
      const next = f(structuredClone(d));
      return next;
    });
  };

  const addStrip = () => {
    const taken = new Set(draft.strips.map((s) => s.id));
    patchDraft((d) => {
      d.strips.push({ id: nextId('S', taken), length: '', headTrim: '0.0', defects: [] });
      return d;
    });
  };

  const addPiece = () => {
    const taken = new Set(draft.pieces.map((p) => p.id));
    patchDraft((d) => {
      d.pieces.push({ id: nextId('P', taken), length: '', lockedStripId: null });
      return d;
    });
  };

  const handleDrop = (payload: DragPayload, stripId: string | null) => {
    patchDraft((d) => {
      const piece = d.pieces.find((p) => p.id === payload.pieceId);
      if (piece) piece.lockedStripId = stripId;
      return d;
    });
  };

  const runSolve = () => {
    setAttempted(true);
    const { problem, errors } = validateProblem(draft);
    if (Object.keys(errors).length > 0 || !problem) {
      setResult(null);
      return;
    }
    setResult({ snapshot: structuredClone(draft), out: solve(problem) });
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>铅槽条排料台</h1>
        <p className="subtitle">0.1 毫米为一格 · 疵点闭区间不可用 · 裁片右侧带锯缝 · 精确最少条材搜索</p>
      </header>

      <Editor
        draft={draft}
        errors={showErrors ? validation.errors : {}}
        onChange={patchDraft}
        onAddStrip={addStrip}
        onAddPiece={addPiece}
        onDropPiece={handleDrop}
      />

      <section className="solve-bar">
        <button type="button" className="primary" onClick={runSolve} data-testid="solve-button">
          精确排料
        </button>
        {showErrors && Object.keys(validation.errors).length > 0 && (
          <span className="form-error" data-testid="solve-errors">
            有 {Object.keys(validation.errors).length} 处录入错误，请先修正标红字段
          </span>
        )}
      </section>

      {result && <ResultView draft={result.snapshot} out={result.out} />}
    </div>
  );
}
