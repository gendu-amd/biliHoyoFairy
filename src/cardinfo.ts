// 卡片信息抽取：从 DOM 卡片（extractCardInfo）或接口 JSON 列表项（normFeedItem）
// 归一成同形状的 CardInfo，供匹配引擎判定。两路同构，判定一致。
// 广告检测要遍历全卡节点，是热路径大头，仅在「屏蔽广告卡」开启时才做——开关经 configureCardDetect 注入，避免直接耦合 CONFIG。
import { parseDuration, parseCount } from './util';
import {
  AD_CARD_SELECTOR,
  CARD_DURATION_SELECTORS,
  CARD_MID_ATTRS,
  CARD_MID_ATTR_SELECTOR,
  CARD_PARTITION_SELECTORS,
  CARD_TITLE_SELECTORS,
  CARD_UP_SELECTORS,
  CARD_VIEWS_SELECTORS,
  CARD_LIKES_SELECTORS,
  LIVE_CARD_SELECTOR,
} from './selectors';

// 归一后的卡片信息：DOM 抽取与接口归一两路同构。
export interface CardInfo {
  title: string;
  up: string;
  uid: string;
  partition: string;
  bvid: string;
  link?: string;
  duration: number | null;
  views: number | null;
  likes: number | null;
  isLive: boolean;
  isAd: boolean;
}

interface DetectFlags {
  detectAd: boolean;
}
// 默认不检测（零开销）；主程序在 CONFIG 就绪后注入 () => ({ detectAd: CONFIG.hideAd })。
let getDetect: () => DetectFlags = () => ({ detectAd: false });
export function configureCardDetect(fn: () => DetectFlags): void {
  getDetect = fn;
}

function pickText(card: Element, selectors: string[]): string {
  for (const sel of selectors) {
    const el = card.querySelector(sel);
    if (el) {
      const v = el.getAttribute('title') || el.textContent;
      if (v && v.trim()) return v.trim();
    }
  }
  return '';
}

// deepUid: 是否为缺 UID 的卡做昂贵的 innerHTML 兜底解析（扫描热路径按需，拉黑场景强制 true）。
// 卡片上缓存的抽取结果。DOM 层判定时已经抠过一遍，悬停浮层/右键菜单再抠一遍既浪费、又可能
// 在首屏抠到还没渲染完的空 UID。用一对带类型的存取函数封住这个 expando，
// 好过各处写 (card as any)._bfbInfo —— 键名打错在那种写法下是不报错的。
interface CardWithInfo extends Element {
  _bfbInfo?: CardInfo;
}

export function cacheCardInfo(card: Element, info: CardInfo): void {
  (card as CardWithInfo)._bfbInfo = info;
}

export function cachedCardInfo(card: Element): CardInfo | null {
  return (card as CardWithInfo)._bfbInfo || null;
}

