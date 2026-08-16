// 拦截层契约测试：用固化的接口响应样本，锁住「URL → 取出哪个数组 → 删掉哪些项」这条链路。
//
// 纯逻辑单测测不出这里真正的风险：B 站把 data.item 改名成 data.items，matchRule 依然完美工作，
// 脚本却一个视频都不再拦。样本 + 契约断言让这种结构漂移在改代码时立刻暴露。
import { describe, expect, it, beforeEach } from 'vitest';
import { CONFIG, DEFAULT_CONFIG } from '../src/config';
import { rebuildRules } from '../src/match/engine';
import { filterFeedJson, findFeedHook, FEED_HOOKS } from '../src/net';
import { health } from '../src/health';
import rcmd from './fixtures/rcmd.json';
import ranking from './fixtures/ranking.json';
import popular from './fixtures/popular.json';
import related from './fixtures/related.json';
import searchAll from './fixtures/search-all.json';

const clone = <T>(x: T): T => structuredClone(x);

// 每个样本对应的真实请求 URL（含查询串，贴近线上形态）。
const URLS = {
  rcmd: 'https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?ps=12&fresh_idx=1&w_rid=abc',
  ranking: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
  popular: 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1',
  related: 'https://api.bilibili.com/x/web-interface/archive/related?bvid=BV1aa411a1a1',
  searchAll: 'https://api.bilibili.com/x/web-interface/wbi/search/all/v2?keyword=test&page=1',
};

function reset(): void {
  Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
  rebuildRules();
}

beforeEach(reset);

describe('findFeedHook：URL 路由', () => {
  it('五类推荐接口都能命中（含带查询串的真实 URL）', () => {
    for (const [name, url] of Object.entries(URLS)) {
      expect(findFeedHook(url), name).not.toBeNull();
    }
  });

  it('不相干的 B 站接口不被命中（拦截层不该碰它们）', () => {
    const others = [
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1aa411a1a1',
      'https://api.bilibili.com/x/relation/modify',
      'https://api.bilibili.com/x/v2/reply/wbi/main?oid=1',
      'https://api.bilibili.com/x/web-interface/nav',
    ];
    for (const u of others) expect(findFeedHook(u), u).toBeNull();
  });

  it('memo 不会把上一条 URL 的结果串给下一条（单格缓存的经典坑）', () => {
    expect(findFeedHook(URLS.rcmd)).not.toBeNull();
    expect(findFeedHook('https://api.bilibili.com/x/web-interface/nav')).toBeNull();
    expect(findFeedHook(URLS.rcmd)).not.toBeNull();
  });
});

describe('取数契约：每类响应都能取出视频数组', () => {
  const cases: Array<[string, string, any, number]> = [
    ['首页推荐', URLS.rcmd, rcmd, 3],
    ['排行榜', URLS.ranking, ranking, 2],
    ['热门', URLS.popular, popular, 2],
    ['播放页相关推荐（data 本身即数组）', URLS.related, related, 2],
    ['搜索综合（分组里取 result_type=video）', URLS.searchAll, searchAll, 2],
  ];
  it.each(cases)('%s', (_name, url, fixture, expected) => {
    const hook = findFeedHook(url)!;
    const arr = hook.get(clone(fixture).data);
    expect(arr).not.toBeNull();
    expect(arr!.length).toBe(expected);
  });
});

