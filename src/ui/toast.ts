// 角标与轻提示（UI 基元）。被 api / blacklist / dom / 面板等广泛使用，故置于低层。
// 角标点击需打开面板 → 经 ui/hooks 的 openPanel 注入，避免直接依赖面板模块。
import { CONFIG } from '../config';
import { healthDegraded } from '../health';
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
  // 拦截管线疑似失效时角标变黄。不弹 toast——误报的代价是骚扰所有人，而变色是零打断的提示：
  // 平时粉的东西今天黄了，足以让人点开看一眼，这正是「静默失效」最缺的那一环。
  const degraded = CONFIG.enabled && healthDegraded();
  b.classList.toggle('warn', degraded);
  b.title = degraded ? '⚠ 拦截可能已失效，点开看「工具 → 🩺 运行自检」' : '点击打开设置';
  b.textContent = CONFIG.enabled ? `${degraded ? '⚠' : '🛡'} 已拦截 ${sessionBlocked}（共${CONFIG.blockedCount}）` : '🛡 已暂停';
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

// 停留时长。带按钮的要长一些（用户得先读完再决定点不点），但也就长一点——
// 撤销这种提示 6 秒足够，再久就只是挡着页面。
const PLAIN_MS = 4000;
const ACTION_MS = 6000;

// 点页面别处也关掉。听 mousedown 而不是 click：提示多半是在某次 click 的处理函数里创建的，
// 听 click 会被同一次交互立刻打中（mousedown 那时提示还不存在，天然错开）。
// 首次出现提示时挂一次、之后常驻——回调只做一次 getElementById + contains，代价可忽略。
let dismissArmed = false;
function armDismissOnOutsideClick(): void {
  if (dismissArmed) return;
  dismissArmed = true;
  const onDown = (e: Event) => {
    const c = document.getElementById('bfb-toasts');
    if (!c) return;
    // 点在提示自己身上由它自己处理（还要区分「按了动作按钮」）
    if (e.target instanceof Node && c.contains(e.target)) return;
    c.innerHTML = '';
  };
  document.addEventListener('mousedown', onDown, true);
}

export type ToastKind = 'info' | 'success' | 'warn' | 'error';
export interface ToastAction {
  label: string;
  onClick: () => void;
}

// kind 决定左侧色条（默认 info=原样）：success 绿 / warn 橙 / error 红，便于一眼区分操作结果。
// action：可选行内按钮（如「撤销」）；带 action 时默认延长停留到 8s，给用户反应时间。
export function toast(msg: string, kind: ToastKind = 'info', action?: ToastAction, ms?: number): void {
  const t = document.createElement('div');
  t.className = 'bfb-toast' + (kind !== 'info' ? ' ' + kind : '');
  t.title = '点击关闭';
  const span = document.createElement('span');
  span.className = 'bfb-toast-msg';
  span.textContent = msg;
  t.appendChild(span);
  const timeout = ms ?? (action ? ACTION_MS : PLAIN_MS);
  const timer = setTimeout(() => t.remove(), timeout);
  const close = () => {
    clearTimeout(timer);
    t.remove();
  };
  // 点提示本身即关闭。带按钮的提示停留更久（要给人反应时间），久到不能手动关掉就成了赖着不走。
  t.onclick = close;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bfb-toast-act';
    b.textContent = action.label;
    b.onclick = (e: MouseEvent) => {
      e.stopPropagation(); // 别让上面那层 close 抢在动作前面
      close();
      action.onClick();
    };
    t.appendChild(b);
  }
  toastContainer().appendChild(t);
  armDismissOnOutsideClick();
}
