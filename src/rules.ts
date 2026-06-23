// 规则列表增删的统一入口：去重 + 存盘 + 通知规则变更。供右键菜单、设置面板、审查放行共用。
// 通过 events seam 通知（而非直接 import dom），以打断 dom ↔ rules 循环依赖。
import { saveConfig } from './config';
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

// 从规则数组移除一条（存在才动作）。
export function removeFromList(arr: string[], value: unknown): void {
  const i = arr.map(String).indexOf(String(value));
  if (i >= 0) {
    arr.splice(i, 1);
    saveConfig();
    emitRulesChanged();
  }
}
