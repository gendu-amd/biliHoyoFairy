// 右键菜单 + 悬停快捷拉黑浮层。右键视频卡/评论 → 屏蔽/拉黑/加白名单/隐藏；悬停卡片显示「拉黑」浮层。
// 浮层用独立 Shadow DOM，抗 B 站框架重渲染、与页面 CSS 互不污染。
import { CONFIG } from '../config';
import { PROCESSED } from '../constants';
import { VIDEO_CARD_SELECTOR, pageType } from '../page';
import { isCommentTag, PAGE_HEADER_SELECTOR, VIDEO_PAGE_UP_BOX, VIDEO_PAGE_UP_NAME } from '../selectors';
import { extractCardInfo, cachedCardInfo } from '../cardinfo';
import type { CardInfo } from '../cardinfo';
import { readCmt, asCommentHost } from '../comments';
import type { CommentHost } from '../comments';
import { blockVideo } from '../dom';
import { blacklistUp } from '../blacklist';
import { addToList, removeFromList } from '../rules';
import { toast } from './toast';
import { confirmModal } from './confirm';
import { refreshPanelIfOpen, openPanel } from './hooks';

// 事件的 target / composedPath 项静态类型只是 EventTarget（取不到 closest/tagName），
// 运行期在本页面上总是元素。用一次带运行期检查的收窄替代散落的 as Element：非元素目标（document 等）
// 走 null 分支，行为与旧代码的 `t.closest && ...` 一致。
function elementOf(t: EventTarget | null): Element | null {
  return t instanceof Element ? t : null;
}

// 从鼠标事件定位视频卡。
//
// 不能直接 e.target.closest(...)：卡片可能长在 shadow DOM 里（B 站自己的组件，以及 BewlyCat
// 这类把整个界面挂进 shadow root 的界面替换类扩展）。事件穿过影子边界时 e.target 会被**重定向**
// 到宿主元素，从它出发的 closest 永远走不进那棵影子树——于是扫描器明明已经遍历 shadow root
// 隐藏了这张卡，同一张卡却右键不了、悬停也不出按钮。评论那条路径早就用 composedPath 解决了
// 这个问题（见 findCommentHost），视频卡这条一直没跟上，是我们自己的不一致。
//
// composedPath() 给出的是**未重定向**的完整路径：影子树内的真实节点 + 一路向上的普通祖先，
// 所以对「卡在影子树里」和「卡在普通 DOM 里」两种情况一视同仁，逐个 matches 即可。
function findCard(e: MouseEvent): HTMLElement | null {
  const path: EventTarget[] = (e.composedPath && e.composedPath()) || [];
  for (const node of path) {
    const el = elementOf(node);
    if (el && el.matches(VIDEO_CARD_SELECTOR)) return el as HTMLElement;
  }
  // composedPath 不可用时退回原来的写法（普通 DOM 上两者等价）。
  const t = elementOf(e.target);
  return t ? t.closest<HTMLElement>(VIDEO_CARD_SELECTOR) : null;
}

// 播放页上「当前正在看的这个视频的 UP」。它不属于任何一张卡，所以走不到上面那条路径——
// 于是播放页右键 UP 一直没有任何反应，而那恰恰是最想屏蔽的时刻（看到一半发现是营销号）。
//
// 判据用「指向 space.bilibili.com 的链接」而不是类名：UP 名、头像、联合投稿的合作成员，
// 在 B 站历次版式里都是这样的链接，类名却改过好几轮。范围收得很紧，避免抢掉浏览器原生右键菜单：
//   - 只在播放页生效；
//   - 顶栏里的 space 链接（你自己的头像）不算；
//   - 评论组件里的用户名不算——那是评论者不是本视频的 UP。评论区自己有一条右键分支，但它只在
//     「评论区过滤」开着时才走，关着时这里必须自己把评论区排除掉，否则会把评论者加进视频黑名单。
function findVideoPageUp(e: MouseEvent): { uid: string; up: string; bvid: string } | null {
  if (pageType() !== '播放页') return null;
  const path: EventTarget[] = (e.composedPath && e.composedPath()) || [];
  let link: Element | null = null;
  for (const node of path) {
    const el = elementOf(node);
    if (!el) continue;
    // 排除项要一路查到顶才算数，所以找到链接后不能提前 return。
    if (isCommentTag(el.tagName) || el.matches(PAGE_HEADER_SELECTOR)) return null;
    if (!link && el.matches('a[href*="space.bilibili.com"]')) link = el;
  }
  if (!link) return null;
  const uid = ((link.getAttribute('href') || '').match(/space\.bilibili\.com\/(\d+)/) || [])[1] || '';
  if (!uid) return null;
  let up = (link.getAttribute('title') || link.textContent || '').trim();
  if (!up) {
    // 头像那种链接自身没有文字：到所在的 UP 信息区里取名字。取不到也不影响功能——
    // 屏蔽与拉黑都按 uid 走，名字只用于菜单文案和屏蔽记录的显示。
    const box = link.closest(VIDEO_PAGE_UP_BOX);
    const nameEl = box && box.querySelector(VIDEO_PAGE_UP_NAME);
    up = ((nameEl && (nameEl.getAttribute('title') || nameEl.textContent)) || '').trim();
  }
  return { uid, up, bvid: (location.pathname.match(/(BV[0-9A-Za-z]+)/) || [])[1] || '' };
}

