// 规则增删的统一入口。这里锁的是「撤销删除」的语义：
// 误删规则比误拉黑常见得多，而拉黑早就有撤销红线了，规则却一直是不可逆的。
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_CONFIG, isRuleDisabled, loadConfig, saveConfig } from '../src/config';
import { setRulesChangedHandler } from '../src/events';
import { addToList, clearLists, removeEntries, removeFromList, restoreToList, toggleRuleDisabled } from '../src/rules';

beforeEach(() => {
  (globalThis as any).__gmClear();
  Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
});

describe('restoreToList：撤销删除', () => {
  it('插回原来的位置，而不是追加到末尾', () => {
    const arr = ['a', 'b', 'c'];
    const at = arr.indexOf('b');
    removeFromList(arr, 'b');
    expect(arr).toEqual(['a', 'c']);
    restoreToList(arr, 'b', at);
    // 名单顺序是用户自己攒出来的，撤销的语义是「刚才那下不算」，不该顺手把顺序打乱
    expect(arr).toEqual(['a', 'b', 'c']);
  });

  it('位置越界时退化为追加，不抛错', () => {
    const arr = ['a'];
    restoreToList(arr, 'z', 99);
    expect(arr).toEqual(['a', 'z']);
    restoreToList(arr, 'y', -5);
    expect(arr).toEqual(['a', 'z', 'y']);
  });

  it('已经存在时不重复插入（连点两次撤销）', () => {
    const arr = ['a', 'b'];
    restoreToList(arr, 'b', 0);
    expect(arr).toEqual(['a', 'b']);
  });

  it('空值不插入', () => {
    const arr = ['a'];
    restoreToList(arr, '   ', 0);
    restoreToList(arr, '', 0);
    expect(arr).toEqual(['a']);
  });
});

describe('toggleRuleDisabled', () => {
  it('来回切换，并返回切换后的状态', () => {
    addToList(CONFIG.block.keywords, '原神');
    expect(toggleRuleDisabled('block.keywords', '原神')).toBe(true);
    expect(isRuleDisabled('block.keywords', '原神')).toBe(true);
    expect(toggleRuleDisabled('block.keywords', '原神')).toBe(false);
    expect(isRuleDisabled('block.keywords', '原神')).toBe(false);
  });

  it('不同名单路径互不干扰（block 与 allow 的字段名是重的）', () => {
    toggleRuleDisabled('block.keywords', '原神');
    expect(isRuleDisabled('block.keywords', '原神')).toBe(true);
    expect(isRuleDisabled('allow.keywords', '原神')).toBe(false);
  });

  it('停用不影响名单内容本身（规则还在，只是不生效）', () => {
    addToList(CONFIG.block.keywords, '原神');
    toggleRuleDisabled('block.keywords', '原神');
    expect(CONFIG.block.keywords).toEqual(['原神']);
  });
});

// 批量删除与清空：写入侧早就立了「批量只存盘一次」的规矩（doBlacklistMany / pushUnique），
// 删除侧一直缺对称件，于是面板的「删除所选/删除匹配」在循环里逐条调 removeFromList——
// 每条都是「全量三方合并存盘 + 重建全部匹配器 + 全页重扫」，100 条就是那一整套跑 100 遍。
describe('removeEntries：批量删除', () => {
  it('跨多个数组一次删完（UP 字段把名称与 UID 放在两个数组里）', () => {
    const names = ['甲', '乙'];
    const uids = ['1', '2', '3'];
    const n = removeEntries([
      { arr: names, value: '乙' },
      { arr: uids, value: '1' },
      { arr: uids, value: '3' },
    ]);
    expect(n).toBe(3);
    expect(names).toEqual(['甲']);
    expect(uids).toEqual(['2']);
  });

  it('就地压缩，不换数组本身（面板控件闭包持有的正是它）', () => {
    const arr = ['a', 'b', 'c'];
    const same = arr;
    removeEntries([{ arr, value: 'b' }]);
    expect(arr).toBe(same);
    expect(arr).toEqual(['a', 'c']);
  });

  it('不存在的值不计数，也不影响其余', () => {
    const arr = ['a'];
    expect(removeEntries([{ arr, value: '不存在' }])).toBe(0);
    expect(arr).toEqual(['a']);
  });

  it('空输入直接返回 0（不白跑一次存盘）', () => {
    expect(removeEntries([])).toBe(0);
  });
});

// 曾经的真 bug：面板「清空」只做 arr.length = 0，既不存盘也不发规则变更事件。
// 后果两条——刷新后规则全回来（像「清空按钮坏了」）；匹配器没重建，界面空了行为却照旧。
describe('clearLists：清空名单', () => {
  it('清空并落盘，规则变更事件也发出去（否则界面空了但还在拦）', () => {
    let changed = 0;
    setRulesChangedHandler(() => changed++);
    CONFIG.block.keywords.push('原神', '鸣潮');
    saveConfig();

    expect(clearLists(CONFIG.block.keywords)).toBe(2);
    expect(CONFIG.block.keywords).toEqual([]);
    expect(changed).toBeGreaterThan(0);
    // 存盘了 → 重新载入不会把规则带回来
    expect(loadConfig().block.keywords).toEqual([]);
    setRulesChangedHandler(() => {});
  });

  it('一次清多个数组（UP 字段），本来就空则不触发存盘', () => {
    const a: string[] = [];
    const b: string[] = [];
    expect(clearLists(a, b)).toBe(0);
  });
});
