// 规则列表增删的统一入口：去重 + 存盘 + 通知规则变更。经 events seam 通知以打断 dom ↔ rules 环。
// 只有 addEntries / removeEntries 两个核心，单条版是薄包装——分成两套写过一次，
// 结果是补了删除侧忘了添加侧。逐条调用意味着「全量存盘 + 重建匹配器 + 全页重扫」跑 N 遍。
import { isRuleDisabled, saveConfig, setRuleDisabled } from './config';
import { emitRulesChanged } from './events';

/** 批量追加（去重、去空白），末尾统一一次存盘 + 重扫。返回真正新增的条数。 */
export function addEntries(entries: ReadonlyArray<{ arr: string[]; value: unknown }>): number {
  const byArr = new Map<string[], string[]>();
  for (const e of entries) {
    const v = (e.value ? String(e.value) : '').trim(); // falsy(含 '' / 0 / undefined) 视为空
    if (!v) continue;
    const list = byArr.get(e.arr);
    if (list) list.push(v);
    else byArr.set(e.arr, [v]);
  }
  let n = 0;
  for (const [arr, values] of byArr) n += pushUnique(arr, values);
  if (n) {
    saveConfig();
    emitRulesChanged();
  }
  return n;
}

/** 批量删除，末尾统一一次存盘 + 重扫。返回真正删掉的条数。 */
export function removeEntries(entries: ReadonlyArray<{ arr: string[]; value: unknown }>): number {
  const byArr = new Map<string[], Set<string>>();
  for (const e of entries) {
    let set = byArr.get(e.arr);
    if (!set) byArr.set(e.arr, (set = new Set<string>()));
    set.add(String(e.value));
  }
  let n = 0;
  for (const [arr, kill] of byArr) {
    // 就地压缩而非 filter 重建：数组身份要保住（面板控件闭包持有的正是它，见 deepMerge 的不变量）。
    let w = 0;
    for (let r = 0; r < arr.length; r++) {
      if (kill.has(String(arr[r]))) n++;
      else arr[w++] = arr[r];
    }
    arr.length = w;
  }
  if (n) {
    saveConfig();
    emitRulesChanged();
  }
  return n;
}

export const addToList = (arr: string[], value: unknown): boolean => addEntries([{ arr, value }]) > 0;
export const removeFromList = (arr: string[], value: unknown): boolean => removeEntries([{ arr, value }]) > 0;

// 纯去重追加，不存盘、不重扫：供已自行安排存盘时机的批量场景（拉黑、预置库、名单导入）复用。
export function pushUnique(arr: string[], values: readonly string[]): number {
  const seen = new Set(arr.map(String)); // 一次性建索引，避免每元素重算 map(String).includes 退化为 O(n²)
  let n = 0;
  for (const v of values) {
    const s = String(v);
    if (!seen.has(s)) {
      seen.add(s);
      arr.push(s);
      n++;
    }
  }
  return n;
}

// 清空若干名单。曾经各 model 自己 `arr.length = 0` 就完事，既不存盘也不发变更事件——
// 刷新后规则全回来，且匹配器没重建（界面空了行为照旧）。
export function clearLists(...arrs: string[][]): number {
  let n = 0;
  for (const a of arrs) {
    n += a.length;
    a.length = 0;
  }
  if (n) {
    saveConfig();
    emitRulesChanged();
  }
  return n;
}

// 撤销删除：插回原位而非追加到末尾（撤销的语义是「刚才那下不算」）。at 越界则退化为追加。
export function restoreToList(arr: string[], value: unknown, at: number): void {
  const v = (value ? String(value) : '').trim();
  if (!v || arr.map(String).includes(v)) return;
  arr.splice(at >= 0 && at <= arr.length ? at : arr.length, 0, v);
  saveConfig();
  emitRulesChanged();
}

// 停用 / 启用一条规则。走与增删同一条存盘+重扫链路——对页面来说「不再生效」和「被删了」是一回事。
export function toggleRuleDisabled(path: string, line: string): boolean {
  const off = !isRuleDisabled(path, line);
  setRuleDisabled(path, line, off);
  saveConfig();
  emitRulesChanged();
  return off;
}
