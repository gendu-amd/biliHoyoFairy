import { describe, it, expect } from 'vitest';
import { cellOf } from '../src/page';

// 极简 DOM 替身：只实现 cellOf 用到的 parentElement / closest，且严格照规范语义——
// closest 沿祖先链向上，返回**最近的**匹配元素。仓库不引入 jsdom（依赖刻意保持最小），
// 而这个 bug 的本质就是 closest 的「最近」语义，用替身足以锁住。
class El {
  classes: Set<string>;
  tag: string;
  parentElement: El | null = null;
  constructor(tag: string, cls = '') {
    this.tag = tag;
    this.classes = new Set(cls.split(/\s+/).filter(Boolean));
  }
  appendChild(c: El): El {
    c.parentElement = this;
    return c;
  }
  matches(sel: string): boolean {
    return sel.split(',').some((one) => {
      const s = one.trim();
      const m = s.match(/^([a-z]*)((?:\.[\w-]+)*)$/);
      if (!m) return false;
      if (m[1] && m[1] !== this.tag) return false;
      const need = m[2].split('.').filter(Boolean);
      return need.every((c) => this.classes.has(c));
    });
  }
  closest(sel: string): El | null {
    let p: El | null = this;
    while (p) {
      if (p.matches(sel)) return p;
      p = p.parentElement;
    }
    return null;
  }
}

// B 站首页 2026-08 的真实结构（抓自线上 HTML）：
//   div.container(display:grid) > div.feed-card > div.bili-feed-card > div.bili-video-card
// 网格项是 .feed-card——隐藏内层 .bili-feed-card 会让 .feed-card 空占一个网格单元，留下空洞。
function homeFeed() {
  const container = new El('div', 'container is-version8');
  const feedCard = container.appendChild(new El('div', 'feed-card'));
  const biliFeedCard = feedCard.appendChild(new El('div', 'bili-feed-card'));
  const card = biliFeedCard.appendChild(new El('div', 'bili-video-card is-rcmd'));
  return { container, feedCard, biliFeedCard, card };
}

describe('cellOf', () => {
  it('首页信息流：返回网格项 .feed-card，而不是更近的 .bili-feed-card', () => {
    const { feedCard, card } = homeFeed();
    // 回归：曾用 closest('div.feed-card, div.bili-feed-card, …') 一把梭，
    // 命中最近的 .bili-feed-card 就停，隐藏后 .feed-card 仍占网格单元 → 空洞不重排。
    expect(cellOf(card as any)).toBe(feedCard);
  });

  it('没有外层 .feed-card 时退回 .bili-feed-card', () => {
    const wrap = new El('div', 'some-list');
    const biliFeedCard = wrap.appendChild(new El('div', 'bili-feed-card'));
    const card = biliFeedCard.appendChild(new El('div', 'bili-video-card'));
    expect(cellOf(card as any)).toBe(biliFeedCard);
  });

  it('直播推荐单卡：上移到带宽高占位的 .floor-single-card', () => {
    const wrap = new El('div', 'container');
    const floor = wrap.appendChild(new El('div', 'floor-single-card'));
    const card = floor.appendChild(new El('div', 'floor-card single-card'));
    expect(cellOf(card as any)).toBe(floor);
  });

  it('找不到任何格子容器时返回卡片自身', () => {
    const wrap = new El('div', 'whatever');
    const card = wrap.appendChild(new El('div', 'bili-video-card'));
    expect(cellOf(card as any)).toBe(card);
  });
});
