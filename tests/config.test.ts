import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG,
  DEFAULT_CONFIG,
  deepMerge,
  mergeImport,
  exportConfig,
  sanitizeConfigInput,
  migrateConfig,
  installConfigSync,
} from '../src/config';
import { SCHEMA_VERSION, STORE_KEY, SYNC_COALESCE_MS } from '../src/constants';

describe('exportConfig：剔除不可移植键（安全红线）', () => {
  it('导出不含 subscriptions/uidNames/blockedCount/enabled/debug/reviewMode，但保留规则', () => {
    Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
    (CONFIG.subscriptions as any).push({ url: 'https://evil.example/x.json', name: 'x', enabled: true });
    CONFIG.uidNames['1'] = '某up';
    CONFIG.blockedCount = 42;
    CONFIG.block.keywords.push('原神');
    const out = JSON.parse(exportConfig());
    expect(out.config.subscriptions).toBeUndefined();
    expect(out.config.uidNames).toBeUndefined();
    expect(out.config.blockedCount).toBeUndefined();
    expect(out.config.enabled).toBeUndefined();
    expect(out.config.debug).toBeUndefined();
    expect(out.config.reviewMode).toBeUndefined();
    expect(out.config.block.keywords).toContain('原神'); // 规则照常导出
  });
});

describe('deepMerge', () => {
  it('递归合并同名对象，标量覆盖', () => {
    const base = { a: { x: 1, y: 2 }, b: 1 };
    deepMerge(base, { a: { y: 9, z: 3 }, b: 5 });
    expect(base).toEqual({ a: { x: 1, y: 9, z: 3 }, b: 5 });
  });
  it('数组按整体覆盖（非合并）', () => {
    const base: any = { arr: [1, 2, 3] };
    deepMerge(base, { arr: [9] });
    expect(base.arr).toEqual([9]);
  });
  it('拦截原型链污染键 __proto__', () => {
    const base: any = {};
    deepMerge(base, JSON.parse('{"__proto__":{"polluted":1}}'));
    expect(({} as any).polluted).toBeUndefined();
    expect(base.polluted).toBeUndefined();
  });
});

