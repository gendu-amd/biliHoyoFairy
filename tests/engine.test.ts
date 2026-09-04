import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_CONFIG } from '../src/config';
import { matchRule, matchApi, apiNeeds, rebuildRules, enumerateRules } from '../src/match/engine';
import type { CardInfo } from '../src/cardinfo';

// 每个用例从默认配置开始，改完配置后 rebuildRules() 让匹配器生效。
function reset() {
  Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
  rebuildRules();
}
beforeEach(reset);

const card = (over: Partial<CardInfo> = {}): CardInfo => ({
  title: '', up: '', uid: '', partition: '', bvid: '', link: '',
  duration: null, views: null, likes: null, isLive: false, isAd: false,
  ...over,
});

describe('matchRule：本地同步维度', () => {
  it('关键词命中标题', () => {
    CONFIG.block.keywords.push('原神');
    rebuildRules();
    expect(matchRule(card({ title: '今天玩原神' }))).toBe('关键词:原神');
    expect(matchRule(card({ title: '鸣潮启动' }))).toBe(null);
  });

  it('UID 黑名单命中', () => {
    CONFIG.block.uids.push('123');
    rebuildRules();
    expect(matchRule(card({ uid: '123' }))).toBe('UID:123');
  });

  it('UP 名黑名单命中（大小写无关）', () => {
    CONFIG.block.upNames.push('营销号');
    rebuildRules();
    expect(matchRule(card({ up: '某营销号' }))).toBe(null); // upNames 为精确(小写)匹配，非包含
    expect(matchRule(card({ up: '营销号' }))).toBe('UP主:营销号');
  });

  it('白名单优先于黑名单（同一 UID 同时在黑白名单 → 放行）', () => {
    CONFIG.block.uids.push('123');
    CONFIG.allow.uids.push('123');
    rebuildRules();
    expect(matchRule(card({ uid: '123' }))).toBe(null);
  });

  it('白名单关键词命中标题 → 放行', () => {
    CONFIG.block.keywords.push('原神');
    CONFIG.allow.keywords.push('教程');
    rebuildRules();
    expect(matchRule(card({ title: '原神 萌新教程' }))).toBe(null);
  });

  it('最低播放量阈值（万）', () => {
    CONFIG.block.minViews = 10; // 10 万
    rebuildRules();
    expect(matchRule(card({ views: 50000 }))).toBe('播放<10万');
    expect(matchRule(card({ views: 200000 }))).toBe(null);
  });

  it('营销号低赞率：高播放 + 极低赞', () => {
    CONFIG.block.spamLikeRatio = 1; // 1%
    CONFIG.block.spamMinViews = 10; // 10 万门槛
    rebuildRules();
    expect(matchRule(card({ views: 1_000_000, likes: 500 }))).toMatch(/营销号/); // 0.05% < 1%
    expect(matchRule(card({ views: 1_000_000, likes: 50_000 }))).toBe(null); // 5% > 1%
    expect(matchRule(card({ views: 50_000, likes: 1 }))).toBe(null); // 未达播放门槛
  });

  it('时长区间过滤', () => {
    CONFIG.block.minDuration = 60;
    CONFIG.block.maxDuration = 600;
    rebuildRules();
    expect(matchRule(card({ duration: 30 }))).toBe('时长<60s');
    expect(matchRule(card({ duration: 1200 }))).toBe('时长>600s');
    expect(matchRule(card({ duration: 300 }))).toBe(null);
  });

  it('广告/直播卡需对应开关开启才拦', () => {
    expect(matchRule(card({ isAd: true }))).toBe(null);
    CONFIG.hideAd = true;
    rebuildRules();
    expect(matchRule(card({ isAd: true }))).toBe('广告卡');
  });

  it('无任何规则命中 → null', () => {
    expect(matchRule(card({ title: '普通视频', up: '普通up', uid: '999' }))).toBe(null);
  });
});

describe('apiNeeds：按启用的联网维度推导要拉的接口', () => {
  it('默认无联网规则 → 全 false', () => {
    expect(apiNeeds()).toEqual({ needTag: false, needView: false, needCard: false });
  });
  it('视频标签规则 → needTag', () => {
    CONFIG.block.tags.push('鬼畜');
    rebuildRules();
    expect(apiNeeds().needTag).toBe(true);
  });
  it('充电专属 → needView', () => {
    CONFIG.hideCharging = true;
    rebuildRules();
    expect(apiNeeds().needView).toBe(true);
  });
  it('UP 简介 → needCard 且连带 needView', () => {
    CONFIG.block.upBio.push('恰饭');
    rebuildRules();
    const n = apiNeeds();
    expect(n.needCard).toBe(true);
    expect(n.needView).toBe(true);
  });
});

