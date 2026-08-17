// 拦截统计与屏蔽记录（纯计数 + 环形日志）。命中后通过注入的监听器通知 UI（更新角标 / 刷新面板），
// 自身不直接依赖 UI，避免环。拦截层（无 card）与 DOM 层共用。
import { CONFIG, scheduleSave } from './config';
import { log } from './logging';
import { BLOCKED_LOG_MAX } from './constants';

export interface BlockedEntry {
  title: string;
  up: string;
  uid: string;
  bvid: string;
  link: string;
  src: string; // NET=网络拦截层（渲染前删项）/ DOM=兜底隐藏 / CMT=评论 / BL=拉黑
  reason: string;
  t: number;
}

// 本次会话屏蔽记录（最新在前，上限 BLOCKED_LOG_MAX）。
export const blockedLog: BlockedEntry[] = [];

// 本次会话计数（live binding；面板与启动汇总读取，清零用 setSessionBlocked）。
export let sessionBlocked = 0;
export function setSessionBlocked(n: number): void {
  sessionBlocked = n;
}

// 原因字符串的形态是 `维度` 或 `维度:具体规则`（如 `关键词:原神`、`UP主:某某`）。
// 冒号前即维度名——注意用半角冒号切，规则本身可能含全角「：」。
export const reasonDim = (reason: string): string => {
  const i = reason.indexOf(':');
  return i > 0 ? reason.slice(0, i) : reason;
};

// 按**维度**聚合计数，供面板「分类」与启动汇总共用。
// 不按完整原因聚合：自 0.0.8 起关键词/标签/简介等会带上具体命中规则，按完整原因分组会让
// 分类栏碎成几十项（`关键词:原神×3`、`关键词:恰饭×2`…）。具体规则在每条记录里能看到。
export function tallyLog(): Record<string, number> {
  const t: Record<string, number> = {};
  for (const b of blockedLog) {
    const d = reasonDim(b.reason);
    t[d] = (t[d] || 0) + 1;
  }
  return t;
}

// 规则级累计命中（持久化）。会话内的 blockedLog 只有 300 条、刷新即清，判不了「这条规则是不是从来没用过」。
// 只记带具体规则的原因（`维度:规则`）——阈值/开关类维度（时长<、广告卡）没有可体检的规则行。
export function bumpRuleStat(reason: string): void {
  if (reason.indexOf(':') <= 0) return;
  if (!CONFIG.ruleStatsSince) CONFIG.ruleStatsSince = Date.now();
  CONFIG.ruleStats[reason] = (CONFIG.ruleStats[reason] || 0) + 1;
}

export function logBlocked(reason: string, info: any, src?: string): void {
  blockedLog.unshift({
    title: (info && info.title) || '',
    up: (info && info.up) || '',
    uid: (info && info.uid) || '',
    bvid: (info && info.bvid) || '',
    link: (info && info.link) || '',
    src: src || 'DOM',
    reason,
    t: Date.now(),
  });
  if (blockedLog.length > BLOCKED_LOG_MAX) blockedLog.pop();
}

// 命中记账后的监听器（由 UI 注册：更新角标 + 面板打开时刷新计数）。
let onRecorded: () => void = () => {};
export function setStatsListener(fn: () => void): void {
  onRecorded = fn;
}

// UI 通知合批：一次响应过滤可能连删几十项，逐项调 onRecorded（重绘角标/面板列表）会做几十次
// 同样的重绘。攒到本轮同步代码结束后的微任务里只通知一次——用户看到的是同一个最终数字。
let notifyQueued = false;
function notifyBatched(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  Promise.resolve().then(() => {
    notifyQueued = false;
    try {
      onRecorded();
    } catch (e) {
      /* UI 监听器异常不能反噬记账链路 */
    }
    scheduleSave(); // 本身已是 SAVE_DEBOUNCE_MS 防抖，跟着合批一起走即可
  });
}

// 记账：计数 + 日志 + 通知 UI。拦截层（无 card）与 DOM 层共用。
export function recordBlock(reason: string, info: any, src?: string): void {
  logBlocked(reason, info, src);
  bumpRuleStat(reason);
  sessionBlocked++;
  CONFIG.blockedCount++;
  notifyBatched();
  log(() => `拦截🚫 ${reason} ${info && info.up ? info.up + ' · ' : ''}${(info && info.title) || '(无标题)'}`);
}
