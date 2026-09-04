// 规则列表增删的统一入口：去重 + 存盘 + 通知规则变更。供右键菜单、设置面板、审查放行共用。
// 通过 events seam 通知（而非直接 import dom），以打断 dom ↔ rules 循环依赖。
import { isRuleDisabled, saveConfig, setRuleDisabled } from './config';
import { emitRulesChanged } from './events';

// 向规则数组追加一条（去重）。返回是否真正新增。
export function addToList(arr: string[], value: unknown): boolean {
  const v = (value ? String(value) : '').trim(); // 与 v0.0.5 一致：falsy(含 '' / 0 / undefined) 视为空
  if (!v) return false;
  if (arr.map(String).includes(v)) return false;
  arr.push(v);
  saveConfig();
  emitRulesChanged();
  return true;
}

// 纯去重追加：把已归一的字符串值逐个加进 arr（已存在则跳过），返回新增条数。
// 不存盘、不触发重扫——供批量场景（名单批处理、预置库）在最后统一存盘+重扫，避免逐条重扫。
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

// 从规则数组移除一条（存在才动作）。
export function removeFromList(arr: string[], value: unknown): void {
  const i = arr.map(String).indexOf(String(value));
  if (i >= 0) {
    arr.splice(i, 1);
    saveConfig();
    emitRulesChanged();
  }
}

// 批量删除的统一入口。
//
// 为什么必须有它：removeFromList 一条就是「全量三方合并存盘 + 重建全部匹配器 + 全页重扫」，
// 在循环里调 100 次 = 那一整套跑 100 遍，几千条名单下是秒级的主线程冻结外加 100 次写存储。
// 写入侧早就立了规矩（doBlacklistMany / presets / 名单批处理都用 pushUnique + 末尾一次 save），
// 删除侧一直缺这个对称件，于是面板的「删除所选 / 删除匹配」就成了红线的唯一违反者。
// 顺带把 removeFromList 里 arr.map(String).indexOf 的 O(n²) 收成一次 Set 索引。
export function removeEntries(entries: ReadonlyArray<{ arr: string[]; value: string }>): number {
  if (!entries.length) return 0;
  // 同一批可能跨多个数组（UP 字段把名称与 UID 放在两个数组里），按数组分组后各自就地过滤。
  const byArr = new Map<string[], Set<string>>();
  for (const e of entries) {
    let set = byArr.get(e.arr);
    if (!set) byArr.set(e.arr, (set = new Set<string>()));
    set.add(String(e.value));
  }
  let n = 0;
  for (const [arr, kill] of byArr) {
    // 就地压缩而不是 splice/filter 重建：数组身份必须保住——面板的名单控件闭包持有的正是它本身
    // （见 config.deepMerge 的不变量），换成新数组之后控件的增删就写进了脱钩的旧数组。
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

// 清空若干名单（面板的「清空」）。同样只存盘/重扫一次。
// 曾经这里是各 model 自己 `arr.length = 0` 就完事——既不存盘也不发规则变更事件，于是
// 刷新页面规则全回来（像「清空按钮坏了」），而且匹配器没重建，界面空了行为却照旧。
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

// 撤销删除：插回**原来的位置**而不是追加到末尾——名单顺序是用户自己攒出来的，
// 撤销的语义是「刚才那下不算」，不该顺手把顺序打乱。at 越界或重复则退化为追加/不动作。
export function restoreToList(arr: string[], value: unknown, at: number): void {
  const v = (value ? String(value) : '').trim();
  if (!v || arr.map(String).includes(v)) return;
  arr.splice(at >= 0 && at <= arr.length ? at : arr.length, 0, v);
  saveConfig();
  emitRulesChanged();
}

// 停用 / 启用一条规则（保留在名单里，只是不参与编译）。与增删共用同一条存盘+重扫链路，
// 因为对页面来说「这条规则不再生效」和「这条规则被删了」是同一件事。
export function toggleRuleDisabled(path: string, line: string): boolean {
  const off = !isRuleDisabled(path, line);
  setRuleDisabled(path, line, off);
  saveConfig();
  emitRulesChanged();
  return off;
}