export function extractCardInfo(card: Element, deepUid = true): CardInfo {
  const info: CardInfo = { title: '', up: '', uid: '', partition: '', bvid: '', duration: null, views: null, likes: null, isLive: false, isAd: false };

  info.title = pickText(card, CARD_TITLE_SELECTORS);
  info.up = pickText(card, CARD_UP_SELECTORS);

  // UID（拉黑必需）：space 链接 → data-* → innerHTML 兜底（含纯文本卡内嵌的 "mid":数字）
  const upA = card.querySelector('a[href*="space.bilibili.com"]');
  if (upA) info.uid = ((upA.getAttribute('href') || '').match(/space\.bilibili\.com\/(\d+)/) || [])[1] || '';
  if (!info.uid) {
    const midEl = card.querySelector(CARD_MID_ATTR_SELECTOR);
    // 逐个短路取值（不用 map+find：这是每张卡都会走的热路径，别为一次取值分配临时数组）
    if (midEl) {
      for (const a of CARD_MID_ATTRS) {
        const v = midEl.getAttribute(a);
        if (v) {
          info.uid = v;
          break;
        }
      }
    }
  }
  info.partition = pickText(card, CARD_PARTITION_SELECTORS);

  const aVideo = card.querySelector('a[href*="/video/"]');
  if (aVideo) {
    const m = (aVideo.getAttribute('href') || '').match(/(BV[0-9A-Za-z]+)/);
    if (m) info.bvid = m[1];
  }

  info.duration = parseDuration(pickText(card, CARD_DURATION_SELECTORS));

  // 按优先级逐个试（不能 join 成一条选择器：那样返回的是文档序首个元素，而非优先级首选）
  for (const sel of CARD_VIEWS_SELECTORS) {
    const statEl = card.querySelector(sel);
    if (statEl) {
      info.views = parseCount(statEl.textContent);
      break;
    }
  }

  // 点赞数：只有少数版式会在卡面上显示它（如 BewlyCat 的封面统计条）。取不到就保持 null，
  // 营销号维度自己会跳过——那条规则的语义本来就是「拿得到点赞数时才判」。
  for (const sel of CARD_LIKES_SELECTORS) {
    const el = card.querySelector(sel);
    if (el) {
      info.likes = parseCount(el.textContent);
      break;
    }
  }

  const { detectAd } = getDetect();
  // 直播识别**不挂开关**：除了「屏蔽直播卡」这个功能，它还是 processCard 判定骨架卡的依据
  // （直播卡常常没有标题，靠 isLive 才不会被当成尚未渲染的空壳）。跟着开关走的话，
  // 两个开关都关时每一张无标题直播卡都会被判成骨架、每轮扫描重抠一次，且这个字段的含义会随配置漂移。
  // 三次判定都很轻（两次 querySelector + 一次本卡 textContent），远小于下面的广告角标全卡遍历。
  // textContent 取一次给两处用（直播判定 + 下面的骨架卡闸门），省一次全卡文本遍历。
  const text = card.textContent || '';
  info.isLive = !!(card.querySelector('a[href*="live.bilibili.com"]') || card.querySelector(LIVE_CARD_SELECTOR) || /直播中|正在直播/.test(text));

  // innerHTML 兜底会把整张卡序列化成字符串，是本函数最贵的一步，所以放到最后并加两道闸：
  //   1) 只序列化一次（原先两条正则各读了一遍 innerHTML，等于白做两倍功）；
  //   2) 骨架卡（整张卡一个字都没有 = 还没渲染出内容）直接跳过。判据用「有没有文本」而不是
  //      「有没有标题/UP」：某个版式的标题选择器没覆盖到时，卡其实是渲染好的，不该被当成空壳。
  //      这一闸很关键——processCard 对骨架卡**不打 PROCESSED 标记**（要等它填充后再判），
  //      于是每轮扫描都会重抽一遍；不跳过的话，一屏骨架卡就是每 250ms 两次全卡序列化 × N。
  if (!info.uid && deepUid && text.trim()) {
    const html = card.innerHTML;
    info.uid = (html.match(/space\.bilibili\.com\/(\d+)/) || [])[1] || '';
    if (!info.uid) info.uid = (html.match(/"(?:mid|owner_?id|up_?mid)"\s*:\s*"?(\d{2,})"?/) || [])[1] || '';
  }


  // 广告判定（含遍历全卡 span/div 找角标文案）只服务于「屏蔽广告卡」，hideAd 关时整段跳过，省热路径开销。
  // 直播卡直接判非广告（下面本来也是 !isLive && …），顺带省掉那次全卡 span/div 遍历。
  if (detectAd && !info.isLive) {
    // 仅用稳定的广告标识判定：官方广告类名 / 投流域名 / 运营推广链接 / 显式角标文案。
    // 角标文案要遍历全卡节点，最贵，放在选择器之后惰性求值。
    const adBadge = () =>
      Array.from(card.querySelectorAll('span,div')).some((el) => {
        const tx = (el.textContent || '').trim();
        return tx === '广告' || tx === '赞助' || tx === '推广';
      });
    info.isAd = !!card.querySelector(AD_CARD_SELECTOR) || adBadge();
  }

  return info;
}

