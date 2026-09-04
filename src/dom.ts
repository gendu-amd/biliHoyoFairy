// DOM 兜底层：处理网络拦截层覆盖不到的部分（首屏 SSR 漏网、需联网取数的进阶维度），命中即安全隐藏整张卡。
// 单卡处理有错误边界，异形卡不会中断整轮扫描。
import { CONFIG } from './config';
import { ATTR_API, ATTR_BLOCKED, PROCESSED } from './constants';
import { cellOf, isUnsafeHideTarget, UNPROCESSED_CARD_SELECTOR } from './page';
import { SWIPE_BANNER } from './selectors';
import { extractCardInfo, cacheCardInfo } from './cardinfo';
import type { CardInfo } from './cardinfo';
import { M, matchRule, matchApi, apiNeeds, apiRulesActive, isWhitelisted, rebuildRules } from './match/engine';
import { fetchView, fetchTags, fetchCard } from './api';
import { recordBlock } from './stats';
import { shadowRoots } from './shadow';
import { scanComments } from './comments';
import { addToList } from './rules';
import { log, logErr, safe } from './logging';
import { health, timed } from './health';
import { toast } from './ui/toast';
import { refreshPanelIfOpen } from './ui/hooks';

const countedEls = new WeakSet<Element>(); // DOM 兜底「已计数」去重

// 撤销 DOM 层对某卡的隐藏 / 审查标记（规则变更后重扫时调用）。
function clearVisual(card: HTMLElement) {
  card.style.removeProperty('display'); // 隐藏时带了 important，得整条删掉才还原得回去
  card.classList.remove('bfb-review');
  const t = card.querySelector(':scope > .bfb-tag');
  if (t) t.remove();
  card.removeAttribute(ATTR_BLOCKED);
  const cell = cellOf(card) as HTMLElement;
  if (cell !== card) cell.style.removeProperty('display');
}

// 审查模式：不隐藏，给卡片打醒目标记 + 原因 + 就地「放行」按钮，便于核对防误伤。
function markCard(card: HTMLElement, reason: string, info: CardInfo) {
  card.classList.add('bfb-review');
  if (card.querySelector(':scope > .bfb-tag')) return;
  const tag = document.createElement('div');
  tag.className = 'bfb-tag';
  const rs = document.createElement('span');
  rs.className = 'rs';
  rs.textContent = '已判定拦截 · ' + reason;
  tag.appendChild(rs);
  if (info.up || info.uid || info.bvid) {
    const pass = document.createElement('button');
    pass.textContent = '✅放行';
    pass.title = '误伤了？把该 UP 加白名单，永不再拦';
    pass.onclick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (info.uid) addToList(CONFIG.allow.uids, info.uid);
      else if (info.up) addToList(CONFIG.allow.upNames, info.up);
      else if (info.bvid) addToList(CONFIG.allow.keywords, info.title || info.bvid);
      toast('已放行：' + (info.up || info.title || info.bvid));
      refreshPanelIfOpen();
    };
    tag.appendChild(pass);
  }
  card.appendChild(tag);
}

// DOM 兜底层：审查模式标记、否则直接隐藏漏网卡。主路径由网络拦截层在渲染前就删除。
// 有些版式的列间距是靠 `:nth-child(odd){margin-right:Xpx}` 拼出来的（热门页就是这样）。
// 而 display:none **不会重排 nth-child 的序号**：藏掉一项后，后面那项仍按原来的奇偶带着右边距，
// 宽度差那几像素就挤不进空出来的格子 → 换行 → 留下一个补不上的洞。
//
// 修法是把列间距从「子项的奇偶」搬到「容器」上：容器加 column-gap、子项右边距清零，
// 视觉一致但与位置无关。只在**确实发现这种拼法**时才动手——判据是「有的子项带右边距、有的不带」，
// 那正是奇偶写法的签名；容器本来就有 gap 的（首页那种 grid）直接跳过。
const gutterFixed = new WeakSet<Element>();
function fixParityGutter(box: Element | null): void {
  if (!box || gutterFixed.has(box)) return;
  gutterFixed.add(box); // 无论修不修都只判一次：这是每次隐藏都会走的路
  try {
    const cs = getComputedStyle(box as HTMLElement);
    if (!cs.display.includes('flex') || cs.flexWrap !== 'wrap') return;
    if (cs.columnGap && cs.columnGap !== 'normal' && parseFloat(cs.columnGap) > 0) return;
    let gutter = 0;
    let sawZero = false;
    for (const ch of Array.from(box.children)) {
      const m = parseFloat(getComputedStyle(ch as HTMLElement).marginRight) || 0;
      if (m > 0) gutter = gutter || m;
      else sawZero = true;
      if (gutter && sawZero) break;
    }
    if (!gutter || !sawZero) return; // 不是奇偶拼法，别乱动别人的布局
    (box as HTMLElement).style.columnGap = gutter + 'px';
    box.classList.add('bfb-gutter-fix');
    log(() => `列间距改由容器提供（${gutter}px），避免隐藏后 nth-child 奇偶错位`);
  } catch (e) {
    /* 拿不到计算样式（极早期/异常环境）：放弃修正，不影响隐藏本身 */
  }
}

export function blockVideo(card: HTMLElement, reason: string, info: CardInfo): void {
  if (CONFIG.reviewMode) {
    markCard(card, reason, info);
  } else {
    // 用 important：B 站各版式的组件样式里带 `display:… !important` 的不在少数，
    // 普通内联赋值压不过它——隐藏静默失效，卡片照旧占着位。评论那边早就踩过同一个坑。
    const cell = cellOf(card) as HTMLElement;
    if (!isUnsafeHideTarget(cell)) cell.style.setProperty('display', 'none', 'important');
    card.style.setProperty('display', 'none', 'important');
    fixParityGutter(cell.parentElement);
  }
  card.setAttribute(ATTR_BLOCKED, '1'); // 供「批量拉黑」扫描
  if (countedEls.has(card)) return;
  countedEls.add(card);
  recordBlock(reason, info, 'DOM');
}

