// 面板分区契约（叶子模块：只有类型与一格状态，不 import 任何 section，也不 import index）。
//
// 拆分动机：原 ui/panel.ts 是一个 900 多行的 renderPanel 函数，改「屏蔽记录」要在近千行里找位置，
// 任何一处笔误都会让整个面板渲染不出来。现在每个分区是一个独立文件，只认识 ctx 这一个接口。
//
// 依赖方向：index → sections → ctx。sections 之间互不 import，也不反向 import index，
// 因此不会成环；需要「重渲整个面板」时调 ctx.rerender()。

// 各分组 Tab 的容器元素（键与 PANEL_TABS 的 id 一致）。
export type PanelGroups = Record<string, HTMLElement>;

export interface PanelCtx {
  panel: HTMLElement; // 面板根节点
  groups: PanelGroups; // 各 Tab 的内容容器
  rerender: () => void; // 重建整个面板并保持打开（改动了会影响其它分区展示时调用）
  refreshStats: () => void; // 刷新「屏蔽记录」区（拉黑进度回调里用，避免直接引用 log section）
  setStatsRefresh: (fn: () => void) => void; // 由 log section 注册自身刷新器
}

// 一个面板分区：声明它属于哪个 Tab，以及怎么把自己渲染进去。
export interface PanelSection {
  tab: string; // PANEL_TABS 的 id
  render: (host: HTMLElement, ctx: PanelCtx) => void;
}

// 「屏蔽记录」刷新器：renderPanel 每次重建时清空，由 log section 重新注册。
// stats 监听器经 refreshStatsIfOpen() 读取它，实现命中即时更新计数。
let statsRefresh: (() => void) | null = null;
export function setStatsRefresh(fn: (() => void) | null): void {
  statsRefresh = fn;
}
export function runStatsRefresh(): void {
  if (statsRefresh) statsRefresh();
}
export function hasStatsRefresh(): boolean {
  return !!statsRefresh;
}
