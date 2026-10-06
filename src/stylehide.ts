// 「整段样式隐藏」的通用开关：开=注入一段 display:none 样式，关=移除。
//
// 适用对象是**扫描器认不出的纯 UI 元素**——它们不是视频卡，逐卡判定那套（extractCardInfo →
// matchRule → blockVideo）用不上，也没法享受「网络拦截层在渲染前删项」：
//   1. 搜索面板的热搜榜（HOTSEARCH_SELECTORS）
//   2. 首页信息流带角标的整宽推广单卡（.floor-single-card:has(.badge)，官方运营位）
// 两者都是主文档元素（不在 shadow tree 里），一段文档级样式即可，不存在 hide.ts 里
// 「样式到不了影子树」的问题，也不需要逐卡存档/还原。
// 曾经热搜榜的逻辑自成一份（hotsearch.ts），新增角标卡时出现两套几乎相同的注入/移除代码——
// 补一处漏一处的经典形状，收敛到这里。
import { CONFIG } from './config';
import { FLOOR_BADGE_CARD_SELECTOR, HOTSEARCH_SELECTORS } from './selectors';

function toggleStyle(id: string, css: string, on: boolean): void {
  let st = document.getElementById(id);
  if (on) {
    if (!st) {
      st = document.createElement('style');
      st.id = id;
      document.head.appendChild(st);
    }
    st.textContent = css;
  } else if (st) {
    st.remove();
  }
}

export function applyHotSearchStyle(): void {
  toggleStyle('bfb-hotsearch-style', HOTSEARCH_SELECTORS.join(',') + '{display:none !important}', CONFIG.hideHotSearch);
}

export function applyFloorBadgeStyle(): void {
  toggleStyle('bfb-floorbadge-style', FLOOR_BADGE_CARD_SELECTOR + '{display:none !important}', CONFIG.hideFloorBadgeCard);
}
