// 规则增删的统一入口。这里锁的是「撤销删除」的语义：
// 误删规则比误拉黑常见得多，而拉黑早就有撤销红线了，规则却一直是不可逆的。
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_CONFIG, isRuleDisabled } from '../src/config';
import { addToList, removeFromList, restoreToList, toggleRuleDisabled } from '../src/rules';

beforeEach(() => {
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
