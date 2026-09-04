// 页面模型：识别当前页类型、定位“内层视频卡”与要隐藏的网格格子。
// 选择器字符串本身统一登记在 ./selectors，本文件只负责「怎么用」。
import { CELL_CONTAINERS, UNSAFE_HIDE_CONTAINERS, VIDEO_CARD_SELECTORS } from './selectors';
import { PROCESSED } from './constants';

const IS_SEARCH = location.host === 'search.bilibili.com';
const IS_DYNAMIC = location.host === 't.bilibili.com';

export function pageType(): string {
  const h = location.href;
  if (IS_DYNAMIC) return '动态';
  if (h.includes('/v/popular/rank') || h.includes('/ranking')) return '排行榜';
  if (h.includes('/v/popular')) return '热门';
  if (IS_SEARCH) return '搜索页';
  if (/^https:\/\/www\.bilibili\.com\/?($|\?|#)/.test(h)) return '首页';
  if (h.includes('/video/')) return '播放页';
  return '其他';
}

// 「内层视频卡」选择器（兼容首页 / 热门 / 排行榜 / 搜索 / 播放页）。
export const VIDEO_CARD_SELECTOR = VIDEO_CARD_SELECTORS.join(',');

// 「还没处理过的卡」。扫描热路径专用：把「跳过已处理」交给选择器引擎，
// 而不是把整页卡片取回来再逐个 getAttribute——稳态下绝大多数卡都是已处理的，
// 那一遍遍历纯属白做（每 250ms 一次 × 页面上所有卡）。
// 逐条加后缀而不是给整串包一层：`a,b:not(x)` 只会作用在最后一段上。
export const UNPROCESSED_CARD_SELECTOR = VIDEO_CARD_SELECTORS.map((s) => s + `:not([${PROCESSED}])`).join(',');

// 定位要隐藏的网格格子：显式有序链，避免破坏布局。
export function cellOf(el: Element): Element {
  // 逐个 closest 按 CELL_CONTAINERS 的优先级（由外到内）取——不能 join 成一条，
  // 那样返回的是「最近的祖先」，会停在内层 .bili-feed-card，留下占位的空网格单元。
  for (const sel of CELL_CONTAINERS) {
    const fc = el.closest(sel);
    if (fc) return fc;
  }
  if (IS_SEARCH && el.parentElement && el.parentElement !== document.body) return el.parentElement;
  return el;
}
// 护栏：隐藏时别误删大容器/含多卡的元素（会连带删掉加载哨兵）。
export function isUnsafeHideTarget(el: Element | null): boolean {
  if (!el || el === document.body || el === document.documentElement) return true;
  if (el.matches && el.matches(UNSAFE_HIDE_CONTAINERS)) return true;
  try {
    if (el.querySelectorAll(VIDEO_CARD_SELECTOR).length > 1) return true;
  } catch (e) {
    /* 选择器异常忽略 */
  }
  return false;
}
