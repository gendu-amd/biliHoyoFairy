// DOM 层的契约测试：用**真实页面裁剪下来的 HTML** 锁住选择器。
//
// B 站改类名是这个脚本最常见的失效路径，而它的症状是最糟的那种——脚本照常运行、角标照常显示，
// 只是什么都不再拦。接口那一侧早就有 tests/fixtures/*.json 守着（net.test.ts），
// DOM 这一侧此前只有运行期的 health 计数器和用户报障。
//
// 样本存在 fixtures/html/，改版时替换样本即可看出哪条选择器失效。
// 解析器是 helpers/dom.ts 里那个够用的实现，不引 jsdom——仓库刻意只保留四个依赖。
import { describe, expect, it } from 'vitest';
import { extractCardInfo } from '../src/cardinfo';
import { cellOf, isUnsafeHideTarget, UNPROCESSED_CARD_SELECTOR, VIDEO_CARD_SELECTOR } from '../src/page';
import { fromHtml, installDocument, parseHtml } from './helpers/dom';
import type { El } from './helpers/dom';
import homeFeedCard from './fixtures/html/home-feed-card.html?raw';
import bewlyCard from './fixtures/html/bewly-card.html?raw';
import searchCard from './fixtures/html/search-card.html?raw';

const card = (html: string): El => fromHtml(html, VIDEO_CARD_SELECTOR);

describe('契约：首页信息流卡片', () => {
  it('卡片选择器认得出它', () => {
    expect(card(homeFeedCard).matches(VIDEO_CARD_SELECTOR)).toBe(true);
  });

  it('五个字段都抠得出来', () => {
    const i = extractCardInfo(card(homeFeedCard) as any);
    expect(i.title).toBe('【原神】新版本前瞻全解析');
    expect(i.up).toBe('样本UP甲');
    expect(i.uid).toBe('100001');
    expect(i.bvid).toBe('BV1aa411a1a1');
    expect(i.duration).toBe(615); // 10:15
    expect(i.views).toBe(523000);
  });

  // 这条正是曾经的空洞 bug：closest('a, b') 返回**最近的**祖先而非「优先级最高的选择器」，
  // 于是停在内层 .bili-feed-card，隐藏它之后 .feed-card 仍占着一个网格单元。
  it('cellOf 上移到网格项 .feed-card，而不是停在内层', () => {
    const root = parseHtml(homeFeedCard);
    const restore = installDocument(root);
    try {
      const c = root.querySelector(VIDEO_CARD_SELECTOR)!;
      const cell = cellOf(c as any) as unknown as El;
      expect(cell.classList).toContain('feed-card');
      expect(cell.classList).not.toContain('bili-feed-card');
      expect(isUnsafeHideTarget(cell as any)).toBe(false);
    } finally {
      restore();
    }
  });

  it('隐藏护栏认得出页面级大容器 .container', () => {
    const root = parseHtml(homeFeedCard);
    const restore = installDocument(root);
    try {
      expect(isUnsafeHideTarget(root.querySelector('.container') as any)).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('契约：BewlyCat 卡片', () => {
  it('卡片选择器认得出它（内层类名恰好也是 .video-card）', () => {
    expect(card(bewlyCard).matches(VIDEO_CARD_SELECTOR)).toBe(true);
  });

  it('标题 / UP 名 / UID / BV 都抠得出来', () => {
    const i = extractCardInfo(card(bewlyCard) as any);
    expect(i.title).toBe('你甚至可以在星穹铁道里学佛法');
    expect(i.up).toBe('高原守Channel');
    expect(i.uid).toBe('503302');
    expect(i.bvid).toBe('BV1ETug6DEj7');
  });

  // 四项共用 .video-card-cover-stats__value，不带父级 cover-stat-* 限定就会按文档序取第一个，
  // 而顺序取决于用户的显示设置——「按播放量屏蔽」会时灵时不灵且不报错。
  it('播放量取的是播放那一项，不串到弹幕/点赞上', () => {
    const i = extractCardInfo(card(bewlyCard) as any);
    expect(i.views).toBe(245000);
    expect(i.likes).toBe(19000);
    expect(i.duration).toBe(531);
  });

  it('cellOf 上移到 .video-card-container，否则隐藏后留空洞', () => {
    const root = parseHtml(bewlyCard);
    const restore = installDocument(root);
    try {
      const cell = cellOf(root.querySelector(VIDEO_CARD_SELECTOR) as any) as unknown as El;
      expect(cell.classList).toContain('video-card-container');
    } finally {
      restore();
    }
  });
});

describe('契约：搜索结果卡片', () => {
  it('标题的 <em> 高亮标签不影响取值（title 属性优先）', () => {
    const i = extractCardInfo(card(searchCard) as any);
    expect(i.title).toBe('原神速通全剧情');
    expect(i.uid).toBe('300001');
  });
});

describe('扫描热路径的选择器', () => {
  it('未处理的卡被 UNPROCESSED_CARD_SELECTOR 选中，打了标记的被排除', () => {
    const root = parseHtml(homeFeedCard);
    const c = root.querySelector(VIDEO_CARD_SELECTOR)!;
    // 替身不支持 :not() 伪类，所以这里直接验「选择器字符串是逐条加后缀而非整串包一层」——
    // `a,b:not(x)` 只会作用在最后一段上，那种写法会让除最后一类之外的卡每轮都被重复处理。
    for (const part of UNPROCESSED_CARD_SELECTOR.split(',')) {
      expect(part).toContain(':not([data-bfb-done])');
    }
    expect(c.matches(VIDEO_CARD_SELECTOR)).toBe(true);
  });
});
