// 悬停快捷操作浮层（拉黑 / 不看这个）。
// 用独立 Shadow DOM 承载：不改 B 站卡片 DOM，既抗框架重渲染冲掉，又与页面 CSS 互不污染。
import { CONFIG } from '../../config';
import { extractCardInfo, cachedCardInfo } from '../../cardinfo';
import type { CardInfo } from '../../cardinfo';
import { blacklistUp } from '../../blacklist';
import { addToList, removeFromList } from '../../rules';
import { toast } from '../toast';
import { refreshPanelIfOpen } from '../hooks';
import { elementOf, findCard } from './locate';
import { confirmBlacklist } from './shared';

let overlayHost: HTMLElement | null = null;
let overlayRoot: ShadowRoot | null = null;
function getOverlayRoot(): ShadowRoot {
  if (overlayRoot) return overlayRoot;
  const host = document.createElement('div');
  host.id = 'bfb-overlay-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:100002;pointer-events:none;contain:layout style';
  const root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style');
  st.textContent =
    '.blk{position:fixed;pointer-events:auto;background:rgba(251,114,153,.95);color:#fff;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28);font-family:system-ui,Arial;user-select:none;display:none}' +
    '.blk:hover{background:#fb7299}' +
    '.hidev{position:fixed;pointer-events:auto;background:rgba(45,45,52,.92);color:#fff;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28);font-family:system-ui,Arial;user-select:none;display:none}' +
    '.hidev:hover{background:#2d2d34}';
  root.appendChild(st);
  (document.documentElement || document.body).appendChild(host);
  overlayHost = host;
  overlayRoot = root;
  return root;
}

// 两个浮层按钮成对存在（要么都没建，要么都建好）。用一个整体而不是两个可空变量持有它们：
// 「建好了」这件事只判断一次，后续位置/显隐操作不必再各自判空。
interface HoverBtns {
  blk: HTMLElement;
  hidev: HTMLElement;
}
let hoverBtns: HoverBtns | null = null;
let hoverCard: HTMLElement | null = null;

// 取当前悬停卡的信息：优先用扫描期缓存，没有再现场解析。
function hoverInfo(card: HTMLElement): CardInfo {
  return cachedCardInfo(card) || extractCardInfo(card);
}

function ensureHoverBtns(): HoverBtns {
  if (hoverBtns) return hoverBtns;
  const root = getOverlayRoot();
  const blk = document.createElement('div');
  blk.className = 'blk';
  blk.textContent = '⛔ 拉黑';
  blk.title = '拉黑该 UP（同步账号黑名单）';
  blk.onclick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const card = hoverCard;
    if (!card) return;
    const info = hoverInfo(card);
    const label = info.up || info.bvid;
    if (!label) {
      toast('该卡片信息不足，无法拉黑');
      return;
    }
    confirmBlacklist(label).then((ok) => {
      if (!ok) return;
      blacklistUp(info, refreshPanelIfOpen, card);
      hideHoverBtn();
    });
  };
  root.appendChild(blk);

  // 「不看这个」：只隐藏当前这条视频（加入 BV 屏蔽，刷新后仍隐藏，可撤销）。比拉黑整个 UP 更轻。
  const hidev = document.createElement('div');
  hidev.className = 'hidev';
  hidev.textContent = '🚫 不看这个';
  hidev.title = '不再显示这个视频（按 BV 号屏蔽，刷新后仍隐藏，可在黑名单撤销）';
  hidev.onclick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hoverCard) return;
    const info = hoverInfo(hoverCard);
    const bvid = info.bvid;
    if (!bvid) {
      toast('该卡片没有 BV 号，无法按视频隐藏', 'warn');
      return;
    }
    if (addToList(CONFIG.block.bvids, bvid)) {
      toast(`已隐藏这个视频：${info.title || bvid}`, 'success', { label: '撤销', onClick: () => removeFromList(CONFIG.block.bvids, bvid) });
    } else {
      toast('该视频此前已隐藏');
    }
    refreshPanelIfOpen();
    hideHoverBtn();
  };
  root.appendChild(hidev);

  hoverBtns = { blk, hidev };
  return hoverBtns;
}
export function hideHoverBtn(): void {
  if (hoverBtns) {
    hoverBtns.blk.style.display = 'none';
    hoverBtns.hidev.style.display = 'none';
  }
  hoverCard = null;
}
function positionHoverBtn(card: HTMLElement) {
  const r = card.getBoundingClientRect();
  if (r.width < 80 || r.height < 60) return hideHoverBtn(); // 太小的卡（如纯文本/骨架）不显示
  const { blk, hidev } = ensureHoverBtns();
  const left = Math.max(8, r.left + 8);
  const top = Math.max(8, r.top + 8);
  blk.style.left = left + 'px';
  blk.style.top = top + 'px';
  blk.style.display = 'block';
  hidev.style.left = left + 'px';
  hidev.style.top = top + 30 + 'px'; // 叠在「拉黑」下方
  hidev.style.display = 'block';
  hoverCard = card;
}
// 鼠标划过页面时 mouseover 每秒几十次，而 findCard 要 composedPath()（分配整条祖先路径）
// 再逐节点 matches()。悬停按钮不需要亚帧响应，且一帧内的连续 mouseover 绝大多数落在同一张卡上，
// 所以只记下最后一个事件、下一帧算一次。
let pendingHover: MouseEvent | null = null;
let hoverRaf = 0;

function resolveHover(): void {
  hoverRaf = 0;
  const e = pendingHover;
  pendingHover = null;
  if (!e) return;
  const card = findCard(e);
  if (!card) hideHoverBtn();
  else if (card !== hoverCard) positionHoverBtn(card);
}

export function onCardHover(e: MouseEvent): void {
  if (!CONFIG.enabled || !CONFIG.cardHoverBtn) return;
  const t = elementOf(e.target);
  if (t && t === overlayHost) return; // 事件从 Shadow 浮层冒泡时 target 会重定向为 host，保持显示
  pendingHover = e;
  if (hoverRaf) return;
  hoverRaf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(resolveHover) : (setTimeout(resolveHover, 16) as unknown as number);
}