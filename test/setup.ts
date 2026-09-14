import { vi } from 'vitest';

// jsdom 未实现的浏览器 API 垫片
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = vi.fn();
}

// HTML5 拖放 DataTransfer 最小实现
class DataTransferShim {
  private store = new Map<string, string>();
  dropEffect = 'none';
  effectAllowed = 'all';
  get types() { return [...this.store.keys()]; }
  setData(type: string, data: string) { this.store.set(type, data); }
  getData(type: string) { return this.store.get(type) ?? ''; }
  clearData(type?: string) { if (type) this.store.delete(type); else this.store.clear(); }
}
(globalThis as unknown as { DataTransfer: unknown }).DataTransfer = DataTransferShim;
