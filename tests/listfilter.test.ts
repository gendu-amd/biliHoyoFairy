import { describe, it, expect } from 'vitest';
import { makeMatcher, filterBy } from '../src/ui/listfilter';

describe('名单搜索：匹配语义', () => {
  it('空查询返回 null（调用方据此走「不筛选」的快路径）', () => {
    expect(makeMatcher('')).toBeNull();
    expect(makeMatcher('   ')).toBeNull();
  });

  it('普通词按包含匹配，且忽略大小写', () => {
    const m = makeMatcher('genshin')!;
    expect(m('GenShin Impact')).toBe(true);
    expect(m('原神')).toBe(false);
  });

  it('查询两端空白不参与匹配', () => {
    expect(makeMatcher('  原神  ')!('原神启动')).toBe(true);
  });

  it('/.../ 按正则匹配（与名单里的规则写法一致）', () => {
    const m = makeMatcher('/^UP\\d+$/')!;
    expect(m('up123')).toBe(true); // 正则忽略大小写
    expect(m('xxUP123')).toBe(false);
  });

  it('写到一半的正则降级成字面量搜索，不抛异常', () => {
    // 用户边打边搜，`/(/` 这种中间态是常态。抛异常会把整个面板渲染打断。
    expect(() => makeMatcher('/(/')).not.toThrow();
    const m = makeMatcher('/(/')!;
    expect(m('a/(/b')).toBe(true);
    expect(m('别的')).toBe(false);
  });

  it('单个 / 不当正则处理（否则空正则匹配一切，看起来像没筛选）', () => {
    const m = makeMatcher('/')!;
    expect(m('a/b')).toBe(true);
    expect(m('ab')).toBe(false);
  });
});

describe('名单搜索：条目筛选', () => {
  const items = [
    { key: 'n:某某UP', value: '某某UP', texts: ['某某UP'] },
    { key: 'u:123', value: '123', texts: ['123', '影视飓风'] },
    { key: 'u:456', value: '456', texts: ['456', ''] },
  ];
  const textsOf = (i: (typeof items)[number]) => i.texts;

  it('空查询原样返回（同一个数组引用，不做无谓拷贝）', () => {
    expect(filterBy(items, '', textsOf)).toBe(items);
  });

  it('任一可搜文本命中即保留', () => {
    expect(filterBy(items, '影视', textsOf).map((i) => i.key)).toEqual(['u:123']);
  });

  it('UID 条目按数字也能搜到', () => {
    expect(filterBy(items, '123', textsOf).map((i) => i.key)).toEqual(['u:123']);
  });

  it('空字符串的可搜文本不会被当成匹配', () => {
    // '' 对任何 indexOf 查询都返回 -1，但空查询已在上游短路；这里锁的是不因空串误留条目。
    expect(filterBy(items, '影视', textsOf).some((i) => i.key === 'u:456')).toBe(false);
  });

  it('无匹配时返回空数组（调用方据此显示「没有匹配项」而不是「暂无」）', () => {
    expect(filterBy(items, '不存在的词', textsOf)).toEqual([]);
  });
});
