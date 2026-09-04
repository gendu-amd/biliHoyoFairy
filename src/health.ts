// 运行自检（失败可见性）。
//
// 这类脚本最典型的故障不是崩溃，是**静默失效**：B 站换个接口路径或改个类名，脚本照常跑、
// 角标照常显示，只是什么都不再拦，用户几周后才发现。这里在关键位置埋轻量计数器，
// 由 healthReport() 推导出「拦截层/DOM 层是否还活着」，在控制台与面板里显式报警。
//
// 纯计数 + 纯推导，只依赖 page（L0），不产生任何副作用。
import { pageType } from './page';

// 只统计 B 站数据接口，排除静态资源/埋点，避免 apiSeen 被无关请求灌水。
const API_RE = /api\.bilibili\.com\/x\/|\/x\/web-interface\//;

// 「看起来像推荐流」的接口特征。用途是把「本页压根没发过 feed 请求」和「发了但我们没接住」
// 区分开——只有后者才说明路径变更。比 FEED_HOOKS 宽松（不含具体前缀），B 站给路径加
// wbi/ v2/ 之类的前缀时这里仍能命中，于是能报警；反之首屏 SSR 场景一次都不会命中，不误报。
const FEED_LIKE_RE = /\/(feed\/rcmd|ranking\/v\d|popular|archive\/related|search\/type|search\/all)/;

export const health = {
  apiSeen: 0, // 见到的 B 站数据接口请求数（含未被 hook 的）
  feedLike: 0, // 其中「形似推荐流」的请求数（判断该不该报警的前提）
  feedMatched: 0, // 命中 FEED_HOOKS 的响应数
  feedParsed: 0, // 命中后又成功取出可过滤列表的响应数
  feedItems: 0, // 累计经过拦截层判定的列表项数
  cardsSeen: 0, // DOM 兜底层识别到的视频卡数
  signedSkipped: 0, // 因携带 WBI 签名(w_rid)而放弃改写的请求数（见 net.ts SIGNED_RE）
  noteRequest(url: string): void {
    if (!url || !API_RE.test(url)) return;
    this.apiSeen++;
    if (FEED_LIKE_RE.test(url)) this.feedLike++;
  },
};

// 首屏稳定前各计数天然是 0，任何判断都是误报。由 main 在启动汇总那一刻置位。
let ready = false;
export function markHealthReady(): void {
  ready = true;
}

// 「拦截管线是不是断了」——供角标变色用。控制台报警只有会排查的人看得到，而变色是零打断的提示。
// 只认管线断了这几类，不含 signedSkipped（那是某个开关不生效，不是脚本坏了）。
export function healthDegraded(): boolean {
  if (!ready) return false;
  if (health.feedLike > 0 && health.feedMatched === 0) return true;
  if (health.feedMatched > 0 && health.feedParsed === 0) return true;
  return pageType() !== '其他' && health.cardsSeen === 0;
}

// —— 耗时采样（仅 debug 模式）——
// 上面那组计数回答「还活着吗」，这组回答「花了多少」：性能问题几乎都是写放大与二次复杂度，
// 读代码能推断量级，但改完快了多少只能测。关时零开销——它埋在热路径上。
export interface TimingStat {
  n: number;
  ms: number;
  max: number;
}
const timings = new Map<string, TimingStat>();
let timingOn = false;
export function setTimingEnabled(on: boolean): void {
  timingOn = on;
  if (!on) timings.clear();
}

/** 给一段同步操作计时。debug 关时零开销（直接执行，不取时钟、不写表）。 */
export function timed<T>(label: string, fn: () => T): T {
  if (!timingOn || typeof performance === 'undefined') return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const dt = performance.now() - t0;
    let e = timings.get(label);
    if (!e) timings.set(label, (e = { n: 0, ms: 0, max: 0 }));
    e.n++;
    e.ms += dt;
    if (dt > e.max) e.max = dt;
  }
}

/** 面板/控制台用的耗时摘要，按总耗时降序。空数组 = 没开 debug 或还没采到。 */
export function timingReport(): string[] {
  return [...timings.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([k, v]) => `${k}: ${v.n} 次 · 共 ${v.ms.toFixed(1)}ms · 均 ${(v.ms / v.n).toFixed(2)}ms · 峰 ${v.max.toFixed(1)}ms`);
}

// 返回人类可读的**警告**列表（空数组=没发现异常）。调用时机应在首屏稳定之后，否则会误报。
export function healthReport(): string[] {
  const w: string[] = [];
  // 只在「确实发生过形似推荐流的请求，却一个都没被 hook 接住」时才断言路径变更。
  // 不能用「apiSeen>0 && feedMatched===0」——B 站首页首屏是 SSR（HTML 里直接带 10 张卡），
  // 推荐接口要滚动/换一换才发；那时导航、未读数等几十个无关接口早把 apiSeen 拉起来了，
  // 按旧判据会在每个刚打开的首页上无脑报警。
  if (health.feedLike > 0 && health.feedMatched === 0) {
    w.push(`本页发出了 ${health.feedLike} 个形似推荐流的接口请求，却没有一个命中拦截规则表：接口路径可能已变更，拦截层当前未生效。请更新脚本或提 Issue。`);
  } else if (health.feedMatched > 0 && health.feedParsed === 0) {
    w.push('已捕获到推荐接口响应，但取不出其中的视频列表：接口返回结构可能已变更，拦截层当前未生效。请更新脚本或提 Issue。');
  }
  // 用户开着一个不生效的开关，比脚本坏了更难自己发现——页面一切正常，只是设的东西没用。
  if (health.signedSkipped > 0) {
    w.push(
      `有 ${health.signedSkipped} 个请求因携带 WBI 签名（w_rid）而放弃改写：签名覆盖全部查询参数，改动会被 B 站判为 -403 校验失败。目前唯一会改写请求的功能是「进阶 → 增大首页推荐每批加载数量」，它在这些已签名的接口上不会生效（不影响屏蔽本身），可以关掉。`
    );
  }
  if (pageType() !== '其他' && health.cardsSeen === 0) {
    w.push('未识别到任何视频卡：卡片选择器可能已失效，DOM 兜底层当前未生效。请更新脚本或提 Issue。');
  }
  return w;
}

// 中性说明（不是警告，不进控制台报警）：解释「为什么某些计数是 0」，免得用户误以为坏了。
export function healthNotes(): string[] {
  const n: string[] = [];
  if (health.feedMatched === 0 && health.feedLike === 0) {
    n.push('本页尚未发生推荐流接口请求，拦截层暂无用武之地——B 站首屏是服务端直出的，滚动或点「换一换」加载更多后再看这里。当前屏蔽由 DOM 兜底层完成。');
  }
  return n;
}

// 面板「运行自检」用的一行摘要。
export function healthSummary(): string {
  return (
    `页面 ${pageType()} · 接口请求 ${health.apiSeen}（形似推荐流 ${health.feedLike}）· 命中推荐接口 ${health.feedMatched} · 解析出列表 ${health.feedParsed}（${health.feedItems} 项）· 识别卡片 ${health.cardsSeen}` +
    // 常态是 0，只有开了改写类功能且撞上已签名接口才非 0——恒显示只会变成没人看的噪音。
    (health.signedSkipped ? ` · 因 WBI 签名放弃改写 ${health.signedSkipped}` : '')
  );
}
