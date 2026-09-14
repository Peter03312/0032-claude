import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEventLib from '@testing-library/user-event';
import { App } from '../src/ui/App';

const user = userEventLib.setup();

const setNum = async (testid: string, value: string) => {
  const el = screen.getByTestId(testid) as HTMLInputElement;
  await user.clear(el);
  await user.type(el, value);
};

const addStrips = async (n: number) => {
  for (let i = 0; i < n; i++) await user.click(screen.getByTestId('add-strip'));
};
const addPieces = async (n: number) => {
  for (let i = 0; i < n; i++) await user.click(screen.getByTestId('add-piece'));
};
const solve = async () => user.click(screen.getByTestId('solve-button'));
const stripId = (i: number) => (screen.getByTestId(`strip-id-${i}`) as HTMLInputElement).value;
const pieceId = (i: number) => (screen.getByTestId(`piece-id-${i}`) as HTMLInputElement).value;

describe('端到端：从空仓库起步的完整链路', () => {
  it('非 0.1 整数倍就地报错，修正后正常出图', async () => {
    render(<App />);
    expect(screen.getByTestId('empty-strips')).toBeTruthy();
    await addStrips(1);
    await addPieces(1);
    await setNum('strip-length-0', '12.34'); // 非法精度
    await setNum('piece-length-0', '100');
    await solve();
    expect(screen.getByText(/只接受 0.1 毫米整数倍/)).toBeTruthy();
    expect(screen.queryByTestId('result-view')).toBeNull();

    await setNum('strip-length-0', '1000');
    await solve();
    const view = screen.getByTestId('result-view');
    expect(view.textContent).toContain('1 / 1');
  });

  it('贪心反例：8,8,6,5,4,4,3,2,2 入三根 14 格料，精确解 3 条且零短余料', async () => {
    render(<App />);
    await addStrips(3);
    for (let i = 0; i < 3; i++) await setNum(`strip-length-${i}`, '1.4');
    await addPieces(9);
    const lens = ['0.8', '0.8', '0.6', '0.5', '0.4', '0.4', '0.3', '0.2', '0.2'];
    for (let i = 0; i < 9; i++) await setNum(`piece-length-${i}`, lens[i]);
    await setNum('kerf-input', '0');
    await solve();

    const obj = screen.getByTestId('objectives').textContent!;
    expect(obj).toContain('3 / 3');
    expect(obj).toContain('0.0 mm');
    for (let i = 0; i < 3; i++) expect(screen.getByTestId(`svg-strip-${i}`)).toBeTruthy();
    const table = screen.getByTestId('cut-table');
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(9);
  });

  it('锯缝+疵点反例：漏算锯缝的纸面方案无法落刀，第二片必须从 5.5mm 起放', async () => {
    render(<App />);
    await addStrips(1);
    await setNum('strip-length-0', '11');
    await user.click(screen.getByTestId('add-defect-0'));
    await setNum('defect-from-0-0', '5.0');
    await setNum('defect-to-0-0', '5.4'); // 闭区间 50..54 格
    await addPieces(2);
    await setNum('piece-length-0', '4.8');
    await setNum('piece-length-1', '4.8');
    await setNum('kerf-input', '0.2');
    await solve();

    const table = screen.getByTestId('cut-table');
    const rows = within(table).getAllByRole('row').slice(1);
    const id0 = pieceId(0);
    const id1 = pieceId(1);
    const rowOf = (id: string) => rows.find((r) => r.textContent!.split(id)[1] !== undefined && within(r).getAllByText(id).length > 0)!;
    const p1 = rowOf(id0).textContent!;
    const p2 = rowOf(id1).textContent!;
    // P1 恰好贴疵点：0.0 起、4.8 末、锯缝后缘 5.0
    expect(p1).toContain('0.0');
    expect(p1).toContain('4.8');
    expect(p1).toContain('5.0');
    // P2 若从 5.2 落刀，锯缝会压住疵点 52..54 → 必须 5.5 起
    expect(p2).toContain('5.5');
    expect(p2).toContain('10.5');
    expect(screen.getByTestId('plan-svg').textContent).not.toContain('undefined');
  });

  it('锁定容量冲突：明确标出锁定项与数字，且不展示半成品', async () => {
    render(<App />);
    await addStrips(2);
    await setNum('strip-length-0', '10');
    await setNum('strip-length-1', '10');
    await addPieces(2);
    await setNum('piece-length-0', '6');
    await setNum('piece-length-1', '6');
    await setNum('kerf-input', '0.2');
    const s1 = stripId(0);
    await user.selectOptions(screen.getByTestId('piece-lock-0'), s1);
    await user.selectOptions(screen.getByTestId('piece-lock-1'), s1);
    await solve();

    const banner = screen.getByTestId('result-unsat');
    expect(banner.textContent).toContain('锁定项造成容量冲突');
    expect(banner.textContent).toContain(s1);
    expect(screen.getByTestId(`offending-lock-${s1}`)).toBeTruthy();
    expect(screen.queryByTestId('result-view')).toBeNull();
  });

  it('总需求超容：给出总需求与总可用容量', async () => {
    render(<App />);
    await addStrips(1);
    await setNum('strip-length-0', '1.0');
    await addPieces(2);
    await setNum('piece-length-0', '0.6');
    await setNum('piece-length-1', '0.6');
    await setNum('kerf-input', '0');
    await solve();
    const banner = screen.getByTestId('result-unsat');
    expect(banner.textContent).toContain('总需求');
    expect(banner.textContent).toContain('12');
    expect(banner.textContent).toContain('10');
  });

  it('拖放锁定与解除锁定真正写入模型并参与求解', async () => {
    render(<App />);
    await addStrips(2);
    await setNum('strip-length-0', '10');
    await setNum('strip-length-1', '10');
    await addPieces(1);
    await setNum('piece-length-0', '3');
    await setNum('kerf-input', '0');

    const dt = new DataTransfer();
    const pieceRow = screen.getByTestId('piece-row-0');
    fireEvent.dragStart(pieceRow, { dataTransfer: dt });
    const card1 = screen.getByTestId('strip-card-1');
    fireEvent.drop(card1, { dataTransfer: dt });
    expect((screen.getByTestId('piece-lock-0') as HTMLSelectElement).value).toBe(stripId(1));

    await solve();
    const s0Id = stripId(0);
    const s1Id = stripId(1);
    const pid = pieceId(0);
    expect(screen.getByTestId('svg-strip-1').textContent).toContain(pid);
    expect(screen.getByTestId('svg-strip-0').textContent).not.toContain(pid);

    // 拖回解锁区后重新求解：裁片回到字典序第一条材
    fireEvent.dragStart(pieceRow, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('unlock-tray'), { dataTransfer: dt });
    expect((screen.getByTestId('piece-lock-0') as HTMLSelectElement).value).toBe('');
    await solve();
    expect(screen.getByTestId('svg-strip-0').textContent).toContain(pid);
    expect(s0Id && s1Id).toBeTruthy();
  });

  it('下载方案 JSON：内容为真实放置结果而非空壳', async () => {
    render(<App />);
    await addStrips(1);
    await setNum('strip-length-0', '3');
    await addPieces(1);
    await setNum('piece-length-0', '1');
    await setNum('kerf-input', '0.2');
    const sid = stripId(0);
    const pid = pieceId(0);
    await solve();

    const spy = vi.spyOn(URL, 'createObjectURL');
    await user.click(screen.getByTestId('download-json'));
    expect(spy).toHaveBeenCalledTimes(1);
    const blob = spy.mock.calls[0][0] as Blob;
    const json = JSON.parse((blob as Blob & { jsonText?: string }).jsonText ?? await new Response(blob).text());
    expect(json.objective.stripsUsed).toBe(1);
    expect(json.placements).toHaveLength(1);
    expect(json.placements[0]).toMatchObject({ pieceId: pid, stripId: sid, startMm: 0, kerfEndMm: 1.2 });
    expect(json.remnants.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('缩放控件改变显示比例，复位回到 100%', async () => {
    render(<App />);
    await addStrips(1);
    await setNum('strip-length-0', '10');
    await addPieces(1);
    await setNum('piece-length-0', '3');
    await solve();
    expect(screen.getByTestId('zoom-level').textContent).toBe('100%');
    await user.click(screen.getByTestId('zoom-in'));
    expect(screen.getByTestId('zoom-level').textContent).toBe('125%');
    await user.click(screen.getByTestId('zoom-out'));
    expect(screen.getByTestId('zoom-level').textContent).toBe('100%');
  });

  it('重复标识就地报错；删除锁定条材后锁定自动解除', async () => {
    render(<App />);
    await addStrips(2);
    await setNum('strip-length-0', '10');
    await setNum('strip-length-1', '10');
    await addPieces(1);
    await setNum('piece-length-0', '3');
    const firstId = stripId(0);
    await user.selectOptions(screen.getByTestId('piece-lock-0'), firstId);
    fireEvent.change(screen.getByTestId('strip-id-1'), { target: { value: firstId } });
    await solve();
    expect(screen.getAllByText('条材标识必须唯一').length).toBeGreaterThan(0);

    // 改成唯一标识后求解通过
    fireEvent.change(screen.getByTestId('strip-id-1'), { target: { value: `${firstId}-X` } });
    await solve();
    expect(screen.getByTestId('result-view')).toBeTruthy();

    // 删除第一根条材，锁定自动解除，不残留悬挂引用
    await user.click(screen.getByTestId('strip-remove-0'));
    expect((screen.getByTestId('piece-lock-0') as HTMLSelectElement).value).toBe('');
    await solve();
    expect(screen.getByTestId('result-view')).toBeTruthy();
  });
});