// 播放页 UP 的右键菜单。与卡片菜单的差别：没有「隐藏这一张」（你正在看它，没有卡可隐），
// 屏蔽/拉黑的效果要等下次推荐才看得到，所以文案里说清楚。
function showVideoPageUpMenu(e: MouseEvent): void {
  const info = findVideoPageUp(e);
  if (!info) return;
  const label = info.up || 'UID ' + info.uid;

  e.preventDefault();
  e.stopPropagation();
  closeCtxMenu();

  const items: CtxItem[] = [];
  const sel = selectedText();
  if (sel) {
    items.push({
      label: `🚫 屏蔽含「${sel}」关键词`,
      act: () => {
        addToList(CONFIG.block.keywords, sel);
        toast(`已加入关键词：${sel}`);
        refreshPanelIfOpen();
      },
    });
  }
  items.push({
    label: `🚫 屏蔽 UP「${label}」`,
    act: () => {
      addToList(CONFIG.block.uids, info.uid);
      toast(`已屏蔽 UP：${label}（此后不再向你推荐其视频）`);
      refreshPanelIfOpen();
    },
  });
  items.push({
    label: `⛔ 拉黑 UP「${label}」（同步账号黑名单）`,
    act: () => {
      confirmBlacklist(label).then((ok) => {
        if (ok) blacklistUp(info, refreshPanelIfOpen);
      });
    },
  });
  items.push({
    label: `⭐ 加入白名单（永不屏蔽此 UP）`,
    act: () => {
      addToList(CONFIG.allow.uids, info.uid);
      toast(`已加入白名单：${label}`);
      refreshPanelIfOpen();
    },
  });
  if (info.bvid) {
    items.push({
      label: `🚫 屏蔽此视频（${info.bvid}）`,
      act: () => {
        addToList(CONFIG.block.bvids, info.bvid);
        toast(`已屏蔽视频：${info.bvid}`);
        refreshPanelIfOpen();
      },
    });
  }
  items.push({ label: '⚙️ 打开设置面板', act: openPanel });

  renderCtxMenu(e, items);
}

// 账号拉黑是不可一键撤销的账号写操作，且与「本地屏蔽」相邻、易误点 → 执行前二次确认（样式化弹窗，Promise<boolean>）。
function confirmBlacklist(name: string): Promise<boolean> {
  return confirmModal(`确定拉黑「${name}」并写入账号黑名单？\n刷新后不再推荐、不可一键撤销（未登录则仅本地屏蔽）。`, {
    title: '拉黑确认',
    okText: '拉黑',
    danger: true,
  });
}

interface CtxItem {
  label: string;
  act: () => void;
}

let ctxMenuEl: HTMLElement | null = null;
function closeCtxMenu() {
  if (ctxMenuEl) {
    ctxMenuEl.remove();
    ctxMenuEl = null;
  }
}

// 选中文本：过长（多半是误拖选）不作为规则候选。
function selectedText(): string {
  const s = window.getSelection && window.getSelection();
  const t = (s && s.toString().trim()) || '';
  return t.length <= 30 ? t : '';
}

