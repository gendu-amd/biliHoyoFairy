// 从鼠标事件定位页面元素（视频卡 / 评论宿主 / 播放页 UP）。
// 统一走 composedPath：事件穿过 shadow 边界时 target 会被重定向到宿主，closest 走不进影子树。
import { isCommentTag, PAGE_HEADER_SELECTOR, VIDEO_PAGE_UP_BOX, VIDEO_PAGE_UP_NAME } from '../../selectors';
import { VIDEO_CARD_SELECTOR, pageType } from '../../page';
import { asCommentHost } from '../../comments';
import type { CommentHost } from '../../comments';

// EventTarget 静态类型上没有 closest/tagName。一次带运行期检查的收窄，替代散落的 as Element。
export function elementOf(t: EventTarget | null): Element | null {
  return t instanceof Element ? t : null;
}

// composedPath() 给出未重定向的完整路径（影子树内的真实节点 + 一路向上的祖先），
// 对「卡在影子树里」和「卡在普通 DOM 里」一视同仁。
export function findCard(e: MouseEvent): HTMLElement | null {
  const path: EventTarget[] = (e.composedPath && e.composedPath()) || [];
  for (const node of path) {
    const el = elementOf(node);
    if (el && el.matches(VIDEO_CARD_SELECTOR)) return el as HTMLElement;
  }
  // composedPath 不可用时退回原来的写法（普通 DOM 上两者等价）。
  const t = elementOf(e.target);
  return t ? t.closest<HTMLElement>(VIDEO_CARD_SELECTOR) : null;
}
// 播放页当前视频的 UP（不属于任何一张卡）。判据用「指向 space.bilibili.com 的链接」而非类名——
// 类名改过好几轮，链接没变。范围收紧以免抢掉浏览器原生右键：只在播放页、排除顶栏头像与评论区
// （评论那条右键分支只在「评论区过滤」开着时才走，关着时不排除会把评论者加进视频黑名单）。
export function findVideoPageUp(e: MouseEvent): { uid: string; up: string; bvid: string } | null {
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
// 评论在 shadow DOM 内，contextmenu 的 target 会重定向到宿主；用 composedPath 在路径上找评论组件宿主。
export function findCommentHost(e: MouseEvent): CommentHost | null {
  const path: EventTarget[] = (e.composedPath && e.composedPath()) || [];
  for (const node of path) {
    const host = asCommentHost(elementOf(node));
    if (host) return host;
  }
  return null;
}
