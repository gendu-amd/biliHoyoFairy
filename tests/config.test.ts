import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG,
  DEFAULT_CONFIG,
  deepMerge,
  mergeImport,
  exportConfig,
  exportSubscription,
  sanitizeConfigInput,
  migrateConfig,
  installConfigSync,
  loadConfig,
  configRescue,
  saveConfig,
  saveStats,
  countRules,
  loadBackups,
  loadBackupRaw,
  restoreBackup,
  setConfigNotifier,
} from '../src/config';
import { parseSubscription } from '../src/subscriptions/parse';
import { SCHEMA_VERSION, STATS_KEY, STORE_BACKUP_KEY, STORE_KEY, SYNC_COALESCE_MS } from '../src/constants';

// 存档损坏这条路径只有把存储预置成坏数据才走得到（桩见 tests/setup.ts）。
const gmStore = (globalThis as any).__gmStore as Record<string, string>;
const gmClear = (globalThis as any).__gmClear as () => void;

// 存档读不出来时，过去直接回落到默认配置，而随后**任何一次** saveConfig（拦截计数 +1 就会触发）
// 就把那份也许只是被截断、还能人工抢救的原始内容永久盖掉——用户看到的是「所有设置一夜回到出厂」，
// 且全程没有任何提示。这组用例锁住「先备份、再回落、并留下可上报的状态」。
describe('loadConfig：存档损坏时先抢救再回落', () => {
  beforeEach(() => {
    gmClear();
    configRescue.corrupted = false;
    configRescue.raw = null;
  });

  it('解析失败：原始内容原样备份，配置回落默认值，并留下可上报的状态', () => {
    gmStore[STORE_KEY] = '{"block":{"keywords":["原神"'; // 写到一半被打断的存档
    const c = loadConfig();
    expect(c.block.keywords).toEqual([]); // 回落默认值，脚本照常起得来
    expect(gmStore[STORE_BACKUP_KEY]).toBe('{"block":{"keywords":["原神"');
    expect(configRescue.corrupted).toBe(true);
    expect(configRescue.raw).toBe('{"block":{"keywords":["原神"');
  });

  it('第二次损坏不覆盖第一份备份（首次为准，那份才最可能有救）', () => {
    gmStore[STORE_KEY] = '{"block":{"keywords":["原神"';
    loadConfig();
    gmStore[STORE_KEY] = '{'; // 第二次损坏时，第一份已被默认配置盖掉，内容更少
    loadConfig();
    expect(gmStore[STORE_BACKUP_KEY]).toBe('{"block":{"keywords":["原神"');
  });

  it('存档正常时不备份、不置位', () => {
    gmStore[STORE_KEY] = JSON.stringify({ block: { keywords: ['原神'] } });
    expect(loadConfig().block.keywords).toEqual(['原神']);
    expect(gmStore[STORE_BACKUP_KEY]).toBeUndefined();
    expect(configRescue.corrupted).toBe(false);
  });

  it('没有存档（首次安装）也不算损坏', () => {
    expect(loadConfig().block.keywords).toEqual([]);
    expect(configRescue.corrupted).toBe(false);
  });
});

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
  // 面板的名单控件闭包持有的是数组本身（chipModel(CONFIG.block.keywords)）。
  // 覆盖时若换成新数组，控件此后的增删就写进脱钩的旧数组：界面显示加上了，存盘里没有。
  it('覆盖数组时就地换内容，不换数组本身', () => {
    const base: any = { arr: [1, 2, 3] };
    const arr = base.arr;
    deepMerge(base, { arr: [9] });
    expect(base.arr).toBe(arr);
  });
  it('原本不是数组（存档被写坏）时仍按整体覆盖', () => {
    const base: any = { arr: '原神' };
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

  // 名单控件（chipModel）持有的是数组本身，比对象层更容易被换掉。
  // 这一条模拟「用户正在面板里打字 → 面板不重渲 → 采纳发生 → 用户回车加了一条规则」。
  it('采纳时保持名单数组的引用不变（不重渲的面板加规则仍写得进去）', () => {
    const kw = CONFIG.block.keywords; // 面板渲染时闭包持有的那个数组
    writeFromOtherTab({ block: { ...DEFAULT_CONFIG.block, keywords: ['别处加的'] } });
    fire(true);
    vi.advanceTimersByTime(SYNC_COALESCE_MS + 10);
    expect(CONFIG.block.keywords).toBe(kw);
    kw.push('本页加的'); // 控件写的是旧引用
    expect(CONFIG.block.keywords).toEqual(['别处加的', '本页加的']);
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

// —— 存盘的三方合并（P0 回归）——
//
// 这里锁的是「规则会莫名其妙消失」这条最贵的 bug。旧实现把内存里整份 CONFIG 覆盖写回，
// 而本标签页手里那份随时可能过期——别的标签页刚加的规则不在里面，写回去就没了。
// 更糟的是触发写入的往往不是用户操作，而是后台的拦截计数自增。
describe('saveConfig：写时三方合并，不整份覆盖', () => {
  // 用 saveConfig 自己把合并基准（baseSnapshot）对齐到「当前内存 == 存储」，
  // 再直接改 gmStore 来扮演「另一个标签页写入了存储」。
  function startFrom(cfg: Partial<typeof DEFAULT_CONFIG> = {}) {
    gmClear();
    Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG), structuredClone(cfg));
    saveConfig();
  }
  // 另一个标签页写入：在存储那份的基础上改，模拟它也是从同一个 base 出发的。
  function otherTabWrites(mutate: (c: any) => void) {
    const c = JSON.parse(gmStore[STORE_KEY]);
    mutate(c);
    gmStore[STORE_KEY] = JSON.stringify(c);
  }
  const stored = () => JSON.parse(gmStore[STORE_KEY]);

  it('两个标签页各加各的规则，两边都留得住', () => {
    startFrom();
    otherTabWrites((c) => c.block.keywords.push('别处加的'));
    CONFIG.block.keywords.push('本页加的');
    saveConfig();
    expect(stored().block.keywords).toEqual(['别处加的', '本页加的']);
    // 合并结果要回灌内存，否则本页看不见对面的规则，下次存盘还会拿旧内存当基准再丢一次
    expect(CONFIG.block.keywords).toEqual(['别处加的', '本页加的']);
  });

  it('本页的删除会同步出去，不被存储里的旧值复活', () => {
    startFrom({ block: { ...DEFAULT_CONFIG.block, keywords: ['a', 'b'] } });
    CONFIG.block.keywords.splice(1, 1); // 本页删掉 b
    saveConfig();
    expect(stored().block.keywords).toEqual(['a']);
  });

  it('对面删掉的规则不会被本页复活', () => {
    startFrom({ block: { ...DEFAULT_CONFIG.block, keywords: ['a', 'b'] } });
    otherTabWrites((c) => (c.block.keywords = ['a'])); // 对面删了 b
    saveConfig(); // 本页没动过这个名单
    expect(stored().block.keywords).toEqual(['a']);
    expect(CONFIG.block.keywords).toEqual(['a']);
  });

  it('标量：本页没改过的采纳存储里的，本页改过的以本页为准', () => {
    startFrom();
    otherTabWrites((c) => {
      c.hideAd = true; // 本页没碰 → 采纳
      c.block.minViews = 5; // 本页要改 → 本页优先
    });
    CONFIG.block.minViews = 9;
    saveConfig();
    expect(stored().hideAd).toBe(true);
    expect(stored().block.minViews).toBe(9);
  });

  it('订阅按 url 认同一条：本页拨动开关不会被当成「删一条又加一条」', () => {
    startFrom({ subscriptions: [{ url: 'https://a.example/x.json', name: 'A', enabled: false }] });
    otherTabWrites((c) => c.subscriptions.push({ url: 'https://b.example/y.json', name: 'B', enabled: true }));
    CONFIG.subscriptions[0].enabled = true; // 本页启用了 A
    saveConfig();
    const subs = stored().subscriptions;
    expect(subs.map((s: any) => s.url)).toEqual(['https://a.example/x.json', 'https://b.example/y.json']);
    expect(subs[0].enabled).toBe(true); // 本页的改动留住了
  });

  // 键「消失」有两种含义，靠 base 才分得清：对方新增的要收下，本页删掉的不能被捡回来。
  // 规则停用表就是这个形状——取消最后一条停用会把整个键删掉，分不清的话开关就再也关不掉了。
  it('本页删掉的键不会被存储里的旧值捡回来', () => {
    startFrom({ disabled: { 'block.keywords': ['原神'] } });
    delete CONFIG.disabled['block.keywords'];
    saveConfig();
    expect(stored().disabled['block.keywords']).toBeUndefined();
    expect(CONFIG.disabled['block.keywords']).toBeUndefined();
  });

  it('对面新增的键照常收下', () => {
    startFrom();
    otherTabWrites((c) => (c.disabled = { 'block.keywords': ['别处停用的'] }));
    saveConfig();
    expect(stored().disabled['block.keywords']).toEqual(['别处停用的']);
  });

  it('对面删掉的键，本页没动过就跟着删', () => {
    startFrom({ disabled: { 'block.keywords': ['原神'] } });
    otherTabWrites((c) => delete c.disabled['block.keywords']);
    saveConfig();
    expect(stored().disabled['block.keywords']).toBeUndefined();
  });

  it('存储里还没有内容时（首次安装）直接写本页的', () => {
    gmClear();
    Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
    CONFIG.block.keywords.push('原神');
    saveConfig();
    expect(stored().block.keywords).toEqual(['原神']);
  });
});

describe('高频字段拆到独立存储键', () => {
  it('拦截计数不写进规则那份存储（后台计数不再碰规则）', () => {
    gmClear();
    Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
    CONFIG.block.keywords.push('原神');
    saveConfig();

    // 另一个标签页此刻加了一条规则
    const c = JSON.parse(gmStore[STORE_KEY]);
    c.block.keywords.push('别处加的');
    gmStore[STORE_KEY] = JSON.stringify(c);

    // 本页只是拦到了一个视频（后台计数自增 → 存盘）
    CONFIG.blockedCount += 1;
    saveStats();

    // 规则那份存储必须纹丝不动
    expect(JSON.parse(gmStore[STORE_KEY]).block.keywords).toEqual(['原神', '别处加的']);
    expect(JSON.parse(gmStore[STATS_KEY]).blockedCount).toBe(1);
  });

  it('规则存储里不再残留高频字段', () => {
    gmClear();
    Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
    CONFIG.blockedCount = 42;
    CONFIG.uidNames['1'] = '某up';
    saveConfig();
    const s = JSON.parse(gmStore[STORE_KEY]);
    expect(s.blockedCount).toBeUndefined();
    expect(s.uidNames).toBeUndefined();
    // 但 saveConfig 会顺带把它们落到 STATS_KEY，调用方不必记住该调哪个
    expect(JSON.parse(gmStore[STATS_KEY]).blockedCount).toBe(42);
  });

  it('老存档把高频字段写在规则键里时照样读得回来', () => {
    gmClear();
    gmStore[STORE_KEY] = JSON.stringify({ blockedCount: 7, block: { keywords: ['原神'] } });
    const c = loadConfig();
    expect(c.blockedCount).toBe(7);
    expect(c.block.keywords).toEqual(['原神']);
  });

  it('两个键都在时以独立键为准（迁移后的常态）', () => {
    gmClear();
    gmStore[STORE_KEY] = JSON.stringify({ blockedCount: 7 });
    gmStore[STATS_KEY] = JSON.stringify({ blockedCount: 99 });
    expect(loadConfig().blockedCount).toBe(99);
  });
});

// —— 自动备份 ——
//
// 三方合并解决的是「不再被覆盖」，那是防止事故。但规则是用户攒了几个月的东西，
// 事故真发生了也得有救——这组用例锁的是「任何一次清空类写入，之前那份都留得下来」。
describe('自动备份：事故之后还有得救', () => {
  beforeEach(() => {
    gmClear();
    Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
  });

  it('countRules 数遍黑/白/评论三处的名单', () => {
    expect(countRules({ block: { keywords: ['a', 'b'], uids: ['1'] }, allow: { uids: ['2'] }, comment: { keywords: ['c'] } })).toBe(5);
    expect(countRules({ block: { minViews: 3 } })).toBe(0); // 非数组字段不算
    expect(countRules(null)).toBe(0);
  });

  it('规则骤降时把写入前的内容备份下来，并告警', () => {
    CONFIG.block.keywords.push('a', 'b', 'c', 'd', 'e', 'f');
    saveConfig();
    const msgs: string[] = [];
    setConfigNotifier((m) => msgs.push(m));

    CONFIG.block.keywords.length = 0; // 模拟「被谁清空了」
    saveConfig();

    const backups = loadBackups();
    const shrink = backups.find((b) => b.reason === 'shrink');
    expect(shrink).toBeTruthy();
    expect(shrink!.rules).toBe(6);
    // 内容另存一个键（索引里只留摘要），恢复时才按需读——否则每次开面板都要 JSON.parse 几 MB
    expect(JSON.parse(loadBackupRaw(shrink!)!).block.keywords).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(msgs.length).toBe(1);
    setConfigNotifier(() => {});
  });

  it('日常增删不触发备份（否则备份位会被噪音挤满，真事故反而被挤出去）', () => {
    CONFIG.block.keywords.push('a', 'b', 'c', 'd', 'e', 'f');
    saveConfig();
    CONFIG.block.keywords.splice(0, 2); // 只删两条
    saveConfig();
    expect(loadBackups().some((b) => b.reason === 'shrink')).toBe(false);
  });

  it('restoreBackup 把内容写回存储并载入内存，且先给当前状态留一份后悔药', () => {
    CONFIG.block.keywords.push('原神', '鸣潮');
    saveConfig();
    // 手工造一份备份：索引项 + 内容键
    const good: any = { ts: 1, version: '0.0.8', reason: 'upgrade', rules: 2 };
    gmStore['bfb_backups_v1:1'] = gmStore[STORE_KEY];

    CONFIG.block.keywords.length = 0;
    saveConfig();
    expect(CONFIG.block.keywords).toEqual([]);

    expect(restoreBackup(good)).toBe(true);
    expect(CONFIG.block.keywords).toEqual(['原神', '鸣潮']);
    // 恢复前的状态（空名单）也被备了一份：点错恢复键同样需要后悔药
    expect(loadBackups().some((b) => b.reason === 'restore')).toBe(true);
  });

  it('备份内容损坏或已被清理时恢复失败但不抛错', () => {
    gmStore['bfb_backups_v1:1'] = '{oops';
    expect(restoreBackup({ ts: 1, version: 'x', reason: 'upgrade', rules: 0 } as any)).toBe(false);
    expect(restoreBackup({ ts: 999, version: 'x', reason: 'upgrade', rules: 0 } as any)).toBe(false); // 内容键不存在
  });

  it('超出保留份数的备份，内容键也被清掉（只删索引会留下没人引用的大字符串）', () => {
    for (let i = 0; i < 7; i++) {
      CONFIG.block.keywords.push('a', 'b', 'c', 'd', 'e', 'f', 'g');
      saveConfig();
      CONFIG.block.keywords.length = 0;
      saveConfig(); // 每轮触发一次 shrink 备份
    }
    const list = loadBackups();
    expect(list.length).toBe(5);
    const alive = new Set(list.map((b) => 'bfb_backups_v1:' + b.ts));
    const orphans = Object.keys(gmStore).filter((k) => k.startsWith('bfb_backups_v1:') && !alive.has(k) && gmStore[k]);
    expect(orphans).toEqual([]);
  });

  it('恢复后合并基准同步重置（否则下一次存盘会把恢复的内容又顶回去）', () => {
    CONFIG.block.keywords.push('原神');
    saveConfig();
    const good: any = { ts: 1, version: '0.0.8', reason: 'upgrade', rules: 1 };
    gmStore['bfb_backups_v1:1'] = gmStore[STORE_KEY];
    CONFIG.block.keywords.length = 0;
    saveConfig();
    restoreBackup(good);
    saveConfig(); // 恢复之后随便再存一次
    expect(JSON.parse(gmStore[STORE_KEY]).block.keywords).toEqual(['原神']);
  });
});

describe('exportSubscription：把自己的黑名单导成订阅名单', () => {
  beforeEach(() => {
    gmClear();
    Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
  });

  it('只带订阅支持的黑名单维度，形状与 examples/blocklist.example.json 一致', () => {
    CONFIG.block.keywords.push('原神');
    CONFIG.block.uids.push('123');
    CONFIG.allow.uids.push('999'); // 白名单不该出现
    CONFIG.block.minViews = 5; // 数值阈值不该出现
    const out = JSON.parse(exportSubscription('我的名单'));
    expect(out.app).toBe('biliHoyoFairy');
    expect(out.format).toBe(1);
    expect(out.meta.title).toBe('我的名单');
    expect(out.rules.keywords).toEqual(['原神']);
    expect(out.rules.uids).toEqual(['123']);
    expect(out.rules.minViews).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('999');
  });

  it('空维度不写进去（订阅方按维度合并，空数组只是噪音）', () => {
    CONFIG.block.keywords.push('原神');
    const out = JSON.parse(exportSubscription(''));
    expect(Object.keys(out.rules)).toEqual(['keywords']);
    expect(out.meta.title).toBe('我的名单'); // 没填标题时的兜底
  });

  // 导出的文件必须能被自己的解析器收回来，否则「导出给别人订阅」这条链是断的。
  it('导出的内容能被 parseSubscription 原样解析回来', () => {
    CONFIG.block.keywords.push('原神', '/震惊.*/');
    CONFIG.block.upBio.push('商务合作');
    const parsed = parseSubscription(exportSubscription('往返测试'));
    expect(parsed.meta.title).toBe('往返测试');
    expect(parsed.rules.keywords).toEqual(['原神', '/震惊.*/']);
    expect(parsed.rules.upBio).toEqual(['商务合作']);
  });
});
