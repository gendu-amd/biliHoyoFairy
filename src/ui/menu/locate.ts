// 从鼠标事件定位页面元素（视频卡 / 评论宿主 / 播放页 UP）。
//
// 统一走 composedPath 而不是 e.target.closest：事件穿过 shadow 边界时 target 会被**重定向**
// 到宿主元素，从它出发的 closest 永远走不进那棵影子树——卡片可能长在 B 站自己的组件里，
// 也可能长在 BewlyCat 这类把整个界面挂进 shadow root 的扩展里。
import { isCommentTag, PAGE_HEADER_SELECTOR, VIDEO_PAGE_UP_BOX, VIDEO_PAGE_UP_NAME } from '../../selectors';
import { VIDEO_CARD_SELECTOR, pageType } from '../../page';
import { asCommentHost } from '../../comments';
import type { CommentHost } from '../../comments';

// 事件的 target / composedPath 项静态类型只是 EventTarget（取不到 closest/tagName），
// 运行期在本页面上总是元素。用一次带运行期检查的收窄替代散落的 as Element：非元素目标（document 等）
// 走 null 分支，行为与旧代码的 `t.closest && ...` 一致。
export function elementOf(t: EventTarget | null): Element | null {
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
// 播放页上「当前正在看的这个视频的 UP」。它不属于任何一张卡，所以走不到上面那条路径——
// 于是播放页右键 UP 一直没有任何反应，而那恰恰是最想屏蔽的时刻（看到一半发现是营销号）。
//
// 判据用「指向 space.bilibili.com 的链接」而不是类名：UP 名、头像、联合投稿的合作成员，
// 在 B 站历次版式里都是这样的链接，类名却改过好几轮。范围收得很紧，避免抢掉浏览器原生右键菜单：
//   - 只在播放页生效；
//   - 顶栏里的 space 链接（你自己的头像）不算；
//   - 评论组件里的用户名不算——那是评论者不是本视频的 UP。评论区自己有一条右键分支，但它只在
//     「评论区过滤」开着时才走，关着时这里必须自己把评论区排除掉，否则会把评论者加进视频黑名单。
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
