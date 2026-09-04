// 开放 Shadow Root 注册表：部分卡片/评论渲染在 shadow DOM 内，普通 querySelectorAll 选不中。
// 启动全量采集一次，之后只在 MutationObserver 新增节点子树里增量采集，避免每次扫描全量遍历。
//
// 为什么要有「新增 root」的回调而不是让各处自己 `shadowRoots.add`：
// **shadow root 内部的 DOM 变动不会冒泡到 document 级的 MutationObserver**。
// 只观察 document 的话，影子树里新增的卡永远不触发重扫——只有恰好被光 DOM 的某次变动捎带一次，
// 表现为「有的拦了有的没拦」「滚一会儿就不拦了」。所以每收到一个新 root 都得**单独**观察它，
// 而那个观察器住在 scanner 里。收口成单一入口 + 一个回调，就不会再出现「某处 add 了但没人观察」。
export const shadowRoots = new Set<ShadowRoot>();

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
  onRoot(root);
}

/** 丢掉宿主已脱离文档的 root。
 *
 * 原先清理只发生在 queryAllRoots（dom.ts）里，而它的两个入口都有 `if (!CONFIG.enabled) return`——
 * 脚本一暂停，detached 的评论组件连同整棵子树就被这个集合钉在内存里，每个还挂着观察器。
 * 「回收已经没用的引用」和「用户开没开拦截」没有任何关系，不该被那个开关挡住。 */
export function pruneShadowRoots(): void {
  for (const r of shadowRoots) if (!r.host || !r.host.isConnected) shadowRoots.delete(r);
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