// 动态流（t.bilibili.com，/x/polymer/web-dynamic/…）的列表项归一。
//
// 单独一个函数而不是往 normFeedItem 里加分支：动态的字段全埋在 modules 下，与推荐流那套扁平
// 结构没有一处重合，混在一起会让 normFeedItem 变成谁都不敢改的大杂烩。
// 动态不只有视频（还有图文、转发、直播），非视频项归一后没有 bvid/title 也无妨——
// 关键词与 UP/UID 维度照样能判，这正是我们想拦的（比如某个 UP 的所有动态）。
export function normDynamicItem(it: any): CardInfo | null {
  if (!it || typeof it !== 'object') return null;
  const mods = it.modules || {};
  const author = mods.module_author || {};
  const dyn = mods.module_dynamic || {};
  const major = dyn.major || {};
  // 视频动态的正文在 major.archive；纯文字/图文动态在 module_dynamic.desc.text
  const av = major.archive || major.pgc || {};
  const stat = av.stat || {};
  const title = av.title || (dyn.desc && dyn.desc.text) || '';
  // 转发动态：原动态的正文也要参与关键词判定，否则「转发引战内容」拦不到
  const orig = it.orig ? normDynamicItem(it.orig) : null;
  return {
    title: String(title || '') + (orig && orig.title ? ' ' + orig.title : ''),
    up: author.name || '',
    uid: author.mid != null ? String(author.mid) : '',
    partition: '', // 动态接口不返回分区
    bvid: av.bvid || '',
    link: av.jump_url || '',
    duration: parseDuration(av.duration_text),
    // 动态里的播放数是「10.2万」这类展示串，不是数字
    views: parseCount(stat.play),
    likes: null,
    isLive: it.type === 'DYNAMIC_TYPE_LIVE_RCMD' || !!major.live_rcmd,
    isAd: false,
  };
}

// 各接口的「列表项」归一成与 extractCardInfo 同形状的 info（rcmd/ranking/popular/related 同构）。
// it 为各推荐接口的原始 JSON 列表项，字段形态各异，统一以宽松类型读取后归一。
export function normFeedItem(it: any): CardInfo | null {
  if (!it || typeof it !== 'object') return null;
  const goto = it.goto || it.card_goto || '';
  const owner = it.owner || {};
  const stat = it.stat || {};
  // 广告项标题/落地页常埋在 ad_info / cm 里，尽量抠出来，便于在屏蔽记录里辨识
  const ad = it.ad_info || it.cm_info || it.cm || null;
  const adC = (ad && (ad.creative_content || ad.creative)) || {};
  // 搜索结果的 title 内含 <em class="keyword"> 高亮标签，去标签后再匹配（其它接口无标签，无副作用）
  const rawTitle = it.title || adC.title || adC.description || ad?.title || '';
  return {
    title: String(rawTitle || '').replace(/<[^>]*>/g, ''), // String()：接口偶发非字符串 title 时不抛错
    up: owner.name || it.author || it.name || (ad && ad.source_content && ad.source_content.name) || '',
    uid: owner.mid != null ? String(owner.mid) : it.mid != null ? String(it.mid) : '',
    // 只认真正的分区字段。曾经兜底取过 rcmd_reason.content，但那是「已关注 / 高播放」这类**推荐理由**，
    // 不是分区；混进来会让 `分区:` 规则和 `part:` 关键词莫名其妙地匹配上推荐角标。
    // JSON 这一路本来就拿得到权威的 tname/typename，没有理由降级去用一个语义不同的字段。
    partition: it.tname || it.typename || '',
    bvid: it.bvid || '',
    link: it.uri || it.jump_url || adC.url || adC.jump_url || '',
    duration: typeof it.duration === 'number' ? it.duration : it.duration ? parseDuration(it.duration) : null,
    views: stat.view != null ? stat.view : stat.play != null ? stat.play : it.play != null ? it.play : null,
    likes: stat.like != null ? stat.like : null, // 点赞数（feed JSON 才有；用于营销号低赞率识别）
    isLive: goto === 'live',
    isAd: goto === 'ad' || goto === 'cm' || !!it.ad_info || !!it.is_ad,
  };
}