describe('mergeImport', () => {
  it('数组取并集去重，不丢已有', () => {
    const base: any = { block: { uids: ['1', '2'] } };
    mergeImport(base, { block: { uids: ['2', '3'] } });
    expect(base.block.uids).toEqual(['1', '2', '3']);
  });
  it('标量以导入值为准；对象递归', () => {
    const base: any = { hideAd: false, comment: { minLevel: 0 } };
    mergeImport(base, { hideAd: true, comment: { minLevel: 3 } });
    expect(base.hideAd).toBe(true);
    expect(base.comment.minLevel).toBe(3);
  });
  it('拦截原型链污染键', () => {
    const base: any = {};
    mergeImport(base, JSON.parse('{"__proto__":{"polluted":1}}'));
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe('sanitizeConfigInput：清洗不可信导入（安全红线）', () => {
  it('规则字段是字符串时整条丢弃，绝不留给下游按字符遍历', () => {
    const out = sanitizeConfigInput({ block: { keywords: '原神' } });
    expect(out.block).toBeUndefined();
  });
  it('数组里的非字符串元素被剔除，字符串元素保留', () => {
    const out = sanitizeConfigInput({ block: { keywords: ['原神', 42, null, { a: 1 }, '鸣潮'] } });
    expect(out.block.keywords).toEqual(['原神', '鸣潮']);
  });
  it('丢弃默认配置里不存在的键（陌生文件不能往配置里塞新字段）', () => {
    const out = sanitizeConfigInput({ hideAd: true, evilPayload: 'x', __proto__: { polluted: 1 } });
    expect(out.hideAd).toBe(true);
    expect(out.evilPayload).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
  });
  it('类型不符的标量被丢弃而不是强转', () => {
    const out = sanitizeConfigInput({ hideAd: 'yes', comment: { minLevel: '3' } });
    expect(out.hideAd).toBeUndefined();
    expect(out.comment).toBeUndefined();
  });
  it('subscriptions 这类无形状引用的字段整体丢弃（防塞入自动联网 URL）', () => {
    const out = sanitizeConfigInput({ subscriptions: [{ url: 'https://evil.example/x.json', enabled: true }] });
    expect(out.subscriptions).toEqual([]); // 元素非字符串 → 清空；面板侧还会再按 NON_PORTABLE 删掉整键
  });
});

// 同时开两个 B 站标签页时，晚存盘的那个会把先存盘的那个刚加的规则整体冲掉（各自写的是
// 自己内存里的整份快照）。这组用例锁住「对面写入 → 本页立刻采纳」这条链路。
describe('installConfigSync：多标签页配置同步', () => {
  const fire = (remote: boolean) => (globalThis as any).__gmFireValueChange(STORE_KEY, remote);
  const writeFromOtherTab = (patch: Record<string, any>) => {
    GM_setValue(STORE_KEY, JSON.stringify({ ...structuredClone(DEFAULT_CONFIG), ...patch }));
  };
  let adopts = 0;

  beforeAll(() => installConfigSync(() => adopts++));
  beforeEach(() => {
    vi.useFakeTimers();
    adopts = 0;
    Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
  });
  afterEach(() => vi.useRealTimers());

  it('采纳其它标签页写入的规则，并回调通知（重扫/刷面板由 main 接线）', () => {
    writeFromOtherTab({ block: { ...DEFAULT_CONFIG.block, keywords: ['另一个标签页加的'] } });
    fire(true);
    vi.advanceTimersByTime(SYNC_COALESCE_MS + 10);
    expect(CONFIG.block.keywords).toEqual(['另一个标签页加的']);
    expect(adopts).toBe(1);
  });

  it('自己写的回声（remote=false）不触发重载', () => {
    writeFromOtherTab({ block: { ...DEFAULT_CONFIG.block, keywords: ['不该被采纳'] } });
    fire(false);
    vi.advanceTimersByTime(SYNC_COALESCE_MS + 10);
    expect(CONFIG.block.keywords).toEqual([]);
    expect(adopts).toBe(0);
  });

  it('对面连改几条时合并成一次重载', () => {
    writeFromOtherTab({});
    fire(true);
    fire(true);
    fire(true);
    vi.advanceTimersByTime(SYNC_COALESCE_MS + 10);
    expect(adopts).toBe(1);
  });

  // 面板的输入框在渲染时绑定的是 CONFIG.block 这类**对象引用**。采纳若换掉这些对象，
  // 用户之后改设置就写进了脱钩的旧对象——界面有反应、配置不变、也不报错。
  it('采纳时保持嵌套对象的引用不变（面板绑定不脱钩）', () => {
    const block = CONFIG.block;
    const comment = CONFIG.comment;
    writeFromOtherTab({ hideAd: true, block: { ...DEFAULT_CONFIG.block, uids: ['123'] } });
    fire(true);
    vi.advanceTimersByTime(SYNC_COALESCE_MS + 10);
    expect(CONFIG.block).toBe(block);
    expect(CONFIG.comment).toBe(comment);
    expect(CONFIG.block.uids).toEqual(['123']); // 内容照常更新
    expect(CONFIG.hideAd).toBe(true);
  });
});

describe('migrateConfig：存档结构版本', () => {
  it('缺 schemaVersion 的老存档被补齐到当前版本', () => {
    const c = migrateConfig({ block: { keywords: ['原神'] } });
    expect(c.schemaVersion).toBe(SCHEMA_VERSION);
    expect(c.block.keywords).toEqual(['原神']); // 无登记迁移时不动数据
  });
  it('非对象输入原样返回，不抛错', () => {
    expect(migrateConfig(null)).toBeNull();
    expect(migrateConfig('x')).toBe('x');
  });
});
