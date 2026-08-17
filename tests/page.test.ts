import { describe, it, expect, afterEach } from 'vitest';
import { cellOf, isUnsafeHideTarget } from '../src/page';
import { El, installDocument } from './helpers/dom';

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

describe('isUnsafeHideTarget：隐藏前的护栏', () => {
  // 这道护栏的作用是「宁可漏隐藏，也不能隐错」——把 .container / #i_cecream 之类的页面级
  // 大容器隐掉，会连带删掉无限滚动的加载哨兵，用户看到的是**整页空白且再也加载不出新内容**。
  let restore = () => {};
  afterEach(() => restore());

  const withPage = () => {
    const html = new El('html');
    const body = html.appendChild(new El('body'));
    restore = installDocument(body, html);
    return { html, body };
  };

  it('body / documentElement / null 一律判危险', () => {
    const { html, body } = withPage();
    expect(isUnsafeHideTarget(null as any)).toBe(true);
    expect(isUnsafeHideTarget(body as any)).toBe(true);
    expect(isUnsafeHideTarget(html as any)).toBe(true);
  });

  it('页面级大容器判危险（隐掉会连带删掉加载哨兵）', () => {
    const { body } = withPage();
    for (const cls of ['container', 'feed2', 'bili-feed4', 'bili-header']) {
      expect(isUnsafeHideTarget(body.appendChild(new El('div', cls)) as any), cls).toBe(true);
    }
    expect(isUnsafeHideTarget(body.appendChild(new El('div', '', { id: 'i_cecream' })) as any)).toBe(true);
  });

  it('含多张视频卡的元素判危险（隐一张卡不该带走一整排）', () => {
    const { body } = withPage();
    const wrap = body.appendChild(new El('div', 'some-row'));
    wrap.appendChild(new El('div', 'bili-video-card'));
    wrap.appendChild(new El('div', 'bili-video-card'));
    expect(isUnsafeHideTarget(wrap as any)).toBe(true);
  });

  it('只含一张卡的网格格子是安全目标（正是要隐的那个）', () => {
    const { body } = withPage();
    const cell = body.appendChild(new El('div', 'feed-card'));
    cell.appendChild(new El('div', 'bili-feed-card')).appendChild(new El('div', 'bili-video-card'));
    expect(isUnsafeHideTarget(cell as any)).toBe(false);
  });
});
