import { afterAll, describe, expect, it } from 'vitest';
import { normFeedItem, extractCardInfo, configureCardDetect } from '../src/cardinfo';
import { El, h } from './helpers/dom';

// normFeedItem 是网络拦截层（主过滤路径）把各接口 JSON 列表项归一成 CardInfo 的唯一入口，分支多、最该测。
describe('normFeedItem：拦截层 JSON 归一', () => {
  it('null / 非对象 → null', () => {
    expect(normFeedItem(null)).toBe(null);
    expect(normFeedItem(undefined)).toBe(null);
    expect(normFeedItem('x' as any)).toBe(null);
  });

  it('普通推荐项：owner / stat / title / bvid / duration', () => {
    const i = normFeedItem({ title: '标题', owner: { mid: 123, name: 'UP主' }, stat: { view: 10000, like: 500 }, bvid: 'BV1', duration: 90 })!;
    expect(i.title).toBe('标题');
    expect(i.up).toBe('UP主');
    expect(i.uid).toBe('123');
    expect(i.views).toBe(10000);
    expect(i.likes).toBe(500);
    expect(i.bvid).toBe('BV1');
    expect(i.duration).toBe(90);
    expect(i.isAd).toBe(false);
    expect(i.isLive).toBe(false);
  });

  it('广告项：goto=ad + ad_info 标题被抠出', () => {
    const i = normFeedItem({ goto: 'ad', ad_info: { creative_content: { title: '广告标题' } } })!;
    expect(i.isAd).toBe(true);
    expect(i.title).toBe('广告标题');
  });

  it('is_ad 标志也判定为广告', () => {
    expect(normFeedItem({ title: 't', is_ad: true })!.isAd).toBe(true);
  });

  it('搜索项标题中的 <em> 高亮标签被剥离', () => {
    expect(normFeedItem({ title: '玩<em class="keyword">原神</em>的人' })!.title).toBe('玩原神的人');
  });

  it('duration：number 直取 / "mm:ss" 解析 / 缺失为 null', () => {
    expect(normFeedItem({ title: 't', duration: 90 })!.duration).toBe(90);
    expect(normFeedItem({ title: 't', duration: '03:20' })!.duration).toBe(200);
    expect(normFeedItem({ title: 't' })!.duration).toBe(null);
  });

  it('views 多字段回退：stat.view → stat.play → it.play', () => {
    expect(normFeedItem({ title: 't', stat: { view: 1 } })!.views).toBe(1);
    expect(normFeedItem({ title: 't', stat: { play: 888 } })!.views).toBe(888);
    expect(normFeedItem({ title: 't', play: 777 })!.views).toBe(777);
  });

  it('uid 回退：owner.mid 优先，否则 it.mid', () => {
    expect(normFeedItem({ title: 't', mid: 456 })!.uid).toBe('456');
    expect(normFeedItem({ title: 't', owner: { mid: 1 }, mid: 2 })!.uid).toBe('1');
  });

  it('直播项：goto=live', () => {
    expect(normFeedItem({ title: 't', goto: 'live' })!.isLive).toBe(true);
  });
});

