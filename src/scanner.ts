// 「何时扫描」的调度策略。与「扫描什么」（dom.ts）分开：后者是判定逻辑，本模块只管时机。
//
// 为什么需要一个策略而不是一个固定节流值——两个阶段的诉求根本不同：
//
//   1. 首屏解析中（document-start → DOMContentLoaded）
//      B 站首页首屏是 **SSR**：HTML 里直接带着渲染好的卡，拦截层（改 JSON）完全够不着，
//      只能靠 DOM 层。而卡片正被解析器一张张吐出来，必须赶在**这一帧绘制前**判定隐藏，
//      否则用户会看到该屏蔽的视频先闪一下再消失。这里用 rAF 合批——「每帧一次、绘制前」
//      正是浏览器为这件事提供的原语，不是拍脑袋选的间隔。
//
//   2. 首屏之后
//      只有无限滚动会新增卡，晚几十毫秒隐藏没人看得出，继续用 250ms 节流省开销。
//
// 这里刻意**不**采用「先用 CSS 把整个 feed 蒙住、判完再放出来」的做法：那要赌脚本不出错，
// 一旦本层抛异常用户就对着永久空白的首页。本策略只隐藏**肯定命中**的卡，脚本挂掉就什么都不隐藏，
// 退化成「不过滤」而不是「看不见内容」——失败方向必须是安全的那一侧。

import { scanAll } from './dom';
import { addShadowRoot, pruneShadowRoots, setShadowRootHandler } from './shadow';
import { isCommentTag } from './selectors';
import { safe } from './logging';

export interface ScanScheduler {
  /** 有新节点进来，请求一次（合批后的）扫描。 */
  request(): void;
  /** 首屏解析结束，切换到节流档。 */
  toSteadyState(): void;
}

export interface SchedulerDeps {
  scan: () => void;
  /** 首屏阶段的合批原语（绘制前）。 */
  raf: (cb: () => void) => void;
  /** 稳态阶段的节流原语。 */
  timeout: (cb: () => void, ms: number) => void;
}

export const STEADY_THROTTLE_MS = 250;
// 失效 shadow root 的回收间隔。纯垃圾回收，不影响功能，取长一点即可。
const PRUNE_ROOTS_MS = 30000;

// 纯策略，依赖注入以便单测用假的 raf/timeout 驱动（node 环境没有真的）。
export function createScanScheduler(deps: SchedulerDeps): ScanScheduler {
  let firstPaint = true;
  let queued = false;

  const run = () => {
    queued = false;
    deps.scan();
  };

  const request = () => {
    if (queued) return; // 合批：本轮已经排过队
    queued = true;
    if (firstPaint) deps.raf(run);
    else deps.timeout(run, STEADY_THROTTLE_MS);
  };

  return {
    request,
    toSteadyState() {
      if (!firstPaint) return;
      firstPaint = false;
      // 已排队的那次 rAF 照常会跑（run 不看阶段），不能在这里清 queued——
      // 清掉会让它变成一次**空跑**，而真正的扫描请求已经被合批吞掉，首屏最后一批卡就漏了。
    },
  };
}

// —— 实际接线 ——

let installed = false;

// 在 document-start 装观察器。必须这么早：首屏 SSR 的卡是解析器一张张吐出来的，
// 等到 DOMContentLoaded 再看，它们早就画在屏幕上了（曾经的行为——用户会看到该屏蔽的视频闪一下）。
export function startScanner(): void {
  if (installed) return;
  installed = true;

  const scheduler = createScanScheduler({
    scan: scanAll,
    raf: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 0)),
    timeout: (cb, ms) => setTimeout(cb, ms),
  });

  const observer = new MutationObserver(
    safe('observer', (muts: MutationRecord[]) => {
      let touched = false;
      for (const m of muts) {
        if (!m.addedNodes || !m.addedNodes.length) continue;
        touched = true;
        for (const n of m.addedNodes) {
          const el = n as Element;
          // 插入时就已挂着 shadowRoot 的节点（先 attachShadow 后 append）。
          // 走 attachShadow 钩子的那一路更常见，这里只是补齐另一种顺序。
          if (n.nodeType === 1 && el.shadowRoot && el.id !== 'bfb-overlay-host') addShadowRoot(el.shadowRoot);
        }
      }
      if (!touched) return;
      // 这里曾经还会 harvestShadowRoots(document) 全文档扫一遍找 shadow host。删掉了：
      // attachShadow 已被 hook，新建的 root 一律当场入表，全量采集捞不到任何新东西；
      // 而「我们注入之前就已存在的 root」由 main 在 DOMContentLoaded 采集一次即可。
      scheduler.request();
    })
  );
  // 观察 document 本身，而不是 <html>/<body>：document-start 时 body 一定不存在，
  // documentElement 在极早的注入点也可能还没建好。观察 Document 节点没有这个前提，
  // 连 <html> 的插入都看得见——避免「元素还没生成 → 观察器没装上 → DOM 层整层静默失效」。
  observer.observe(document, { childList: true, subtree: true });

  // 每个 shadow root 都要**单独**观察：影子树内部的 DOM 变动不会冒泡到 document 级观察器。
  // 少了这一步，影子树里新增的卡就永远不触发重扫，只能靠光 DOM 的某次变动偶然捎带——
  // 表现为「有的拦了有的没拦」「滚一会儿就不拦了」。B 站自己的 shadow 组件、以及把整个界面
  // 挂进 shadow root 的界面替换类扩展（BewlyCat 等）都吃这个亏。
  // 注册这一步要在任何采集之前，且 setShadowRootHandler 会对已收集的 root 补跑（main 里的
  // attachShadow 钩子先于本函数安装，可能已经收到过 root）。
  setShadowRootHandler((root) => {
    // 评论组件的影子树**不挂**卡片观察器：评论里没有视频卡，但它的懒加载、展开楼中楼、
    // hover 都会持续产生 mutation，每一次都会触发一轮全页卡片重扫（scanAll 要遍历主文档
    // 加所有 shadow root）。评论有自己的扫描路径（scheduleCommentScan / ruleVersion），
    // 不需要也不该由卡片观察器来驱动。
    if (root.host && isCommentTag(root.host.tagName)) return;
    try {
      observer.observe(root, { childList: true, subtree: true });
    } catch (e) {
      /* 个别 root 观察失败不影响其它 */
    }
  });

  // 周期性回收失效的 shadow root。不放在扫描路径里：那条路被 CONFIG.enabled 挡着，
  // 而「脚本暂停时更不该攥着一堆 detached 子树」恰恰相反。间隔取长一点，纯粹是垃圾回收。
  setInterval(pruneShadowRoots, PRUNE_ROOTS_MS);

  // 装好时可能已经解析出一些卡（脚本注入点之前的那部分 HTML），先扫一遍。
  scanAll();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduler.toSteadyState(), { once: true });
  } else {
    scheduler.toSteadyState();
  }
}
