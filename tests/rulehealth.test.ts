// 规则体检：把「规则集本身」变成可审视的对象。
// 这里最要命的不是算错次数，而是**冤枉**——把一条天天在拦的规则报成「从未命中」，
// 用户照着删了，保护就没了。所以核心用例锁的是「枚举出来的键」与「命中时记账的键」字节一致。
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_CONFIG } from '../src/config';
import { matchRule, matchApi, rebuildRules, enumerateRules, ruleKeyOf } from '../src/match/engine';
import { recordBlock } from '../src/stats';
import { ruleHealth, pruneRuleStats, OBSERVE_DAYS } from '../src/rulehealth';
import { saveSubStore } from '../src/subscriptions/store';
import type { CardInfo } from '../src/cardinfo';

const DAY = 86400000;

function reset() {
  Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
  saveSubStore({} as any);
  rebuildRules();
}
beforeEach(reset);

const card = (over: Partial<CardInfo> = {}): CardInfo => ({
  title: '', up: '', uid: '', partition: '', bvid: '', link: '',
  duration: null, views: null, likes: null, isLive: false, isAd: false,
  ...over,
});

// 观察期已满 + 有过命中记录（否则 ruleHealth 一律不下死规则判断）
const observed = () => {
  CONFIG.ruleStatsSince = Date.now() - (OBSERVE_DAYS + 1) * DAY;
};

describe('ruleKeyOf 与真实命中的原因串一致（漂移=冤枉好规则）', () => {
  const cases: { name: string; setup: () => void; hit: () => string | null; field: any; line: string }[] = [
    { name: '关键词', setup: () => (CONFIG.block.keywords = ['原神']), hit: () => matchRule(card({ title: '玩原神' })), field: 'keywords', line: '原神' },
    { name: '关键词(带作用域前缀)', setup: () => (CONFIG.block.keywords = ['up:营销号']), hit: () => matchRule(card({ up: '某某营销号' })), field: 'keywords', line: 'up:营销号' },
    { name: '关键词(两侧空格)', setup: () => (CONFIG.block.keywords = ['  恰饭  ']), hit: () => matchRule(card({ title: '恰饭视频' })), field: 'keywords', line: '  恰饭  ' },
    { name: '分区', setup: () => (CONFIG.block.partitions = ['游戏']), hit: () => matchRule(card({ partition: '游戏' })), field: 'partitions', line: '游戏' },
    { name: 'UP主', setup: () => (CONFIG.block.upNames = ['某某']), hit: () => matchRule(card({ up: '某某' })), field: 'upNames', line: '某某' },
    // 大小写只差的 UP 名：若原因串报「视频里的名字」而非「规则行」，这里就会对不上
    { name: 'UP主(大小写不同)', setup: () => (CONFIG.block.upNames = ['SomeUP']), hit: () => matchRule(card({ up: 'someup' })), field: 'upNames', line: 'SomeUP' },
    { name: 'UID', setup: () => (CONFIG.block.uids = ['123']), hit: () => matchRule(card({ uid: '123' })), field: 'uids', line: '123' },
    { name: 'BV', setup: () => (CONFIG.block.bvids = ['BV1x']), hit: () => matchRule(card({ bvid: 'BV1x' })), field: 'bvids', line: 'BV1x' },
    { name: '标签', setup: () => (CONFIG.block.tags = ['鬼畜']), hit: () => matchApi(card(), null, ['鬼畜'], null), field: 'tags', line: '鬼畜' },
    { name: '标签(正则)', setup: () => (CONFIG.block.tags = ['/游戏.*/']), hit: () => matchApi(card(), null, ['游戏杂谈'], null), field: 'tags', line: '/游戏.*/' },
    { name: '双标签', setup: () => (CONFIG.block.dualTags = ['游戏+搞笑']), hit: () => matchApi(card(), null, ['游戏', '搞笑'], null), field: 'dualTags', line: '游戏+搞笑' },
    { name: 'UP简介', setup: () => (CONFIG.block.upBio = ['恰饭']), hit: () => matchApi(card(), null, null, { card: { sign: '恰饭' } }), field: 'upBio', line: '恰饭' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      c.setup();
      rebuildRules();
      const reason = c.hit();
      expect(reason, '应命中').toBeTruthy();
      expect(ruleKeyOf(c.field, c.line)).toBe(reason);
      // 也必须能被 enumerateRules 枚举到（否则体检永远看不到这条规则）
      expect(enumerateRules().map((r) => r.key)).toContain(reason);
    });
  }
});