// —— DOM 抽取路径 ——
// extractCardInfo 的全部逻辑就是「按优先级试一串选择器」，不喂真元素树等于没测。
// 用 tests/helpers/dom.ts 的替身（严格照规范：closest 取最近祖先、querySelector 取文档序首个），
// 锁住三件最容易在改版/重构中悄悄坏掉的事：优先级顺序、UID 兜底链、按开关跳过热路径。
describe('extractCardInfo：DOM 抽取', () => {
  // 检测开关是模块级状态，用完还原，免得测试之间互相影响
  afterAll(() => configureCardDetect(() => ({ detectAd: false })));
  const card = (...kids: El[]) => {
    const c = new El('div', 'bili-video-card');
    kids.forEach((k) => c.appendChild(k));
    return c;
  };

  it('标题按选择器优先级取，不是文档序首个', () => {
    // .title 在文档里更靠前，但优先级更低——join 成一条选择器就会取错。
    const c = card(h('span', 'title', {}, '低优先级'), h('h3', 'bili-video-card__info--tit', {}, '真标题'));
    expect(extractCardInfo(c as any).title).toBe('真标题');
  });

  it('title 属性优先于文本（B 站长标题会被 CSS 截断，属性里才是全的）', () => {
    const c = card(h('h3', 'bili-video-card__info--tit', { title: '完整标题' }, '完整标…'));
    expect(extractCardInfo(c as any).title).toBe('完整标题');
  });

  it('空白文本的元素跳过，继续试下一个选择器', () => {
    const c = card(h('h3', 'bili-video-card__info--tit', {}, '   '), h('span', 'video-name', {}, '备选标题'));
    expect(extractCardInfo(c as any).title).toBe('备选标题');
  });

  it('UID：space 链接 → data-* → innerHTML 兜底，逐级降级', () => {
    const byLink = card(h('a', '', { href: 'https://space.bilibili.com/12345' }, 'UP'));
    expect(extractCardInfo(byLink as any).uid).toBe('12345');

    const byAttr = card(h('div', '', { 'data-up-mid': '678' }));
    expect(extractCardInfo(byAttr as any).uid).toBe('678');

    // 纯文本卡：UID 只存在于序列化后的 HTML 里（"mid":123）
    const byHtml = card(h('div', '', {}, '{"mid":999,"name":"x"}'));
    expect(extractCardInfo(byHtml as any).uid).toBe('999');
  });

  it('deepUid=false 时不做 innerHTML 兜底（每张卡序列化整卡 HTML 太贵）', () => {
    const c = card(h('div', '', {}, '{"mid":999}'));
    expect(extractCardInfo(c as any, false).uid).toBe('');
  });

  it('BV 号从视频链接里取', () => {
    const c = card(h('a', '', { href: '//www.bilibili.com/video/BV1xx411c7mD?p=1' }));
    expect(extractCardInfo(c as any).bvid).toBe('BV1xx411c7mD');
  });

  it('时长与播放量按各自的选择器归一成数字', () => {
    const c = card(
      h('span', 'bili-video-card__stats__duration', {}, '12:34'),
      h('span', 'bili-video-card__stats--item', {}, '3.2万')
    );
    const i = extractCardInfo(c as any);
    expect(i.duration).toBe(754);
    expect(i.views).toBe(32000);
  });

  // isLive 不跟开关走：processCard 靠它把「无标题的直播卡」和「尚未渲染的骨架卡」区分开，
  // 若跟着 hideLiveCard 漂移，两个开关都关时直播卡会被当骨架、每轮重抠一次。
  it('直播识别与开关无关，广告检测才跟着开关走', () => {
    const live = card(h('a', '', { href: 'https://live.bilibili.com/123' }));
    configureCardDetect(() => ({ detectAd: false }));
    expect(extractCardInfo(live as any).isLive).toBe(true);
    expect(extractCardInfo(card(h('span', '', {}, ' 广告 ')) as any).isAd).toBe(false);
  });

  it('广告角标文案要精确等于「广告/赞助/推广」，不能是包含', () => {
    configureCardDetect(() => ({ detectAd: true }));
    // 「广告位招租」「推广方式」这类标题会让「包含」判法把正常视频当广告删掉。
    expect(extractCardInfo(card(h('span', '', {}, '广告位招租的日常')) as any).isAd).toBe(false);
    expect(extractCardInfo(card(h('span', '', {}, ' 广告 ')) as any).isAd).toBe(true);
  });

  it('直播卡不再判广告（省掉遍历全卡节点的那次开销）', () => {
    configureCardDetect(() => ({ detectAd: true }));
    const c = card(h('a', '', { href: 'https://live.bilibili.com/1' }), h('span', '', {}, '广告'));
    const i = extractCardInfo(c as any);
    expect(i.isLive).toBe(true);
    expect(i.isAd).toBe(false);
  });
});

// BewlyCat（把整个首页换成自己 Vue 界面的扩展）的卡片版式。类名取自它的源码 + 实测 DOM。
// 锁住的是「同一套抽取逻辑对两种版式都成立」——将来谁改了共用的选择器顺序，
// 原生和它两边会同时报错，而不是悄悄只坏一边。
describe('extractCardInfo：BewlyCat 版式', () => {
  const stat = (kind: string, v: string) =>
    h('span', 'video-card-cover-stats__item ' + kind, {}, h('span', 'video-card-cover-stats__value', {}, v));
  const bewlyCard = () => {
    const container = h(
      'div',
      'video-card-container',
      {},
      h(
        'div',
        'video-card group',
        {},
        h(
          'a',
          '',
          { href: 'https://www.bilibili.com/video/BV1ETug6DEj7/' },
          h(
            'div',
            'video-card-cover-stats',
            {},
            h(
              'div',
              'video-card-cover-stats__items',
              {},
              stat('cover-stat-view', '24.5 万'),
              stat('cover-stat-danmaku', '816'),
              stat('cover-stat-like', '1.9 万'),
              stat('video-card-cover-stats__item--duration', '08:51')
            )
          )
        ),
        h('div', 'keep-two-lines video-card-title text-base', {}, '你甚至可以在星穹铁道里学佛法'),
        h('a', 'channel-name', { href: '//space.bilibili.com/503302' }, '高原守Channel')
      )
    );
    return container.querySelector('.video-card')!; // 扫描器匹配的是内层这张，外层只用于 cellOf
  };

  it('标题 / UP 名 / UID / BV 都抠得出来', () => {
    const info = extractCardInfo(bewlyCard() as any);
    expect(info.title).toBe('你甚至可以在星穹铁道里学佛法');
    expect(info.up).toBe('高原守Channel');
    expect(info.uid).toBe('503302');
    expect(info.bvid).toBe('BV1ETug6DEj7');
  });

  // 播放/弹幕/点赞/时长四项**共用** .video-card-cover-stats__value 这一个类名。
  // 不带父级 cover-stat-* 限定的话就会按文档序取第一个——谁排在前面取决于用户的显示设置，
  // 于是「按播放量屏蔽」时灵时不灵，而且不报任何错。
  it('播放量取的是播放那一项，不会串到弹幕/点赞上', () => {
    const info = extractCardInfo(bewlyCard() as any);
    expect(info.views).toBe(245000);
    expect(info.likes).toBe(19000);
    expect(info.duration).toBe(531); // 08:51
  });

  it('卡面不显示统计时三项保持 null，营销号维度自会跳过', () => {
    const bare = h('div', 'video-card', {}, h('div', 'video-card-title', {}, '无统计'));
    const info = extractCardInfo(bare as any);
    expect(info.views).toBeNull();
    expect(info.likes).toBeNull();
    expect(info.duration).toBeNull();
  });
});
