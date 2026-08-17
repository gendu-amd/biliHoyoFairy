// 规则体检：回答「我这堆规则里，哪条太宽（误伤源头）、哪条根本没在干活（写错了/过时了）」。
//
// 为什么要持久化计数而不是就着会话日志算：会话日志只有 300 条、刷新即清，
// 而「这条规则从没命中」是个**长期**结论——今天首页没推这类视频，不代表规则写错了。
// 于是命中时往 CONFIG.ruleStats 累加，本模块只做「当前规则集 × 历史计数」的连接与解释。
//
// 判死规则的三条自我约束（宁可少报，也不能冤枉一条正在生效的规则）：
//   1. 统计时长不够（< OBSERVE_DAYS）一律不报——刚装上的人所有规则都还没命中，报了全是噪音。
//   2. 联网维度（标签/双标签/UP简介）在「精确过滤」关闭时压根不会被求值，零命中是配置使然，
//      单独归到「未启用」而不是「死规则」。
//   3. 只报用户自己名单里的规则；订阅里的规则删不掉，报了也只是干着急。
import { CONFIG, scheduleSave } from './config';
import { enumerateRules } from './match/engine';
import type { RuleRef } from './match/engine';

// 统计满多少天才敢下「死规则」判断。
export const OBSERVE_DAYS = 7;
const DAY = 86400000;

export interface RuleHealth {
  /** 统计已持续的天数（向下取整）；0 = 还没有任何命中记录 */
  days: number;
  /** 是否已达到可以判定死规则的观察时长 */
  ready: boolean;
  /** 命中最多的规则（降序）。命中数畸高常意味着规则过宽 */
  hot: { ref: RuleRef | null; key: string; n: number }[];
  /** 观察期内一次都没命中、且当前有可能命中的自有规则 */
  dead: RuleRef[];
  /** 因「精确过滤」关闭而根本不会被求值的自有规则（不算死规则） */
  inactive: RuleRef[];
}

export function ruleHealth(): RuleHealth {
  const refs = enumerateRules();
  const stats = CONFIG.ruleStats || {};
  const byKey = new Map(refs.map((r) => [r.key, r]));
  const since = CONFIG.ruleStatsSince || 0;
  const days = since ? Math.floor((Date.now() - since) / DAY) : 0;
  const ready = !!since && days >= OBSERVE_DAYS;

  const hot = Object.keys(stats)
    .map((key) => ({ key, n: stats[key], ref: byKey.get(key) || null }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  const dead: RuleRef[] = [];
  const inactive: RuleRef[] = [];
  for (const r of refs) {
    if (!r.own || stats[r.key]) continue;
    if (!r.active) inactive.push(r);
    else if (ready) dead.push(r);
  }
  return { days, ready, hot, dead, inactive };
}

// 清掉已删除/已改写规则留下的计数键：它们既不会再增长，也不对应任何可展示的规则，
// 留着只会让存档 blob 随着「加规则→删规则」的次数无界膨胀。
// 注意按**当前**规则集（含订阅）算存活，否则订阅规则的历史每次启动都被清空又重建。
export function pruneRuleStats(): number {
  const stats = CONFIG.ruleStats;
  if (!stats) return 0;
  const live = new Set(enumerateRules().map((r) => r.key));
  let n = 0;
  for (const k of Object.keys(stats)) {
    if (!live.has(k)) {
      delete stats[k];
      n++;
    }
  }
  if (n) scheduleSave();
  return n;
}
