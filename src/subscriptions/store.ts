// 订阅缓存存取 + 汇总（数据层）：把拉取到的订阅规则缓存于 GM（不进 config、不外传），
// 并把所有【启用】订阅的规则汇总成 {dim: string[]} 供 buildMatchers 并入黑名单。
import { SUB_STORE_KEY } from '../constants';
import { CONFIG } from '../config';
import { SUB_DIMS, type SubRules } from './parse';

// 单条订阅缓存项。
export interface SubStoreEntry {
  meta?: Record<string, any>;
  rules?: SubRules;
  lastSync?: number;
  ok?: boolean;
  count?: number;
  error?: string | null;
}
export type SubStore = Record<string, SubStoreEntry>;

// 解析结果缓存。
//
// 这份缓存只在同步订阅 / 删订阅时才变，但 collectSubRules 每次被调用都要读它一遍，
// 而 collectSubRules 挂在 buildMatchers 与 enumerateRules 上——也就是**每次规则变更、
// 每次开面板的规则体检**都会把整份订阅缓存重新 JSON.parse 一遍。
// 订阅的 uids/upNames/bvids 各自上限 5 万条（parse.ts 的 SUB_CAP），多订几个源就是数 MB。
let cached: SubStore | null = null;

export function invalidateSubStore(): void {
  cached = null;
}

export function loadSubStore(): SubStore {
  if (cached) return cached;
  try {
    cached = JSON.parse(GM_getValue(SUB_STORE_KEY, '') || '{}') || {};
  } catch (e) {
    cached = {};
  }
  return cached as SubStore;
}

export function saveSubStore(store: SubStore): void {
  cached = store; // 调用方拿的就是这个对象，就地改完再存——缓存与存储天然一致
  try {
    GM_setValue(SUB_STORE_KEY, JSON.stringify(store));
  } catch (e) {
    /* 存储不可用时静默 */
  }
}

// 汇总所有【启用】订阅的规则 → {dim: string[]}，供 buildMatchers 并入黑名单。
export function collectSubRules(): SubRules {
  const store = loadSubStore();
  const merged: SubRules = {};
  for (const sub of CONFIG.subscriptions || []) {
    if (!sub || !sub.enabled || !sub.url) continue;
    const e = store[sub.url];
    if (!e || !e.ok || !e.rules) continue;
    for (const dim of SUB_DIMS) {
      const arr = e.rules[dim];
      if (Array.isArray(arr) && arr.length) (merged[dim] = merged[dim] || []).push(...arr);
    }
  }
  return merged;
}

// 别的标签页同步了订阅 → 本页的解析缓存立刻作废，否则会一直用旧规则直到刷新。
// 老版本脚本管理器没有这个 API 时降级为「不失效」：与加缓存之前相比不算退步（那时也读不到对方的写入），
// 只是本页要等自己下一次写订阅或刷新页面。
if (typeof GM_addValueChangeListener === 'function') {
  GM_addValueChangeListener(SUB_STORE_KEY, (_n: string, _o: unknown, _v: unknown, remote: boolean) => {
    if (remote) invalidateSubStore();
  });
}
