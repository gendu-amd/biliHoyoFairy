// 角标与轻提示（UI 基元）。被 api / blacklist / dom / 面板等广泛使用，故置于低层。
// 角标点击需打开面板 → 经 ui/hooks 的 openPanel 注入，避免直接依赖面板模块。
import { CONFIG } from '../config';
import { sessionBlocked } from '../stats';
import { openPanel } from './hooks';

export function updateBadge(): void {
  let b = document.getElementById('bfb-badge');
  if (!b) {
    b = document.createElement('div');
    b.id = 'bfb-badge';
    b.title = '点击打开设置';
    b.onclick = openPanel;
    document.body.appendChild(b);
  }
  b.classList.toggle('off', !CONFIG.enabled);
  b.textContent = CONFIG.enabled ? `🛡 已拦截 ${sessionBlocked}（共${CONFIG.blockedCount}）` : '🛡 已暂停';
}

function toastContainer(): HTMLElement {
  let c = document.getElementById('bfb-toasts');
  if (!c) {
    c = document.createElement('div');
    c.id = 'bfb-toasts';
    document.body.appendChild(c);
  }
  return c;
}

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

// kind 决定左侧色条（默认 info=原样）：success 绿 / warn 橙 / error 红，便于一眼区分操作结果。
export function toast(msg: string, kind: ToastKind = 'info'): void {
  const t = document.createElement('div');
  t.className = 'bfb-toast' + (kind !== 'info' ? ' ' + kind : '');
  t.textContent = msg;
  toastContainer().appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
