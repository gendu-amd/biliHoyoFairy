// B 站 DOM 选择器登记表（L0 叶子：纯数据、无依赖、无副作用）。
//
// 为什么单独一个文件：B 站前端改版时失效的永远是这些字符串，而它们原先散落在
// page / cardinfo / dom / hotsearch / comments 五个文件里，改一处漏一处。
// 现在「B 站换了类名」这件事只需要改这一个文件——各消费方只 import，不再自己写选择器。
//
// 维护约定：
//   - 每条选择器写清它对应哪个页面/哪种卡，删的时候才知道会影响谁；
//   - 只放「B 站的」选择器。本脚本自己注入的元素（.bfb-*）不属于这里，它们不会因 B 站改版而变。

// —— 视频卡（内层卡片本体）——
export const VIDEO_CARD_SELECTORS = [
  'div.bili-video-card', // 首页 / 分区 / 搜索
  'div.video-page-card-small', // 播放页右侧推荐
  'li.bili-rank-list-video__item', // 分区右侧热门
  'div.video-card', // 综合热门 / 每周必看 / 入站必刷
  'li.rank-item', // 排行榜
  'div.video-card-reco',
  'div.video-card-common',
  'div.bili-dyn-list__item', // 动态信息流（t.bilibili.com）
  'div.floor-card.single-card', // 首页信息流里的「直播推荐」单卡（链向 live.bilibili.com）
];
// BewlyCat 的卡片内层类名恰好也是 .video-card，上面那条已能命中；下面 CARD_* 里带 BewlyCat
// 标注的几条补的是它的字段类名（否则卡认得出、标题和 UP 名却抠不到）。

// —— 播放页「当前视频的 UP 主」信息区（只服务于右键菜单）——
// ⚠ 故意不进 VIDEO_CARD_SELECTORS：那是扫描器的输入，混进去会让 UP 信息区被当成卡片隐藏。
// 定位主要靠「指向 space.bilibili.com 的链接」，下面两条只用来补 UP 名的显示文本。
export const VIDEO_PAGE_UP_BOX = '.up-info-container, .membersinfo-upcard, .up-detail, .video-info-container';
export const VIDEO_PAGE_UP_NAME = '.up-name, .up-name__text';
// 顶栏：里面也有指向 space 的链接（你自己的头像），右键它不该弹屏蔽菜单。
export const PAGE_HEADER_SELECTOR = '.bili-header, #biliMainHeader, #bili-header-container';

// —— 隐藏目标定位 ——
// 网格格子容器：隐藏时上移到它，避免只隐内层留下空洞/黑框。
//
// ⚠ 顺序即优先级，**由外到内**，必须逐个 closest() 试，不能 join 成一条选择器。
// `closest('a, b')` 返回的是**最近的祖先**，不是「优先级最高的那个选择器」——
// 首页真实结构是 .container(display:grid) > .feed-card > .bili-feed-card > .bili-video-card，
// 其中网格项是 .feed-card。join 写法会命中更近的 .bili-feed-card 就停下，
// 隐藏它之后 .feed-card 仍占着一个网格单元 → 留下空洞、后面的卡不补位。
export const CELL_CONTAINERS = [
  'div.feed-card', // 首页信息流网格项（.container 的直接子元素，必须优先）
  'div.floor-single-card', // 首页「直播推荐」单卡的带宽高占位外层，只隐内层会留黑框
  'div.bili-feed-card', // 兜底：无外层 .feed-card 的场景（旧版式/其它信息流）
  'div.video-card-container', // BewlyCat 的网格项（内层才是 .video-card）；不登记会留空洞
];
// 护栏名单：这些是页面级大容器，隐藏它们会连带删掉无限滚动的加载哨兵。
export const UNSAFE_HIDE_CONTAINERS = '.container, .feed2, .bili-feed4, #i_cecream, #app, .bili-header';
// 首页顶部轮播 banner：结构特殊且非信息流内容，扫描时整块跳过。
export const SWIPE_BANNER = '.recommended-swipe';

