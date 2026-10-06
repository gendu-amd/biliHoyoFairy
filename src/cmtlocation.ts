// 评论区 IP 属地展示（temp/B站评论区开盒.js 的功能收敛版）。
//
// 原脚本（mscststs，ISC）的思路是拦截评论脚本的加载、拉到源码做字符串补丁后 eval——
// 因为它独立运行，只能从渲染层下手。本项目不需要：评论过滤早已通过 attachShadow 钩子
// 收集了评论组件的全部 shadowRoot，并直接读宿主 __data（见 comments.ts），而
// reply.reply_control.location（"IP属地：xx"）就在同一份数据里。
// 所以这里只做两件事：找到各评论组件 shadow 树里的时间节点（#pubdate），把属地文本插到旁边。
// B 站自己已经显示属地的 root（textContent 含 "IP属地"）跳过，避免重复。
//
// 刻意不做的两路（原脚本还兼容它们）：
//   - 旧版 bbComment 全局的原型补丁：旧评论系统早已下线，兼容代码比功能本身还长；
//   - comment-pc-vue.next.js 的源码补丁 + __vueParentComponent 读取：过渡期架构。
// 本模块依赖的 lit Web Component 架构正是 comments.ts 已经支持的同一套，改版时一起失效、一起修。
import { CONFIG } from './config';
import { shadowRoots } from './shadow';
import { safe } from './logging';

// 只声明用到的字段，全可选（同 comments.ts 的约定：别人的结构，缺字段=不命中而非抛错）。
interface LocReplyControl {
  location?: string;
}
interface LocData {
  reply_control?: LocReplyControl;
}
type LocHost = HTMLElement & { __data?: LocData; data?: LocData };

const LOC_ATTR = 'data-bfb-loc';
// 已注入的属地节点。Set 而非 WeakSet：关闭开关时还要按它**摘除**（ WeakSet 不可枚举）。
const injected = new Set<HTMLElement>();

/** 扫描并注入/（开关关闭时）摘除 IP 属地。进任何扫描路径都安全、幂等。带错误边界：个别失效 root 只跳过本轮。 */
export const scanCmtLocation = safe('scanCmtLocation', function () {
  if (!CONFIG.enabled || !CONFIG.showCmtLocation) {
    clearCmtLocation();
    return;
  }
  for (const root of shadowRoots) {
    const host = root.host as LocHost | undefined;
    // 评论组件族才可能含有 #pubdate：按标签名先把绝大多数无关 root 挡掉（热路径，每轮扫描都跑）。
    if (!host || !host.tagName || !host.tagName.startsWith('BILI-COMMENT')) continue;
    if (root.querySelector('[' + LOC_ATTR + ']')) continue; // 本 root 已注入过
    for (const anchor of root.querySelectorAll<HTMLElement>('[id="pubdate"]')) {
      // B 站自己已经渲染了属地：不重复（同一模板，查一次即可）
      if (root.textContent && root.textContent.includes('IP属地')) break;
      injectAfter(anchor);
    }
  }
});

function injectAfter(anchor: HTMLElement): void {
  const loc = resolveLocation(anchor);
  if (!loc) return;
  const el = document.createElement('span');
  el.setAttribute(LOC_ATTR, '');
  // 处于评论组件的 shadow 树内，文档级 CSS 够不着，样式必须全内联（同折叠灰条的做法）
  el.style.cssText = 'display:inline-block;margin-left:12px;font-size:12px;color:#9499a0;vertical-align:middle';
  el.textContent = loc;
  anchor.insertAdjacentElement('afterend', el);
  injected.add(el);
  // 长会话里 B 站会不断重渲染评论，摘掉的旧节点会留在集合里：过界就顺手清一波断链的
  if (injected.size > 500) {
    for (const old of injected) if (!old.isConnected) injected.delete(old);
  }
}

// 属地数据不在当前节点上就在祖先宿主上：沿 shadow 边界逐层上爬（内层渲染器 → 楼层线程 → …），
// 每层都试 __data / data（lit 组件的公开属性）。找不到就空手而归，绝不抛错。
function resolveLocation(el: Element): string {
  let n: Node | null = el;
  for (let i = 0; i < 6 && n; i++) {
    const rootNode = n.getRootNode();
    if (!(rootNode instanceof ShadowRoot)) return '';
    const host = rootNode.host as LocHost;
    const d = host.__data || host.data;
    const loc = d && d.reply_control && d.reply_control.location;
    if (typeof loc === 'string' && loc) return loc;
    n = host;
  }
  return '';
}

function clearCmtLocation(): void {
  if (!injected.size) return;
  for (const el of injected) {
    try {
      el.remove();
    } catch (e) {
      /* 已被 B 站重渲染摘走 */
    }
  }
  injected.clear();
}