// 单卡处理用错误边界包裹：异形卡导致 extractCardInfo/matchRule 抛错时，只跳过这一张、不中断整轮扫描。
const processCard = safe('processCard', function (card: HTMLElement) {
  if (!CONFIG.enabled) return;
  const info = extractCardInfo(card, M.needUid); // 无 UID 规则时跳过昂贵的 innerHTML 兜底
  if (!info.title && !info.up && !info.isLive) return; // 骨架卡，等填充后再处理（直播卡常无标题，放行交给规则判定）
  card.setAttribute(PROCESSED, '1');
  cacheCardInfo(card, info);
  const hit = matchRule(info);
  // 惰性：这行每张卡都会走一次，debug 关时不该付拼串的代价
  if (!hit) log(() => `放行✅ | 标题:${info.title || '(无)'} | UP:${info.up || '(无)'} | 标签:${info.partition || '(无)'}`);
  if (hit) {
    blockVideo(card, hit, info);
    return;
  }
  // 过了本地规则、未命中白名单、且开了精确过滤 → 按需取数再判（限速、缓存）
  if (info.bvid && apiRulesActive()) evaluateApi(card, info);
});

// 异步评估：只取需要的接口，命中则隐藏/标记（与本地规则同一套出口 blockVideo）。
function evaluateApi(card: HTMLElement, info: CardInfo) {
  if (card.getAttribute(ATTR_API)) return;
  card.setAttribute(ATTR_API, '1');
  const need = apiNeeds();
  let view: any = null;
  let tags: string[] | null = null;
  let cardData: any = null;
  let pending = 1; // 守卫位：占位到所有同步派发完成再释放，避免缓存命中的同步回调导致 pending 中途归零、提前 finish
  const finish = () => {
    if (pending > 0) return;
    if (!CONFIG.enabled || isWhitelisted(info)) return;
    const hit = matchApi(info, view, tags, cardData);
    if (hit) blockVideo(card, hit, info);
    else log(`API放行 | ${info.title || ''}`);
  };
  const afterView = () => {
    // UP 卡片需要 mid：优先用 DOM 解析到的，没有就用 view.owner.mid
    if (need.needCard) {
      const mid = info.uid || (view && view.owner && view.owner.mid);
      if (mid) {
        pending++;
        fetchCard(mid, (c) => {
          cardData = c;
          pending--;
          finish();
        });
      }
    }
    finish();
  };
  if (need.needView) {
    pending++;
    fetchView(info.bvid, (v) => {
      view = v;
      pending--;
      afterView();
    });
  }
  if (need.needTag) {
    pending++;
    fetchTags(info.bvid, (t) => {
      tags = t;
      pending--;
      finish();
    });
  }
  pending--; // 释放守卫：同步派发已结束；若此刻请求都已（同步）完成则在此真正评估一次
  finish();
}

// 跨主文档与所有存活 shadow root 的查询。
// 单一入口：卡片扫描与规则变更后的重扫必须用同一套根集合——只查主文档会漏掉 shadow 内的卡，
// 导致它们的 PROCESSED 标记永远清不掉、规则改了也不重判（曾经的 bug）。
function queryAllRoots(selector: string): HTMLElement[] {
  const out: HTMLElement[] = Array.from(document.querySelectorAll<HTMLElement>(selector));
  for (const r of shadowRoots) {
    if (!r.host || !r.host.isConnected) continue; // 回收由 shadow.pruneShadowRoots 统一负责
    try {
      const found = r.querySelectorAll<HTMLElement>(selector);
      if (found.length) out.push(...found);
    } catch (e) {
      logErr('queryAllRoots', e); // 选择器/已失效 root 异常：跳过该 root 但要可见
    }
  }
  return out;
}

export function scanAll(): void {
  if (!CONFIG.enabled) return;
  // 只取**未处理**的卡：稳态下页面上绝大多数卡都已处理，把它们全取回来再逐个 getAttribute
  // 是每 250ms 白做一遍的活。语义不变（已处理的本来就会被跳过），只是让选择器引擎代劳。
  const cards = timed('scan.query', () => queryAllRoots(UNPROCESSED_CARD_SELECTOR));
  // 自检取的是「一轮里认出过多少张卡」的峰值。首轮全部未处理，峰值照常取到；
  // 之后只增不减，所以「选择器还认不认得出卡片」这个判据不受影响。
  if (cards.length > health.cardsSeen) health.cardsSeen = cards.length;
  // 循环本身单独计时：scan.query 只量了 querySelectorAll，而稳态下 :not([data-bfb-done])
  // 之后循环里剩的都是「不打标记、每轮重抽」的卡（骨架卡，以及渲染好了但选择器没认出来的），
  // 持续开销恰恰藏在这里。改 extractCardInfo 之前先看这个数。
  timed('scan.cards', () =>
    cards.forEach((card) => {
      if (card.closest && card.closest(SWIPE_BANNER)) return; // 顶部轮播 banner，跳过
      processCard(card);
    })
  );
}

export function rescanAfterRuleChange(): void {
  timed('rules.rebuild', rebuildRules);
  // 必须穿透 shadow：扫描会处理 shadow 内的卡，这里就得能把它们的标记一并清掉
  queryAllRoots('[' + PROCESSED + ']').forEach((el) => {
    el.removeAttribute(PROCESSED);
    el.removeAttribute(ATTR_API);
    clearVisual(el);
  });
  scanAll();
  scanComments(); // ruleVersion 已自增，评论会按新规则重判
}