// —— 卡片字段抽取（按优先级顺序尝试，取第一个有文本的）——
export const CARD_TITLE_SELECTORS = [
  '.bili-video-card__info--tit',
  '.video-name',
  'h3[title]',
  '.title',
  '.bili-dyn-card-video__title', // 动态内视频标题
  '.dyn-card-opus__title', // 动态专栏/图文标题
  '.bili-dyn-content__orig__desc', // 动态正文（文字动态，便于关键词命中）
  '.video-card-title', // BewlyCat 卡片标题
];
export const CARD_UP_SELECTORS = [
  '.bili-video-card__info--author',
  '.up-name__text',
  '.up-name',
  '.bili-video-card__info--owner span',
  '.upname .name',
  '.bili-dyn-title__text', // 动态发布者
  '.channel-name', // BewlyCat 的 UP 名（其作者链接仍是 //space.bilibili.com/{mid}，UID 照常抠得到）
];
export const CARD_PARTITION_SELECTORS = ['.bili-video-card__info--tag', '.rcmd-tag'];
export const CARD_DURATION_SELECTORS = [
  '.bili-video-card__stats__duration',
  '.duration',
  '.bili-dyn-card-video__duration',
  '.video-card-cover-stats__item--duration', // BewlyCat
];
// ⚠ 必须带父级 cover-stat-* 限定：BewlyCat 的播放/弹幕/点赞/时长共用 __value 这一个类名，
// 只写子类名会按文档序取第一个，顺序取决于用户的显示设置。
export const CARD_VIEWS_SELECTORS = [
  '.bili-video-card__stats--item',
  '.play-text',
  '.cover-stat-view .video-card-cover-stats__value', // BewlyCat
];
// 点赞数（营销号识别用）。接口那一路从 stat.like 拿，DOM 这一路只有少数版式显示它。
export const CARD_LIKES_SELECTORS = ['.cover-stat-like .video-card-cover-stats__value'];
// UID 兜底：DOM 上可能携带 mid 的自定义属性。
export const CARD_MID_ATTR_SELECTOR = '[data-mid],[data-up-mid],[data-user-id]';
export const CARD_MID_ATTRS = ['data-mid', 'data-up-mid', 'data-user-id'];
// 直播卡特征（服务于「屏蔽直播推荐」，也避免把直播误判成广告）。
export const LIVE_CARD_SELECTOR = '.bili-live-card, [class*="live-card"]';
// 广告卡特征：只用稳定标识——官方广告类名 / 投流域名 / 运营推广链接。
// 只当「有没有」用（不看优先级），故直接写成一条，热路径可直接 querySelector。
export const AD_CARD_SELECTOR =
  '.bili-video-card__info--ad,a[href*="cm.bilibili.com"],a[href*="//mall.bilibili.com"],a[href*="specialRecommendByOp"]';

// —— 搜索面板热搜榜（用一段 display:none 样式整体隐藏）——
export const HOTSEARCH_SELECTORS = [
  '.trending',
  '.search-panel .trending-list',
  '.search-panel-popover .trending',
  '.bili-header [class*="trending"]',
  '.center-search-container [class*="trending"]',
  '.search-panel [class*="trending"]',
  '.history-panel [class*="trending"]',
];

// —— 评论区 Web Component 标签名 —— 值 = 是否为楼中楼（影响“回复 @x:”前缀的剥离）。
// 值域写成 boolean | undefined 而非 boolean：查表用的是任意元素的 tagName，「查不到」是常态而非异常，
// 调用方正是靠 undefined 区分「不是评论宿主」与「是一级评论(false)」。
export const COMMENT_TAGS: Record<string, boolean | undefined> = {
  'BILI-COMMENT-THREAD-RENDERER': false,
  'BILI-COMMENT-REPLY-RENDERER': true,
};

/** 该标签是评论宿主吗（含一级与楼中楼）。tagName 是大写的。 */
export function isCommentTag(tagName: string): boolean {
  return COMMENT_TAGS[tagName] !== undefined;
}