describe('enumerateRules', () => {
  it('区分自有规则与订阅规则（订阅的删不掉，不该出现在待删名单里）', () => {
    const url = 'https://example.com/rh.json';
    saveSubStore({ [url]: { ok: true, rules: { keywords: ['订阅词'] } } } as any);
    (CONFIG.subscriptions as any).push({ url, name: 's', enabled: true });
    CONFIG.block.keywords = ['自有词'];
    rebuildRules();
    const byKey = Object.fromEntries(enumerateRules().map((r) => [r.key, r]));
    expect(byKey['关键词:自有词'].own).toBe(true);
    expect(byKey['关键词:订阅词'].own).toBe(false);
  });

  it('联网维度在「精确过滤」关闭时标记为不活跃', () => {
    CONFIG.apiFilters = false;
    CONFIG.block.tags = ['鬼畜'];
    CONFIG.block.keywords = ['原神'];
    rebuildRules();
    const byKey = Object.fromEntries(enumerateRules().map((r) => [r.key, r]));
    expect(byKey['标签:鬼畜'].active).toBe(false);
    expect(byKey['关键词:原神'].active).toBe(true);
    CONFIG.apiFilters = true;
    expect(enumerateRules().find((r) => r.key === '标签:鬼畜')!.active).toBe(true);
  });

  it('空行/纯空白不产生规则项', () => {
    CONFIG.block.keywords = ['', '   ', '原神'];
    rebuildRules();
    expect(enumerateRules().filter((r) => r.field === 'keywords')).toHaveLength(1);
  });
});

describe('ruleHealth', () => {
  it('观察期不足时不下「死规则」判断（新装用户所有规则都还没命中）', () => {
    CONFIG.block.keywords = ['从没命中的词'];
    rebuildRules();
    CONFIG.ruleStatsSince = Date.now() - 1 * DAY;
    const h = ruleHealth();
    expect(h.ready).toBe(false);
    expect(h.dead).toHaveLength(0);
  });

  it('观察期已满且零命中 → 列为死规则', () => {
    CONFIG.block.keywords = ['从没命中的词'];
    rebuildRules();
    observed();
    const h = ruleHealth();
    expect(h.ready).toBe(true);
    expect(h.dead.map((r) => r.line)).toEqual(['从没命中的词']);
  });

  it('命中过的规则不算死规则（记账走真实 recordBlock 链路）', () => {
    CONFIG.block.keywords = ['原神'];
    rebuildRules();
    const reason = matchRule(card({ title: '玩原神' })) as string;
    recordBlock(reason, { title: '玩原神' }, 'NET');
    observed(); // recordBlock 会把 since 设为「现在」，这里覆盖成足够久之前
    const h = ruleHealth();
    expect(h.dead).toHaveLength(0);
    expect(h.hot[0]).toMatchObject({ key: '关键词:原神', n: 1 });
  });

  it('不活跃的规则归到 inactive 而不是 dead（配置没开 ≠ 规则写错）', () => {
    CONFIG.apiFilters = false;
    CONFIG.block.tags = ['鬼畜'];
    rebuildRules();
    observed();
    const h = ruleHealth();
    expect(h.dead).toHaveLength(0);
    expect(h.inactive.map((r) => r.line)).toEqual(['鬼畜']);
  });

  it('订阅规则即便零命中也不列入死规则（用户删不掉）', () => {
    const url = 'https://example.com/rh2.json';
    saveSubStore({ [url]: { ok: true, rules: { keywords: ['订阅死词'] } } } as any);
    (CONFIG.subscriptions as any).push({ url, name: 's', enabled: true });
    rebuildRules();
    observed();
    expect(ruleHealth().dead).toHaveLength(0);
  });

  it('hot 按命中数降序', () => {
    CONFIG.ruleStats = { 'A:1': 3, 'B:2': 9, 'C:3': 5 };
    CONFIG.ruleStatsSince = Date.now() - DAY;
    expect(ruleHealth().hot.map((x) => x.key)).toEqual(['B:2', 'C:3', 'A:1']);
  });
});

describe('pruneRuleStats', () => {
  it('清掉已删规则的遗留计数，保留仍存在的（含订阅规则的历史）', () => {
    const url = 'https://example.com/rh3.json';
    saveSubStore({ [url]: { ok: true, rules: { keywords: ['订阅词'] } } } as any);
    (CONFIG.subscriptions as any).push({ url, name: 's', enabled: true });
    CONFIG.block.keywords = ['还在的词'];
    rebuildRules();
    CONFIG.ruleStats = { '关键词:还在的词': 2, '关键词:订阅词': 7, '关键词:早删了的词': 5 };
    expect(pruneRuleStats()).toBe(1);
    expect(new Set(Object.keys(CONFIG.ruleStats))).toEqual(new Set(['关键词:还在的词', '关键词:订阅词']));
  });
});
