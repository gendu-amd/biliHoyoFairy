import { isCommentTag } from './selectors';

// 开放 Shadow Root 注册表：部分卡片/评论渲染在 shadow DOM 内，普通 querySelectorAll 选不中。
//
// 之所以要「新增 root」回调而不是各处自己 add：**影子树内部的变动不会冒泡到 document 级观察器**，
// 每个 root 都得被单独观察一次，而观察器住在 scanner 里。收口成单一入口 + 一个回调，
// 就不会出现「某处 add 了但没人观察」。
export const shadowRoots = new Set<ShadowRoot>();
// 评论组件的 root 单列一份：评论扫描只关心它们，不必每轮遍历全部 root 再按标签名过滤。
// 也让「给评论挂它自己的观察器」有个自然的落点。
export const commentRoots = new Set<ShadowRoot>();

type RootHandler = (root: ShadowRoot) => void;
let onRoot: RootHandler = () => {};

/** 注册「发现新 shadow root」的处理器（scanner 用它挂观察器）。注册时会对已收集的 root 补跑一遍。 */
export function setShadowRootHandler(fn: RootHandler): void {
  onRoot = fn;
  for (const r of shadowRoots) fn(r);
}

/** 收录一个 shadow root。所有采集路径（attachShadow 钩子 / 观察器 / 全量采集）的唯一入口。 */
export function addShadowRoot(root: ShadowRoot | null | undefined): void {
  if (!root || shadowRoots.has(root)) return;
  shadowRoots.add(root);
  if (root.host && isCommentTag(root.host.tagName)) commentRoots.add(root);
  onRoot(root);
}

/** 丢掉宿主已脱离文档的 root。由定时器统一调用——回收与「用户开没开拦截」无关，不该被那个开关挡住。 */
export function pruneShadowRoots(): void {
  for (const r of shadowRoots) {
    if (r.host && r.host.isConnected) continue;
    shadowRoots.delete(r);
    commentRoots.delete(r);
  }
}

export function harvestShadowRoots(root: Document | ShadowRoot | Element | null): void {
  if (!root || !root.querySelectorAll) return;
  try {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot && el.id !== 'bfb-overlay-host') addShadowRoot(el.shadowRoot);
    }
  } catch (e) {
    /* 选择器/遍历异常忽略 */
  }
}