describe('filterFeedJson：按规则就地删项', () => {
  it('关键词命中的项被 splice 掉，其余保持原顺序', () => {
    CONFIG.block.keywords.push('原神');
    rebuildRules();
    const json = clone(rcmd);
    expect(filterFeedJson(URLS.rcmd, json)).toBe(1);
    expect(json.data.item.map((x: any) => x.bvid)).toEqual(['BV1bb411b1b1', 'BV1cc411c1c1']);
  });

  it('UID 黑名单在接口层生效（owner.mid）', () => {
    CONFIG.block.uids.push('100003');
    rebuildRules();
    const json = clone(rcmd);
    expect(filterFeedJson(URLS.rcmd, json)).toBe(1);
    expect(json.data.item.some((x: any) => x.owner.mid === 100003)).toBe(false);
  });

  it('白名单优先于黑名单', () => {
    CONFIG.block.keywords.push('原神');
    CONFIG.allow.uids.push('100001');
    rebuildRules();
    const json = clone(rcmd);
    expect(filterFeedJson(URLS.rcmd, json)).toBe(0);
  });

  it('搜索结果标题里的 <em> 高亮标签不影响关键词命中', () => {
    CONFIG.block.keywords.push('原神速通');
    rebuildRules();
    const json = clone(searchAll);
    expect(filterFeedJson(URLS.searchAll, json)).toBe(1);
    const groups: any[] = json.data.result;
    const g = groups.find((x) => x.result_type === 'video');
    expect(g.data.map((x: any) => x.bvid)).toEqual(['BV1kk411k1k1']);
    // 其它分组（用户）不受影响
    expect(groups.find((x) => x.result_type === 'bili_user').data.length).toBe(1);
  });

  it('播放页相关推荐：data 直接是数组时也能就地删', () => {
    CONFIG.block.uids.push('400001');
    rebuildRules();
    const json = clone(related);
    expect(filterFeedJson(URLS.related, json)).toBe(1);
    expect(json.data.length).toBe(1);
  });

  it('分区规则命中排行榜的 tname', () => {
    CONFIG.block.partitions.push('单机游戏');
    rebuildRules();
    const json = clone(ranking);
    expect(filterFeedJson(URLS.ranking, json)).toBe(1);
    expect(json.data.list[0].bvid).toBe('BV1ee411e1e1');
  });
});

describe('filterFeedJson：开关与容错', () => {
  it('总开关关闭时一项不删', () => {
    CONFIG.block.keywords.push('原神');
    CONFIG.enabled = false;
    rebuildRules();
    const json = clone(rcmd);
    expect(filterFeedJson(URLS.rcmd, json)).toBe(0);
    expect(json.data.item.length).toBe(3);
  });

  it('审查模式下数据层不删项（交给 DOM 层打标记核对）', () => {
    CONFIG.block.keywords.push('原神');
    CONFIG.reviewMode = true;
    rebuildRules();
    const json = clone(rcmd);
    expect(filterFeedJson(URLS.rcmd, json)).toBe(0);
    expect(json.data.item.length).toBe(3);
  });

  it('非零 code / 缺 data / 未注册 URL 一律零改动', () => {
    CONFIG.block.keywords.push('原神');
    rebuildRules();
    expect(filterFeedJson(URLS.rcmd, { code: -403, data: clone(rcmd).data })).toBe(0);
    expect(filterFeedJson(URLS.rcmd, { code: 0 })).toBe(0);
    expect(filterFeedJson('https://api.bilibili.com/x/web-interface/nav', clone(rcmd))).toBe(0);
  });

  it('单条畸形 item 不影响同一响应里其它项的判定', () => {
    CONFIG.block.keywords.push('原神');
    rebuildRules();
    const json = clone(rcmd);
    (json.data.item as any[]).splice(1, 0, null); // 混入一条 null
    expect(filterFeedJson(URLS.rcmd, json)).toBe(1);
    expect(json.data.item.length).toBe(3); // 原 3 条 + null - 命中 1 条
  });

  it('规则数组被写成字符串时不会退化成逐字符规则（否则几乎屏蔽整个首页）', () => {
    (CONFIG.block as any).keywords = '原神';
    rebuildRules();
    const json = clone(rcmd);
    expect(filterFeedJson(URLS.rcmd, json)).toBe(0);
    expect(json.data.item.length).toBe(3);
  });
});

describe('health：静默失效自检计数', () => {
  it('解析成功时 feedParsed / feedItems 累加，且不受总开关影响', () => {
    const before = { parsed: health.feedParsed, items: health.feedItems };
    CONFIG.enabled = false;
    filterFeedJson(URLS.rcmd, clone(rcmd));
    expect(health.feedParsed).toBe(before.parsed + 1);
    expect(health.feedItems).toBe(before.items + 3);
  });

  it('取不出数组时不计入 feedParsed（正是「结构变了」的信号）', () => {
    const before = health.feedParsed;
    filterFeedJson(URLS.rcmd, { code: 0, data: { items: [] } }); // 假想的字段改名
    expect(health.feedParsed).toBe(before);
  });
});

describe('FEED_HOOKS 注册表本身', () => {
  it('每条 hook 都有正则与取数函数（新增时别漏）', () => {
    expect(FEED_HOOKS.length).toBeGreaterThan(0);
    for (const h of FEED_HOOKS) {
      expect(h.re).toBeInstanceOf(RegExp);
      expect(typeof h.get).toBe('function');
      expect(h.re.global).toBe(false); // 带 g 的正则 test() 会因 lastIndex 粘连间歇漏判
    }
  });
});
