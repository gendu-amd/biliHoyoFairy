import { describe, it, expect, beforeEach } from 'vitest';
import { health, healthReport, healthNotes, healthSummary, healthDegraded, markHealthReady } from '../src/health';

function reset() {
  health.apiSeen = 0;
  health.feedLike = 0;
  health.feedMatched = 0;
  health.feedParsed = 0;
  health.feedItems = 0;
  health.cardsSeen = 0;
  health.signedSkipped = 0;
}

describe('health.noteRequest', () => {
  beforeEach(reset);

  it('只统计 B 站数据接口，忽略静态资源与埋点', () => {
    health.noteRequest('https://s1.hdslb.com/bfs/static/laputa-home/assets/index.js');
    health.noteRequest('https://data.bilibili.com/log/web');
    expect(health.apiSeen).toBe(0);
  });

  it('推荐流接口同时计入 apiSeen 与 feedLike', () => {
    health.noteRequest('https://api.bilibili.com/x/web-interface/index/top/feed/rcmd?ps=12');
    expect(health.apiSeen).toBe(1);
    expect(health.feedLike).toBe(1);
  });

  it('无关的 web-interface 接口只计 apiSeen，不计 feedLike', () => {
    for (const u of [
      'https://api.bilibili.com/x/web-interface/nav',
      'https://api.bilibili.com/x/web-interface/nav/stat',
      'https://api.bilibili.com/x/web-interface/history/cursor',
      'https://api.bilibili.com/x/web-interface/dynamic/entrance',
    ]) {
      health.noteRequest(u);
    }
    expect(health.apiSeen).toBe(4);
    expect(health.feedLike).toBe(0);
  });

  it('B 站给推荐流路径加前缀（wbi/ 等）时仍算 feedLike——这正是要报警的场景', () => {
    health.noteRequest('https://api.bilibili.com/x/web-interface/wbi/v3/index/top/feed/rcmd');
    expect(health.feedLike).toBe(1);
  });
});

describe('healthReport 不误报', () => {
  beforeEach(reset);

  // 回归：首页首屏是 SSR（HTML 直接带 10 张卡），推荐接口要滚动才发。
  // 旧判据 apiSeen>0 && feedMatched===0 会在每个刚打开的首页上无脑报警。
  it('首屏 SSR：只发生了无关接口请求时不报警，只给中性说明', () => {
    for (let i = 0; i < 53; i++) health.noteRequest('https://api.bilibili.com/x/web-interface/nav');
    health.cardsSeen = 28;
    expect(healthReport()).toEqual([]);
    expect(healthNotes()).toHaveLength(1);
    expect(healthNotes()[0]).toContain('尚未发生推荐流接口请求');
  });

  it('发生了形似推荐流的请求却一个都没命中 → 报警（路径变更）', () => {
    health.noteRequest('https://api.bilibili.com/x/web-interface/wbi/v3/index/top/feed/rcmd');
    health.cardsSeen = 28;
    const w = healthReport();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('接口路径可能已变更');
  });

  it('命中了但取不出列表 → 报警（结构变更）', () => {
    health.noteRequest('https://api.bilibili.com/x/web-interface/index/top/feed/rcmd');
    health.feedMatched = 1;
    health.cardsSeen = 28;
    const w = healthReport();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('返回结构可能已变更');
  });

  it('一张卡都没识别到 → 报警（选择器失效）', () => {
    health.feedMatched = 1;
    health.feedParsed = 1;
    expect(healthReport().some((x) => x.includes('卡片选择器'))).toBe(true);
  });

  it('拦截层正常工作时既无警告也无中性说明', () => {
    health.noteRequest('https://api.bilibili.com/x/web-interface/index/top/feed/rcmd');
    health.feedMatched = 1;
    health.feedParsed = 1;
    health.feedItems = 12;
    health.cardsSeen = 28;
    expect(healthReport()).toEqual([]);
    expect(healthNotes()).toEqual([]);
  });

  it('摘要含全部计数', () => {
    health.apiSeen = 53;
    health.cardsSeen = 28;
    expect(healthSummary()).toContain('接口请求 53');
    expect(healthSummary()).toContain('识别卡片 28');
  });
});

// 角标变色是「静默失效」唯一能触达普通用户的渠道（控制台报警只有会排查的人看得到），
// 所以它的判据必须比控制台更保守：宁可漏报，也不能让好端端的页面挂个黄角标。
describe('healthDegraded：角标该不该变黄', () => {
  beforeEach(() => {
    reset();
    health.cardsSeen = 1; // 排除「没识别到卡片」这一条的干扰，单独测下面各条
  });

  it('首屏稳定前一律不报（那时计数天然都是 0，判什么都是误报）', () => {
    reset();
    expect(healthDegraded()).toBe(false);
  });

  it('发过形似推荐流的请求却一个都没接住 → 变色', () => {
    markHealthReady();
    health.feedLike = 3;
    health.feedMatched = 0;
    expect(healthDegraded()).toBe(true);
  });

  it('接住了但取不出列表（结构变了）→ 变色', () => {
    markHealthReady();
    health.feedLike = 3;
    health.feedMatched = 3;
    health.feedParsed = 0;
    expect(healthDegraded()).toBe(true);
  });

  it('一切正常 → 不变色', () => {
    markHealthReady();
    health.feedLike = 3;
    health.feedMatched = 3;
    health.feedParsed = 3;
    expect(healthDegraded()).toBe(false);
  });

  it('首屏 SSR、压根没发过推荐流请求 → 不变色（最常见的误报来源）', () => {
    markHealthReady();
    health.feedLike = 0;
    health.feedMatched = 0;
    expect(healthDegraded()).toBe(false);
  });

  it('WBI 签名放弃改写不算失效（那是某个开关不生效，不是脚本坏了）', () => {
    markHealthReady();
    health.feedLike = 3;
    health.feedMatched = 3;
    health.feedParsed = 3;
    health.signedSkipped = 5;
    expect(healthDegraded()).toBe(false);
  });

  it('一张视频卡都没识别到 → 变色（DOM 兜底层失效）', () => {
    markHealthReady();
    health.feedLike = 3;
    health.feedMatched = 3;
    health.feedParsed = 3;
    health.cardsSeen = 0;
    expect(healthDegraded()).toBe(true);
  });
});