export function onContextMenu(e: MouseEvent): void {
  if (!CONFIG.enabled || !CONFIG.rightClickBlock) return;

  // 评论区右键（优先于视频卡）：在评论上右键 → 屏蔽该评论用户 / 选中文本加评论关键词
  if (CONFIG.comment.enabled) {
    const cmtHost = findCommentHost(e);
    if (cmtHost) {
      const c = readCmt(cmtHost);
      const citems: CtxItem[] = [];
      const csel = selectedText();
      if (csel) {
        citems.push({
          label: `🚫 评论含「${csel}」关键词`,
          act: () => {
            addToList(CONFIG.comment.keywords, csel);
            toast(`已加入评论关键词：${csel}`);
            refreshPanelIfOpen();
          },
        });
      }
      if (c.uname) {
        citems.push({
          label: `🚫 屏蔽评论用户「${c.uname}」`,
          act: () => {
            addToList(CONFIG.comment.userNames, c.uname);
            toast(`已屏蔽评论用户：${c.uname}`);
            refreshPanelIfOpen();
          },
        });
      }
      if (citems.length) {
        e.preventDefault();
        e.stopPropagation();
        closeCtxMenu();
        renderCtxMenu(e, citems);
        return;
      }
    }
  }

  const card = findCard(e);
  if (!card) return showVideoPageUpMenu(e); // 不是卡片 → 试试播放页的 UP 信息区
  // 右键为低频用户操作：强制深度提取，确保拿到权威 UID（扫描期缓存可能未解析 UID）
  const info = extractCardInfo(card, true);
  if (!info.up && !info.bvid) return;

  e.preventDefault();
  e.stopPropagation();
  closeCtxMenu();

  const items: CtxItem[] = [];
  const sel = selectedText();
  if (sel) {
    items.push({
      label: `🚫 屏蔽含「${sel}」关键词`,
      act: () => {
        addToList(CONFIG.block.keywords, sel);
        toast(`已加入关键词：${sel}`);
        refreshPanelIfOpen();
      },
    });
  }
  if (info.up) {
    const up = info.up;
    items.push({
      label: `🚫 屏蔽 UP「${up}」`,
      act: () => {
        if (info.uid) addToList(CONFIG.block.uids, info.uid);
        else addToList(CONFIG.block.upNames, up);
        toast(`已屏蔽 UP：${up}`);
        refreshPanelIfOpen();
      },
    });
    items.push({
      label: `⛔ 拉黑 UP「${up}」（同步账号黑名单）`,
      act: () => {
        confirmBlacklist(up).then((ok) => {
          if (ok) blacklistUp(info, refreshPanelIfOpen, card);
        });
      },
    });
    items.push({
      label: `⭐ 加入白名单（永不屏蔽此 UP）`,
      act: () => {
        addToList(CONFIG.allow.upNames, up);
        toast(`已加入白名单：${up}`);
        refreshPanelIfOpen();
      },
    });
  }
  if (info.bvid) {
    const bvid = info.bvid;
    items.push({
      label: `🚫 屏蔽此视频（${bvid}）`,
      act: () => {
        addToList(CONFIG.block.bvids, bvid);
        toast(`已屏蔽视频：${bvid}`);
        refreshPanelIfOpen();
      },
    });
  }
  items.push({
    label: '🙈 隐藏这一张',
    act: () => {
      card.setAttribute(PROCESSED, '1');
      blockVideo(card, '手动', info);
    },
  });
  items.push({ label: '⚙️ 打开设置面板', act: openPanel });

  renderCtxMenu(e, items);
}

// 在鼠标处弹出自定义菜单（视频卡 / 评论 共用）。
function renderCtxMenu(e: MouseEvent, items: CtxItem[]) {
  const menu = document.createElement('div');
  menu.id = 'bfb-ctxmenu';
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'bfb-ctx-item';
    row.textContent = it.label;
    row.onclick = () => {
      closeCtxMenu();
      it.act();
    };
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  menu.style.left = Math.min(e.clientX, window.innerWidth - 270) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px';
  ctxMenuEl = menu;
}

// 评论在 shadow DOM 内，contextmenu 的 target 会重定向到宿主；用 composedPath 在路径上找评论组件宿主。
function findCommentHost(e: MouseEvent): CommentHost | null {
  const path: EventTarget[] = (e.composedPath && e.composedPath()) || [];
  for (const node of path) {
    const host = asCommentHost(elementOf(node));
    if (host) return host;
  }
  return null;
}
document.addEventListener('click', closeCtxMenu, true);
document.addEventListener('scroll', closeCtxMenu, true);

/* —— 悬停快捷拉黑按钮（独立 fixed 浮层，不改 B 站卡片 DOM，规避框架重渲染冲掉） —— */
// 浮层根：独立 Shadow DOM。host 自身 pointer-events:none + contain，既抗 B 站框架重渲染冲掉，
// 又让页面 CSS 与我们的样式互不污染。
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