// 存档被写坏（旧版本 bug、手改 GM 存储、导入了畸形 JSON）时，名单字段可能不是数组而是字符串。
// 字符串是可迭代的，`for...of` / `map` 会把它按**字符**拆成一堆单字伪规则——一条 "原神" 能让
// 所有含「原」或「神」的视频全被屏蔽，且用户在面板里看不出任何异常。ruleLines 是唯一的收口。
describe('名单字段被写成字符串时不产生单字伪规则', () => {
  const FIELDS = ['keywords', 'partitions', 'upNames', 'uids', 'bvids', 'tags', 'dualTags', 'upBio'] as const;

  it('每个可定位维度都扛得住', () => {
    for (const f of FIELDS) (CONFIG.block as any)[f] = '原神+抽卡';
    expect(() => rebuildRules()).not.toThrow();
    expect(matchRule(card({ title: '神作', up: '原', partition: '抽' }))).toBe(null);
    expect(matchApi(card(), { is_upower_exclusive: false }, ['原神', '抽卡'], { card: { sign: '原' } })).toBe(null);
    const n = apiNeeds();
    expect([n.needTag, n.needView, n.needCard]).toEqual([false, false, false]);
    expect(enumerateRules()).toEqual([]);
  });
});

describe('matchApi：联网维度', () => {
  it('标签命中（任一标签 textHit）', () => {
    CONFIG.block.tags.push('鬼畜');
    rebuildRules();
    expect(matchApi(card(), null, ['鬼畜', '搞笑'], null)).toBe('标签:鬼畜');
    expect(matchApi(card(), null, ['日常'], null)).toBe(null);
  });
  it('双标签：需全部子标签命中', () => {
    CONFIG.block.dualTags.push('原神+抽卡');
    rebuildRules();
    expect(matchApi(card(), null, ['原神', '抽卡', '日常'], null)).toBe('双标签:原神+抽卡');
    expect(matchApi(card(), null, ['原神'], null)).toBe(null);
  });
  it('双标签：少于两个分量的行不成立（编译期就丢掉，别让「原神+」等价于单标签）', () => {
    CONFIG.block.dualTags.push('原神+', '+', '  ');
    rebuildRules();
    expect(matchApi(card(), null, ['原神', '抽卡'], null)).toBe(null);
    expect(apiNeeds().needTag).toBe(false); // 一条有效规则都没有 → 不该为此去拉标签接口
  });

  it('充电专属（view.is_upower_exclusive）', () => {
    CONFIG.hideCharging = true;
    rebuildRules();
    expect(matchApi(card(), { is_upower_exclusive: true }, null, null)).toBe('充电专属');
    expect(matchApi(card(), { is_upower_exclusive: false }, null, null)).toBe(null);
  });
  it('UP 简介（cardData.card.sign）', () => {
    CONFIG.block.upBio.push('恰饭');
    rebuildRules();
    expect(matchApi(card(), null, null, { card: { sign: '专业恰饭十年' } })).toBe('UP简介:恰饭');
    expect(matchApi(card(), null, null, { card: { sign: '佛系UP' } })).toBe(null);
  });
});

// 数值阈值：每项独立，任一命中即拦（不是「同时满足」）；两端都填 = 区间外屏蔽。
describe('数值阈值：各自独立 + 双向', () => {
  const card = (o: Partial<CardInfo>): CardInfo =>
    ({ title: '', up: '', uid: '', partition: '', bvid: '', duration: null, views: null, likes: null, isLive: false, isAd: false, ...o }) as CardInfo;

  it('播放量支持「高于则屏蔽」，不只是低于', () => {
    CONFIG.block.maxViews = 100; // 100 万以上屏蔽
    rebuildRules();
    expect(matchRule(card({ views: 2000000 }))).toBe('播放>100万');
    expect(matchRule(card({ views: 500000 }))).toBeNull();
  });

  it('两端都填 = 区间外屏蔽', () => {
    CONFIG.block.minViews = 1;
    CONFIG.block.maxViews = 100;
    rebuildRules();
    expect(matchRule(card({ views: 5000 }))).toBe('播放<1万'); // 低于下界
    expect(matchRule(card({ views: 2000000 }))).toBe('播放>100万'); // 高于上界
    expect(matchRule(card({ views: 500000 }))).toBeNull(); // 区间内放行
  });

  it('点赞数是独立维度，与营销号那条复合规则互不干扰', () => {
    CONFIG.block.minLikes = 100;
    rebuildRules();
    expect(matchRule(card({ likes: 20, views: 999 }))).toBe('点赞<100');
    // 营销号没开，不该因为「低赞」被算成营销号
    expect(matchRule(card({ likes: 200, views: 999 }))).toBeNull();
  });

  it('拿不到数据的卡片跳过该项，不误伤', () => {
    CONFIG.block.minViews = 10;
    CONFIG.block.minLikes = 100;
    rebuildRules();
    expect(matchRule(card({ views: null, likes: null }))).toBeNull();
  });

  it('各项之间是「或」：只要一项命中就屏蔽', () => {
    CONFIG.block.minViews = 10; // 不命中
    CONFIG.block.maxDuration = 60; // 命中
    rebuildRules();
    expect(matchRule(card({ views: 5000000, duration: 600 }))).toBe('时长>60s');
  });
});
