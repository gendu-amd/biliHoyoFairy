// ==UserScript==
// @name         B站(bilibili)推荐流净化·屏蔽拉黑去广告 — biliHoyoFairy 抗击黑潮
// @name:zh-CN   B站(bilibili)推荐流净化·屏蔽拉黑去广告 — biliHoyoFairy 抗击黑潮
// @name:en      biliHoyoFairy — bilibili Feed Cleaner, Blocker & Account Blacklist
// @namespace    https://github.com/gendu-amd/biliHoyoFairy
// @version      0.0.8
// @description  B站(bilibili/哔哩哔哩)推荐流净化与屏蔽脚本：屏蔽黑流量、引战视频、商业广告与不想看的 UP 主。支持按 标签/UP主/UID/关键词(可正则)/分区/时长/播放量/BV 精准过滤；覆盖首页/热门/排行榜/搜索/播放页/动态/评论区；白名单优先防误伤；右键一键屏蔽/拉黑(同步账号黑名单)；内置预置关键词库与规则订阅。
// @description:en  Clean up & block the bilibili recommendation feed: hide clickbait, flame-bait, ads and unwanted UP owners. Filter by tag/UP/UID/keyword(regex)/category/duration/views/BV across home, popular, ranking, search, video, dynamic pages and comments; whitelist priority; one-click block synced to the account blacklist; preset keyword library and rule subscriptions.
// @author       gendu-amd
// @match        https://www.bilibili.com/*
// @match        https://search.bilibili.com/*
// @match        https://t.bilibili.com/*
// @updateURL    https://raw.githubusercontent.com/gendu-amd/biliHoyoFairy/main/biliHoyoFairy.user.js
// @downloadURL  https://raw.githubusercontent.com/gendu-amd/biliHoyoFairy/main/biliHoyoFairy.user.js
// @connect      api.bilibili.com
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      gitee.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// @license      MIT
// ==/UserScript==

"use strict";
(() => {
  // src/constants.ts
  var VERSION = typeof GM_info !== "undefined" && GM_info.script && GM_info.script.version || "0.0.1";
  var STORE_KEY = "bfb_config_v2";
  var STORE_BACKUP_KEY = "bfb_config_corrupt_backup";
  var STATS_KEY = "bfb_stats_v1";
  var BACKUP_KEY = "bfb_backups_v1";
  var BACKUP_MAX = 5;
  var SHRINK_ALERT_MIN = 5;
  var SCHEMA_VERSION = 1;
  var SUB_STORE_KEY = "bfb_subs_v1";
  var BLACKLIST_MANAGE_URL = "https://account.bilibili.com/account/blacklist";
  var ATTR_API = "data-bfb-api";
  var ATTR_BLOCKED = "data-bfb-blocked";
  var PROCESSED = "data-bfb-done";
  var COMMENT_BOTS = /* @__PURE__ */ new Set([
    "机器工具人",
    "有趣的程序员",
    "AI视频小助理",
    "AI视频小助理总结一下",
    "AI笔记侠",
    "AI视频助手",
    "哔哩哔理点赞姬",
    "课代表猫",
    "AI课代表呀",
    "木几萌Moe",
    "星崽丨StarZai",
    "AI沈阳美食家",
    "AI头脑风暴",
    "GPT_5",
    "Juice_AI",
    "AI全文总结",
    "AI视频总结",
    "AI总结视频",
    "AI工具集",
    "Ai的评论",
    "AI识片酱",
    "AI知识总结",
    "AI小精灵呀",
    "AI课程教学",
    "Ai好记",
    "MilkyAi",
    "视频AI问答助手"
  ]);
  var COMMENT_AD_RE = /(bili2233\.cn|b23\.tv)\/(mall-|cm-)|领券|gaoneng\.bilibili\.com/i;
  var UNSAFE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  var BLOCKED_LOG_MAX = 300;
  var SAVE_DEBOUNCE_MS = 1200;
  var SYNC_COALESCE_MS = 300;
  var STARTUP_SUMMARY_MS = 3500;
  var LIST_SEARCH_MIN = 8;
  var CHIP_RENDER_MAX = 300;
  var NAME_RESOLVE_MAX = 20;
  var RISK_CODES = /* @__PURE__ */ new Set([-352, -412, -509, -799]);

  // src/selectors.ts
  var VIDEO_CARD_SELECTORS = [
    "div.bili-video-card",
    // 首页 / 分区 / 搜索
    "div.video-page-card-small",
    // 播放页右侧推荐
    "li.bili-rank-list-video__item",
    // 分区右侧热门
    "div.video-card",
    // 综合热门 / 每周必看 / 入站必刷
    "li.rank-item",
    // 排行榜
    "div.video-card-reco",
    "div.video-card-common",
    "div.bili-dyn-list__item",
    // 动态信息流（t.bilibili.com）
    "div.floor-card.single-card"
    // 首页信息流里的「直播推荐」单卡（链向 live.bilibili.com）
  ];
  var VIDEO_PAGE_UP_BOX = ".up-info-container, .membersinfo-upcard, .up-detail, .video-info-container";
  var VIDEO_PAGE_UP_NAME = ".up-name, .up-name__text";
  var PAGE_HEADER_SELECTOR = ".bili-header, #biliMainHeader, #bili-header-container";
  var CELL_CONTAINERS = [
    "div.feed-card",
    // 首页信息流网格项（.container 的直接子元素，必须优先）
    "div.floor-single-card",
    // 首页「直播推荐」单卡的带宽高占位外层，只隐内层会留黑框
    "div.bili-feed-card",
    // 兜底：无外层 .feed-card 的场景（旧版式/其它信息流）
    "div.video-card-container"
    // BewlyCat 的网格项（内层才是 .video-card）；不登记会留空洞
  ];
  var UNSAFE_HIDE_CONTAINERS = ".container, .feed2, .bili-feed4, #i_cecream, #app, .bili-header";
  var SWIPE_BANNER = ".recommended-swipe";
  var CARD_TITLE_SELECTORS = [
    ".bili-video-card__info--tit",
    ".video-name",
    "h3[title]",
    ".title",
    ".bili-dyn-card-video__title",
    // 动态内视频标题
    ".dyn-card-opus__title",
    // 动态专栏/图文标题
    ".bili-dyn-content__orig__desc",
    // 动态正文（文字动态，便于关键词命中）
    ".video-card-title"
    // BewlyCat 卡片标题
  ];
  var CARD_UP_SELECTORS = [
    ".bili-video-card__info--author",
    ".up-name__text",
    ".up-name",
    ".bili-video-card__info--owner span",
    ".upname .name",
    ".bili-dyn-title__text",
    // 动态发布者
    ".channel-name"
    // BewlyCat 的 UP 名（其作者链接仍是 //space.bilibili.com/{mid}，UID 照常抠得到）
  ];
  var CARD_PARTITION_SELECTORS = [".bili-video-card__info--tag", ".rcmd-tag"];
  var CARD_DURATION_SELECTORS = [
    ".bili-video-card__stats__duration",
    ".duration",
    ".bili-dyn-card-video__duration",
    ".video-card-cover-stats__item--duration"
    // BewlyCat
  ];
  var CARD_VIEWS_SELECTORS = [
    ".bili-video-card__stats--item",
    ".play-text",
    ".cover-stat-view .video-card-cover-stats__value"
    // BewlyCat
  ];
  var CARD_LIKES_SELECTORS = [".cover-stat-like .video-card-cover-stats__value"];
  var CARD_MID_ATTR_SELECTOR = "[data-mid],[data-up-mid],[data-user-id]";
  var CARD_MID_ATTRS = ["data-mid", "data-up-mid", "data-user-id"];
  var LIVE_CARD_SELECTOR = '.bili-live-card, [class*="live-card"]';
  var AD_CARD_SELECTOR = '.bili-video-card__info--ad,a[href*="cm.bilibili.com"],a[href*="//mall.bilibili.com"],a[href*="specialRecommendByOp"]';
  var HOTSEARCH_SELECTORS = [
    ".trending",
    ".search-panel .trending-list",
    ".search-panel-popover .trending",
    '.bili-header [class*="trending"]',
    '.center-search-container [class*="trending"]',
    '.search-panel [class*="trending"]',
    '.history-panel [class*="trending"]'
  ];
  var COMMENT_TAGS = {
    "BILI-COMMENT-THREAD-RENDERER": false,
    "BILI-COMMENT-REPLY-RENDERER": true
  };
  function isCommentTag(tagName) {
    return COMMENT_TAGS[tagName] !== void 0;
  }

  // src/page.ts
  var IS_SEARCH = location.host === "search.bilibili.com";
  var IS_DYNAMIC = location.host === "t.bilibili.com";
  function pageType() {
    const h = location.href;
    if (IS_DYNAMIC) return "动态";
    if (h.includes("/v/popular/rank") || h.includes("/ranking")) return "排行榜";
    if (h.includes("/v/popular")) return "热门";
    if (IS_SEARCH) return "搜索页";
    if (/^https:\/\/www\.bilibili\.com\/?($|\?|#)/.test(h)) return "首页";
    if (h.includes("/video/")) return "播放页";
    return "其他";
  }
  var VIDEO_CARD_SELECTOR = VIDEO_CARD_SELECTORS.join(",");
  var UNPROCESSED_CARD_SELECTOR = VIDEO_CARD_SELECTORS.map((s) => s + `:not([${PROCESSED}])`).join(",");
  function cellOf(el) {
    for (const sel of CELL_CONTAINERS) {
      const fc = el.closest(sel);
      if (fc) return fc;
    }
    if (IS_SEARCH && el.parentElement && el.parentElement !== document.body) return el.parentElement;
    return el;
  }
  function isUnsafeHideTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el.matches && el.matches(UNSAFE_HIDE_CONTAINERS)) return true;
    try {
      if (el.querySelectorAll(VIDEO_CARD_SELECTOR).length > 1) return true;
    } catch (e) {
    }
    return false;
  }

  // src/health.ts
  var API_RE = /api\.bilibili\.com\/x\/|\/x\/web-interface\//;
  var FEED_LIKE_RE = /\/(feed\/rcmd|ranking\/v\d|popular|archive\/related|search\/type|search\/all)/;
  var health = {
    apiSeen: 0,
    // 见到的 B 站数据接口请求数（含未被 hook 的）
    feedLike: 0,
    // 其中「形似推荐流」的请求数（判断该不该报警的前提）
    feedMatched: 0,
    // 命中 FEED_HOOKS 的响应数
    feedParsed: 0,
    // 命中后又成功取出可过滤列表的响应数
    feedItems: 0,
    // 累计经过拦截层判定的列表项数
    cardsSeen: 0,
    // DOM 兜底层识别到的视频卡数
    signedSkipped: 0,
    // 因携带 WBI 签名(w_rid)而放弃改写的请求数（见 net.ts SIGNED_RE）
    noteRequest(url) {
      if (!url || !API_RE.test(url)) return;
      this.apiSeen++;
      if (FEED_LIKE_RE.test(url)) this.feedLike++;
    }
  };
  var ready = false;
  function markHealthReady() {
    ready = true;
  }
  function healthDegraded() {
    if (!ready) return false;
    if (health.feedLike > 0 && health.feedMatched === 0) return true;
    if (health.feedMatched > 0 && health.feedParsed === 0) return true;
    return pageType() !== "其他" && health.cardsSeen === 0;
  }
  var timings = /* @__PURE__ */ new Map();
  var timingOn = false;
  function setTimingEnabled(on) {
    timingOn = on;
    if (!on) timings.clear();
  }
  function timed(label, fn) {
    if (!timingOn || typeof performance === "undefined") return fn();
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      const dt = performance.now() - t0;
      let e = timings.get(label);
      if (!e) timings.set(label, e = { n: 0, ms: 0, max: 0 });
      e.n++;
      e.ms += dt;
      if (dt > e.max) e.max = dt;
    }
  }
  function timingReport() {
    return [...timings.entries()].sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => `${k}: ${v.n} 次 · 共 ${v.ms.toFixed(1)}ms · 均 ${(v.ms / v.n).toFixed(2)}ms · 峰 ${v.max.toFixed(1)}ms`);
  }
  function healthReport() {
    const w = [];
    if (health.feedLike > 0 && health.feedMatched === 0) {
      w.push(`本页发出了 ${health.feedLike} 个形似推荐流的接口请求，却没有一个命中拦截规则表：接口路径可能已变更，拦截层当前未生效。请更新脚本或提 Issue。`);
    } else if (health.feedMatched > 0 && health.feedParsed === 0) {
      w.push("已捕获到推荐接口响应，但取不出其中的视频列表：接口返回结构可能已变更，拦截层当前未生效。请更新脚本或提 Issue。");
    }
    if (health.signedSkipped > 0) {
      w.push(
        `有 ${health.signedSkipped} 个请求因携带 WBI 签名（w_rid）而放弃改写：签名覆盖全部查询参数，改动会被 B 站判为 -403 校验失败。目前唯一会改写请求的功能是「进阶 → 增大首页推荐每批加载数量」，它在这些已签名的接口上不会生效（不影响屏蔽本身），可以关掉。`
      );
    }
    if (pageType() !== "其他" && health.cardsSeen === 0) {
      w.push("未识别到任何视频卡：卡片选择器可能已失效，DOM 兜底层当前未生效。请更新脚本或提 Issue。");
    }
    return w;
  }
  function healthNotes() {
    const n = [];
    if (health.feedMatched === 0 && health.feedLike === 0) {
      n.push("本页尚未发生推荐流接口请求，拦截层暂无用武之地——B 站首屏是服务端直出的，滚动或点「换一换」加载更多后再看这里。当前屏蔽由 DOM 兜底层完成。");
    }
    return n;
  }
  function healthSummary() {
    return `页面 ${pageType()} · 接口请求 ${health.apiSeen}（形似推荐流 ${health.feedLike}）· 命中推荐接口 ${health.feedMatched} · 解析出列表 ${health.feedParsed}（${health.feedItems} 项）· 识别卡片 ${health.cardsSeen}` + // 常态是 0，只有开了改写类功能且撞上已签名接口才非 0——恒显示只会变成没人看的噪音。
    (health.signedSkipped ? ` · 因 WBI 签名放弃改写 ${health.signedSkipped}` : "");
  }

  // src/subscriptions/parse.ts
  var SUB_DIMS = ["uids", "upNames", "keywords", "partitions", "tags", "upBio", "bvids"];
  var SUB_LINE_PREFIX = { uid: "uids", up: "upNames", kw: "keywords", part: "partitions", tag: "tags", bio: "upBio", bv: "bvids" };
  var SUB_PREFIX_RE = new RegExp("^(" + Object.keys(SUB_LINE_PREFIX).join("|") + ")\\s*:\\s*(.+)$", "i");
  var SUB_CAP = { uids: 5e4, upNames: 5e4, bvids: 5e4 };
  var SUB_CAP_DEFAULT = 5e3;
  function migrateSub(obj) {
    return obj || {};
  }
  function sanitizeSubRules(rawRules) {
    const out = {};
    for (const dim of SUB_DIMS) {
      const arr = rawRules && rawRules[dim];
      if (!Array.isArray(arr)) continue;
      const max = SUB_CAP[dim] || SUB_CAP_DEFAULT;
      const seen = /* @__PURE__ */ new Set();
      const clean = [];
      for (const x of arr) {
        if (typeof x !== "string") continue;
        const v = x.trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        clean.push(v);
        if (clean.length >= max) break;
      }
      if (clean.length) out[dim] = clean;
    }
    return out;
  }
  function parseSubscription(text) {
    const t = (text || "").trim();
    if (!t) throw new Error("空内容");
    if (t[0] === "{") {
      const obj = migrateSub(JSON.parse(t));
      const meta2 = obj && obj.meta && typeof obj.meta === "object" ? obj.meta : {};
      let rawRules = obj && obj.rules;
      if (!rawRules && obj && obj.config && obj.config.block) rawRules = obj.config.block;
      return { meta: meta2, rules: sanitizeSubRules(rawRules) };
    }
    const meta = {};
    const buckets = {};
    for (let line of t.split(/\r?\n/)) {
      line = line.trim();
      if (!line) continue;
      if (line[0] === "!") {
        const m = line.slice(1).match(/^\s*([a-zA-Z][\w-]*)\s*:\s*(.+)$/);
        if (m) meta[m[1]] = m[2].trim();
        continue;
      }
      line = line.replace(/\s+#.*$/, "").trim();
      if (!line) continue;
      const pm = !line.startsWith("/") && line.match(SUB_PREFIX_RE);
      const dim = pm ? SUB_LINE_PREFIX[pm[1].toLowerCase()] : "keywords";
      const val = pm ? pm[2].trim() : line;
      (buckets[dim] = buckets[dim] || []).push(val);
    }
    return { meta, rules: sanitizeSubRules(buckets) };
  }

  // src/config.ts
  var DEFAULT_CONFIG = {
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    reviewMode: false,
    // 审查模式：被拦视频不删/不隐，而是标记+就地放行，便于核对防误伤
    rightClickBlock: true,
    cardHoverBtn: false,
    // 悬停卡片时显示快捷「拉黑」浮层按钮（独立浮层，不改 B 站卡片 DOM）
    fuzzyMatch: true,
    // 反绕过：普通关键词匹配前剔除分隔符（“原 神/原.神”也命中）；隐形字符始终剔除
    tradNorm: false,
    // 简繁归一（默认关：多数用户用不到，且要多建一张 2.8k 条的表）
    blacklistCollab: false,
    // 拉黑联合投稿时，是否把所有合作者一并拉黑
    block: {
      keywords: [],
      // 命中 标题/UP名/分区（纯本地，不联网；标签匹配请用 tags 维度）；普通词=包含，/.../ =正则
      partitions: [],
      // 视频分区(tname)黑名单；普通词=包含，/.../ =正则（网络拦截层最准）
      upNames: [],
      uids: [],
      bvids: [],
      minDuration: 0,
      maxDuration: 0,
      minViews: 0,
      // 万；>0 时播放量低于此值的视频被拦
      spamLikeRatio: 0,
      // %；>0 时，点赞率(点赞/播放)低于此值且播放≥下方阈值的视频判为营销号/搬运号（仅 feed 有点赞数据时生效）
      spamMinViews: 10,
      // 万；营销号识别的最低播放门槛（避免冤枉小/新视频）
      // —— 以下为需要读取接口数据的维度（仅在开启「精确过滤」后生效）——
      tags: [],
      // 视频标签黑名单（标题区看不到，需调接口；支持 /正则/）
      dualTags: [],
      // 双重标签，“原神+鸣潮” 形式，同时命中两组才拦（治引战）
      upBio: []
      // UP 简介关键词黑名单（支持 /正则/）
    },
    allow: { keywords: [], upNames: [], uids: [] },
    hideAd: false,
    hideLiveCard: false,
    // 屏蔽信息流里的直播推荐卡（首页/动态里链向 live.bilibili.com 的卡）
    hideHotSearch: false,
    apiFilters: false,
    // 精确过滤总开关（关闭时完全不联网）
    hideCharging: false,
    // 充电专属视频（API）
    boostFeedLoad: false,
    // 增大首页推荐每次请求的视频数（拦截层删项后仍保持信息流饱满）
    // —— 评论区过滤（独立一套，读评论组件 __data；仅在有评论的页面生效）——
    comment: {
      enabled: false,
      // 评论区过滤总开关（关=完全不处理评论）
      keywords: [],
      // 评论正文关键词黑名单（独立于视频关键词；支持 /正则/、作用域前缀无意义）
      userNames: [],
      // 评论用户名精确黑名单
      userNameKeywords: [],
      // 评论用户名昵称关键词黑名单（支持 /正则/）
      minLevel: 0,
      // 评论者等级低于此值则隐藏（0=不启用）
      hideNoFace: false,
      // 默认头像且非会员（小号/水军特征）
      hideEmojiOnly: false,
      // 纯表情/纯 @ 的空洞评论
      hideCallOnly: false,
      // 只含 @其他用户、无实质内容
      hideAd: false,
      // 带货/导流广告评论
      hideCallBot: false,
      // 召唤 AI 的评论
      hideBot: false,
      // AI 机器人发布的评论
      allowUp: true,
      // 白名单：UP 主本人的评论免过滤
      allowPin: true,
      // 白名单：置顶评论免过滤
      allowMe: true,
      // 白名单：自己发布/被 @ 的评论免过滤
      collapse: true
      // 命中后折叠为一行灰条（点击展开），而非直接隐藏
    },
    debug: false,
    blockedCount: 0,
    uidNames: {},
    // uid -> UP 名 缓存（仅用于面板按名称展示；拉黑仍用 uid）
    ruleStats: {},
    // 规则 -> 累计命中次数（规则体检：过宽 / 从未命中）
    ruleStatsSince: 0,
    // 首次记账的时间戳（0=尚未开始统计）
    onboarded: false,
    disabled: {},
    // 规则停用表（见 AppConfig.disabled / isRuleDisabled）
    // 规则订阅：每条 { url, name, enabled }。拉取到的规则数据另存于 SUB_STORE_KEY 缓存（不进 config，不外传）
    subscriptions: []
  };
  function deepMerge(base, override) {
    for (const k of Object.keys(override || {})) {
      if (UNSAFE_KEYS.has(k)) continue;
      const v = override[k];
      if (Array.isArray(v) && Array.isArray(base[k])) {
        base[k].length = 0;
        for (const x of v) base[k].push(x);
      } else if (v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object") {
        deepMerge(base[k], v);
      } else {
        base[k] = v;
      }
    }
    return base;
  }
  var MIGRATIONS = {};
  function migrateConfig(parsed) {
    if (!parsed || typeof parsed !== "object") return parsed;
    let v = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0;
    while (v < SCHEMA_VERSION) {
      const step = MIGRATIONS[v];
      if (!step) break;
      try {
        step(parsed);
      } catch (e) {
        break;
      }
      v++;
    }
    parsed.schemaVersion = SCHEMA_VERSION;
    return parsed;
  }
  var configRescue = {
    corrupted: false,
    backupKey: STORE_BACKUP_KEY,
    raw: null
    // 原始内容，供报错时打进控制台（备份键在 GM 存储里，用户自己翻不到）
  };
  var STATS_FIELDS = ["blockedCount", "uidNames", "ruleStats", "ruleStatsSince"];
  function readJson(key) {
    const raw = GM_getValue(key, null);
    if (!raw) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return null;
    }
  }
  function pickStats(src) {
    const out = {};
    if (!src || typeof src !== "object") return out;
    for (const k of STATS_FIELDS) if (src[k] !== void 0) out[k] = src[k];
    return out;
  }
  function loadConfig() {
    const raw = GM_getValue(STORE_KEY, null);
    if (!raw) return deepMerge(structuredClone(DEFAULT_CONFIG), pickStats(readJson(STATS_KEY)));
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      const cfg = deepMerge(structuredClone(DEFAULT_CONFIG), migrateConfig(parsed));
      return deepMerge(cfg, pickStats(readJson(STATS_KEY)));
    } catch (e) {
      try {
        if (!GM_getValue(STORE_BACKUP_KEY, null)) GM_setValue(STORE_BACKUP_KEY, raw);
      } catch (_) {
      }
      configRescue.corrupted = true;
      configRescue.raw = raw;
      return deepMerge(structuredClone(DEFAULT_CONFIG), pickStats(readJson(STATS_KEY)));
    }
  }
  var CONFIG = loadConfig();
  var backupBlobKey = (ts) => BACKUP_KEY + ":" + ts;
  function countRules(cfg) {
    if (!cfg || typeof cfg !== "object") return 0;
    let n = 0;
    for (const scope of [cfg.block, cfg.allow, cfg.comment]) {
      if (!scope || typeof scope !== "object") continue;
      for (const v of Object.values(scope)) if (Array.isArray(v)) n += v.length;
    }
    return n;
  }
  function loadBackups() {
    const v = readJson(BACKUP_KEY);
    return Array.isArray(v) ? v : [];
  }
  function loadBackupRaw(b) {
    const v = GM_getValue(backupBlobKey(b.ts), null);
    return typeof v === "string" && v ? v : null;
  }
  function pushBackup(raw, reason, rules) {
    try {
      const ts = Date.now();
      const list = loadBackups();
      list.unshift({ ts, version: VERSION, reason, rules });
      const keep = list.slice(0, BACKUP_MAX);
      GM_setValue(backupBlobKey(ts), raw);
      GM_setValue(BACKUP_KEY, JSON.stringify(keep));
      for (const old of list.slice(BACKUP_MAX)) {
        if (typeof GM_deleteValue === "function") GM_deleteValue(backupBlobKey(old.ts));
        else GM_setValue(backupBlobKey(old.ts), "");
      }
    } catch (e) {
    }
  }
  function restoreBackup(b) {
    try {
      const raw = loadBackupRaw(b);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return false;
      const cur = GM_getValue(STORE_KEY, null);
      if (typeof cur === "string") pushBackup(cur, "restore", countRules(readJson(STORE_KEY)));
      GM_setValue(STORE_KEY, raw);
      deepMerge(CONFIG, loadConfig());
      baseSnapshot = snapshotConfig();
      return true;
    } catch (e) {
      return false;
    }
  }
  function snapshotOnUpgrade() {
    const raw = GM_getValue(STORE_KEY, null);
    if (typeof raw !== "string" || !raw) return;
    const list = loadBackups();
    if (list.some((b) => b.reason === "upgrade" && b.version === VERSION)) return;
    pushBackup(raw, "upgrade", countRules(readJson(STORE_KEY)));
  }
  snapshotOnUpgrade();
  var notify = () => {
  };
  function setConfigNotifier(fn) {
    notify = fn;
  }
  var baseSnapshot = {};
  function stripStats(src) {
    const out = src && typeof src === "object" ? { ...src } : {};
    for (const k of STATS_FIELDS) delete out[k];
    return out;
  }
  function snapshotConfig() {
    return stripStats(structuredClone(CONFIG));
  }
  function mergeList(base, mine, theirs) {
    const keyOf = (x) => typeof x === "string" ? x : x && typeof x === "object" && x.url ? "u:" + String(x.url) : JSON.stringify(x);
    const baseMap = new Map(base.map((x) => [keyOf(x), x]));
    const mineMap = new Map(mine.map((x) => [keyOf(x), x]));
    const removed = new Set([...baseMap.keys()].filter((k) => !mineMap.has(k)));
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const x of theirs) {
      const k = keyOf(x);
      if (removed.has(k) || seen.has(k)) continue;
      seen.add(k);
      const m = mineMap.get(k);
      const b = baseMap.get(k);
      if (m !== void 0 && b !== void 0 && typeof m !== "string" && JSON.stringify(m) !== JSON.stringify(b)) out.push(m);
      else out.push(x);
    }
    for (const x of mine) {
      const k = keyOf(x);
      if (baseMap.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }
  function threeWayMerge(base, mine, theirs) {
    const out = {};
    for (const k of /* @__PURE__ */ new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})])) {
      if (UNSAFE_KEYS.has(k)) continue;
      const b = base ? base[k] : void 0;
      const m = mine ? mine[k] : void 0;
      const t = theirs ? theirs[k] : void 0;
      if (Array.isArray(m) && Array.isArray(t)) out[k] = mergeList(Array.isArray(b) ? b : [], m, t);
      else if (m && typeof m === "object" && !Array.isArray(m) && t && typeof t === "object" && !Array.isArray(t))
        out[k] = threeWayMerge(b, m, t);
      else if (m === void 0) {
        if (b === void 0) out[k] = t;
      } else if (t === void 0) {
        if (b === void 0 || JSON.stringify(m) !== JSON.stringify(b)) out[k] = m;
      } else {
        out[k] = m === b || JSON.stringify(m) === JSON.stringify(b) ? t : m;
      }
    }
    return out;
  }
  function saveConfig() {
    timed("config.save", saveConfigInner);
  }
  function saveConfigInner() {
    const stored = readJson(STORE_KEY);
    const mine = snapshotConfig();
    const merged = stored ? threeWayMerge(baseSnapshot, mine, stripStats(migrateConfig(stored))) : mine;
    if (stored) {
      const before = countRules(stored);
      const after = countRules(merged);
      const drop = before - after;
      if (before > 0 && (after === 0 || drop >= SHRINK_ALERT_MIN)) {
        pushBackup(JSON.stringify(stored), "shrink", before);
        notify(`⚠ 规则条数从 ${before} 降到 ${after}。若非你本人操作，可在「工具 → 🗂 配置备份」里恢复。`);
      }
    }
    deepMerge(CONFIG, merged);
    GM_setValue(STORE_KEY, JSON.stringify(merged));
    baseSnapshot = structuredClone(merged);
    saveStats();
  }
  var statsTimer = null;
  function saveStats() {
    if (statsTimer) {
      clearTimeout(statsTimer);
      statsTimer = null;
    }
    const out = {};
    for (const k of STATS_FIELDS) out[k] = CONFIG[k];
    GM_setValue(STATS_KEY, JSON.stringify(out));
  }
  function scheduleStatsSave() {
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = setTimeout(saveStats, SAVE_DEBOUNCE_MS);
  }
  baseSnapshot = snapshotConfig();
  function installConfigSync(onAdopt) {
    if (typeof GM_addValueChangeListener !== "function") return;
    let syncTimer = null;
    GM_addValueChangeListener(STORE_KEY, (_name, _old, _new, remote) => {
      if (!remote) return;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        deepMerge(CONFIG, loadConfig());
        baseSnapshot = snapshotConfig();
        onAdopt();
      }, SYNC_COALESCE_MS);
    });
  }
  function isRuleDisabled(path, line) {
    const off = CONFIG.disabled[path];
    return Array.isArray(off) && off.indexOf(line) >= 0;
  }
  function setRuleDisabled(path, line, off) {
    const list = Array.isArray(CONFIG.disabled[path]) ? CONFIG.disabled[path] : CONFIG.disabled[path] = [];
    const i = list.indexOf(line);
    if (off && i < 0) list.push(line);
    else if (!off && i >= 0) list.splice(i, 1);
    if (!list.length) delete CONFIG.disabled[path];
  }
  var UID_NAMES_MAX = 5e3;
  function setUidName(uid, name) {
    const k = String(uid || "");
    if (!k || !name) return;
    if (CONFIG.uidNames[k] !== void 0 || Object.keys(CONFIG.uidNames).length < UID_NAMES_MAX) {
      CONFIG.uidNames[k] = name;
    }
  }
  var NON_PORTABLE = ["blockedCount", "uidNames", "enabled", "debug", "reviewMode", "subscriptions", "ruleStats", "ruleStatsSince", "disabled", "onboarded"];
  function exportSubscription(title) {
    const b = CONFIG.block;
    const rules = {};
    for (const dim of SUB_DIMS) {
      const arr = b[dim];
      if (Array.isArray(arr) && arr.length) rules[dim] = arr.filter((x) => typeof x === "string");
    }
    return JSON.stringify(
      {
        app: "biliHoyoFairy",
        format: 1,
        meta: {
          title: title || "我的名单",
          description: "由 biliHoyoFairy 导出。托管到公开 URL（GitHub raw / Gist raw）后，别人在「工具 → 规则订阅」填入即可。",
          version: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          expires: "1d"
        },
        rules
      },
      null,
      2
    );
  }
  function exportConfig() {
    const c = structuredClone(CONFIG);
    NON_PORTABLE.forEach((k) => delete c[k]);
    return JSON.stringify({ app: "biliHoyoFairy", version: VERSION, config: c }, null, 2);
  }
  var IMPORT_ARRAY_CAP = 5e4;
  function sanitizeConfigInput(input, ref = DEFAULT_CONFIG) {
    const out = {};
    if (!input || typeof input !== "object" || Array.isArray(input)) return out;
    for (const k of Object.keys(ref)) {
      if (UNSAFE_KEYS.has(k)) continue;
      if (!Object.prototype.hasOwnProperty.call(input, k)) continue;
      const v = input[k];
      const r = ref[k];
      if (Array.isArray(r)) {
        if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === "string");
      } else if (r && typeof r === "object") {
        const sub = sanitizeConfigInput(v, r);
        if (Object.keys(sub).length) out[k] = sub;
      } else if (typeof v === typeof r) {
        out[k] = v;
      }
    }
    return out;
  }
  function mergeImport(base, inc) {
    for (const k of Object.keys(inc || {})) {
      if (UNSAFE_KEYS.has(k)) continue;
      const v = inc[k];
      if (Array.isArray(v)) {
        if (!Array.isArray(base[k])) base[k] = [];
        const seen = new Set(base[k].map(String));
        for (const it of v) {
          if (base[k].length >= IMPORT_ARRAY_CAP) break;
          const s = String(it);
          if (!seen.has(s)) {
            seen.add(s);
            base[k].push(it);
          }
        }
      } else if (v && typeof v === "object" && base[k] && typeof base[k] === "object") {
        mergeImport(base[k], v);
      } else {
        base[k] = v;
      }
    }
  }

  // src/logging.ts
  var BADGE = "color:#fff;background:#fb7299;padding:0 4px;border-radius:3px";
  function log(...args) {
    if (!CONFIG.debug) return;
    const out = args.length === 1 && typeof args[0] === "function" ? [args[0]()] : args;
    console.log("%c[biliHoyoFairy]%c", BADGE, "color:inherit", ...out);
  }
  function logErr(where, e) {
    try {
      console.warn(`%c[biliHoyoFairy]%c ${where}`, BADGE, "color:#e74c3c", e);
    } catch (_) {
    }
  }
  function safe(where, fn) {
    return function(...args) {
      try {
        return fn.apply(this, args);
      } catch (e) {
        logErr(where, e);
        return void 0;
      }
    };
  }

  // src/util.ts
  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }
  function parseDuration(s) {
    if (!s) return null;
    const parts = s.trim().split(":").map((x) => parseInt(x, 10));
    if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  function parseCount(s) {
    if (!s) return null;
    const t = s.trim().replace(/[,\s]/g, "");
    const m = t.match(/^([\d.]+)\s*(万|亿)?/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (Number.isNaN(n)) return null;
    if (m[2] === "万") n *= 1e4;
    else if (m[2] === "亿") n *= 1e8;
    return Math.round(n);
  }
  function capMapSet(map, key, val, max) {
    map.set(key, val);
    while (map.size > max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }
  var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }

  // src/cardinfo.ts
  var getDetect = () => ({ detectAd: false });
  function configureCardDetect(fn) {
    getDetect = fn;
  }
  function pickText(card, selectors) {
    for (const sel of selectors) {
      const el = card.querySelector(sel);
      if (el) {
        const v = el.getAttribute("title") || el.textContent;
        if (v && v.trim()) return v.trim();
      }
    }
    return "";
  }
  function cacheCardInfo(card, info) {
    card._bfbInfo = info;
  }
  function cachedCardInfo(card) {
    return card._bfbInfo || null;
  }
  function extractCardInfo(card, deepUid = true) {
    const info = { title: "", up: "", uid: "", partition: "", bvid: "", duration: null, views: null, likes: null, isLive: false, isAd: false };
    info.title = pickText(card, CARD_TITLE_SELECTORS);
    info.up = pickText(card, CARD_UP_SELECTORS);
    const upA = card.querySelector('a[href*="space.bilibili.com"]');
    if (upA) info.uid = ((upA.getAttribute("href") || "").match(/space\.bilibili\.com\/(\d+)/) || [])[1] || "";
    if (!info.uid) {
      const midEl = card.querySelector(CARD_MID_ATTR_SELECTOR);
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
      const m = (aVideo.getAttribute("href") || "").match(/(BV[0-9A-Za-z]+)/);
      if (m) info.bvid = m[1];
    }
    info.duration = parseDuration(pickText(card, CARD_DURATION_SELECTORS));
    for (const sel of CARD_VIEWS_SELECTORS) {
      const statEl = card.querySelector(sel);
      if (statEl) {
        info.views = parseCount(statEl.textContent);
        break;
      }
    }
    for (const sel of CARD_LIKES_SELECTORS) {
      const el = card.querySelector(sel);
      if (el) {
        info.likes = parseCount(el.textContent);
        break;
      }
    }
    const { detectAd } = getDetect();
    const text = card.textContent || "";
    info.isLive = !!(card.querySelector('a[href*="live.bilibili.com"]') || card.querySelector(LIVE_CARD_SELECTOR) || /直播中|正在直播/.test(text));
    if (!info.uid && deepUid && text.trim()) {
      const html = card.innerHTML;
      info.uid = (html.match(/space\.bilibili\.com\/(\d+)/) || [])[1] || "";
      if (!info.uid) info.uid = (html.match(/"(?:mid|owner_?id|up_?mid)"\s*:\s*"?(\d{2,})"?/) || [])[1] || "";
    }
    if (detectAd && !info.isLive) {
      const adBadge = () => Array.from(card.querySelectorAll("span,div")).some((el) => {
        const tx = (el.textContent || "").trim();
        return tx === "广告" || tx === "赞助" || tx === "推广";
      });
      info.isAd = !!card.querySelector(AD_CARD_SELECTOR) || adBadge();
    }
    return info;
  }
  function normDynamicItem(it) {
    if (!it || typeof it !== "object") return null;
    const mods = it.modules || {};
    const author = mods.module_author || {};
    const dyn = mods.module_dynamic || {};
    const major = dyn.major || {};
    const av = major.archive || major.pgc || {};
    const stat = av.stat || {};
    const title = av.title || dyn.desc && dyn.desc.text || "";
    const orig = it.orig ? normDynamicItem(it.orig) : null;
    return {
      title: String(title || "") + (orig && orig.title ? " " + orig.title : ""),
      up: author.name || "",
      uid: author.mid != null ? String(author.mid) : "",
      partition: "",
      // 动态接口不返回分区
      bvid: av.bvid || "",
      link: av.jump_url || "",
      duration: parseDuration(av.duration_text),
      // 动态里的播放数是「10.2万」这类展示串，不是数字
      views: parseCount(stat.play),
      likes: null,
      isLive: it.type === "DYNAMIC_TYPE_LIVE_RCMD" || !!major.live_rcmd,
      isAd: false
    };
  }
  function normFeedItem(it) {
    if (!it || typeof it !== "object") return null;
    const goto = it.goto || it.card_goto || "";
    const owner = it.owner || {};
    const stat = it.stat || {};
    const ad = it.ad_info || it.cm_info || it.cm || null;
    const adC = ad && (ad.creative_content || ad.creative) || {};
    const rawTitle = it.title || adC.title || adC.description || ad?.title || "";
    return {
      title: String(rawTitle || "").replace(/<[^>]*>/g, ""),
      // String()：接口偶发非字符串 title 时不抛错
      up: owner.name || it.author || it.name || ad && ad.source_content && ad.source_content.name || "",
      uid: owner.mid != null ? String(owner.mid) : it.mid != null ? String(it.mid) : "",
      // 只认真正的分区字段。曾经兜底取过 rcmd_reason.content，但那是「已关注 / 高播放」这类**推荐理由**，
      // 不是分区；混进来会让 `分区:` 规则和 `part:` 关键词莫名其妙地匹配上推荐角标。
      // JSON 这一路本来就拿得到权威的 tname/typename，没有理由降级去用一个语义不同的字段。
      partition: it.tname || it.typename || "",
      bvid: it.bvid || "",
      link: it.uri || it.jump_url || adC.url || adC.jump_url || "",
      duration: typeof it.duration === "number" ? it.duration : it.duration ? parseDuration(it.duration) : null,
      views: stat.view != null ? stat.view : stat.play != null ? stat.play : it.play != null ? it.play : null,
      likes: stat.like != null ? stat.like : null,
      // 点赞数（feed JSON 才有；用于营销号低赞率识别）
      isLive: goto === "live",
      isAd: goto === "ad" || goto === "cm" || !!it.ad_info || !!it.is_ad
    };
  }

  // src/match/t2s.ts
  var T2S_PAIRS = "丟丢並并乾干亂乱亙亘亞亚佇伫佈布佔占併并來来侖仑侶侣侷局俁俣係系俔伣俠侠俥伡俬私倀伥倆俩倈俫倉仓個个們们倖幸倫伦偉伟側侧偵侦偽伪傑杰傖伧傘伞備备傢家傭佣傯偬傳传傴伛債债傷伤傾倾僂偻僅仅僉佥僑侨僕仆僞伪僥侥僨偾僱雇價价儀仪儁俊儂侬億亿儈侩儉俭儎傤儐傧儔俦儕侪儘尽償偿優优儲储儷俪儺傩儻傥儼俨兇凶兌兑兒儿兗兖內内兩两冊册冑胄冪幂凈净凍冻凜凛凱凯別别刪删剄刭則则剋克剎刹剗刬剛刚剝剥剮剐剴剀創创剷铲劃划劄札劇剧劉刘劊刽劌刿劍剑劑剂勁劲動动務务勛勋勝胜勞劳勢势勩勚勱劢勳勋勵励勸劝勻匀匭匦匯汇匱匮區区協协卹恤卻却卽即厙厍厠厕厤历厭厌厲厉厴厣參参叄叁叢丛吒咤吳吴吶呐呂吕咼呙員员唄呗唸念問问啓启啞哑啟启啢唡喚唤喪丧喫吃喬乔單单喲哟嗆呛嗇啬嗊唝嗎吗嗚呜嗩唢嗶哔嘆叹嘍喽嘓啯嘔呕嘖啧嘗尝嘜唛嘩哗嘮唠嘯啸嘰叽嘵哓嘸呒嘽啴噁恶噓嘘噝咝噠哒噥哝噦哕噯嗳噲哙噴喷噸吨噹当嚀咛嚇吓嚌哜嚐尝嚕噜嚙啮嚥咽嚦呖嚨咙嚮向嚲亸嚳喾嚴严嚶嘤囀啭囁嗫囂嚣囅冁囈呓囉啰囌苏囑嘱囪囱圇囵國国圍围園园圓圆圖图團团垻坝埡垭埰采執执堅坚堊垩堖垴堝埚堯尧報报場场塊块塋茔塏垲塒埘塗涂塚冢塢坞塤埙塵尘塹堑墊垫墜坠墮堕墰坛墳坟墶垯墻墙墾垦壇坛壋垱壎埙壓压壘垒壙圹壚垆壜坛壞坏壟垄壠垅壢坜壩坝壪塆壯壮壺壶壼壸壽寿夠够夢梦夥伙夾夹奐奂奧奥奩奁奪夺奬奖奮奋奼姹妝妆姍姗姦奸娛娱婁娄婦妇婭娅媧娲媯妫媼媪媽妈嫋袅嫗妪嫵妩嫺娴嫻娴嫿婳嬀妫嬃媭嬈娆嬋婵嬌娇嬙嫱嬡嫒嬤嬷嬪嫔嬰婴嬸婶孃娘孌娈孫孙學学孿孪宮宫寀采寢寝實实寧宁審审寫写寬宽寵宠寶宝將将專专尋寻對对導导尷尴屆届屍尸屓屃屜屉屢屡層层屨屦屬属岡冈峯峰峴岘島岛峽峡崍崃崑昆崗岗崙仑崢峥崬岽嵐岚嵗岁嶁嵝嶄崭嶇岖嶔嵚嶗崂嶠峤嶢峣嶧峄嶨峃嶮崄嶸嵘嶺岭嶼屿嶽岳巋岿巒峦巔巅巖岩巰巯巹卺帥帅師师帳帐帶带幀帧幃帏幗帼幘帻幟帜幣币幫帮幬帱幷并幹干幾几庫库廁厕廂厢廄厩廈厦廎庼廕荫廚厨廝厮廟庙廠厂廡庑廢废廣广廩廪廬庐廳厅弒弑弔吊弳弪張张強强彆别彈弹彌弥彎弯彔录彙汇彠彟彥彦彫雕彲彨彿佛後后徑径從从徠徕復复徵征徹彻恆恒恥耻悅悦悞悮悵怅悶闷悽凄惡恶惱恼惲恽惻恻愛爱愜惬愨悫愴怆愷恺愾忾慄栗態态慍愠慘惨慚惭慟恸慣惯慤悫慪怄慫怂慮虑慳悭慶庆慼戚慾欲憂忧憊惫憐怜憑凭憒愦憖慭憚惮憤愤憫悯憮怃憲宪憶忆懇恳應应懌怿懍懔懞蒙懟怼懣懑懨恹懲惩懶懒懷怀懸悬懺忏懼惧懾慑戀恋戇戆戔戋戧戗戩戬戰战戱戯戲戏戶户扞捍拋抛拚拼挩捝挱挲挾挟捨舍捫扪捱挨捲卷掃扫掄抡掗挜掙挣掛挂採采揀拣揚扬換换揮挥揯搄損损搖摇搗捣搧扇搵揾搶抢摑掴摜掼摟搂摯挚摳抠摶抟摺折摻掺撈捞撏挦撐撑撓挠撟挢撣掸撥拨撫抚撲扑撳揿撻挞撾挝撿捡擁拥擄掳擇择擊击擋挡擔担據据擠挤擡抬擣捣擬拟擯摈擰拧擱搁擲掷擴扩擷撷擺摆擻擞擼撸擾扰攄摅攆撵攏拢攔拦攖撄攙搀攛撺攜携攝摄攢攒攣挛攤摊攪搅攬揽敎教敓敚敗败敘叙敵敌數数斂敛斃毙斆敩斕斓斬斩斷断於于旂旗旣既昇升時时晉晋晝昼暈晕暉晖暘旸暢畅暫暂曄晔曆历曇昙曉晓曏向曖暧曠旷曨昽曬晒書书會会朧胧朮术東东枴拐柵栅柺拐査查桿杆梔栀梘枧條条梟枭梲棁棄弃棊棋棖枨棗枣棟栋棧栈棲栖棶梾椏桠楊杨楓枫楨桢業业極极榘矩榦干榪杩榮荣榲榅榿桤構构槍枪槓杠槤梿槧椠槨椁槮椮槳桨槶椢槼椝樁桩樂乐樅枞樑梁樓楼標标樞枢樣样樧榝樳桪樸朴樹树樺桦樿椫橈桡橋桥機机橢椭橫横檁檩檉柽檔档檜桧檟槚檢检檣樯檮梼檯台檳槟檸柠檻槛櫃柜櫓橹櫚榈櫛栉櫝椟櫞橼櫟栎櫥橱櫧槠櫨栌櫪枥櫫橥櫬榇櫱蘖櫳栊櫸榉櫻樱欄栏欅榉權权欏椤欒栾欖榄欞棂欽钦歎叹歐欧歟欤歡欢歲岁歷历歸归歿殁殘残殞殒殤殇殫殚殭僵殮殓殯殡殲歼殺杀殻壳殼壳毀毁毆殴毿毵氂牦氈毡氌氇氣气氫氢氬氩氳氲氾泛汎泛汙污決决沒没沖冲況况泝溯洩泄洶汹浹浃涇泾涗涚涼凉淒凄淚泪淥渌淨净淩凌淪沦淵渊淶涞淺浅渙涣減减渢沨渦涡測测渾浑湊凑湞浈湧涌湯汤溈沩準准溝沟溫温溮浉溳涢溼湿滄沧滅灭滌涤滎荥滙汇滬沪滯滞滲渗滷卤滸浒滻浐滾滚滿满漁渔漊溇漚沤漢汉漣涟漬渍漲涨漵溆漸渐漿浆潁颍潑泼潔洁潙沩潛潜潤润潯浔潰溃潷滗潿涠澀涩澆浇澇涝澐沄澗涧澠渑澤泽澦滪澩泶澮浍澱淀濁浊濃浓濕湿濘泞濚溁濛蒙濜浕濟济濤涛濫滥濰潍濱滨濺溅濼泺濾滤瀂澛瀅滢瀆渎瀉泻瀋沈瀏浏瀕濒瀘泸瀝沥瀟潇瀠潆瀦潴瀧泷瀨濑瀰弥瀲潋瀾澜灃沣灄滠灑洒灕漓灘滩灝灏灣湾灤滦灧滟灩滟災灾為为烏乌烴烃無无煉炼煒炜煙烟煢茕煥焕煩烦煬炀熅煴熒荧熗炝熱热熲颎熾炽燁烨燈灯燉炖燒烧燙烫燜焖營营燦灿燬毁燭烛燴烩燻熏燼烬燾焘爍烁爐炉爛烂爭争爲为爺爷爾尔牀床牆墙牘牍牴抵牽牵犖荦犛牦犢犊犧牺狀状狹狭狽狈猙狰猶犹猻狲獁犸獃呆獄狱獅狮獎奖獨独獪狯獫猃獮狝獰狞獲获獵猎獷犷獸兽獺獭獻献獼猕玀猡現现琱雕琺珐琿珲瑋玮瑒玚瑣琐瑤瑶瑩莹瑪玛瑲玱璉琏璡琎璣玑璦瑷璫珰環环璵玙璸瑸璽玺璿璇瓊琼瓏珑瓔璎瓚瓒甌瓯甕瓮產产産产畝亩畢毕畫画異异畵画當当疇畴疊叠痙痉痠酸痾疴瘂痖瘋疯瘍疡瘓痪瘞瘗瘡疮瘧疟瘮瘆瘲疭瘺瘘瘻瘘療疗癆痨癇痫癉瘅癒愈癘疠癟瘪癡痴癢痒癤疖癥症癧疬癩癞癬癣癭瘿癮瘾癰痈癱瘫癲癫發发皁皂皚皑皰疱皸皲皺皱盃杯盜盗盞盏盡尽監监盤盘盧卢盪荡眞真眥眦眾众睏困睜睁睞睐瞘眍瞞瞒瞶瞆瞼睑矇蒙矓眬矚瞩矯矫硃朱硜硁硤硖硨砗硯砚碕埼碩硕碭砀碸砜確确碼码磑硙磚砖磠硵磣碜磧碛磯矶磽硗礄硚礎础礙碍礦矿礪砺礫砾礬矾礱砻祕秘祿禄禍祸禎祯禕祎禡祃禦御禪禅禮礼禰祢禱祷禿秃秈籼稅税稈秆稜棱稟禀種种稱称穀谷穌稣積积穎颖穠秾穡穑穢秽穩稳穫获穭穞窩窝窪洼窮穷窯窑窵窎窶窭窺窥竄窜竅窍竇窦竈灶竊窃竪竖競竞筆笔筍笋筧笕箇个箋笺箏筝箚札節节範范築筑篋箧篔筼篠筿篤笃篩筛篳筚簀箦簍篓簑蓑簞箪簡简簣篑簫箫簹筜簽签簾帘籃篮籌筹籙箓籛篯籜箨籟籁籠笼籤签籩笾籪簖籬篱籮箩籲吁粵粤糉粽糝糁糞粪糧粮糰团糲粝糴籴糶粜糹纟糾纠紀纪紂纣約约紅红紆纡紇纥紈纨紉纫紋纹納纳紐纽紓纾純纯紕纰紖纼紗纱紘纮紙纸級级紛纷紜纭紝纴紡纺紮扎細细紱绂紲绁紳绅紵纻紹绍紺绀紼绋紿绐絀绌終终絃弦組组絆绊絎绗結结絕绝絛绦絝绔絞绞絡络絢绚給给絨绒絰绖統统絲丝絳绛絶绝絹绢綁绑綃绡綆绠綈绨綉绣綌绤綏绥綑捆經经綜综綞缍綠绿綢绸綣绻綫线綬绶維维綯绹綰绾綱纲網网綳绷綴缀綵彩綸纶綹绺綺绮綻绽綽绰綾绫綿绵緄绲緇缁緊紧緋绯緑绿緒绪緓绬緔绱緗缃緘缄緙缂線线緝缉緞缎締缔緡缗緣缘緦缌編编緩缓緬缅緯纬緱缑緲缈練练緶缏緹缇緻致緼缊縈萦縉缙縊缢縋缒縐绉縑缣縕缊縗缞縛缚縝缜縞缟縟缛縣县縧绦縫缝縭缡縮缩縱纵縲缧縴纤縵缦縶絷縷缕縹缥總总績绩繃绷繅缫繆缪繒缯織织繕缮繚缭繞绕繡绣繢缋繩绳繪绘繫系繭茧繮缰繯缳繰缲繳缴繹绎繼继繽缤繾缱纇颣纈缬纊纩續续纍累纏缠纓缨纔才纖纤纘缵纜缆缽钵罈坛罌罂罎坛罰罚罵骂罷罢羅罗羆罴羈羁羋芈羣群羥羟羨羡義义羶膻習习翫玩翬翚翹翘翽翙耬耧耮耢聖圣聞闻聯联聰聪聲声聳耸聵聩聶聂職职聹聍聽听聾聋肅肃脅胁脈脉脛胫脣唇脩修脫脱脹胀腎肾腖胨腡脶腦脑腫肿腳脚腸肠膃腽膕腘膚肤膠胶膩腻膽胆膾脍膿脓臉脸臍脐臏膑臘腊臚胪臟脏臠脔臢臜臥卧臨临臺台與与興兴舉举舊旧舖铺舘馆艙舱艤舣艦舰艫舻艱艰艷艳芻刍苧苎茲兹荊荆莊庄莖茎莢荚莧苋華华菴庵菸烟萇苌萊莱萬万萴荝萵莴葉叶葒荭葤荮葦苇葯药葷荤蒐搜蒓莼蒔莳蒕蒀蒞莅蒼苍蓀荪蓆席蓋盖蓮莲蓯苁蓴莼蓽荜蔔卜蔘参蔞蒌蔣蒋蔥葱蔦茑蔭荫蕁荨蕆蒇蕎荞蕒荬蕓芸蕕莸蕘荛蕢蒉蕩荡蕪芜蕭萧蕷蓣薀蕰薈荟薊蓟薌芗薑姜薔蔷薘荙薟莶薦荐薩萨薴苧薹苔薺荠藍蓝藎荩藝艺藥药藪薮藴蕴藶苈藹蔼藺蔺蘀萚蘄蕲蘆芦蘇苏蘊蕴蘋苹蘚藓蘞蔹蘢茏蘭兰蘺蓠蘿萝虆蔂處处虛虚虜虏號号虧亏虯虬蛺蛱蛻蜕蜆蚬蝕蚀蝟猬蝦虾蝨虱蝸蜗螄蛳螞蚂螢萤螻蝼螿螀蟄蛰蟈蝈蟎螨蟣虮蟬蝉蟯蛲蟲虫蟶蛏蟻蚁蠁蚃蠅蝇蠆虿蠍蝎蠐蛴蠑蝾蠔蚝蠟蜡蠣蛎蠨蟏蠱蛊蠶蚕蠻蛮衆众衊蔑術术衕同衚胡衛卫衝冲袞衮袷夹裊袅裏里補补裝装裡里製制複复褌裈褘袆褲裤褳裢褸褛褻亵襇裥襉裥襏袯襖袄襝裣襠裆襤褴襪袜襬摆襯衬襲袭襴襕覈核見见覎觃規规覓觅視视覘觇覡觋覥觍覦觎親亲覬觊覯觏覲觐覷觑覺觉覽览覿觌觀观觴觞觶觯觸触訁讠訂订訃讣計计訊讯訌讧討讨訐讦訒讱訓训訕讪訖讫託托記记訛讹訝讶訟讼訣诀訥讷訩讻訪访設设許许訴诉訶诃診诊註注証证詁诂詆诋詎讵詐诈詒诒詔诏評评詖诐詗诇詘诎詛诅詞词詠咏詡诩詢询詣诣試试詩诗詫诧詬诟詭诡詮诠詰诘話话該该詳详詵诜詼诙詿诖誄诔誅诛誆诓誇夸誌志認认誑诳誒诶誕诞誘诱誚诮語语誠诚誡诫誣诬誤误誥诰誦诵誨诲說说説说誰谁課课誶谇誹诽誼谊誾訚調调諂谄諄谆談谈諉诿請请諍诤諏诹諑诼諒谅論论諗谂諛谀諜谍諝谞諞谝諡谥諢诨諤谔諦谛諧谐諫谏諭谕諮咨諱讳諳谙諶谌諷讽諸诸諺谚諼谖諾诺謀谋謁谒謂谓謄誊謅诌謊谎謎谜謐谧謔谑謖谡謗谤謙谦謚谥講讲謝谢謠谣謡谣謨谟謫谪謬谬謭谫謳讴謹谨謾谩譁哗證证譎谲譏讥譖谮識识譙谯譚谭譜谱譟噪譫谵譭毁譯译議议譴谴護护譸诪譽誉譾谫讀读讅谉變变讋詟讎雠讒谗讓让讕谰讖谶讚赞讜谠讞谳谿溪豈岂豎竖豐丰豔艳豬猪豶豮貍狸貓猫貝贝貞贞貟贠負负財财貢贡貧贫貨货販贩貪贪貫贯責责貯贮貰贳貲赀貳贰貴贵貶贬買买貸贷貺贶費费貼贴貽贻貿贸賀贺賁贲賂赂賃赁賄贿賅赅資资賈贾賊贼賑赈賒赊賓宾賕赇賙赒賚赉賜赐賞赏賠赔賡赓賢贤賣卖賤贱賦赋賧赕質质賫赍賬账賭赌賴赖賵赗賺赚賻赙購购賽赛賾赜贄贽贅赘贇赟贈赠贊赞贋赝贍赡贏赢贐赆贓赃贔赑贖赎贗赝贛赣贜赃赬赪趕赶趙赵趨趋趲趱跡迹踐践踰逾踴踊蹌跄蹕跸蹟迹蹠跖蹣蹒蹤踪蹺跷躂跶躉趸躊踌躋跻躍跃躑踯躒跞躓踬躕蹰躚跹躡蹑躥蹿躦躜躪躏軀躯車车軋轧軌轨軍军軑轪軒轩軔轫軛轭軟软軤轷軫轸軲轱軸轴軹轵軺轺軻轲軼轶軾轼較较輅辂輇辁輈辀載载輊轾輒辄輓挽輔辅輕轻輛辆輜辎輝辉輞辋輟辍輥辊輦辇輩辈輪轮輬辌輯辑輳辏輸输輻辐輼辒輾辗輿舆轀辒轂毂轄辖轅辕轆辘轉转轍辙轎轿轔辚轟轰轡辔轢轹轤轳辦办辭辞辮辫辯辩農农迴回逕径這这連连週周進进遊游運运過过達达違违遙遥遜逊遞递遠远遡溯適适遲迟遶绕遷迁選选遺遗遼辽邁迈還还邇迩邊边邏逻邐逦郟郏郵邮鄆郓鄉乡鄒邹鄔邬鄖郧鄧邓鄭郑鄰邻鄲郸鄴邺鄶郐鄺邝酇酂酈郦醃腌醖酝醜丑醞酝醟蒏醣糖醫医醬酱醱酦釀酿釁衅釃酾釅酽釋释釐厘釒钅釓钆釔钇釕钌釗钊釘钉釙钋針针釣钓釤钐釦扣釧钏釩钒釵钗釷钍釹钕釺钎鈀钯鈁钫鈃钘鈄钭鈅钥鈈钚鈉钠鈍钝鈎钩鈐钤鈑钣鈒钑鈔钞鈕钮鈞钧鈡钟鈣钙鈥钬鈦钛鈧钪鈮铌鈰铈鈳钶鈴铃鈷钴鈸钹鈹铍鈺钰鈽钸鈾铀鈿钿鉀钾鉅巨鉆钻鉈铊鉉铉鉋铇鉍铋鉑铂鉕钷鉗钳鉚铆鉛铅鉞钺鉢钵鉤钩鉦钲鉬钼鉭钽鉳锫鉶铏鉸铰鉺铒鉻铬鉿铪銀银銃铳銅铜銍铚銑铣銓铨銖铢銘铭銚铫銛铦銜衔銠铑銣铷銥铱銦铟銨铵銩铥銪铕銫铯銬铐銱铞銳锐銷销銹锈銻锑銼锉鋁铝鋃锒鋅锌鋇钡鋌铤鋏铗鋒锋鋙铻鋝锊鋟锓鋣铘鋤锄鋥锃鋦锔鋨锇鋩铓鋪铺鋭锐鋮铖鋯锆鋰锂鋱铽鋶锍鋸锯鋼钢錁锞錄录錆锖錇锫錈锩錏铔錐锥錒锕錕锟錘锤錙锱錚铮錛锛錟锬錠锭錡锜錢钱錦锦錨锚錩锠錫锡錮锢錯错録录錳锰錶表錸铼錼镎鍀锝鍁锨鍃锪鍅钫鍆钔鍇锴鍈锳鍊炼鍋锅鍍镀鍔锷鍘铡鍚钖鍛锻鍠锽鍤锸鍥锲鍩锘鍬锹鍰锾鍵键鍶锶鍺锗鍼针鍾钟鎂镁鎄锿鎇镅鎊镑鎌镰鎔镕鎖锁鎘镉鎚锤鎛镈鎡镃鎢钨鎣蓥鎦镏鎧铠鎩铩鎪锼鎬镐鎭镇鎮镇鎰镒鎲镋鎳镍鎵镓鎶鿔鎸镌鎿镎鏃镞鏇旋鏈链鏌镆鏍镙鏐镠鏑镝鏗铿鏘锵鏜镗鏝镘鏞镛鏟铲鏡镜鏢镖鏤镂鏨錾鏰镚鏵铧鏷镤鏹镪鏽锈鐃铙鐋铴鐐镣鐒铹鐓镦鐔镡鐘钟鐙镫鐝镢鐠镨鐦锎鐧锏鐨镄鐫镌鐮镰鐲镯鐳镭鐵铁鐶镮鐸铎鐺铛鐿镱鑄铸鑊镬鑌镔鑑鉴鑒鉴鑔镲鑕锧鑞镴鑠铄鑣镳鑥镥鑭镧鑰钥鑱镵鑲镶鑷镊鑹镩鑼锣鑽钻鑾銮鑿凿钁镢钂镋長长門门閂闩閃闪閆闫閈闬閉闭開开閌闶閎闳閏闰閑闲閒闲間间閔闵閘闸閡阂閣阁閤合閥阀閨闺閩闽閫阃閬阆閭闾閱阅閲阅閶阊閹阉閻阎閼阏閽阍閾阈閿阌闃阒闆板闇暗闈闱闊阔闋阕闌阑闍阇闐阗闒阘闓闿闔阖闕阙闖闯關关闞阚闠阓闡阐闢辟闤阛闥闼陘陉陝陕陞升陣阵陰阴陳陈陸陆陽阳隉陧隊队階阶隕陨際际隨随險险隯陦隱隐隴陇隸隶隻只雋隽雖虽雙双雛雏雜杂雞鸡離离難难雲云電电霑沾霢霡霧雾霽霁靂雳靄霭靆叇靈灵靉叆靚靓靜静靝靔靦腼靨靥鞏巩鞝绱鞦秋鞽鞒韁缰韃鞑韆千韉鞯韋韦韌韧韍韨韓韩韙韪韜韬韝鞲韞韫韻韵響响頁页頂顶頃顷項项順顺頇顸須须頊顼頌颂頎颀頏颃預预頑顽頒颁頓顿頗颇領领頜颌頡颉頤颐頦颏頭头頮颒頰颊頲颋頴颕頷颔頸颈頹颓頻频頽颓顆颗題题額额顎颚顏颜顒颙顓颛顔颜願愿顙颡顛颠類类顢颟顥颢顧顾顫颤顬颥顯显顰颦顱颅顳颞顴颧風风颭飐颮飑颯飒颱台颳刮颶飓颸飔颺飏颻飖颼飕飀飗飄飘飆飙飈飚飛飞飠饣飢饥飣饤飥饦飩饨飪饪飫饫飭饬飯饭飱飧飲饮飴饴飼饲飽饱飾饰飿饳餃饺餄饸餅饼餈糍餉饷養养餌饵餎饹餏饻餑饽餒馁餓饿餕馂餖饾餘余餚肴餛馄餜馃餞饯餡馅館馆餬糊餱糇餳饧餵喂餶馉餷馇餺馎餼饩餾馏餿馊饁馌饃馍饅馒饈馐饉馑饊馓饋馈饌馔饑饥饒饶饗飨饜餍饞馋饢馕馬马馭驭馮冯馱驮馳驰馴驯馹驲駁驳駐驻駑驽駒驹駔驵駕驾駘骀駙驸駛驶駝驼駟驷駡骂駢骈駭骇駰骃駱骆駸骎駿骏騁骋騂骍騅骓騌骔騍骒騎骑騏骐騖骛騙骗騤骙騫骞騭骘騮骝騰腾騶驺騷骚騸骟騾骡驀蓦驁骜驂骖驃骠驄骢驅驱驊骅驌骕驍骁驏骣驕骄驗验驚惊驛驿驟骤驢驴驤骧驥骥驦骦驪骊驫骉骯肮髏髅髒脏體体髕髌髖髋髮发鬆松鬍胡鬚须鬢鬓鬥斗鬧闹鬨哄鬩阋鬮阄鬱郁鬹鬶魎魉魘魇魚鱼魛鱽魢鱾魨鲀魯鲁魴鲂魷鱿魺鲄鮁鲅鮃鲆鮊鲌鮋鲉鮍鲏鮎鲇鮐鲐鮑鲍鮒鲋鮓鲊鮚鲒鮜鲘鮝鲞鮞鲕鮦鲖鮪鲔鮫鲛鮭鲑鮮鲜鮳鲓鮶鲪鮺鲝鯀鲧鯁鲠鯇鲩鯉鲤鯊鲨鯒鲬鯔鲻鯕鲯鯖鲭鯗鲞鯛鲷鯝鲴鯡鲱鯢鲵鯤鲲鯧鲳鯨鲸鯪鲮鯫鲰鯰鲶鯴鲺鯷鳀鯽鲫鯿鳊鰁鳈鰂鲗鰃鳂鰈鲽鰉鳇鰍鳅鰏鲾鰐鳄鰒鳆鰓鳃鰛鳁鰜鳒鰟鳑鰠鳋鰣鲥鰥鳏鰨鳎鰩鳐鰭鳍鰮鳁鰱鲢鰲鳌鰳鳓鰵鳘鰷鲦鰹鲣鰺鲹鰻鳗鰼鳛鰾鳔鱂鳉鱅鳙鱈鳕鱉鳖鱒鳟鱔鳝鱖鳜鱗鳞鱘鲟鱝鲼鱟鲎鱠鲙鱣鳣鱤鳡鱧鳢鱨鲿鱭鲚鱯鳠鱷鳄鱸鲈鱺鲡鳥鸟鳧凫鳩鸠鳬凫鳲鸤鳳凤鳴鸣鳶鸢鴆鸩鴇鸨鴉鸦鴒鸰鴕鸵鴛鸳鴝鸲鴞鸮鴟鸱鴣鸪鴦鸯鴨鸭鴯鸸鴰鸹鴴鸻鴻鸿鴿鸽鵂鸺鵃鸼鵐鹀鵑鹃鵒鹆鵓鹁鵜鹈鵝鹅鵠鹄鵡鹉鵪鹌鵬鹏鵮鹐鵯鹎鵰雕鵲鹊鵷鹓鵾鹍鶇鸫鶉鹑鶊鹒鶓鹋鶖鹙鶘鹕鶚鹗鶡鹖鶥鹛鶩鹜鶬鸧鶯莺鶲鹟鶴鹤鶹鹠鶺鹡鶻鹘鶼鹣鶿鹚鷀鹚鷁鹢鷂鹞鷄鸡鷊鹝鷓鹧鷖鹥鷗鸥鷙鸷鷚鹨鷥鸶鷦鹪鷫鹔鷯鹩鷲鹫鷳鹇鷴鹇鷸鹬鷹鹰鷺鹭鷽鸴鸇鹯鸌鹱鸏鹲鸕鸬鸘鹴鸚鹦鸛鹳鸝鹂鸞鸾鹵卤鹹咸鹺鹾鹼碱鹽盐麗丽麥麦麩麸麪面麫面麯曲麴曲麵面麼么麽么黃黄黌黉點点黨党黲黪黴霉黶黡黷黩黽黾黿鼋鼂鼌鼉鼍鼕冬鼴鼹齊齐齋斋齎赍齏齑齒齿齔龀齕龁齗龂齙龅齜龇齟龃齠龆齡龄齣出齦龈齧啮齪龊齬龉齲龋齶腭齷龌龍龙龎厐龐庞龔龚龕龛龜龟鿓鿒";

  // src/match/normalize.ts
  var lc = (s) => (s || "").toString().trim().toLowerCase();
  function toHalfWidth(s) {
    return (s || "").toString().replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/\u3000/g, " ");
  }
  var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
  var stripInvisible = (s) => (s || "").toString().replace(INVISIBLE_RE, "");
  var SEP_RE = /[\s_.·・･﹒。,，、;；:：!！?？~～^*"'`|｜/\\()（）【】<>《》[\]—-]+/g;
  var getFuzzy = () => false;
  function configureFuzzy(fn) {
    getFuzzy = fn;
  }
  var getTrad = () => false;
  function configureTradNorm(fn) {
    getTrad = fn;
  }
  var t2sMap = null;
  var t2sRe = null;
  function buildT2S() {
    t2sMap = /* @__PURE__ */ new Map();
    let cls = "";
    for (let i = 0; i + 1 < T2S_PAIRS.length; i += 2) {
      t2sMap.set(T2S_PAIRS[i], T2S_PAIRS[i + 1]);
      cls += T2S_PAIRS[i];
    }
    t2sRe = new RegExp("[" + cls + "]", "g");
  }
  function toSimplified(s) {
    if (!t2sRe) buildT2S();
    return t2sRe.test(s) ? (t2sRe.lastIndex = 0, s.replace(t2sRe, (c) => t2sMap.get(c) || c)) : s;
  }
  var memoSrc;
  var memoFuzzy;
  var memoTrad;
  var memoOut = "";
  function normMatch(s) {
    const fuzzy = getFuzzy();
    const trad = getTrad();
    if (s === memoSrc && fuzzy === memoFuzzy && trad === memoTrad) return memoOut;
    let t = stripInvisible(toHalfWidth(s)).toLowerCase();
    if (trad) t = toSimplified(t);
    if (fuzzy) t = t.replace(SEP_RE, "");
    memoSrc = s;
    memoFuzzy = fuzzy;
    memoTrad = trad;
    memoOut = t;
    return t;
  }
  var MAX_REGEX_LEN = 1e3;
  function looksCatastrophic(src) {
    return /\((?:[^()]*[*+]|[^()]*\{\d+,\}?)[^()]*\)\s*(?:[*+]|\{\d+,\}?)/.test(src);
  }
  function regexRejectReason(body) {
    if (body.length > MAX_REGEX_LEN) return `模式体超过 ${MAX_REGEX_LEN} 字符`;
    if (looksCatastrophic(body)) return "疑似灾难性回溯（量词套在含无界量词的分组上，如 (a+)+），可能卡死页面";
    return null;
  }
  function ruleLines(lines) {
    if (!Array.isArray(lines)) return [];
    return lines.filter((x) => typeof x === "string");
  }
  function compileLines(lines) {
    const plainParts = [];
    const plainSrc = [];
    const plainNorm = [];
    const regexes = [];
    const regexSrc = [];
    for (const raw of ruleLines(lines)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^\/(.*)\/([a-z]*)$/);
      if (m) {
        if (regexRejectReason(m[1])) continue;
        try {
          const flags = (m[2] || "i").replace(/[gy]/g, "");
          regexes.push(new RegExp(m[1], flags.includes("i") ? flags : flags + "i"));
          regexSrc.push(line);
        } catch (e) {
        }
      } else {
        const w = normMatch(line);
        if (w) {
          plainParts.push(escapeRe(w));
          plainSrc.push(line);
          plainNorm.push(w);
        }
      }
    }
    let plain = null;
    if (plainParts.length) {
      try {
        plain = new RegExp(plainParts.join("|"), "i");
      } catch (e) {
      }
    }
    return { plain, regexes, empty: !plain && !regexes.length, plainSrc, plainNorm, regexSrc };
  }
  function textHit(text, matcher) {
    if (!text || !matcher) return false;
    if (matcher.plain && matcher.plain.test(normMatch(text))) return true;
    if (matcher.regexes.length) {
      let t = stripInvisible(text);
      if (getTrad()) t = toSimplified(t);
      for (const r of matcher.regexes) if (r.test(t)) return true;
    }
    return false;
  }
  function whichHit(text, matcher) {
    if (!text || !matcher) return null;
    if (matcher.plain) {
      const t = normMatch(text);
      for (let i = 0; i < matcher.plainNorm.length; i++) {
        if (t.includes(matcher.plainNorm[i])) return matcher.plainSrc[i];
      }
    }
    if (matcher.regexes.length) {
      const t = stripInvisible(text);
      for (let i = 0; i < matcher.regexes.length; i++) {
        if (matcher.regexes[i].test(t)) return matcher.regexSrc[i];
      }
    }
    return null;
  }
  function compileScopedKeywords(lines) {
    const buckets = { all: [], title: [], up: [], part: [] };
    for (const raw of ruleLines(lines)) {
      const line = raw.trim();
      if (!line) continue;
      const m = !line.startsWith("/") && line.match(/^(title|up|part)\s*:\s*(.+)$/i);
      if (m) buckets[m[1].toLowerCase()].push(m[2].trim());
      else buckets.all.push(line);
    }
    return {
      all: compileLines(buckets.all),
      title: compileLines(buckets.title),
      up: compileLines(buckets.up),
      part: compileLines(buckets.part)
    };
  }
  function kwHit(scoped, field, text) {
    if (!scoped || !text) return false;
    return textHit(text, scoped.all) || textHit(text, scoped[field]);
  }
  function kwWhich(scoped, field, text) {
    if (!scoped || !text) return null;
    return whichHit(text, scoped.all) || whichHit(text, scoped[field]);
  }
  function splitRuleInput(raw) {
    const out = [];
    for (const ln of String(raw || "").split("\n")) {
      const s = ln.trim();
      if (!s) continue;
      if (s[0] === "/") {
        out.push(s);
        continue;
      }
      for (const x of s.split(/[,，;；]/)) {
        const v = x.trim();
        if (v) out.push(v);
      }
    }
    return out;
  }

  // src/subscriptions/store.ts
  var cached = null;
  function invalidateSubStore() {
    cached = null;
  }
  function loadSubStore() {
    if (cached) return cached;
    try {
      cached = JSON.parse(GM_getValue(SUB_STORE_KEY, "") || "{}") || {};
    } catch (e) {
      cached = {};
    }
    return cached;
  }
  function saveSubStore(store) {
    cached = store;
    try {
      GM_setValue(SUB_STORE_KEY, JSON.stringify(store));
    } catch (e) {
    }
  }
  function collectSubRules() {
    const store = loadSubStore();
    const merged = {};
    for (const sub of CONFIG.subscriptions || []) {
      if (!sub || !sub.enabled || !sub.url) continue;
      const e = store[sub.url];
      if (!e || !e.ok || !e.rules) continue;
      for (const dim of SUB_DIMS) {
        const arr = e.rules[dim];
        if (Array.isArray(arr) && arr.length) (merged[dim] = merged[dim] || []).push(...arr);
      }
    }
    return merged;
  }
  if (typeof GM_addValueChangeListener === "function") {
    GM_addValueChangeListener(SUB_STORE_KEY, (_n, _o, _v, remote) => {
      if (remote) invalidateSubStore();
    });
  }

  // src/match/engine.ts
  configureFuzzy(() => CONFIG.fuzzyMatch);
  configureTradNorm(() => CONFIG.tradNorm);
  var SUB_DIM_SET = new Set(SUB_DIMS);
  var isSubDim = (f) => SUB_DIM_SET.has(f);
  function userAndSubLines(dim, sub) {
    const own = activeLines("block." + dim, CONFIG.block[dim]);
    return isSubDim(dim) ? own.concat(ruleLines(sub[dim])) : own;
  }
  function activeLines(path, lines) {
    const arr = ruleLines(lines);
    return CONFIG.disabled[path] ? arr.filter((l) => !isRuleDisabled(path, l)) : arr;
  }
  function compileDualTags(lines) {
    const out = [];
    for (const src of ruleLines(lines)) {
      const parts = src.split("+").map((s) => lc(s.trim())).filter(Boolean);
      if (parts.length >= 2) out.push({ src, parts });
    }
    return out;
  }
  function buildMatchers() {
    const lcSet = (arr) => new Set(ruleLines(arr).map((x) => lc(x)).filter(Boolean));
    const strSet = (arr) => new Set(ruleLines(arr));
    const sub = collectSubRules();
    const u = (dim) => userAndSubLines(dim, sub);
    const blockUidSet = strSet(u("uids"));
    const allowUidSet = strSet(activeLines("allow.uids", CONFIG.allow.uids));
    const blockTag = compileLines(u("tags"));
    const dualTags = compileDualTags(u("dualTags"));
    const upBio = compileLines(u("upBio"));
    return {
      blockKw: compileScopedKeywords(u("keywords")),
      blockPartition: compileLines(u("partitions")),
      allowKw: compileScopedKeywords(activeLines("allow.keywords", CONFIG.allow.keywords)),
      blockTag,
      dualTags,
      upBio,
      blockUidSet,
      blockBvidSet: new Set(u("bvids")),
      blockUpNameMap: new Map(ruleLines(u("upNames")).map((x) => [lc(x), x.trim()]).filter(([k]) => k)),
      allowUidSet,
      allowUpNameSet: lcSet(activeLines("allow.upNames", CONFIG.allow.upNames)),
      // 评论区维度（独立编译）
      cmtKw: compileLines(activeLines("comment.keywords", CONFIG.comment.keywords)),
      cmtUserKw: compileLines(activeLines("comment.userNameKeywords", CONFIG.comment.userNameKeywords)),
      cmtUserSet: lcSet(activeLines("comment.userNames", CONFIG.comment.userNames)),
      // 是否存在 UID 规则：决定扫描时要不要为缺 UID 的卡做昂贵的 innerHTML 兜底解析
      needUid: blockUidSet.size > 0 || allowUidSet.size > 0,
      // API 维度是否需要拉取（含订阅并入的规则）：标签 = 仅当有专门的「视频标签」规则；简介 = 有简介词。
      // 注意：普通关键词只匹配 标题/UP名/分区（本地、免联网），不再隐式触发每张卡的标签请求。
      tagActive: !blockTag.empty,
      upBioActive: !upBio.empty
    };
  }
  var M = buildMatchers();
  var ruleVersion = 0;
  function rebuildRules() {
    M = buildMatchers();
    ruleVersion++;
  }
  function isWhitelisted(info) {
    if (kwHit(M.allowKw, "title", info.title)) return true;
    if (info.up && kwHit(M.allowKw, "up", info.up)) return true;
    if (info.partition && kwHit(M.allowKw, "part", info.partition)) return true;
    if (info.up && M.allowUpNameSet.has(lc(info.up))) return true;
    if (info.uid && M.allowUidSet.has(info.uid)) return true;
    return false;
  }
  var SYNC_DIMS = [
    { match: (i) => CONFIG.hideAd && i.isAd ? "广告卡" : null },
    { match: (i) => CONFIG.hideLiveCard && i.isLive ? "直播卡" : null },
    {
      match: (i) => {
        const b = CONFIG.block;
        return b.minViews > 0 && i.views != null && i.views < b.minViews * 1e4 ? `播放<${b.minViews}万` : null;
      }
    },
    // 营销号/搬运号：高播放却极低赞（点赞率异常）。仅在拿得到点赞数(feed 层)时判定。
    {
      match: (i) => {
        const b = CONFIG.block;
        if (b.spamLikeRatio <= 0 || i.likes == null || !i.views) return null;
        if (i.views < b.spamMinViews * 1e4) return null;
        return i.likes / i.views * 100 < b.spamLikeRatio ? `营销号(赞率<${b.spamLikeRatio}%)` : null;
      }
    },
    // 关键词：标题 / UP名 / 分区任一命中即拦（标签维度在 matchApi 里补判）
    // 关键词命中要说清是**哪一条**词命中的——关键词是规则最多、最容易误伤的维度，
    // 只报「关键词」等于让用户去上百条规则里自己猜。判定仍走 kwHit 的合并正则（热路径不变），
    // 仅在确定命中后再 kwWhich 回查一次（每次拦截一次，不是每张卡一次）。
    {
      match: (i) => {
        const field = kwHit(M.blockKw, "title", i.title) ? "title" : i.up && kwHit(M.blockKw, "up", i.up) ? "up" : kwHit(M.blockKw, "part", i.partition) ? "part" : null;
        if (!field) return null;
        const text = field === "title" ? i.title : field === "up" ? i.up : i.partition;
        const rule = kwWhich(M.blockKw, field, text);
        return rule ? "关键词:" + rule : "关键词";
      }
    },
    { match: (i) => i.partition && textHit(i.partition, M.blockPartition) ? "分区:" + (whichHit(i.partition, M.blockPartition) || i.partition) : null },
    { match: (i) => i.up && M.blockUpNameMap.has(lc(i.up)) ? "UP主:" + M.blockUpNameMap.get(lc(i.up)) : null },
    { match: (i) => i.uid && M.blockUidSet.has(i.uid) ? "UID:" + i.uid : null },
    { match: (i) => i.bvid && M.blockBvidSet.has(i.bvid) ? "BV:" + i.bvid : null },
    {
      match: (i) => {
        const b = CONFIG.block;
        if (i.duration == null) return null;
        if (b.minDuration > 0 && i.duration < b.minDuration) return `时长<${b.minDuration}s`;
        if (b.maxDuration > 0 && i.duration > b.maxDuration) return `时长>${b.maxDuration}s`;
        return null;
      }
    }
  ];
  var API_DIMS = [
    {
      source: "tag",
      needs: "tag",
      active: () => M.tagActive,
      // 含订阅并入的「视频标签」维度
      match: (info, ctx) => {
        for (const t of ctx.tags) {
          if (!textHit(t, M.blockTag)) continue;
          return "标签:" + (whichHit(t, M.blockTag) || t);
        }
        return null;
      }
    },
    {
      source: "tag",
      needs: "tag",
      active: () => M.dualTags.length > 0,
      match: (info, ctx) => {
        for (const rule of M.dualTags) {
          if (rule.parts.every((p) => ctx.tags.some((t) => lc(t).includes(p)))) return "双标签:" + rule.src;
        }
        return null;
      }
    },
    {
      source: "view",
      needs: "view",
      active: () => CONFIG.hideCharging,
      match: (info, ctx) => CONFIG.hideCharging && ctx.view.is_upower_exclusive ? "充电专属" : null
    },
    {
      source: "card",
      needs: "card",
      active: () => M.upBioActive,
      // 含订阅并入的简介词
      match: (info, ctx) => {
        if (M.upBio.empty || !textHit(ctx.sign, M.upBio)) return null;
        const rule = whichHit(ctx.sign, M.upBio);
        return rule ? "UP简介:" + rule : "UP简介";
      }
    }
  ];
  var REASON_RULE_FIELD = {
    关键词: "keywords",
    分区: "partitions",
    UP主: "upNames",
    UID: "uids",
    BV: "bvids",
    标签: "tags",
    双标签: "dualTags",
    UP简介: "upBio"
  };
  var locIndex = null;
  var locIndexVer = -1;
  function buildLocIndex() {
    const idx = /* @__PURE__ */ new Map();
    for (const dim of Object.keys(REASON_RULE_FIELD)) {
      const field = REASON_RULE_FIELD[dim];
      for (const line of ruleLines(CONFIG.block[field])) {
        const t = line.trim();
        if (!t) continue;
        if (!idx.has(dim + ":" + t)) idx.set(dim + ":" + t, { field, line });
        const m = !t.startsWith("/") && t.match(/^(?:title|up|part)\s*:\s*(.+)$/i);
        if (m) {
          const k = dim + ":" + m[1].trim();
          if (!idx.has(k)) idx.set(k, { field, line });
        }
      }
    }
    return idx;
  }
  function locateRule(reason) {
    const i = reason.indexOf(":");
    if (i <= 0) return null;
    if (!REASON_RULE_FIELD[reason.slice(0, i)]) return null;
    if (!locIndex || locIndexVer !== ruleVersion) {
      locIndex = buildLocIndex();
      locIndexVer = ruleVersion;
    }
    return locIndex.get(reason) || null;
  }
  var FIELD_REASON_DIM = {};
  for (const dim of Object.keys(REASON_RULE_FIELD)) FIELD_REASON_DIM[REASON_RULE_FIELD[dim]] = dim;
  var API_FIELDS = /* @__PURE__ */ new Set(["tags", "dualTags", "upBio"]);
  function ruleKeyOf(field, line) {
    const dim = FIELD_REASON_DIM[field];
    if (!dim) return null;
    if (field === "uids" || field === "bvids" || field === "dualTags") return line ? dim + ":" + line : null;
    let v = line.trim();
    if (!v) return null;
    if (field === "keywords") {
      const m = !v.startsWith("/") && v.match(/^(?:title|up|part)\s*:\s*(.+)$/i);
      if (m) v = m[1].trim();
      if (!v) return null;
    }
    return dim + ":" + v;
  }
  function enumerateRules() {
    const out = [];
    const sub = collectSubRules();
    const seen = /* @__PURE__ */ new Set();
    for (const field of Object.keys(REASON_RULE_FIELD).map((d) => REASON_RULE_FIELD[d])) {
      const dimOn = !API_FIELDS.has(field) || !!CONFIG.apiFilters;
      const path = "block." + field;
      const own = new Set(ruleLines(CONFIG.block[field]));
      for (const line of ruleLines(CONFIG.block[field]).concat(isSubDim(field) ? ruleLines(sub[field]) : [])) {
        const key = ruleKeyOf(field, line);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const isOwn = own.has(line);
        const disabled = isOwn && isRuleDisabled(path, line);
        out.push({ key, dim: FIELD_REASON_DIM[field], field, line, own: isOwn, active: dimOn && !disabled, disabled });
      }
    }
    return out;
  }
  function matchRule(info) {
    if (isWhitelisted(info)) return null;
    for (const d of SYNC_DIMS) {
      const r = d.match(info);
      if (r) return r;
    }
    return null;
  }
  function apiNeeds() {
    let needTag = false;
    let needView = false;
    let needCard = false;
    for (const d of API_DIMS) {
      if (!d.active()) continue;
      if (d.needs === "tag") needTag = true;
      else if (d.needs === "view") needView = true;
      else if (d.needs === "card") needCard = true;
    }
    if (needCard) needView = true;
    return { needTag, needView, needCard };
  }
  function apiRulesActive() {
    if (!CONFIG.apiFilters) return false;
    const n = apiNeeds();
    return n.needTag || n.needView || n.needCard;
  }
  function buildApiCtx(info, view, tags, cardData) {
    const ctx = { tags: tags || [], view: view || {} };
    if (cardData) {
      const c = cardData.card || cardData;
      ctx.sign = c.sign || "";
    }
    return ctx;
  }
  function matchApi(info, view, tags, cardData) {
    if (isWhitelisted(info)) return null;
    const ctx = buildApiCtx(info, view, tags, cardData);
    for (const d of API_DIMS) {
      if (d.source === "tag" && !(tags && tags.length)) continue;
      if (d.source === "view" && !view) continue;
      if (d.source === "card" && !cardData) continue;
      const r = d.match(info, ctx);
      if (r) return r;
    }
    return null;
  }

  // src/stats.ts
  var blockedLog = [];
  var sessionBlocked = 0;
  function setSessionBlocked(n) {
    sessionBlocked = n;
  }
  var reasonDim = (reason) => {
    const i = reason.indexOf(":");
    return i > 0 ? reason.slice(0, i) : reason;
  };
  function tallyLog() {
    const t = {};
    for (const b of blockedLog) {
      const d = reasonDim(b.reason);
      t[d] = (t[d] || 0) + 1;
    }
    return t;
  }
  function bumpRuleStat(reason) {
    if (reason.indexOf(":") <= 0) return;
    if (!CONFIG.ruleStatsSince) CONFIG.ruleStatsSince = Date.now();
    CONFIG.ruleStats[reason] = (CONFIG.ruleStats[reason] || 0) + 1;
  }
  function logBlocked(reason, info, src) {
    blockedLog.unshift({
      title: info && info.title || "",
      up: info && info.up || "",
      uid: info && info.uid || "",
      bvid: info && info.bvid || "",
      link: info && info.link || "",
      src: src || "DOM",
      reason,
      t: Date.now()
    });
    if (blockedLog.length > BLOCKED_LOG_MAX) blockedLog.pop();
  }
  var onRecorded = () => {
  };
  function setStatsListener(fn) {
    onRecorded = fn;
  }
  var notifyQueued = false;
  function notifyBatched() {
    if (notifyQueued) return;
    notifyQueued = true;
    Promise.resolve().then(() => {
      notifyQueued = false;
      try {
        onRecorded();
      } catch (e) {
      }
      scheduleStatsSave();
    });
  }
  function recordBlock(reason, info, src) {
    logBlocked(reason, info, src);
    bumpRuleStat(reason);
    sessionBlocked++;
    CONFIG.blockedCount++;
    notifyBatched();
    log(() => `拦截🚫 ${reason} ${info && info.up ? info.up + " · " : ""}${info && info.title || "(无标题)"}`);
  }

  // src/net.ts
  var FEED_HOOKS = [
    { re: /\/x\/web-interface\/wbi\/index\/top\/feed\/rcmd/, get: (d) => d && Array.isArray(d.item) ? d.item : null },
    { re: /\/x\/web-interface\/index\/top\/feed\/rcmd/, get: (d) => d && Array.isArray(d.item) ? d.item : null },
    { re: /\/x\/web-interface\/ranking\/v2/, get: (d) => d && Array.isArray(d.list) ? d.list : null },
    { re: /\/x\/web-interface\/popular(\/|\?|$)/, get: (d) => d && Array.isArray(d.list) ? d.list : null },
    { re: /\/x\/web-interface\/archive\/related/, get: (d) => Array.isArray(d) ? d : null },
    // 搜索页：type=视频 时 data.result 直接是视频数组；综合(all/v2) 时 data.result 是分组，取 result_type==='video' 的 data
    {
      re: /\/x\/web-interface\/wbi\/search\/(type|all\/v2)/,
      get: (d) => {
        if (!d || !Array.isArray(d.result)) return null;
        if (d.result.length && d.result[0] && d.result[0].result_type) {
          const g = d.result.find((x) => x.result_type === "video");
          return g && Array.isArray(g.data) ? g.data : null;
        }
        return d.result;
      }
    },
    // 动态流（t.bilibili.com）。此前这是唯一一个完全靠 DOM 兜底的主要页面——DOM 层只能在卡片
    // 画出来之后再隐藏，且抠不到 UID 这类权威字段。接到拦截层后与首页同源同判。
    // 只删 data.items 里的项，不动 offset/has_more：分页游标由 B 站维护，改它会打乱后续加载。
    { re: /\/x\/polymer\/web-dynamic\/v1\/feed\/(all|space)/, get: (d) => d && Array.isArray(d.items) ? d.items : null, norm: normDynamicItem }
  ];
  var memoUrl = null;
  var memoHook = null;
  function findFeedHook(url) {
    if (!url) return null;
    if (url === memoUrl) return memoHook;
    let hit = null;
    for (const h of FEED_HOOKS) {
      if (h.re.test(url)) {
        hit = h;
        break;
      }
    }
    memoUrl = url;
    memoHook = hit;
    return hit;
  }
  var isFeedUrl = (url) => !!findFeedHook(url);
  function filterFeedJson(url, json) {
    if (!json || json.code !== 0 || !json.data) return 0;
    const hook = findFeedHook(url);
    if (!hook) return 0;
    const arr = hook.get(json.data);
    if (!arr || !arr.length) return 0;
    health.feedParsed++;
    health.feedItems += arr.length;
    if (!CONFIG.enabled || CONFIG.reviewMode) return 0;
    let removed = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      try {
        const info = (hook.norm || normFeedItem)(arr[i]);
        if (!info) continue;
        const reason = matchRule(info);
        if (reason) {
          recordBlock(reason, info, "NET");
          arr.splice(i, 1);
          removed++;
        }
      } catch (e) {
        log("拦截层 单项判定异常（已跳过）", e);
      }
    }
    if (removed) log(`拦截层 删除 ${removed} 项 @ ${url.split("?")[0]}`);
    return removed;
  }
  var SIGNED_RE = /[?&]w_rid=/;
  var NET = /* @__PURE__ */ (() => {
    const preFns = [];
    const postFns = [];
    return {
      addPre: (fn) => preFns.push(fn),
      addPost: (fn) => postFns.push(fn),
      hasPre: () => preFns.length > 0,
      rewriteUrl(url) {
        let u = url;
        for (const fn of preFns) {
          try {
            const r = fn(u);
            if (typeof r === "string" && r) u = r;
          } catch (e) {
            logErr("NET.pre", e);
          }
        }
        if (u !== url && SIGNED_RE.test(url)) {
          health.signedSkipped++;
          return url;
        }
        return u;
      },
      runJson(url, json) {
        let removed = 0;
        for (const fn of postFns) {
          try {
            removed += fn(url, json) || 0;
          } catch (e) {
            logErr("NET.post", e);
          }
        }
        return removed;
      }
    };
  })();
  function rewriteRequestUrl(url) {
    return NET.hasPre() ? NET.rewriteUrl(url) : url;
  }
  var RCMD_RE = /\/x\/web-interface\/(wbi\/)?index\/top\/feed\/rcmd/;
  NET.addPost(filterFeedJson);
  NET.addPre((url) => {
    if (!CONFIG.boostFeedLoad) return;
    if (RCMD_RE.test(url) && /[?&]ps=\d+/.test(url)) {
      return url.replace(/([?&]ps=)\d+/, "$130");
    }
  });
  function computeFilteredText(url, raw) {
    try {
      const json = JSON.parse(raw);
      return NET.runJson(url, json) ? JSON.stringify(json) : raw;
    } catch (e) {
      return raw;
    }
  }
  function installNetworkHooks() {
    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const RespCtor = W.Response || Response;
    if (typeof W.fetch === "function" && !W.fetch.__bfb) {
      const origFetch = W.fetch;
      const wrapped = function(input, init) {
        let input2 = input;
        if (typeof input === "string") input2 = rewriteRequestUrl(input);
        const url = typeof input2 === "string" ? input2 : input2 && input2.url || "";
        const p = origFetch.call(this, input2, init);
        health.noteRequest(url);
        if (!isFeedUrl(url)) return p;
        health.feedMatched++;
        return p.then(
          (resp) => resp.clone().json().then((json) => {
            if (!NET.runJson(url, json)) return resp;
            const h = new Headers(resp.headers);
            h.delete("content-encoding");
            h.delete("content-length");
            return new RespCtor(JSON.stringify(json), { status: resp.status, statusText: resp.statusText, headers: h });
          }).catch(() => resp)
        );
      };
      wrapped.__bfb = true;
      try {
        W.fetch = wrapped;
      } catch (e) {
        logErr("installNetworkHooks.fetch", e);
      }
    }
    const XHR = W.XMLHttpRequest;
    if (XHR && XHR.prototype && !XHR.prototype.__bfb) {
      const origOpen = XHR.prototype.open;
      const dText = Object.getOwnPropertyDescriptor(XHR.prototype, "responseText");
      const dResp = Object.getOwnPropertyDescriptor(XHR.prototype, "response");
      XHR.prototype.open = function(method, url, async = true, user, password) {
        const self = this;
        if (self.__bfbHooked) {
          delete self.responseText;
          delete self.response;
          self.__bfbHooked = false;
        }
        self.__bfbText = void 0;
        self.__bfbResp = void 0;
        const url2 = typeof url === "string" ? rewriteRequestUrl(url) : url;
        health.noteRequest(url2);
        if (isFeedUrl(url2)) {
          health.feedMatched++;
          const filteredText = (getRaw) => {
            if (self.__bfbText === void 0) self.__bfbText = computeFilteredText(url2, getRaw());
            return self.__bfbText;
          };
          if (dText && dText.get) {
            Object.defineProperty(self, "responseText", {
              configurable: true,
              get() {
                if (self.readyState !== 4) return dText.get.call(self);
                return filteredText(() => dText.get.call(self));
              }
            });
            self.__bfbHooked = true;
          }
          if (dResp && dResp.get) {
            Object.defineProperty(self, "response", {
              configurable: true,
              get() {
                if (self.readyState !== 4) return dResp.get.call(self);
                const rt = self.responseType;
                if (rt === "json") {
                  if (self.__bfbResp === void 0) {
                    const orig = dResp.get.call(self);
                    try {
                      if (orig && typeof orig === "object") NET.runJson(url2, orig);
                      self.__bfbResp = orig;
                    } catch (e) {
                      self.__bfbResp = orig;
                    }
                  }
                  return self.__bfbResp;
                }
                if (rt === "" || rt === "text") {
                  const orig = dResp.get.call(self);
                  return typeof orig === "string" ? filteredText(() => orig) : orig;
                }
                return dResp.get.call(self);
              }
            });
            self.__bfbHooked = true;
          }
        }
        return origOpen.call(this, method, url2, async, user, password);
      };
      XHR.prototype.__bfb = true;
    }
  }

  // src/shadow.ts
  var shadowRoots = /* @__PURE__ */ new Set();
  var commentRoots = /* @__PURE__ */ new Set();
  var onRoot = () => {
  };
  function setShadowRootHandler(fn) {
    onRoot = fn;
    for (const r of shadowRoots) fn(r);
  }
  function addShadowRoot(root) {
    if (!root || shadowRoots.has(root)) return;
    shadowRoots.add(root);
    if (root.host && isCommentTag(root.host.tagName)) commentRoots.add(root);
    onRoot(root);
  }
  function pruneShadowRoots() {
    for (const r of shadowRoots) {
      if (r.host && r.host.isConnected) continue;
      shadowRoots.delete(r);
      commentRoots.delete(r);
    }
  }
  function harvestShadowRoots(root) {
    if (!root || !root.querySelectorAll) return;
    try {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot && el.id !== "bfb-overlay-host") addShadowRoot(el.shadowRoot);
      }
    } catch (e) {
    }
  }

  // src/ui/hooks.ts
  var _refreshPanelIfOpen = () => {
  };
  var _openPanel = () => {
  };
  function setPanelHooks(h) {
    if (h.refreshPanelIfOpen) _refreshPanelIfOpen = h.refreshPanelIfOpen;
    if (h.openPanel) _openPanel = h.openPanel;
  }
  function refreshPanelIfOpen() {
    _refreshPanelIfOpen();
  }
  function openPanel() {
    _openPanel();
  }

  // src/ui/toast.ts
  function updateBadge() {
    let b = document.getElementById("bfb-badge");
    if (!b) {
      b = document.createElement("div");
      b.id = "bfb-badge";
      b.title = "点击打开设置";
      b.onclick = openPanel;
      document.body.appendChild(b);
    }
    b.classList.toggle("off", !CONFIG.enabled);
    const degraded = CONFIG.enabled && healthDegraded();
    b.classList.toggle("warn", degraded);
    b.title = degraded ? "⚠ 拦截可能已失效，点开看「工具 → 🩺 运行自检」" : "点击打开设置";
    b.textContent = CONFIG.enabled ? `${degraded ? "⚠" : "🛡"} 已拦截 ${sessionBlocked}（共${CONFIG.blockedCount}）` : "🛡 已暂停";
  }
  function toastContainer() {
    let c = document.getElementById("bfb-toasts");
    if (!c) {
      c = document.createElement("div");
      c.id = "bfb-toasts";
      document.body.appendChild(c);
    }
    return c;
  }
  var PLAIN_MS = 4e3;
  var ACTION_MS = 6e3;
  var dismissArmed = false;
  function armDismissOnOutsideClick() {
    if (dismissArmed) return;
    dismissArmed = true;
    const onDown = (e) => {
      const c = document.getElementById("bfb-toasts");
      if (!c) return;
      if (e.target instanceof Node && c.contains(e.target)) return;
      c.innerHTML = "";
    };
    document.addEventListener("mousedown", onDown, true);
  }
  function toast(msg, kind = "info", action, ms) {
    const t = document.createElement("div");
    t.className = "bfb-toast" + (kind !== "info" ? " " + kind : "");
    t.title = "点击关闭";
    const span = document.createElement("span");
    span.className = "bfb-toast-msg";
    span.textContent = msg;
    t.appendChild(span);
    const timeout = ms ?? (action ? ACTION_MS : PLAIN_MS);
    const timer = setTimeout(() => t.remove(), timeout);
    const close = () => {
      clearTimeout(timer);
      t.remove();
    };
    t.onclick = close;
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bfb-toast-act";
      b.textContent = action.label;
      b.onclick = (e) => {
        e.stopPropagation();
        close();
        action.onClick();
      };
      t.appendChild(b);
    }
    toastContainer().appendChild(t);
    armDismissOnOutsideClick();
  }

  // src/gm.ts
  function gmRequest(opts) {
    if (typeof GM_xmlhttpRequest !== "function") return false;
    GM_xmlhttpRequest(opts);
    return true;
  }

  // src/events.ts
  var handler = () => {
  };
  function setRulesChangedHandler(fn) {
    handler = fn;
  }
  function emitRulesChanged() {
    handler();
  }

  // src/subscriptions/refresh.ts
  function metaGet(meta, key) {
    if (!meta) return void 0;
    if (meta[key] != null) return meta[key];
    const lk = key.toLowerCase();
    for (const k in meta) if (k.toLowerCase() === lk) return meta[k];
    return void 0;
  }
  function cmpVer(a, b) {
    const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  var DAY_MS = 24 * 36e5;
  function parseExpires(s) {
    const m = String(s ?? "").trim().match(/^(\d+)\s*([hd])?/i);
    if (!m) return DAY_MS;
    const n = Math.max(1, parseInt(m[1], 10) || 1);
    return n * ((m[2] || "d").toLowerCase() === "h" ? 36e5 : DAY_MS);
  }
  var SUB_MAX_LEN = 2 * 1024 * 1024;
  function fetchSubText(url, cb) {
    const sent = gmRequest({
      method: "GET",
      url,
      timeout: 15e3,
      onload: (r) => {
        if (!(r.status >= 200 && r.status < 300) || !r.responseText) return cb(null, "HTTP " + r.status);
        if (r.responseText.length > SUB_MAX_LEN) return cb(null, "订阅内容过大（>2MB）");
        cb(r.responseText, null);
      },
      onerror: () => cb(null, "网络错误"),
      ontimeout: () => cb(null, "超时")
    });
    if (!sent) cb(null, "无 GM_xmlhttpRequest");
  }
  function syncSubscription(url, cb) {
    fetchSubText(url, (text, err) => {
      const store = loadSubStore();
      const finish = (patch, ok) => {
        const prev = store[url] || {};
        if (ok) {
          store[url] = patch;
        } else if (prev.ok && prev.rules) {
          store[url] = Object.assign(prev, { error: patch.error, lastError: Date.now() });
        } else {
          store[url] = Object.assign(prev, patch);
        }
        saveSubStore(store);
        cb?.(ok);
      };
      if (err || !text) return finish({ lastSync: Date.now(), ok: false, error: err || "空内容" }, false);
      try {
        const { meta, rules } = parseSubscription(text);
        const count = SUB_DIMS.reduce((n, d) => n + (rules[d] && rules[d].length || 0), 0);
        finish({ meta, rules, lastSync: Date.now(), ok: true, count, error: null }, true);
        const minV = metaGet(meta, "minScriptVersion");
        if (minV && cmpVer(VERSION, minV) < 0) toast(`订阅「${metaGet(meta, "title") || url}」建议脚本升级到 ≥ ${minV}（部分规则可能未识别）`);
      } catch (e) {
        finish({ lastSync: Date.now(), ok: false, error: "解析失败" }, false);
      }
    });
  }
  function refreshSubscriptions(force, done) {
    const store = loadSubStore();
    const urls = new Set((CONFIG.subscriptions || []).map((s) => s && s.url).filter(Boolean));
    let pruned = false;
    for (const k of Object.keys(store)) {
      if (!urls.has(k)) {
        delete store[k];
        pruned = true;
      }
    }
    if (pruned) saveSubStore(store);
    const due = (CONFIG.subscriptions || []).filter((s) => {
      if (!s || !s.enabled || !s.url) return false;
      if (force) return true;
      const e = store[s.url];
      if (!e || !e.ok) return true;
      return Date.now() - (e.lastSync || 0) >= parseExpires(metaGet(e.meta, "expires"));
    });
    if (!due.length) return done?.(0);
    let pending = due.length;
    let changed = 0;
    due.forEach(
      (s) => syncSubscription(s.url, (ok) => {
        if (ok) changed++;
        if (--pending === 0) {
          if (changed) emitRulesChanged();
          done?.(changed);
        }
      })
    );
  }

  // src/comments.ts
  function hostOf(root) {
    return root.host;
  }
  function asCommentHost(el) {
    return el && el.tagName && isCommentTag(el.tagName) ? el : null;
  }
  function cmtCleanMsg(msg, isSub) {
    let s = (msg || "").toString();
    if (isSub) s = s.replace(/^回复\s?@[^@\s:：]+\s?[:：]/, "");
    return s.replace(/@[^@\s]+/g, " ").replace(/(\[[^[\]]+\])+/g, " ").trim();
  }
  var EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u200d\u{20E3}]/gu;
  function readCmt(host) {
    const d = host && host.__data || {};
    const member = d.member || {};
    const content = d.content || {};
    const lv = member.level_info && member.level_info.current_level;
    const vipStatus = member.vip && member.vip.vipStatus;
    return {
      uname: ((member.uname || "") + "").trim(),
      mid: d.mid,
      level: typeof lv === "number" ? lv : null,
      noface: (member.avatar || "").endsWith("noface.jpg") && (vipStatus === 0 || vipStatus == null),
      message: (content.message || "") + "",
      members: Array.isArray(content.members) ? content.members : [],
      isUpTop: !!(d.reply_control && d.reply_control.is_up_top),
      upMid: host ? host.__upMid : void 0,
      // B 站组件挂的视频 UP mid（可能缺，缺则 isUp 白名单不生效）
      me: host && host.__user ? host.__user.uname : void 0
      // 当前登录用户名（可能缺）
    };
  }
  function matchComment(c, isSub) {
    const cc = CONFIG.comment;
    if (cc.allowUp && c.upMid != null && c.mid != null && String(c.mid) === String(c.upMid)) return null;
    if (cc.allowPin && !isSub && c.isUpTop) return null;
    if (cc.allowMe && c.me && (c.uname === c.me || c.message.includes("@" + c.me))) return null;
    if (c.uname && M.cmtUserSet.has(lc(c.uname))) return "评论用户:" + c.uname;
    if (c.uname && textHit(c.uname, M.cmtUserKw)) return "评论昵称词";
    const clean = cmtCleanMsg(c.message, isSub);
    if (textHit(clean, M.cmtKw)) return "评论关键词";
    if (cc.minLevel > 0 && c.level != null && c.level < cc.minLevel) return `评论等级<${cc.minLevel}`;
    if (cc.hideNoFace && c.noface) return "默认头像非会员";
    if (cc.hideBot && c.uname && COMMENT_BOTS.has(c.uname)) return "AI机器人";
    if (cc.hideCallBot && c.members.some((m) => !!(m && m.uname && COMMENT_BOTS.has(m.uname)))) return "召唤AI";
    if (cc.hideAd && COMMENT_AD_RE.test(c.message)) return "带货评论";
    if (cc.hideCallOnly && c.message.replace(/@[^@\s]+/g, " ").trim() === "") return "纯@评论";
    if (cc.hideEmojiOnly && clean.replace(EMOJI_RE, "").trim() === "") return "纯表情评论";
    return null;
  }
  function renderPlaceholder(ph, host, reason) {
    const expanded = !!host.__bfbCmtExpanded;
    const txt = ph.querySelector(".bfb-ph-txt");
    const act = ph.querySelector(".bfb-ph-act");
    if (txt) txt.textContent = (expanded ? "已展开 · 命中：" : "已折叠 · 命中：") + reason;
    if (act) act.textContent = expanded ? "点击收起 ▴" : "点击展开 ▾";
    ph.style.opacity = expanded ? ".6" : "";
    if (expanded) host.style.removeProperty("display");
    else host.style.setProperty("display", "none", "important");
  }
  function collapseComment(host, reason) {
    if (host.__bfbCmtPh && host.__bfbCmtPh.isConnected) {
      renderPlaceholder(host.__bfbCmtPh, host, reason);
      return;
    }
    const parent = host.parentNode;
    if (!parent) {
      host.style.setProperty("display", "none", "important");
      return;
    }
    const ph = document.createElement("div");
    ph.className = "bfb-cmt-ph";
    ph.style.cssText = "display:flex;align-items:center;gap:8px;margin:4px 0;padding:6px 10px;border-radius:8px;background:rgba(251,114,153,.08);border:1px dashed rgba(251,114,153,.45);font-size:12px;color:#9499a0;cursor:pointer;user-select:none;line-height:1.5";
    ph.innerHTML = '<span class="bfb-ph-txt" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><span class="bfb-ph-act" style="color:#fb7299;flex:none"></span>';
    ph.addEventListener("click", function() {
      host.__bfbCmtExpanded = !host.__bfbCmtExpanded;
      renderPlaceholder(ph, host, reason);
    });
    parent.insertBefore(ph, host);
    host.__bfbCmtPh = ph;
    renderPlaceholder(ph, host, reason);
  }
  function removeCmtPlaceholder(host) {
    if (host.__bfbCmtPh) {
      try {
        host.__bfbCmtPh.remove();
      } catch (e) {
      }
      host.__bfbCmtPh = null;
    }
  }
  var processComment = safe("processComment", function(host, isSub) {
    if (host.__bfbCmtV === ruleVersion) return;
    const c = readCmt(host);
    if (!c.uname && !c.message) return;
    host.__bfbCmtV = ruleVersion;
    const reason = matchComment(c, isSub);
    if (reason) {
      if (CONFIG.reviewMode) {
        removeCmtPlaceholder(host);
        host.style.setProperty("outline", "2px solid #fb7299", "important");
        host.title = "[biliHoyoFairy] 命中：" + reason;
        host.style.removeProperty("display");
      } else if (CONFIG.comment.collapse) {
        collapseComment(host, reason);
      } else if (host.__bfbCmtExpanded) {
        removeCmtPlaceholder(host);
        host.style.removeProperty("display");
      } else {
        removeCmtPlaceholder(host);
        host.style.setProperty("display", "none", "important");
      }
      if (!host.__bfbCmtHit) {
        host.__bfbCmtHit = true;
        recordBlock(reason, { up: c.uname, title: cmtCleanMsg(c.message, isSub).slice(0, 40) }, "CMT");
      }
    } else {
      removeCmtPlaceholder(host);
      host.style.removeProperty("display");
      host.style.removeProperty("outline");
      host.removeAttribute("title");
      host.__bfbCmtHit = false;
      host.__bfbCmtExpanded = false;
    }
  });
  function revertComments() {
    for (const root of shadowRoots) {
      const host = hostOf(root);
      if (!host || !isCommentTag(host.tagName)) continue;
      if (host.__bfbCmtHit || host.__bfbCmtPh || host.style.display === "none" || host.style.outline) {
        removeCmtPlaceholder(host);
        host.style.removeProperty("display");
        host.style.removeProperty("outline");
        host.removeAttribute("title");
        host.__bfbCmtHit = false;
        host.__bfbCmtExpanded = false;
        host.__bfbCmtV = void 0;
      }
    }
  }
  var lastCmtDiag = "";
  function scanComments() {
    if (!CONFIG.enabled || !CONFIG.comment.enabled) {
      revertComments();
      return;
    }
    let cmtHosts = 0;
    for (const root of commentRoots) {
      const host = hostOf(root);
      if (!host || !host.isConnected) continue;
      const isSub = COMMENT_TAGS[host.tagName];
      if (isSub === void 0) continue;
      cmtHosts++;
      processComment(host, isSub);
    }
    if (CONFIG.debug) {
      const tags = {};
      for (const r of shadowRoots) {
        const h = r && r.host;
        if (h && h.tagName) tags[h.tagName] = (tags[h.tagName] || 0) + 1;
      }
      const sig = JSON.stringify(tags);
      if (sig !== lastCmtDiag) {
        lastCmtDiag = sig;
        log(`评论诊断｜shadowRoot 总数=${shadowRoots.size}｜评论宿主=${cmtHosts}｜各标签计数=`, tags);
      }
    }
  }
  var cmtTimer = null;
  function scheduleCommentScan() {
    if (!CONFIG.comment.enabled) return;
    if (cmtTimer) return;
    cmtTimer = setTimeout(() => {
      cmtTimer = null;
      scanComments();
    }, 300);
  }

  // src/hotsearch.ts
  function applyHotSearchStyle() {
    let st = document.getElementById("bfb-hotsearch-style");
    if (CONFIG.hideHotSearch) {
      if (!st) {
        st = document.createElement("style");
        st.id = "bfb-hotsearch-style";
        document.head.appendChild(st);
      }
      st.textContent = HOTSEARCH_SELECTORS.join(",") + "{display:none !important}";
    } else if (st) {
      st.remove();
    }
  }

  // src/api.ts
  var VIEW_CACHE_MAX = 800;
  var TAG_CACHE_MAX = 1200;
  var CARD_CACHE_MAX = 800;
  var riskGuard = {
    until: 0,
    strikes: 0,
    blocked() {
      return Date.now() < this.until;
    },
    remaining() {
      return Math.max(0, this.until - Date.now());
    },
    // 任何联网响应都喂进来：风控码→升级退避；正常码→冷却期过后清零。
    note(code) {
      if (code == null || !RISK_CODES.has(code)) {
        if (code === 0 && this.strikes && !this.blocked()) this.strikes = 0;
        return;
      }
      const wasBlocked = this.blocked();
      this.strikes = Math.min(this.strikes + 1, 6);
      const backoff = Math.min(6e4, 2e3 * 2 ** (this.strikes - 1));
      this.until = Date.now() + backoff;
      if (!wasBlocked) {
        logErr("风控熔断", `code ${code}，暂停联网 ${Math.round(backoff / 1e3)}s`);
        toast(`⚠️ 触发 B 站风控(code ${code})，已暂停联网 ${Math.round(backoff / 1e3)} 秒以保护账号`, "error");
      }
    }
  };
  var API = {
    view: /* @__PURE__ */ new Map(),
    tag: /* @__PURE__ */ new Map(),
    card: /* @__PURE__ */ new Map(),
    queue: [],
    active: 0,
    waiting: false,
    CONCURRENCY: 3,
    DELAY: 120
  };
  function apiPump() {
    if (riskGuard.blocked()) {
      if (!API.waiting) {
        API.waiting = true;
        setTimeout(() => {
          API.waiting = false;
          apiPump();
        }, riskGuard.remaining() + 50);
      }
      return;
    }
    while (API.active < API.CONCURRENCY && API.queue.length) {
      const task = API.queue.shift();
      API.active++;
      task(() => {
        setTimeout(() => {
          API.active--;
          apiPump();
        }, API.DELAY);
      });
    }
  }
  function apiEnqueue(task) {
    API.queue.push(task);
    apiPump();
  }
  function gmGet(url, cb) {
    const sent = gmRequest({
      method: "GET",
      url,
      withCredentials: true,
      timeout: 12e3,
      onload: (r) => {
        try {
          const j = JSON.parse(r.responseText);
          riskGuard.note(j && j.code);
          cb(j);
        } catch (e) {
          cb(null);
        }
      },
      onerror: () => cb(null),
      ontimeout: () => cb(null)
    });
    if (!sent) cb(null);
  }
  var RETRY_AFTER_MS = 3e4;
  var COOLDOWN_MAX = 2e3;
  var cooldown = /* @__PURE__ */ new Map();
  function inCooldown(k) {
    const until = cooldown.get(k);
    if (until === void 0) return false;
    if (Date.now() < until) return true;
    cooldown.delete(k);
    return false;
  }
  var inflight = /* @__PURE__ */ new Map();
  function cachedGet(cache, cap, ns, key, url, pick, cb) {
    if (!key) return cb(null);
    if (cache.has(key)) return cb(cache.get(key));
    if (inCooldown(ns + key)) return cb(null);
    const flightKey = ns + key;
    const waiting = inflight.get(flightKey);
    if (waiting) {
      waiting.push(cb);
      return;
    }
    inflight.set(flightKey, [cb]);
    const settle = (d) => {
      const cbs = inflight.get(flightKey) || [];
      inflight.delete(flightKey);
      for (const f of cbs) f(d);
    };
    apiEnqueue((done) => {
      gmGet(url, (j) => {
        const code = j && typeof j.code === "number" ? j.code : null;
        if (code === null || RISK_CODES.has(code)) {
          capMapSet(cooldown, ns + key, Date.now() + RETRY_AFTER_MS, COOLDOWN_MAX);
          settle(null);
        } else {
          const d = code === 0 ? pick(j) : null;
          capMapSet(cache, key, d, cap);
          settle(d);
        }
        done();
      });
    });
  }
  function fetchView(bvid, cb) {
    cachedGet(API.view, VIEW_CACHE_MAX, "v:", bvid, "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid), (j) => j.data, (d) => {
      if (d && d.owner && d.owner.mid && d.owner.name && CONFIG.uidNames[String(d.owner.mid)] === void 0) {
        setUidName(d.owner.mid, d.owner.name);
        scheduleStatsSave();
      }
      cb(d);
    });
  }
  function fetchTags(bvid, cb) {
    cachedGet(
      API.tag,
      TAG_CACHE_MAX,
      "t:",
      bvid,
      "https://api.bilibili.com/x/web-interface/view/detail/tag?bvid=" + encodeURIComponent(bvid),
      (j) => Array.isArray(j.data) ? j.data.map((x) => x.tag_name).filter(Boolean) : null,
      cb
    );
  }
  function fetchCard(mid, cb) {
    cachedGet(API.card, CARD_CACHE_MAX, "c:", mid, "https://api.bilibili.com/x/web-interface/card?mid=" + encodeURIComponent(mid), (j) => j.data, cb);
  }
  function cachedUid(bvid) {
    const d = bvid && API.view.get(bvid);
    return d && d.owner && d.owner.mid ? String(d.owner.mid) : "";
  }

  // src/rules.ts
  function addEntries(entries) {
    const byArr = /* @__PURE__ */ new Map();
    for (const e of entries) {
      const v = (e.value ? String(e.value) : "").trim();
      if (!v) continue;
      const list = byArr.get(e.arr);
      if (list) list.push(v);
      else byArr.set(e.arr, [v]);
    }
    let n = 0;
    for (const [arr, values] of byArr) n += pushUnique(arr, values);
    if (n) {
      saveConfig();
      emitRulesChanged();
    }
    return n;
  }
  function removeEntries(entries) {
    const byArr = /* @__PURE__ */ new Map();
    for (const e of entries) {
      let set = byArr.get(e.arr);
      if (!set) byArr.set(e.arr, set = /* @__PURE__ */ new Set());
      set.add(String(e.value));
    }
    let n = 0;
    for (const [arr, kill] of byArr) {
      let w = 0;
      for (let r = 0; r < arr.length; r++) {
        if (kill.has(String(arr[r]))) n++;
        else arr[w++] = arr[r];
      }
      arr.length = w;
    }
    if (n) {
      saveConfig();
      emitRulesChanged();
    }
    return n;
  }
  var addToList = (arr, value) => addEntries([{ arr, value }]) > 0;
  var removeFromList = (arr, value) => removeEntries([{ arr, value }]) > 0;
  function pushUnique(arr, values) {
    const seen = new Set(arr.map(String));
    let n = 0;
    for (const v of values) {
      const s = String(v);
      if (!seen.has(s)) {
        seen.add(s);
        arr.push(s);
        n++;
      }
    }
    return n;
  }
  function clearLists(...arrs) {
    let n = 0;
    for (const a of arrs) {
      n += a.length;
      a.length = 0;
    }
    if (n) {
      saveConfig();
      emitRulesChanged();
    }
    return n;
  }
  function restoreToList(arr, value, at) {
    const v = (value ? String(value) : "").trim();
    if (!v || arr.map(String).includes(v)) return;
    arr.splice(at >= 0 && at <= arr.length ? at : arr.length, 0, v);
    saveConfig();
    emitRulesChanged();
  }
  function toggleRuleDisabled(path, line) {
    const off = !isRuleDisabled(path, line);
    setRuleDisabled(path, line, off);
    saveConfig();
    emitRulesChanged();
    return off;
  }

  // src/dom.ts
  var countedEls = /* @__PURE__ */ new WeakSet();
  function clearVisual(card) {
    card.style.removeProperty("display");
    card.classList.remove("bfb-review");
    const t = card.querySelector(":scope > .bfb-tag");
    if (t) t.remove();
    card.removeAttribute(ATTR_BLOCKED);
    const cell = cellOf(card);
    if (cell !== card) cell.style.removeProperty("display");
  }
  function markCard(card, reason, info) {
    card.classList.add("bfb-review");
    if (card.querySelector(":scope > .bfb-tag")) return;
    const tag = document.createElement("div");
    tag.className = "bfb-tag";
    const rs = document.createElement("span");
    rs.className = "rs";
    rs.textContent = "已判定拦截 · " + reason;
    tag.appendChild(rs);
    if (info.up || info.uid || info.bvid) {
      const pass = document.createElement("button");
      pass.textContent = "✅放行";
      pass.title = "误伤了？把该 UP 加白名单，永不再拦";
      pass.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (info.uid) addToList(CONFIG.allow.uids, info.uid);
        else if (info.up) addToList(CONFIG.allow.upNames, info.up);
        else if (info.bvid) addToList(CONFIG.allow.keywords, info.title || info.bvid);
        toast("已放行：" + (info.up || info.title || info.bvid));
        refreshPanelIfOpen();
      };
      tag.appendChild(pass);
    }
    card.appendChild(tag);
  }
  var gutterFixed = /* @__PURE__ */ new WeakSet();
  function fixParityGutter(box) {
    if (!box || gutterFixed.has(box)) return;
    gutterFixed.add(box);
    try {
      const cs = getComputedStyle(box);
      if (!cs.display.includes("flex") || cs.flexWrap !== "wrap") return;
      if (cs.columnGap && cs.columnGap !== "normal" && parseFloat(cs.columnGap) > 0) return;
      let gutter = 0;
      let sawZero = false;
      for (const ch of Array.from(box.children)) {
        const m = parseFloat(getComputedStyle(ch).marginRight) || 0;
        if (m > 0) gutter = gutter || m;
        else sawZero = true;
        if (gutter && sawZero) break;
      }
      if (!gutter || !sawZero) return;
      box.style.columnGap = gutter + "px";
      box.classList.add("bfb-gutter-fix");
      log(() => `列间距改由容器提供（${gutter}px），避免隐藏后 nth-child 奇偶错位`);
    } catch (e) {
    }
  }
  function blockVideo(card, reason, info) {
    if (CONFIG.reviewMode) {
      markCard(card, reason, info);
    } else {
      const cell = cellOf(card);
      if (!isUnsafeHideTarget(cell)) cell.style.setProperty("display", "none", "important");
      card.style.setProperty("display", "none", "important");
      fixParityGutter(cell.parentElement);
    }
    card.setAttribute(ATTR_BLOCKED, "1");
    if (countedEls.has(card)) return;
    countedEls.add(card);
    recordBlock(reason, info, "DOM");
  }
  var processCard = safe("processCard", function(card) {
    if (!CONFIG.enabled) return;
    const info = extractCardInfo(card, M.needUid);
    if (!info.title && !info.up && !info.isLive) return;
    card.setAttribute(PROCESSED, "1");
    cacheCardInfo(card, info);
    const hit = matchRule(info);
    if (!hit) log(() => `放行✅ | 标题:${info.title || "(无)"} | UP:${info.up || "(无)"} | 标签:${info.partition || "(无)"}`);
    if (hit) {
      blockVideo(card, hit, info);
      return;
    }
    if (info.bvid && apiRulesActive()) evaluateApi(card, info);
  });
  function evaluateApi(card, info) {
    if (card.getAttribute(ATTR_API)) return;
    card.setAttribute(ATTR_API, "1");
    const need = apiNeeds();
    let view = null;
    let tags = null;
    let cardData = null;
    let pending = 1;
    const finish = () => {
      if (pending > 0) return;
      if (!CONFIG.enabled || isWhitelisted(info)) return;
      const hit = matchApi(info, view, tags, cardData);
      if (hit) blockVideo(card, hit, info);
      else log(`API放行 | ${info.title || ""}`);
    };
    const afterView = () => {
      if (need.needCard) {
        const mid = info.uid || view && view.owner && view.owner.mid;
        if (mid) {
          pending++;
          fetchCard(mid, (c) => {
            cardData = c;
            pending--;
            finish();
          });
        }
      }
      finish();
    };
    if (need.needView) {
      pending++;
      fetchView(info.bvid, (v) => {
        view = v;
        pending--;
        afterView();
      });
    }
    if (need.needTag) {
      pending++;
      fetchTags(info.bvid, (t) => {
        tags = t;
        pending--;
        finish();
      });
    }
    pending--;
    finish();
  }
  function queryAllRoots(selector) {
    const out = Array.from(document.querySelectorAll(selector));
    for (const r of shadowRoots) {
      if (!r.host || !r.host.isConnected) continue;
      try {
        const found = r.querySelectorAll(selector);
        if (found.length) out.push(...found);
      } catch (e) {
        logErr("queryAllRoots", e);
      }
    }
    return out;
  }
  function scanAll() {
    if (!CONFIG.enabled) return;
    const cards = timed("scan.query", () => queryAllRoots(UNPROCESSED_CARD_SELECTOR));
    if (cards.length > health.cardsSeen) health.cardsSeen = cards.length;
    timed(
      "scan.cards",
      () => cards.forEach((card) => {
        if (card.closest && card.closest(SWIPE_BANNER)) return;
        processCard(card);
      })
    );
  }
  function rescanAfterRuleChange() {
    timed("rules.rebuild", rebuildRules);
    queryAllRoots("[" + PROCESSED + "]").forEach((el) => {
      el.removeAttribute(PROCESSED);
      el.removeAttribute(ATTR_API);
      clearVisual(el);
    });
    scanAll();
    scanComments();
  }

  // src/scanner.ts
  var STEADY_THROTTLE_MS = 250;
  var PRUNE_ROOTS_MS = 3e4;
  function createScanScheduler(deps) {
    let firstPaint = true;
    let queued = false;
    const run = () => {
      queued = false;
      deps.scan();
    };
    const request = () => {
      if (queued) return;
      queued = true;
      if (firstPaint) deps.raf(run);
      else deps.timeout(run, STEADY_THROTTLE_MS);
    };
    return {
      request,
      toSteadyState() {
        if (!firstPaint) return;
        firstPaint = false;
      }
    };
  }
  var installed = false;
  function startScanner() {
    if (installed) return;
    installed = true;
    const scheduler = createScanScheduler({
      scan: scanAll,
      raf: (cb) => typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(cb, 0),
      timeout: (cb, ms) => setTimeout(cb, ms)
    });
    const observer = new MutationObserver(
      safe("observer", (muts) => {
        let touched = false;
        for (const m of muts) {
          if (!m.addedNodes || !m.addedNodes.length) continue;
          touched = true;
          for (const n of m.addedNodes) {
            const el = n;
            if (n.nodeType === 1 && el.shadowRoot && el.id !== "bfb-overlay-host") addShadowRoot(el.shadowRoot);
          }
        }
        if (!touched) return;
        scheduler.request();
      })
    );
    observer.observe(document, { childList: true, subtree: true });
    const cmtObserver = new MutationObserver(safe("cmtObserver", () => scheduleCommentScan()));
    setShadowRootHandler((root) => {
      const target = root.host && isCommentTag(root.host.tagName) ? cmtObserver : observer;
      try {
        target.observe(root, { childList: true, subtree: true });
      } catch (e) {
      }
    });
    setInterval(pruneShadowRoots, PRUNE_ROOTS_MS);
    scanAll();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => scheduler.toSteadyState(), { once: true });
    } else {
      scheduler.toSteadyState();
    }
  }

  // src/blacklist.ts
  function resolveUidByBvid(bvid, cb) {
    fetchView(bvid, (d) => {
      if (d && d.owner) cb(String(d.owner.mid), d.owner.name || "");
      else cb("", "");
    });
  }
  var REL_ERR = {
    "-101": "未登录或登录已过期",
    "-111": "CSRF 校验失败，请刷新页面重试",
    "-352": "触发 B 站风控，请稍后再试",
    22120: "该用户已在你的黑名单中"
  };
  var relErr = (code) => code == null ? "" : REL_ERR[String(code)] || "";
  function relationModify(uid, act, done) {
    const csrf = getCookie("bili_jct");
    if (!csrf) {
      done({ code: -101, msg: "", outcome: "noauth" });
      return;
    }
    gmRequest({
      method: "POST",
      url: "https://api.bilibili.com/x/relation/modify",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // gaia_source=web_main 贴合当前官方 web 端行为，降低被风控/失败概率
      data: `fid=${encodeURIComponent(uid)}&act=${act}&re_src=11&gaia_source=web_main&csrf=${encodeURIComponent(csrf)}`,
      withCredentials: true,
      onload: (res) => {
        let code = null;
        let msg = "";
        try {
          const j = JSON.parse(res.responseText);
          code = j.code;
          msg = j.message || "";
        } catch (e) {
        }
        riskGuard.note(code);
        done({ code, msg, outcome: "replied" });
      },
      onerror: () => done({ code: null, msg: "", outcome: "neterr" })
    });
  }
  function doBlacklist(uid, upName, cb, quiet) {
    const label = upName || uid;
    const addLocal = () => {
      if (upName) setUidName(uid, upName);
      if (quiet) pushUnique(CONFIG.block.uids, [String(uid)]);
      else addToList(CONFIG.block.uids, String(uid));
    };
    relationModify(uid, 5, ({ code, msg, outcome }) => {
      addLocal();
      const ok = code === 0 || code === 22120;
      if (ok) logBlocked("拉黑", { up: upName || CONFIG.uidNames && CONFIG.uidNames[String(uid)] || "", uid: String(uid) }, "BL");
      if (!quiet) {
        if (outcome === "noauth") toast(`未登录，已本地屏蔽「${label}」(未同步账号黑名单)`, "warn");
        else if (outcome === "neterr") toast(`网络错误，已本地屏蔽：${label}`, "error");
        else if (code === 0) toast(`已拉黑并同步账号黑名单：${label}（刷新后不再推荐）`, "success", { label: "撤销", onClick: () => unblockUp(String(uid), upName) });
        else if (code === 22120) toast(`「${label}」此前已在账号黑名单，已本地同步`, "success");
        else toast(`账号侧拉黑失败（${relErr(code) || msg || "code " + code}），已本地屏蔽：${label}`, "warn");
      }
      cb?.(ok, code);
    });
  }
  function unblockUp(uid, upName, cb) {
    const label = upName || uid;
    relationModify(uid, 6, ({ code, msg, outcome }) => {
      removeFromList(CONFIG.block.uids, String(uid));
      const ok = code === 0 && outcome === "replied";
      if (outcome === "noauth") toast(`已移出本地屏蔽：${label}（未登录，账号黑名单未变动）`, "warn");
      else if (outcome === "neterr") toast(`网络错误，已移出本地屏蔽：${label}`, "error");
      else toast(ok ? `已撤销拉黑：${label}（刷新后恢复推荐）` : `账号侧撤销失败（${relErr(code) || msg || "code " + code}），已移出本地屏蔽：${label}`, ok ? "success" : "warn");
      cb?.(ok, code);
    });
  }
  var BL_DELAY = 900;
  var BL_JITTER = 700;
  function doBlacklistMany(targets, cb, onProgress) {
    const list = [];
    const seen = /* @__PURE__ */ new Set();
    for (const t of targets) {
      const uid = String(t && t.uid || "");
      if (uid && !seen.has(uid)) {
        seen.add(uid);
        list.push({ uid, name: t && t.name || "" });
      }
    }
    let added = 0;
    let already = 0;
    let done = 0;
    let i = 0;
    const failed = [];
    let cancelled = false;
    let finished = false;
    let timer = null;
    const noCsrf = !getCookie("bili_jct");
    const snapshot = (paused) => ({
      done,
      added,
      already,
      ok: added + already,
      fail: failed.length,
      total: list.length,
      paused: !!paused,
      wait: paused ? Math.ceil(riskGuard.remaining() / 1e3) : 0,
      cancelled
    });
    const report = (paused) => onProgress?.(snapshot(paused));
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (CONFIG.debug && failed.length) {
        const byCode = {};
        failed.forEach((f) => byCode[String(f.code)] = (byCode[String(f.code)] || 0) + 1);
        log("批量拉黑失败按 code 分布：", byCode, failed);
      }
      if (list.length) {
        saveConfig();
        emitRulesChanged();
      }
      cb?.({ added, already, failed, total: list.length, done, cancelled });
    };
    const next = () => {
      if (cancelled || i >= list.length) return finish();
      if (riskGuard.blocked()) {
        report(true);
        timer = setTimeout(next, riskGuard.remaining() + 50);
        return;
      }
      timer = null;
      const t = list[i++];
      doBlacklist(
        t.uid,
        t.name,
        (s, code) => {
          done++;
          if (code === 0) added++;
          else if (code === 22120) already++;
          else failed.push({ uid: t.uid, code });
          report(false);
          if (cancelled) return finish();
          timer = setTimeout(next, noCsrf ? 0 : BL_DELAY + Math.random() * BL_JITTER);
        },
        true
      );
    };
    if (!list.length) finish();
    else next();
    return {
      cancel() {
        if (finished) return;
        cancelled = true;
        if (timer) finish();
      }
    };
  }
  function blacklistUp(info, cb, cardEl = null) {
    let uid = info && info.uid ? String(info.uid) : "";
    let upName = info && info.up || "";
    let bvid = info && info.bvid || "";
    if (cardEl) {
      const live = extractCardInfo(cardEl);
      uid = uid || live.uid;
      upName = upName || live.up;
      bvid = bvid || live.bvid;
    }
    if (CONFIG.blacklistCollab && bvid) {
      toast("正在读取联合投稿名单…");
      fetchView(bvid, (d) => {
        const targets = [];
        if (d && d.owner) targets.push({ uid: d.owner.mid, name: d.owner.name || "" });
        if (d && Array.isArray(d.staff)) d.staff.forEach((s) => targets.push({ uid: s.mid, name: s.name || "" }));
        if (!targets.length && uid) targets.push({ uid, name: upName });
        if (!targets.length) {
          if (upName) {
            addToList(CONFIG.block.upNames, upName);
            toast(`未能解析名单，已按 UP 名本地屏蔽：${upName}`);
          } else {
            toast("该卡片信息不足，无法拉黑");
          }
          cb?.(false);
          return;
        }
        doBlacklistMany(targets, (r) => {
          const ok = r.added + r.already;
          toast(targets.length > 1 ? `联合投稿：已拉黑 ${ok}/${r.total} 位作者${r.failed.length ? `（失败 ${r.failed.length}）` : ""}` : `已拉黑：${targets[0].name || targets[0].uid}`);
          cb?.(ok > 0);
        });
      });
      return;
    }
    if (uid) {
      doBlacklist(uid, upName, cb);
      return;
    }
    if (bvid) {
      toast("正在解析该 UP 的 UID…");
      resolveUidByBvid(bvid, (rid, rname) => {
        if (rid) {
          doBlacklist(rid, rname || upName, cb);
        } else if (upName) {
          addToList(CONFIG.block.upNames, upName);
          toast(`未能解析 UID，已按 UP 名本地屏蔽：${upName}`);
          cb?.(false);
        } else {
          toast("未能解析该 UP，已跳过");
          cb?.(false);
        }
      });
      return;
    }
    if (upName) {
      addToList(CONFIG.block.upNames, upName);
      toast(`该卡片没拿到 UID/BV，已按 UP 名本地屏蔽：${upName}`);
    } else {
      toast("该卡片信息不足，无法拉黑");
    }
    cb?.(false);
  }
  var BLACKS_PAGE_SIZE = 50;
  var BLACKS_DELAY = 400;
  var BLACKS_JITTER = 300;
  var BLACKS_RETRY_MAX = 4;
  var BLACKS_MAX_PAGES = 400;
  function importAccountBlacklist(cb, onProgress) {
    const uids = [];
    const names = {};
    let total = 0;
    let retries = 0;
    const finish = (truncated) => {
      const added = pushUnique(CONFIG.block.uids, uids);
      for (const uid of Object.keys(names)) setUidName(uid, names[uid]);
      if (added || Object.keys(names).length) {
        saveConfig();
        emitRulesChanged();
      }
      cb({ total, fetched: uids.length, added, truncated });
    };
    const page = (pn) => {
      if (pn > BLACKS_MAX_PAGES) return finish(true);
      if (riskGuard.blocked()) {
        onProgress?.(uids.length, total, true);
        setTimeout(() => page(pn), riskGuard.remaining() + 50);
        return;
      }
      const sent = gmRequest({
        method: "GET",
        url: `https://api.bilibili.com/x/relation/blacks?re_version=0&ps=${BLACKS_PAGE_SIZE}&pn=${pn}`,
        withCredentials: true,
        timeout: 12e3,
        onload: (r) => {
          let j = null;
          try {
            j = JSON.parse(r.responseText);
          } catch (e) {
          }
          const code = j && typeof j.code === "number" ? j.code : null;
          riskGuard.note(code);
          if (code !== null && RISK_CODES.has(code)) {
            if (++retries > BLACKS_RETRY_MAX) return finish(true);
            onProgress?.(uids.length, total, true);
            setTimeout(() => page(pn), riskGuard.remaining() + 50);
            return;
          }
          if (!j || code !== 0 || !j.data) return cb(null);
          retries = 0;
          const list = Array.isArray(j.data.list) ? j.data.list : [];
          total = typeof j.data.total === "number" ? j.data.total : total;
          for (const it of list) {
            if (!it || it.mid == null) continue;
            const uid = String(it.mid);
            uids.push(uid);
            if (it.uname) names[uid] = String(it.uname);
          }
          onProgress?.(uids.length, total, false);
          if (list.length >= BLACKS_PAGE_SIZE) setTimeout(() => page(pn + 1), BLACKS_DELAY + Math.random() * BLACKS_JITTER);
          else finish(false);
        },
        onerror: () => cb(null),
        ontimeout: () => cb(null)
      });
      if (!sent) cb(null);
    };
    page(1);
  }

  // src/ui/menu/locate.ts
  function elementOf(t) {
    return t instanceof Element ? t : null;
  }
  function findCard(e) {
    const path = e.composedPath && e.composedPath() || [];
    for (const node of path) {
      const el = elementOf(node);
      if (el && el.matches(VIDEO_CARD_SELECTOR)) return el;
    }
    const t = elementOf(e.target);
    return t ? t.closest(VIDEO_CARD_SELECTOR) : null;
  }
  function findVideoPageUp(e) {
    if (pageType() !== "播放页") return null;
    const path = e.composedPath && e.composedPath() || [];
    let link = null;
    for (const node of path) {
      const el = elementOf(node);
      if (!el) continue;
      if (isCommentTag(el.tagName) || el.matches(PAGE_HEADER_SELECTOR)) return null;
      if (!link && el.matches('a[href*="space.bilibili.com"]')) link = el;
    }
    if (!link) return null;
    const uid = ((link.getAttribute("href") || "").match(/space\.bilibili\.com\/(\d+)/) || [])[1] || "";
    if (!uid) return null;
    let up = (link.getAttribute("title") || link.textContent || "").trim();
    if (!up) {
      const box = link.closest(VIDEO_PAGE_UP_BOX);
      const nameEl = box && box.querySelector(VIDEO_PAGE_UP_NAME);
      up = (nameEl && (nameEl.getAttribute("title") || nameEl.textContent) || "").trim();
    }
    return { uid, up, bvid: (location.pathname.match(/(BV[0-9A-Za-z]+)/) || [])[1] || "" };
  }
  function findCommentHost(e) {
    const path = e.composedPath && e.composedPath() || [];
    for (const node of path) {
      const host = asCommentHost(elementOf(node));
      if (host) return host;
    }
    return null;
  }

  // src/ui/confirm.ts
  var current = null;
  function baseModal(opts, fill) {
    return new Promise((resolve) => {
      if (current) current.close();
      const back = document.createElement("div");
      back.className = "bfb-modal-back";
      const box = document.createElement("div");
      box.className = "bfb-modal" + (opts.danger ? " danger" : "");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      const title = document.createElement("div");
      title.className = "bfb-modal-title";
      title.textContent = opts.title || "确认操作";
      box.appendChild(title);
      let done = false;
      const ctl = { close: () => settle(null) };
      const settle = (v) => {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        back.remove();
        if (current === ctl) current = null;
        resolve(v);
      };
      let valueGetter = () => null;
      const submit = () => settle(valueGetter());
      const cancel = () => settle(null);
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }
      };
      const filled = fill(box, submit, cancel);
      valueGetter = filled.value;
      back.appendChild(box);
      (document.body || document.documentElement).appendChild(back);
      current = ctl;
      back.onclick = (e) => {
        if (e.target === back) cancel();
      };
      document.addEventListener("keydown", onKey, true);
      (filled.focus || box).focus();
    });
  }
  function mkBtns(opts, submit, cancel) {
    const btns = document.createElement("div");
    btns.className = "bfb-modal-btns";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "bfb-modal-btn ghost";
    cancelBtn.textContent = opts.cancelText || "取消";
    cancelBtn.onclick = cancel;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "bfb-modal-btn" + (opts.danger ? " danger" : "");
    ok.textContent = opts.okText || "确定";
    ok.onclick = submit;
    btns.append(cancelBtn, ok);
    return { btns, ok: opts.danger ? cancelBtn : ok };
  }
  function confirmModal(message, opts = {}) {
    return baseModal(opts, (box, submit, cancel) => {
      const msg = document.createElement("div");
      msg.className = "bfb-modal-msg";
      msg.textContent = message;
      box.appendChild(msg);
      const { btns, ok } = mkBtns(opts, submit, cancel);
      box.appendChild(btns);
      return { focus: ok, value: () => true };
    }).then((v) => v === true);
  }
  function promptModal(message, opts = {}) {
    return baseModal(opts, (box, submit, cancel) => {
      const msg = document.createElement("div");
      msg.className = "bfb-modal-msg";
      msg.textContent = message;
      box.appendChild(msg);
      const input = document.createElement("input");
      input.type = "text";
      input.className = "bfb-modal-input";
      if (opts.placeholder) input.placeholder = opts.placeholder;
      if (opts.value) input.value = opts.value;
      box.appendChild(input);
      const { btns } = mkBtns(opts, submit, cancel);
      box.appendChild(btns);
      return { focus: input, value: () => input.value };
    });
  }

  // src/ui/menu/shared.ts
  function confirmBlacklist(name) {
    return confirmModal(`确定拉黑「${name}」并写入账号黑名单？
刷新后不再推荐、不可一键撤销（未登录则仅本地屏蔽）。`, {
      title: "拉黑确认",
      okText: "拉黑",
      danger: true
    });
  }

  // src/ui/menu/context.ts
  function showVideoPageUpMenu(e) {
    const info = findVideoPageUp(e);
    if (!info) return;
    const label = info.up || "UID " + info.uid;
    e.preventDefault();
    e.stopPropagation();
    closeCtxMenu();
    const items = [];
    const sel = selectedText();
    if (sel) {
      items.push({
        label: `🚫 屏蔽含「${sel}」关键词`,
        act: () => {
          addToList(CONFIG.block.keywords, sel);
          toast(`已加入关键词：${sel}`);
          refreshPanelIfOpen();
        }
      });
    }
    items.push({
      label: `🚫 屏蔽 UP「${label}」`,
      act: () => {
        addToList(CONFIG.block.uids, info.uid);
        toast(`已屏蔽 UP：${label}（此后不再向你推荐其视频）`);
        refreshPanelIfOpen();
      }
    });
    items.push({
      label: `⛔ 拉黑 UP「${label}」（同步账号黑名单）`,
      act: () => {
        confirmBlacklist(label).then((ok) => {
          if (ok) blacklistUp(info, refreshPanelIfOpen);
        });
      }
    });
    items.push({
      label: `⭐ 加入白名单（永不屏蔽此 UP）`,
      act: () => {
        addToList(CONFIG.allow.uids, info.uid);
        toast(`已加入白名单：${label}`);
        refreshPanelIfOpen();
      }
    });
    if (info.bvid) {
      items.push({
        label: `🚫 屏蔽此视频（${info.bvid}）`,
        act: () => {
          addToList(CONFIG.block.bvids, info.bvid);
          toast(`已屏蔽视频：${info.bvid}`);
          refreshPanelIfOpen();
        }
      });
    }
    items.push({ label: "⚙️ 打开设置面板", act: openPanel });
    renderCtxMenu(e, items);
  }
  var ctxMenuEl = null;
  function closeCtxMenu() {
    if (ctxMenuEl) {
      ctxMenuEl.remove();
      ctxMenuEl = null;
    }
  }
  function selectedText() {
    const s = window.getSelection && window.getSelection();
    const t = s && s.toString().trim() || "";
    return t.length <= 30 ? t : "";
  }
  function onContextMenu(e) {
    closeCtxMenu();
    if (!CONFIG.enabled || !CONFIG.rightClickBlock) return;
    if (CONFIG.comment.enabled) {
      const cmtHost = findCommentHost(e);
      if (cmtHost) {
        const c = readCmt(cmtHost);
        const citems = [];
        const csel = selectedText();
        if (csel) {
          citems.push({
            label: `🚫 评论含「${csel}」关键词`,
            act: () => {
              addToList(CONFIG.comment.keywords, csel);
              toast(`已加入评论关键词：${csel}`);
              refreshPanelIfOpen();
            }
          });
        }
        if (c.uname) {
          citems.push({
            label: `🚫 屏蔽评论用户「${c.uname}」`,
            act: () => {
              addToList(CONFIG.comment.userNames, c.uname);
              toast(`已屏蔽评论用户：${c.uname}`);
              refreshPanelIfOpen();
            }
          });
        }
        if (citems.length) {
          e.preventDefault();
          e.stopPropagation();
          closeCtxMenu();
          renderCtxMenu(e, citems);
          return;
        }
      }
    }
    const card = findCard(e);
    if (!card) return showVideoPageUpMenu(e);
    const info = extractCardInfo(card, true);
    if (!info.up && !info.bvid) return;
    e.preventDefault();
    e.stopPropagation();
    closeCtxMenu();
    const items = [];
    const sel = selectedText();
    if (sel) {
      items.push({
        label: `🚫 屏蔽含「${sel}」关键词`,
        act: () => {
          addToList(CONFIG.block.keywords, sel);
          toast(`已加入关键词：${sel}`);
          refreshPanelIfOpen();
        }
      });
    }
    if (info.up) {
      const up = info.up;
      items.push({
        label: `🚫 屏蔽 UP「${up}」`,
        act: () => {
          if (info.uid) addToList(CONFIG.block.uids, info.uid);
          else addToList(CONFIG.block.upNames, up);
          toast(`已屏蔽 UP：${up}`);
          refreshPanelIfOpen();
        }
      });
      items.push({
        label: `⛔ 拉黑 UP「${up}」（同步账号黑名单）`,
        act: () => {
          confirmBlacklist(up).then((ok) => {
            if (ok) blacklistUp(info, refreshPanelIfOpen, card);
          });
        }
      });
      items.push({
        label: `⭐ 加入白名单（永不屏蔽此 UP）`,
        act: () => {
          addToList(CONFIG.allow.upNames, up);
          toast(`已加入白名单：${up}`);
          refreshPanelIfOpen();
        }
      });
    }
    if (info.bvid) {
      const bvid = info.bvid;
      items.push({
        label: `🚫 屏蔽此视频（${bvid}）`,
        act: () => {
          addToList(CONFIG.block.bvids, bvid);
          toast(`已屏蔽视频：${bvid}`);
          refreshPanelIfOpen();
        }
      });
    }
    items.push({
      label: "🙈 隐藏这一张",
      act: () => {
        card.setAttribute(PROCESSED, "1");
        blockVideo(card, "手动", info);
      }
    });
    items.push({ label: "⚙️ 打开设置面板", act: openPanel });
    renderCtxMenu(e, items);
  }
  function renderCtxMenu(e, items) {
    const menu = document.createElement("div");
    menu.id = "bfb-ctxmenu";
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "bfb-ctx-item";
      row.textContent = it.label;
      row.onclick = () => {
        closeCtxMenu();
        it.act();
      };
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    menu.style.left = Math.min(e.clientX, window.innerWidth - 270) + "px";
    menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + "px";
    ctxMenuEl = menu;
  }

  // src/ui/menu/hover.ts
  var overlayHost = null;
  var overlayRoot = null;
  function getOverlayRoot() {
    if (overlayRoot) return overlayRoot;
    const host = document.createElement("div");
    host.id = "bfb-overlay-host";
    host.style.cssText = "position:fixed;inset:0;z-index:100002;pointer-events:none;contain:layout style";
    const root = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = ".blk{position:fixed;pointer-events:auto;background:rgba(251,114,153,.95);color:#fff;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28);font-family:system-ui,Arial;user-select:none;display:none}.blk:hover{background:#fb7299}.hidev{position:fixed;pointer-events:auto;background:rgba(45,45,52,.92);color:#fff;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28);font-family:system-ui,Arial;user-select:none;display:none}.hidev:hover{background:#2d2d34}";
    root.appendChild(st);
    (document.documentElement || document.body).appendChild(host);
    overlayHost = host;
    overlayRoot = root;
    return root;
  }
  var hoverBtns = null;
  var hoverCard = null;
  function hoverInfo(card) {
    return cachedCardInfo(card) || extractCardInfo(card);
  }
  function ensureHoverBtns() {
    if (hoverBtns) return hoverBtns;
    const root = getOverlayRoot();
    const blk = document.createElement("div");
    blk.className = "blk";
    blk.textContent = "⛔ 拉黑";
    blk.title = "拉黑该 UP（同步账号黑名单）";
    blk.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = hoverCard;
      if (!card) return;
      const info = hoverInfo(card);
      const label = info.up || info.bvid;
      if (!label) {
        toast("该卡片信息不足，无法拉黑");
        return;
      }
      confirmBlacklist(label).then((ok) => {
        if (!ok) return;
        blacklistUp(info, refreshPanelIfOpen, card);
        hideHoverBtn();
      });
    };
    root.appendChild(blk);
    const hidev = document.createElement("div");
    hidev.className = "hidev";
    hidev.textContent = "🚫 不看这个";
    hidev.title = "不再显示这个视频（按 BV 号屏蔽，刷新后仍隐藏，可在黑名单撤销）";
    hidev.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!hoverCard) return;
      const info = hoverInfo(hoverCard);
      const bvid = info.bvid;
      if (!bvid) {
        toast("该卡片没有 BV 号，无法按视频隐藏", "warn");
        return;
      }
      if (addToList(CONFIG.block.bvids, bvid)) {
        toast(`已隐藏这个视频：${info.title || bvid}`, "success", { label: "撤销", onClick: () => removeFromList(CONFIG.block.bvids, bvid) });
      } else {
        toast("该视频此前已隐藏");
      }
      refreshPanelIfOpen();
      hideHoverBtn();
    };
    root.appendChild(hidev);
    hoverBtns = { blk, hidev };
    return hoverBtns;
  }
  function hideHoverBtn() {
    if (hoverBtns) {
      hoverBtns.blk.style.display = "none";
      hoverBtns.hidev.style.display = "none";
    }
    hoverCard = null;
  }
  function positionHoverBtn(card) {
    const r = card.getBoundingClientRect();
    if (r.width < 80 || r.height < 60) return hideHoverBtn();
    const { blk, hidev } = ensureHoverBtns();
    const left = Math.max(8, r.left + 8);
    const top = Math.max(8, r.top + 8);
    blk.style.left = left + "px";
    blk.style.top = top + "px";
    blk.style.display = "block";
    hidev.style.left = left + "px";
    hidev.style.top = top + 30 + "px";
    hidev.style.display = "block";
    hoverCard = card;
  }
  var pendingHover = null;
  var hoverRaf = 0;
  function resolveHover() {
    hoverRaf = 0;
    const e = pendingHover;
    pendingHover = null;
    if (!e) return;
    const card = findCard(e);
    if (!card) hideHoverBtn();
    else if (card !== hoverCard) positionHoverBtn(card);
  }
  function onCardHover(e) {
    if (!CONFIG.enabled || !CONFIG.cardHoverBtn) return;
    const t = elementOf(e.target);
    if (t && t === overlayHost) return;
    pendingHover = e;
    if (hoverRaf) return;
    hoverRaf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(resolveHover) : setTimeout(resolveHover, 16);
  }

  // src/ui/panel/ctx.ts
  function q(root, sel) {
    const el = root.querySelector(sel);
    if (!el) throw new Error("[bfb] 面板模板缺少元素: " + sel);
    return el;
  }
  var statsRefresh = null;
  function setStatsRefresh(fn) {
    statsRefresh = fn;
  }
  function runStatsRefresh() {
    if (statsRefresh) statsRefresh();
  }
  function hasStatsRefresh() {
    return !!statsRefresh;
  }

  // src/ui/panel.styles.ts
  GM_addStyle(`
    .bfb-gutter-fix > *{margin-right:0 !important}
    .bfb-review{outline:2px solid #fb7299 !important;outline-offset:-2px;border-radius:8px;position:relative !important}
    .bfb-tag{position:absolute;top:6px;left:6px;z-index:9;display:flex;align-items:center;gap:6px;background:rgba(251,114,153,.95);color:#fff;border-radius:8px;padding:3px 6px;font-size:11px;font-family:system-ui,Arial;box-shadow:0 2px 6px rgba(0,0,0,.25)}
    .bfb-tag .rs{white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis}
    .bfb-tag button{border:none;border-radius:6px;background:#fff;color:#1b7a3d;font-size:11px;padding:2px 6px;cursor:pointer;white-space:nowrap}
    #bfb-badge{position:fixed;right:18px;bottom:18px;z-index:99999;background:#fb7299;color:#fff;border-radius:24px;padding:8px 14px;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.2);font-family:system-ui,Arial;user-select:none}
    #bfb-badge.off{background:#999}
    #bfb-badge.warn{background:#e67e22}
    #bfb-ctxmenu{position:fixed;z-index:100002;background:#fff;border:1px solid #ffd5e2;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);overflow:hidden;min-width:210px;font-family:system-ui,Arial}
    .bfb-ctx-item{padding:10px 14px;font-size:13px;color:#333;cursor:pointer;white-space:nowrap}
    .bfb-ctx-item:hover{background:#fff0f5;color:#fb7299}
    #bfb-toasts{position:fixed;right:18px;bottom:70px;z-index:100001;display:flex;flex-direction:column}
    .bfb-toast{background:#fff;color:#222;border-radius:12px;padding:12px 14px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.18);max-width:320px;font-family:system-ui,Arial;border:1px solid #ffd5e2;margin-top:8px;display:flex;align-items:center;gap:10px;cursor:pointer}
    .bfb-toast .bfb-toast-msg{flex:1;min-width:0}
    .bfb-toast-act{flex:0 0 auto;border:none;border-radius:7px;background:#fb7299;color:#fff;font-size:12px;font-weight:600;padding:5px 12px;cursor:pointer}
    .bfb-toast-act:hover{background:#e85d88}
    .bfb-toast.success{border-left:4px solid #1b7a3d}
    .bfb-toast.warn{border-left:4px solid #e67e22}
    .bfb-toast.error{border-left:4px solid #e74c3c}
    .bfb-modal-back{position:fixed;inset:0;z-index:100003;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-family:system-ui,Arial;padding:16px}
    .bfb-modal{background:#fff;border-radius:14px;max-width:400px;width:88vw;box-shadow:0 12px 44px rgba(0,0,0,.32);overflow:hidden;animation:bfb-modal-in .14s ease-out}
    @keyframes bfb-modal-in{from{transform:scale(.95);opacity:.4}to{transform:scale(1);opacity:1}}
    .bfb-modal-title{padding:13px 16px;font-size:15px;font-weight:600;color:#fff;background:#fb7299}
    .bfb-modal.danger .bfb-modal-title{background:#e74c3c}
    .bfb-modal-msg{padding:14px 16px;font-size:13px;line-height:1.65;color:#333;white-space:pre-line;max-height:54vh;overflow:auto}
    .bfb-modal-btns{display:flex;gap:8px;justify-content:flex-end;padding:0 16px 14px}
    .bfb-modal-btn{border:none;border-radius:8px;padding:8px 18px;font-size:13px;cursor:pointer;background:#fb7299;color:#fff}
    .bfb-modal-btn.ghost{background:#f0f0f0;color:#444}
    .bfb-modal-btn.danger{background:#e74c3c}
    .bfb-modal-btn:focus-visible{outline:2px solid #222;outline-offset:2px}
    .bfb-modal-input{display:block;width:calc(100% - 32px);margin:0 16px 12px;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;background:#fff;color:#222}
    .bfb-modal-input:focus{outline:none;border-color:#fb7299;box-shadow:0 0 0 2px rgba(251,114,153,.18)}
    #bfb-panel .bfb-sub-row{border:1px solid #eee;border-radius:8px;padding:8px;margin-top:6px;background:#fafafa}
    #bfb-panel .bfb-sub-url{font-size:11px;color:#6e6e6e;word-break:break-all;margin-top:4px}
    #bfb-panel .bfb-sub-status{font-size:11px;color:#6e6e6e;margin-top:4px}
    #bfb-panel .bfb-listta{width:100%;box-sizing:border-box;resize:vertical;font-family:monospace;font-size:12px;padding:6px;border:1px solid #ddd;border-radius:6px;background:#fff;color:#222}
    #bfb-panel{position:fixed;top:0;right:0;width:400px;max-width:94vw;height:100vh;z-index:100000;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,.2);overflow:auto;overscroll-behavior:contain;font-family:system-ui,Arial;transform:translateX(100%);transition:transform .25s}
    #bfb-panel.open{transform:translateX(0)}
    #bfb-panel h2{margin:0;padding:14px 16px;background:#fb7299;color:#fff;font-size:16px;position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;z-index:2}
    #bfb-panel h2 .x{cursor:pointer}
    #bfb-panel .sec{padding:13px 16px;border-bottom:1px solid #f0f0f0}
    #bfb-panel .sec.allow{background:#f3fbf4}
    #bfb-panel label{font-size:13px;color:#444;display:block;margin-bottom:6px;font-weight:600}
    #bfb-panel .addrow{display:flex;gap:6px}
    #bfb-panel .addrow input{flex:1;min-width:0;padding:6px 8px;border:1px solid #ddd;border-radius:8px;font-size:13px}
    #bfb-panel .addrow button{background:#fb7299;color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer;font-size:13px;white-space:nowrap}
    #bfb-panel .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    #bfb-panel .chip{display:inline-flex;align-items:center;gap:6px;background:#fff0f5;color:#c2185b;border:1px solid #ffd5e2;border-radius:14px;padding:3px 10px;font-size:12px}
    #bfb-panel .sec.allow .chip{background:#eafaef;color:#1b7a3d;border-color:#c6ecd0}
    #bfb-panel .chip b{cursor:pointer;font-weight:700;opacity:.6}
    /* 停用态：留在名单里但不生效。删除线 + 去色，一眼能看出「它在这儿，只是没在干活」 */
    #bfb-panel .chip.off{background:#f2f2f4;color:#8a8a8a;border-color:#e0e0e4;text-decoration:line-through}
    #bfb-panel .sec.allow .chip.off{background:#f2f2f4;color:#8a8a8a;border-color:#e0e0e4}
    #bfb-panel .chip .chip-toggle{text-decoration:none;font-size:10px}
    #bfb-panel .chip b:hover{opacity:1}
    #bfb-panel .bfb-finder{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #f0f0f0}
    #bfb-panel .bfb-finder input{flex:1;min-width:0;padding:7px 11px;border:1px solid #e3e3e6;border-radius:9px;font-size:12px;outline:none}
    #bfb-panel .bfb-finder input:focus{border-color:#fb7299}
    #bfb-panel .bfb-finder button{flex:none;padding:6px 10px;border:1px solid #e3e3e6;border-radius:9px;background:#fafafa;color:#6e6e6e;cursor:pointer;font-size:12px}
    #bfb-panel .bfb-finder .fst{flex:none;font-size:11px;color:#8a8a8a;text-align:right}
    #bfb-panel .empty{font-size:11px;color:#767676;margin-top:6px}
    #bfb-panel .hint code{background:rgba(0,0,0,.06);border-radius:4px;padding:1px 5px;font-family:ui-monospace,Consolas,monospace;font-size:11px}
    #bfb-panel input[type=number]{width:80px;padding:4px 6px;border:1px solid #ddd;border-radius:6px}
    #bfb-panel .hint{font-size:11px;color:#6e6e6e;margin-top:7px;line-height:1.7}
    #bfb-panel .toolbar{display:flex;gap:8px;flex-wrap:wrap}
    #bfb-panel button.act{background:#fb7299;color:#fff;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px}
    #bfb-panel button.ghost{background:#f3f3f3;color:#333}
    #bfb-panel .switch{display:flex;align-items:center;gap:8px;font-size:13px;color:#333;font-weight:600;margin-top:9px;line-height:1.5}
    #bfb-panel .stat{font-size:12px;color:#6e6e6e}
    #bfb-panel a.manage{color:#fb7299;font-size:12px}
    #bfb-panel .sec.api{background:#f5f3ff}
    /* —— 交互美化 —— */
    #bfb-panel h2{background:linear-gradient(135deg,#fb7299,#ff9bb6)}
    #bfb-panel .switch input[type=checkbox]{appearance:none;-webkit-appearance:none;width:38px;height:22px;border-radius:22px;background:#d4d4d8;position:relative;cursor:pointer;transition:.2s;flex:0 0 auto;margin:0}
    #bfb-panel .switch input[type=checkbox]:checked{background:#fb7299}
    #bfb-panel .switch input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
    #bfb-panel .switch input[type=checkbox]:checked::after{transform:translateX(16px)}
    #bfb-panel .sec{transition:background .15s}
    #bfb-panel .addrow input:focus,#bfb-panel input[type=number]:focus{outline:none;border-color:#fb7299;box-shadow:0 0 0 2px rgba(251,114,153,.18)}
    /* —— 键盘焦点环（仅键盘导航时出现，鼠标点击不显示）—— */
    #bfb-panel button:focus-visible,#bfb-panel .tab:focus-visible,#bfb-panel .chip b:focus-visible,#bfb-panel .x:focus-visible,#bfb-panel a:focus-visible,#bfb-panel .switch input:focus-visible,.bfb-toast-act:focus-visible{outline:2px solid #fb7299;outline-offset:2px;border-radius:6px}
    #bfb-panel:focus{outline:none}
    #bfb-panel button.act:active,#bfb-panel .addrow button:active{transform:translateY(1px)}
    #bfb-panel::-webkit-scrollbar{width:10px}
    #bfb-panel::-webkit-scrollbar-thumb{background:#f0c2d2;border-radius:8px;border:2px solid #fff}
    #bfb-panel::-webkit-scrollbar-thumb:hover{background:#fb7299}
    #bfb-panel .chip{transition:transform .1s}
    #bfb-panel .chip:hover{transform:translateY(-1px)}
    #bfb-panel .field-head{cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;margin-bottom:0;padding:4px 6px;margin-left:-6px;margin-right:-6px;border-radius:8px;transition:background .12s}
    #bfb-panel .field-head:hover{background:#fff0f5}
    #bfb-panel .field-head .caret{color:#fb7299;font-size:14px;width:14px;flex:0 0 auto;transition:transform .12s}
    #bfb-panel .chip-bar{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    #bfb-panel .chip-search{display:none;gap:6px;margin-top:8px;align-items:center}
    #bfb-panel .chip-search input{flex:1;min-width:0;padding:5px 8px;border:1px solid #e3e3e3;border-radius:8px;font-size:12px;background:#fafafa}
    #bfb-panel .chip-search input:focus{outline:none;border-color:#fb7299;background:#fff;box-shadow:0 0 0 2px rgba(251,114,153,.18)}
    #bfb-panel .chip-search-x{border:none;background:transparent;color:#999;cursor:pointer;font-size:12px;padding:2px 4px}
    #bfb-panel .chip-search-x:hover{color:#fb7299}
    #bfb-panel .chip-act{border:1px solid #ffd5e2;background:#fff;color:#fb7299;border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer}
    #bfb-panel .chip-act:hover{background:#fff0f5}
    #bfb-panel .chip-act.primary{background:#fb7299;color:#fff;border-color:#fb7299}
    #bfb-panel .chip.sel{outline:2px solid #fb7299;outline-offset:1px;background:#ffd9e6}
    #bfb-panel .sec.allow .chip.sel{outline-color:#1b7a3d;background:#cdeed6}
    #bfb-panel .log-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(128,128,128,.12)}
    #bfb-panel .log-tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #bfb-panel .log-rs{color:#fb7299;margin-right:2px}
    #bfb-panel .log-link{color:inherit;text-decoration:none}
    #bfb-panel .log-link:hover{color:#fb7299;text-decoration:underline}
    #bfb-panel .log-src{flex:0 0 auto;font-size:10px;border-radius:5px;padding:0 4px;margin-right:4px;color:#fff}
    #bfb-panel .log-src.net{background:#27ae60}
    #bfb-panel .log-src.dom{background:#e67e22}
    #bfb-panel .log-blk{flex:0 0 auto;border:1px solid #ffd5e2;background:#fff;color:#fb7299;border-radius:7px;padding:2px 8px;font-size:11px;cursor:pointer}
    #bfb-panel .log-blk:hover{background:#fb7299;color:#fff}
    #bfb-panel .log-blk[disabled]{opacity:.6;cursor:default}
    #bfb-panel .log-undo{flex:0 0 auto;border:1px solid #c6ecd0;background:#fff;color:#1b7a3d;border-radius:7px;padding:2px 8px;font-size:11px;cursor:pointer}
    #bfb-panel .log-undo:hover{background:#1b7a3d;color:#fff}
    #bfb-panel .log-undo[disabled]{opacity:.6;cursor:default}
    #bfb-panel .log-pass{flex:0 0 auto;border:1px solid #c6ecd0;background:#fff;color:#1b7a3d;border-radius:7px;padding:2px 8px;font-size:11px;cursor:pointer;margin-right:6px}
    #bfb-panel .log-pass:hover{background:#1b7a3d;color:#fff}
    #bfb-panel .field-head .lt{flex:1}
    #bfb-panel .field-head .cnt{background:#fb7299;color:#fff;border-radius:10px;font-size:11px;padding:0 7px;min-width:18px;text-align:center;font-weight:700}
    #bfb-panel .field-head .cnt:empty{display:none}
    #bfb-panel .field-body{margin-top:8px}
    #bfb-panel .field .chips{max-height:132px;overflow-y:auto;overscroll-behavior:contain;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:8px;margin-top:8px}
    #bfb-panel .field .chips:empty{display:none}
    #bfb-panel .field .chips::-webkit-scrollbar{width:8px}
    #bfb-panel .field .chips::-webkit-scrollbar-thumb{background:#f0c2d2;border-radius:8px}
    #bfb-panel .field .chips::-webkit-scrollbar-thumb:hover{background:#fb7299}
    #bfb-panel .chip.uidchip::before{content:"账号";font-size:9px;background:#6b4dff;color:#fff;border-radius:5px;padding:0 4px;margin-right:2px}
    #bfb-panel .chip.group{background:#ede9fe;color:#5b21b6;border-color:#ddd6fe}
    /* —— 分组 Tab —— */
    #bfb-panel .tabs{position:sticky;top:48px;z-index:2;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:10px 12px;background:#fff;border-bottom:1px solid #f0f0f0;overscroll-behavior:contain}
    #bfb-panel .tab{flex:0 0 auto;padding:6px 13px;border-radius:16px;background:#f3f3f3;color:#666;font-size:13px;cursor:pointer;border:none;white-space:nowrap;font-weight:600;transition:.15s}
    #bfb-panel .tab:hover{background:#ffe3ec;color:#fb7299}
    #bfb-panel .tab.active{background:linear-gradient(135deg,#fb7299,#ff9bb6);color:#fff;box-shadow:0 2px 8px rgba(251,114,153,.35)}
    #bfb-panel .bfb-group{display:none}
    #bfb-panel .bfb-group.active{display:block;animation:bfb-fade .18s ease}
    @keyframes bfb-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
    #bfb-panel .grp-tip{padding:8px 16px;font-size:11px;color:#6e6e6e;background:#fafafa;border-bottom:1px solid #f0f0f0}
    /* —— 暗色模式（跟随系统 prefers-color-scheme）：仅覆盖自有 UI 表面，品牌粉与语义色保留 —— */
    @media (prefers-color-scheme: dark){
      #bfb-panel,.bfb-toast,.bfb-modal,#bfb-ctxmenu{background:#1c1c20;color:#e6e6e9}
      #bfb-panel .sec{border-bottom-color:#2c2c32}
      #bfb-panel .sec.allow{background:rgba(39,174,96,.08)}
      #bfb-panel .sec.api{background:rgba(124,92,255,.1)}
      #bfb-panel label{color:#cfcfd6}
      #bfb-panel .switch,#bfb-panel button.ghost{color:#d0d0d6}
      #bfb-panel .hint,#bfb-panel .stat,#bfb-panel .grp-tip{color:#8a8a92}
      #bfb-panel .grp-tip{background:#232328;border-bottom-color:#2c2c32}
      #bfb-panel .bfb-sub-row{background:#232328;border-color:#34343a}
      #bfb-panel .bfb-sub-url,#bfb-panel .bfb-sub-status{color:#9a9aa2}
      #bfb-panel .bfb-listta{background:#26262b;color:#e6e6e9;border-color:#44444c}
      .bfb-modal-input{background:#26262b;color:#e6e6e9;border-color:#44444c}
      #bfb-panel .empty{color:#9a9aa2}
      #bfb-panel .addrow input,#bfb-panel input[type=number]{background:#26262b;border-color:#44444c;color:#e6e6e9}
      #bfb-panel .chip-search input{background:#232328;border-color:#3a3a42;color:#e6e6e9}
      #bfb-panel .chip-search input:focus{background:#26262b}
      #bfb-panel button.ghost{background:#2e2e34}
      #bfb-panel .switch input[type=checkbox]{background:#45454d}
      #bfb-panel .chip{background:rgba(251,114,153,.16);color:#ff9ebc;border-color:rgba(251,114,153,.35)}
      #bfb-panel .sec.allow .chip{background:rgba(39,174,96,.16);color:#6ee7a0;border-color:rgba(39,174,96,.35)}
      #bfb-panel .chip.group{background:rgba(124,92,255,.18);color:#c4b5fd;border-color:rgba(124,92,255,.4)}
      #bfb-panel .chip.off{background:rgba(255,255,255,.07);color:#8b8b93;border-color:rgba(255,255,255,.14)}
      #bfb-panel .sec.allow .chip.off{background:rgba(255,255,255,.07);color:#8b8b93;border-color:rgba(255,255,255,.14)}
      #bfb-panel .hint code{background:rgba(255,255,255,.12)}
      #bfb-panel .bfb-finder{border-bottom-color:#2c2c32}
      #bfb-panel .bfb-finder input,#bfb-panel .bfb-finder button{background:#2e2e34;border-color:#45454d;color:#e8e8ea}
      #bfb-panel .chip.sel{background:rgba(251,114,153,.3)}
      #bfb-panel .sec.allow .chip.sel{background:rgba(39,174,96,.3)}
      #bfb-panel .field .chips{background:#232328;border-color:#34343a}
      #bfb-panel .chip-act,#bfb-panel .log-blk,#bfb-panel .log-pass,#bfb-panel .log-undo{background:#1c1c20}
      #bfb-panel .field-head:hover,#bfb-panel .chip-act:hover{background:rgba(251,114,153,.14)}
      #bfb-panel .tabs{background:#1c1c20;border-bottom-color:#2c2c32}
      #bfb-panel .tab{background:#2e2e34;color:#a8a8b0}
      #bfb-panel .tab:hover{background:rgba(251,114,153,.18)}
      #bfb-panel::-webkit-scrollbar-thumb{border-color:#1c1c20}
      .bfb-toast{border-color:#38383f}
      .bfb-modal-msg{color:#d8d8de}
      .bfb-modal-btn.ghost{background:#2e2e34;color:#d0d0d6}
      .bfb-ctx-item{color:#d8d8de}
      .bfb-ctx-item:hover{background:rgba(251,114,153,.16)}
    }
  `);

  // src/ui/field/models.ts
  var nameBudget = 0;
  function resetNameBudget() {
    nameBudget = NAME_RESOLVE_MAX;
  }
  var nameFlushTimer = null;
  var NAME_FLUSH_MS = 400;
  function scheduleNameFlush(rerender) {
    if (nameFlushTimer) clearTimeout(nameFlushTimer);
    nameFlushTimer = setTimeout(() => {
      nameFlushTimer = null;
      saveConfig();
      rerender();
    }, NAME_FLUSH_MS);
  }
  function chipModel(arr, groupMode = false, path) {
    return {
      count: () => arr.length,
      entries: () => arr.map((v) => ({ key: v, value: v, arr, path })),
      clear: () => {
        clearLists(arr);
      },
      add: (raw) => {
        if (groupMode) {
          const parts2 = raw.split(/[+,，、\s]+/).map((s) => s.trim()).filter(Boolean);
          if (parts2.length < 2) {
            toast("组合标签至少要 2 个，如：原神 鸣潮");
            return false;
          }
          if (addToList(arr, parts2.join("+"))) {
            toast(`已添加组合：${parts2.join(" & ")}`);
            return true;
          }
          toast("该组合已存在");
          return false;
        }
        const parts = splitRuleInput(raw);
        if (!parts.length) return false;
        const added = addEntries(parts.map((v) => ({ arr, value: v })));
        if (added) toast(`已添加 ${added} 条${parts.length > added ? `（${parts.length - added} 条已存在）` : ""}`);
        else toast("均已存在，未重复添加");
        return true;
      },
      decorate: (entry, chip, txt) => {
        if (groupMode) chip.classList.add("group");
        txt.textContent = groupMode ? String(entry.value).split("+").join(" & ") : entry.value;
      },
      // 可搜文本 = 存的值 + 显示的值（组合标签存 `a+b`、显示 `a & b`，两种写法都得搜得到）。
      texts: (entry) => groupMode ? [String(entry.value), String(entry.value).split("+").join(" & ")] : [String(entry.value)]
    };
  }
  function upModel(names, uids, namePath, uidPath) {
    return {
      count: () => names.length + uids.length,
      entries: () => names.map((v) => ({ key: "n:" + v, value: v, arr: names, uid: false, path: namePath })).concat(uids.map((v) => ({ key: "u:" + v, value: v, arr: uids, uid: true, path: uidPath }))),
      clear: () => {
        clearLists(names, uids);
      },
      add: (raw) => {
        const parts = splitRuleInput(raw);
        if (!parts.length) return false;
        const added = addEntries(parts.map((v) => ({ arr: /^\d+$/.test(v) ? uids : names, value: v })));
        toast(added ? `已添加 ${added} 条` : "均已存在，未重复添加");
        return true;
      },
      // UID 条目按数字和解析出的 UP 名都能搜到——用户记得住的是名字，不是一串数字。
      texts: (entry) => entry.uid ? [String(entry.value), CONFIG.uidNames[String(entry.value)] || ""] : [String(entry.value)],
      decorate: (entry, chip, txt, rerender) => {
        if (!entry.uid) {
          txt.textContent = entry.value;
          return;
        }
        const nm = CONFIG.uidNames[String(entry.value)];
        txt.textContent = nm || entry.value;
        chip.classList.add("uidchip");
        chip.title = "UID " + entry.value + (nm ? "" : nameBudget > 0 ? "（正在解析名称…）" : "（名单过长，本次未解析名称）");
        if (!nm && nameBudget > 0) {
          nameBudget--;
          fetchCard(entry.value, (d) => {
            const name = d && d.card && d.card.name;
            if (name) {
              setUidName(entry.value, name);
              scheduleNameFlush(rerender);
            }
          });
        }
      }
    };
  }

  // src/ui/listfilter.ts
  function makeMatcher(query) {
    const q2 = (query || "").trim();
    if (!q2) return null;
    if (q2.length > 2 && q2.startsWith("/") && q2.endsWith("/")) {
      try {
        const re = new RegExp(q2.slice(1, -1), "i");
        return (t) => re.test(t);
      } catch (e) {
      }
    }
    const lc2 = q2.toLowerCase();
    return (t) => t.toLowerCase().indexOf(lc2) >= 0;
  }
  function filterBy(items, query, textsOf) {
    const m = makeMatcher(query);
    if (!m) return items;
    return items.filter((it) => textsOf(it).some((t) => !!t && m(t)));
  }

  // src/ui/field/list.ts
  var SYNTAX_CHEATSHEET = "<b>规则语法速查</b><br>· <code>原神</code> —— 普通词，<b>包含</b>即命中，忽略大小写与全角半角<br>· <code>/震惊.*竟然/</code> —— 以 <code>/</code> 包裹为<b>正则</b>，可加 <code>/…/i</code> 等标志<br>· <code>title:原神</code> / <code>up:营销号</code> / <code>part:资讯</code> —— 只匹配 标题 / UP 名 / 分区（不写前缀 = 三者都匹配）<br>· <code>原神 鸣潮</code> —— 仅「组合标签」字段：<b>同时</b>含这一组全部标签才屏蔽<br>· 一次可粘贴多条，用<b>换行</b>或<b>逗号</b>分隔；以 <code>/</code> 开头的行整行保留，不会被逗号拆断<br>· 拿不准就用「工具 → 🧪 正则测试器」先试，它会告诉你会不会被引擎拒收";
  var collapseState = {};
  function renderListField(host, o) {
    const model = o.model;
    const el = (t, c) => {
      const e = document.createElement(t);
      if (c) e.className = c;
      return e;
    };
    const sec = el("div", "sec field" + (o.isAllow ? " allow" : ""));
    const lab = el("label", "field-head");
    const collapsed = !!collapseState[o.label];
    const caret = el("span", "caret");
    caret.textContent = collapsed ? "▸" : "▾";
    const lt = el("span", "lt");
    lt.textContent = o.label;
    const cnt = el("span", "cnt");
    cnt.textContent = String(model.count() || "");
    lab.append(caret, " ", lt, " ", cnt);
    sec.appendChild(lab);
    const body = el("div", "field-body");
    body.style.display = collapsed ? "none" : "block";
    sec.appendChild(body);
    lab.onclick = () => {
      const now = body.style.display === "none";
      body.style.display = now ? "block" : "none";
      collapseState[o.label] = !now;
      caret.textContent = now ? "▾" : "▸";
    };
    const addrow = el("div", "addrow");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = o.placeholder || "输入后点添加";
    if (o.inputTitle) input.title = o.inputTitle;
    const btn = document.createElement("button");
    btn.textContent = "添加";
    const help = document.createElement("button");
    help.type = "button";
    help.className = "chip-search-x";
    help.textContent = "?";
    help.title = "规则语法速查";
    addrow.appendChild(input);
    addrow.appendChild(btn);
    addrow.appendChild(help);
    body.appendChild(addrow);
    const cheat = el("div", "hint");
    cheat.style.display = "none";
    cheat.innerHTML = SYNTAX_CHEATSHEET;
    help.onclick = () => cheat.style.display = cheat.style.display === "none" ? "block" : "none";
    body.appendChild(cheat);
    if (o.hint) {
      const h = el("div", "hint");
      h.style.marginTop = "6px";
      h.textContent = o.hint;
      body.appendChild(h);
    }
    const search = el("div", "chip-search");
    const sInput = document.createElement("input");
    sInput.type = "text";
    sInput.placeholder = "搜索本列表（支持 /正则/）";
    const sClear = el("button", "chip-search-x");
    sClear.textContent = "✕";
    sClear.title = "清除搜索";
    search.appendChild(sInput);
    search.appendChild(sClear);
    body.appendChild(search);
    const bar = el("div", "chip-bar");
    body.appendChild(bar);
    const chips = el("div", "chips");
    body.appendChild(chips);
    let manage = false;
    let query = "";
    const selected = /* @__PURE__ */ new Set();
    let visCache = null;
    const visible = () => {
      if (!visCache) visCache = filterBy(model.entries(), query, (e) => model.texts ? model.texts(e) : [String(e.value)]);
      return visCache;
    };
    const invalidateVis = () => visCache = null;
    const filtering = () => !!query.trim();
    const renderBar = () => {
      bar.innerHTML = "";
      if (!model.count()) {
        manage = false;
        return;
      }
      const mk = (text, fn, primary) => {
        const b = el("button", "chip-act" + (primary ? " primary" : ""));
        b.textContent = text;
        b.onclick = fn;
        bar.appendChild(b);
      };
      if (!manage) {
        mk("批量管理", () => {
          manage = true;
          selected.clear();
          renderChips();
        });
        return;
      }
      mk(filtering() ? "全选匹配" : "全选", () => {
        visible().forEach((e) => selected.add(e.key));
        syncSelection();
      });
      mk("反选", () => {
        visible().forEach((e) => selected.has(e.key) ? selected.delete(e.key) : selected.add(e.key));
        syncSelection();
      });
      mk(`删除所选(${selected.size})`, () => {
        if (!selected.size) {
          toast("未勾选任何项");
          return;
        }
        const byKey = {};
        model.entries().forEach((e) => byKey[e.key] = e);
        const n = removeEntries([...selected].map((k) => byKey[k]).filter(Boolean));
        selected.clear();
        renderChips();
        toast(`已删除 ${n} 条`);
      }, true);
      const vis = visible();
      mk(filtering() ? `删除匹配(${vis.length})` : "清空", () => {
        if (!model.count()) return;
        if (filtering()) {
          if (!vis.length) return;
          confirmModal(`确定删除匹配「${query.trim()}」的 ${vis.length} 条？此操作不可撤销（其余 ${model.count() - vis.length} 条保留）。`, { title: "删除匹配项", okText: "删除", danger: true }).then((ok) => {
            if (!ok) return;
            removeEntries(vis);
            selected.clear();
            renderChips();
            toast(`已删除 ${vis.length} 条`);
          });
          return;
        }
        confirmModal(`确定清空该列表全部 ${model.count()} 条？此操作不可撤销。`, { title: "清空列表", okText: "清空", danger: true }).then((ok) => {
          if (!ok) return;
          model.clear();
          selected.clear();
          renderChips();
        });
      });
      mk("完成", () => {
        manage = false;
        selected.clear();
        renderChips();
      });
    };
    const syncSelection = () => {
      const nodes = chips.querySelectorAll(".chip");
      let i = 0;
      for (const e of visible().slice(0, CHIP_RENDER_MAX)) {
        const node = nodes[i++];
        if (node) node.classList.toggle("sel", selected.has(e.key));
      }
      renderBar();
    };
    const renderChips = () => {
      invalidateVis();
      chips.innerHTML = "";
      const total = model.count();
      const list = visible();
      cnt.textContent = filtering() && total ? `${list.length}/${total}` : String(total || "");
      search.style.display = total > LIST_SEARCH_MIN || filtering() ? "flex" : "none";
      if (!total) {
        const e = el("div", "empty");
        e.textContent = "（暂无，添加后会显示在这里）";
        chips.appendChild(e);
        renderBar();
        return;
      }
      if (!list.length) {
        const e = el("div", "empty");
        e.textContent = `（${total} 条里没有匹配「${query.trim()}」的项）`;
        chips.appendChild(e);
        renderBar();
        return;
      }
      resetNameBudget();
      const shown = list.slice(0, CHIP_RENDER_MAX);
      shown.forEach((entry) => {
        const chip = el("span", "chip" + (manage && selected.has(entry.key) ? " sel" : ""));
        const txt = document.createElement("span");
        model.decorate(entry, chip, txt, renderChips);
        chip.appendChild(txt);
        if (manage) {
          chip.style.cursor = "pointer";
          chip.title = "点击勾选 / 取消";
          chip.onclick = () => {
            if (selected.has(entry.key)) selected.delete(entry.key);
            else selected.add(entry.key);
            chip.classList.toggle("sel", selected.has(entry.key));
            renderBar();
          };
        } else {
          if (entry.path) {
            const off = isRuleDisabled(entry.path, entry.value);
            if (off) chip.classList.add("off");
            const t = document.createElement("b");
            t.className = "chip-toggle";
            t.textContent = off ? "▶" : "⏸";
            t.title = off ? "重新启用这条规则" : "暂时停用这条规则（保留在名单里，不参与匹配）";
            t.onclick = (ev) => {
              ev.stopPropagation();
              toggleRuleDisabled(entry.path, entry.value);
              renderChips();
            };
            chip.appendChild(t);
          }
          const x = document.createElement("b");
          x.textContent = "✕";
          x.title = "删除";
          x.onclick = () => {
            const { arr, value } = entry;
            const at = arr.indexOf(value);
            removeFromList(arr, value);
            renderChips();
            toast(`已删除：${value}`, "info", {
              label: "撤销",
              onClick: () => {
                restoreToList(arr, value, at);
                renderChips();
              }
            });
          };
          chip.appendChild(x);
        }
        chips.appendChild(chip);
      });
      if (list.length > shown.length) {
        const more = el("div", "empty");
        more.textContent = `⋯ 还有 ${list.length - shown.length} 条未显示（共 ${list.length} 条）。用上面的搜索框查找具体条目；批量操作仍作用于全部 ${list.length} 条。`;
        chips.appendChild(more);
      }
      renderBar();
    };
    const setQuery = (v) => {
      if (query === v) return;
      query = v;
      selected.clear();
      renderChips();
    };
    sInput.addEventListener("input", () => setQuery(sInput.value));
    sClear.onclick = () => {
      sInput.value = "";
      setQuery("");
      sInput.focus();
    };
    const doAdd = () => {
      if (model.add(input.value)) {
        input.value = "";
        sInput.value = "";
        setQuery("");
        renderChips();
      }
    };
    btn.onclick = doAdd;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doAdd();
    });
    renderChips();
    host.appendChild(sec);
  }

  // src/ui/field/controls.ts
  function bindControl(root, id, obj, key, opts = {}) {
    const el = root.querySelector("#" + id);
    if (!el) return;
    const isCheck = el instanceof HTMLInputElement && el.type === "checkbox";
    if (isCheck) el.checked = !!obj[key];
    else el.value = obj[key] != null ? String(obj[key]) : opts.number ? "0" : "";
    el.onchange = () => {
      let v;
      if (isCheck) v = el.checked;
      else if (opts.number) v = (opts.int ? parseInt(el.value, 10) : parseFloat(el.value)) || 0;
      else v = el.value;
      obj[key] = v;
      saveConfig();
      if (opts.after) opts.after();
    };
  }
  function listOf(obj, key) {
    const v = key ? obj[key] : void 0;
    if (!Array.isArray(v)) throw new Error("[bfb] 字段描述表的 key 不是名单数组: " + key);
    return v;
  }
  function renderFields(host, defs) {
    defs.forEach((f) => {
      if (f.kind === "up") {
        renderListField(host, {
          label: f.label,
          hint: f.hint,
          placeholder: "输入 UP 名 或 UID（纯数字自动识别）",
          inputTitle: "可一次粘贴多条，用逗号或换行分隔；纯数字按 UID，其余按 UP 名",
          model: upModel(CONFIG.block.upNames, CONFIG.block.uids, "block.upNames", "block.uids")
        });
        return;
      }
      const arr = listOf(f.scope === "allow" ? CONFIG.allow : CONFIG.block, f.key);
      renderListField(host, {
        label: f.label,
        hint: f.hint,
        placeholder: f.placeholder,
        isAllow: f.scope === "allow",
        inputTitle: f.groupMode ? "输入一组标签，用空格或逗号分隔，表示同时含这些标签才拦" : "可一次粘贴多条，用逗号或换行分隔",
        model: chipModel(arr, f.groupMode, `${f.scope === "allow" ? "allow" : "block"}.${f.key}`)
      });
    });
  }

  // src/ui/panel/sections/base.ts
  var baseSection = {
    tab: "base",
    render(host) {
      const sw = document.createElement("div");
      sw.className = "sec";
      sw.innerHTML = `
      <div class="switch"><input type="checkbox" id="bfb-enabled"> 启用拦截</div>
      <div class="switch"><input type="checkbox" id="bfb-review"> 🔍 审查模式（不隐藏，仅标记被拦视频并提供就地放行，便于核对）</div>
      <div class="switch"><input type="checkbox" id="bfb-rclick"> 右键卡片弹出菜单（屏蔽、拉黑、加入白名单）</div>
      <div class="switch"><input type="checkbox" id="bfb-hoverbtn"> 悬停卡片显示快捷「拉黑 / 不看这个」按钮</div>
      <div class="switch"><input type="checkbox" id="bfb-collab"> 联合投稿一并拉黑合作者</div>
      <div class="switch"><input type="checkbox" id="bfb-fuzzy"> 反绕过模糊匹配（「原 神」「原.神」同样拦截；隐形字符始终拦截）</div>
      <div class="switch"><input type="checkbox" id="bfb-trad"> 简繁归一（规则写「原神」也能拦住繁体标题；单向繁→简）</div>
      <div class="switch"><input type="checkbox" id="bfb-debug"> 调试模式（控制台逐卡打印拦截 / 放行原因；并在「工具 → 运行自检」里记录耗时）</div>
      <div class="hint">所有开关与规则<b>即时生效</b>，无需保存。<b>审查模式</b>会让拦截层停止在数据层删项以便核对，切换后建议刷新页面。想让视频真正从推荐流消失请用<b>拉黑</b>。</div>`;
      host.appendChild(sw);
      bindControl(sw, "bfb-enabled", CONFIG, "enabled", {
        after: () => {
          updateBadge();
          rescanAfterRuleChange();
        }
      });
      bindControl(sw, "bfb-review", CONFIG, "reviewMode", { after: rescanAfterRuleChange });
      bindControl(sw, "bfb-rclick", CONFIG, "rightClickBlock");
      bindControl(sw, "bfb-hoverbtn", CONFIG, "cardHoverBtn", { after: hideHoverBtn });
      bindControl(sw, "bfb-collab", CONFIG, "blacklistCollab");
      bindControl(sw, "bfb-fuzzy", CONFIG, "fuzzyMatch", { after: rescanAfterRuleChange });
      bindControl(sw, "bfb-trad", CONFIG, "tradNorm", { after: rescanAfterRuleChange });
      bindControl(sw, "bfb-debug", CONFIG, "debug", {
        after: () => {
          setTimingEnabled(CONFIG.debug);
          rescanAfterRuleChange();
        }
      });
      const ct = document.createElement("div");
      ct.className = "sec";
      ct.innerHTML = `
      <label>卡片类型过滤</label>
      <div class="switch"><input type="checkbox" id="bfb-ad"> 屏蔽广告 / 推广卡片</div>
      <div class="switch"><input type="checkbox" id="bfb-live"> 屏蔽信息流中的直播推荐卡</div>
      <div class="switch"><input type="checkbox" id="bfb-hotsearch"> 屏蔽搜索框热搜词</div>
      <div class="hint">广告为自动识别，偶有误差，可在「屏蔽记录」核对。直播卡指信息流里指向直播间的推荐卡。</div>`;
      host.appendChild(ct);
      bindControl(ct, "bfb-ad", CONFIG, "hideAd", { after: rescanAfterRuleChange });
      bindControl(ct, "bfb-live", CONFIG, "hideLiveCard", { after: rescanAfterRuleChange });
      bindControl(ct, "bfb-hotsearch", CONFIG, "hideHotSearch", { after: applyHotSearchStyle });
    }
  };

  // src/ui/panel/sections/lists.ts
  var BLACK_FIELDS = [
    { key: "keywords", label: "🎯 关键词", placeholder: "如：原神 或 /震惊.*竟然/", hint: "匹配标题、UP 主名、分区任一即拦截（纯本地）。普通词为包含匹配，/.../ 为正则。可加前缀限定字段：title: / up: / part:。按视频标签拦截请用下方「视频标签」。" },
    { kind: "up", label: "UP 主", hint: "输入 UP 名 或 UID（纯数字自动识别为 UID）；可一次粘贴多条，用逗号或换行分隔。" },
    { key: "bvids", label: "BV 号", placeholder: "如：BV1xx411c7XX", hint: "按视频 BV 号精确屏蔽单个视频。" },
    { key: "partitions", label: "视频分区", placeholder: "如：资讯 或 /综艺|娱乐/", hint: "按视频分区（tname）屏蔽，网络拦截层判定最准。普通词为包含匹配，以 /.../ 包裹为正则。" }
  ];
  var API_CHIP_FIELDS = [
    { key: "tags", label: "视频标签", placeholder: "如：原神 或 /鬼畜|二创/", hint: "匹配视频的完整标签（tag），需开启上方「精确过滤」。普通词为包含匹配，以 /.../ 包裹为正则。" },
    { key: "dualTags", label: "组合标签", placeholder: "如：原神 鸣潮（空格分隔）", groupMode: true, hint: "同时含这一组里所有标签才屏蔽，专治对立引战内容；需开启「精确过滤」。" },
    { key: "upBio", label: "UP 简介关键词", placeholder: "如：商务合作", hint: "匹配 UP 主个人简介，需开启「精确过滤」。" }
  ];
  var ALLOW_FIELDS = [
    { scope: "allow", key: "keywords", label: "关键词", placeholder: "喜欢的题材", hint: "命中即永不隐藏（优先级最高）。作用于视频标题与 UP 主名；普通词为包含匹配，/.../ 为正则。" },
    { scope: "allow", key: "upNames", label: "UP 主名", placeholder: "喜欢的 UP 主名", hint: "该 UP 的视频永不隐藏（按名称精确匹配）。" },
    { scope: "allow", key: "uids", label: "UID", placeholder: "喜欢的 UP 的 UID（纯数字）", hint: "该 UP 的视频永不隐藏（按 UID 精确匹配，最可靠）。" }
  ];
  var blackListsSection = {
    tab: "black",
    render: (host) => renderFields(host, BLACK_FIELDS)
  };
  var apiListsSection = {
    tab: "api",
    render: (host) => renderFields(host, API_CHIP_FIELDS)
  };
  var allowListsSection = {
    tab: "allow",
    render: (host) => renderFields(host, ALLOW_FIELDS)
  };

  // src/ui/panel/sections/advanced.ts
  var advancedSection = {
    tab: "api",
    render(host) {
      const num = document.createElement("div");
      num.className = "sec";
      num.innerHTML = `<label>播放量 / 时长</label>
      <div class="switch" style="margin-top:4px;font-weight:400">播放量低于 <input type="number" id="bfb-minviews" min="0" step="0.1" style="width:64px"> 万则屏蔽（0 为不启用）</div>
      <div class="switch" style="margin-top:8px;font-weight:400">时长　最短 <input type="number" id="bfb-dmin" min="0" style="width:64px"> 秒　最长 <input type="number" id="bfb-dmax" min="0" style="width:64px"> 秒</div>
      <div class="switch" style="margin-top:8px;font-weight:400">营销号：点赞率低于 <input type="number" id="bfb-spamratio" min="0" max="100" step="0.1" style="width:56px"> % 且播放量≥ <input type="number" id="bfb-spamviews" min="0" step="1" style="width:56px"> 万则屏蔽</div>
      <div class="hint">填 0 = 不启用。营销号常表现为「高播放、极低赞」；点赞率仅在接口返回点赞数时生效，其余卡片自动跳过。</div>`;
      host.appendChild(num);
      bindControl(num, "bfb-minviews", CONFIG.block, "minViews", { number: true, after: rescanAfterRuleChange });
      bindControl(num, "bfb-dmin", CONFIG.block, "minDuration", { number: true, int: true, after: rescanAfterRuleChange });
      bindControl(num, "bfb-dmax", CONFIG.block, "maxDuration", { number: true, int: true, after: rescanAfterRuleChange });
      bindControl(num, "bfb-spamratio", CONFIG.block, "spamLikeRatio", { number: true, after: rescanAfterRuleChange });
      bindControl(num, "bfb-spamviews", CONFIG.block, "spamMinViews", { number: true, int: true, after: rescanAfterRuleChange });
      const feed = document.createElement("div");
      feed.className = "sec";
      feed.innerHTML = `<label>信息流加载</label>
      <div class="switch"><input type="checkbox" id="bfb-boost"> 增大首页推荐每批加载数量</div>
      <div class="hint">每批多取一些视频，删除命中项后信息流更饱满，下次加载生效。<br>⚠ B 站推荐接口大多已带 <b>WBI 签名</b>（签名覆盖全部参数），这类接口上本功能<b>不会生效</b>——脚本跳过改写而不是把请求改坏。</div>`;
      host.appendChild(feed);
      bindControl(feed, "bfb-boost", CONFIG, "boostFeedLoad");
      const api = document.createElement("div");
      api.className = "sec api";
      api.innerHTML = `
      <label>🛰 精确过滤</label>
      <div class="switch"><input type="checkbox" id="bfb-api"> <b>启用精确过滤</b></div>
      <div class="hint">按需读取视频标签、UP 简介等数据来判断，命中时会略有延迟；不开启则完全不联网。</div>
      <div id="bfb-api-body" style="margin-top:6px">
        <div class="switch"><input type="checkbox" id="bfb-charging"> 屏蔽充电专属视频</div>
      </div>`;
      host.appendChild(api);
      const apiBody = q(api, "#bfb-api-body");
      const syncApiBody = () => {
        apiBody.style.opacity = CONFIG.apiFilters ? "1" : ".4";
        apiBody.style.pointerEvents = CONFIG.apiFilters ? "auto" : "none";
      };
      bindControl(api, "bfb-api", CONFIG, "apiFilters", {
        after: () => {
          syncApiBody();
          rescanAfterRuleChange();
        }
      });
      bindControl(api, "bfb-charging", CONFIG, "hideCharging", { after: rescanAfterRuleChange });
      syncApiBody();
    }
  };

  // src/ui/panel/sections/comment.ts
  var commentSection = {
    tab: "comment",
    render(host) {
      const cmt = document.createElement("div");
      cmt.className = "sec";
      cmt.innerHTML = `
      <label>💬 评论区过滤</label>
      <div class="switch"><input type="checkbox" id="bfb-cmt"> <b>启用评论区过滤</b></div>
      <div class="hint">仅在含评论的页面生效；以下规则与视频黑名单相互独立。</div>
      <div id="bfb-cmt-body" style="margin-top:6px">
        <div class="switch" style="font-weight:400">评论者等级低于 <input type="number" id="bfb-cmt-level" min="0" max="6" style="width:56px"> 级则隐藏（0=不启用）</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-noface"> 隐藏 默认头像且非会员（疑似小号、水军）</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-bot"> 隐藏 AI 机器人发布的评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-callbot"> 隐藏 召唤 AI 的评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-ad"> 隐藏 带货 / 导流广告评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-callonly"> 隐藏 只含 @他人 的空评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-emoji"> 隐藏 纯表情评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-collapse"> 命中后折叠为一行（点击展开），而非直接隐藏</div>
        <label style="margin-top:10px">⭐ 免过滤（白名单）</label>
        <div class="switch"><input type="checkbox" id="bfb-cmt-up"> UP 主的评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-pin"> 置顶评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-me"> 我自己 / @我 的评论</div>
      </div>`;
      host.appendChild(cmt);
      const cmtBody = q(cmt, "#bfb-cmt-body");
      const syncCmtBody = () => {
        cmtBody.style.opacity = CONFIG.comment.enabled ? "1" : ".4";
        cmtBody.style.pointerEvents = CONFIG.comment.enabled ? "auto" : "none";
      };
      bindControl(cmt, "bfb-cmt", CONFIG.comment, "enabled", {
        after: () => {
          syncCmtBody();
          rescanAfterRuleChange();
        }
      });
      bindControl(cmt, "bfb-cmt-level", CONFIG.comment, "minLevel", { number: true, int: true, after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-noface", CONFIG.comment, "hideNoFace", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-bot", CONFIG.comment, "hideBot", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-callbot", CONFIG.comment, "hideCallBot", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-ad", CONFIG.comment, "hideAd", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-callonly", CONFIG.comment, "hideCallOnly", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-emoji", CONFIG.comment, "hideEmojiOnly", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-collapse", CONFIG.comment, "collapse", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-up", CONFIG.comment, "allowUp", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-pin", CONFIG.comment, "allowPin", { after: rescanAfterRuleChange });
      bindControl(cmt, "bfb-cmt-me", CONFIG.comment, "allowMe", { after: rescanAfterRuleChange });
      syncCmtBody();
      renderListField(host, {
        label: "🚫 评论关键词",
        placeholder: "如：引战词 或 /.../",
        hint: "评论正文命中即隐藏。普通词为包含匹配，/.../ 为正则。与视频关键词相互独立。",
        model: chipModel(CONFIG.comment.keywords, false, "comment.keywords")
      });
      renderListField(host, {
        label: "🚫 评论用户名（精确）",
        placeholder: "精确用户名",
        hint: "按评论者用户名精确隐藏其评论。可在评论区右键用户名快捷加入。",
        model: chipModel(CONFIG.comment.userNames, false, "comment.userNames")
      });
      renderListField(host, {
        label: "🚫 用户名关键词",
        placeholder: "如：营销 或 /.../",
        hint: "按评论者昵称关键词隐藏。普通词为包含匹配，/.../ 为正则。",
        model: chipModel(CONFIG.comment.userNameKeywords, false, "comment.userNameKeywords")
      });
    }
  };

  // src/presets.ts
  var PRESET_LIBRARY = [
    { cat: "游戏黑水", name: "库洛系(鸣潮/库洛)", desc: "鸣潮 / 库洛 / 战双 等相关词", rules: { keywords: ["库洛", "库洛游戏", "呜哇", "鸣潮", "战双", "战双帕弥什", "漂泊者", "漂泊神游", "寄生神游", "寄生社区"] } },
    { cat: "引战", name: "引战话术", desc: "挑动对立的话术片段（已收敛正则、防误伤）", rules: { keywords: ["/接触wuwa后|大脑发生的异变/"] } },
    { cat: "引战", name: "引战标签", desc: "抹黑 / 拉踩类标签（需开「精确过滤」才匹配标签）", rules: { tags: ["/米哈一儿|一哭|二抄|三自爆/"] } },
    { cat: "标题党 / 营销", name: "标题党", desc: "震惊体 + 一口气看完", rules: { keywords: ["/(一口气|一次性|一天|分钟|分半|小时)(看完|带你看完|直接看完)/", "/震惊|竟然|万万没想到/"] } },
    { cat: "标题党 / 营销", name: "营销号UP名", desc: "常见营销号账号名", rules: { keywords: ["今日话题", "话题酱", "今日知乎", "大型纪录片"] } },
    { cat: "标题党 / 营销", name: "软传销", desc: "日入月入 / 为自己打工", rules: { keywords: ["/(日入|日赚|月入|月赚)\\d+/", "/(小时|内耗).+为自己打工/"] } },
    { cat: "其它", name: "MBTI", rules: { keywords: ["/MBTI|[IE][SN][TF][JP]|I人|E人/"] } },
    { cat: "其它", name: "梗视频", rules: { keywords: ["科目三", "猫meme", "/是什么梗|梗百科|大型[纪记]录片/"] } },
    { cat: "其它", name: "含日语标题", rules: { keywords: ["/[ぁ-ヶ]/"] } }
  ];

  // src/ui/panel/sections/presets.ts
  var API_DIM_KEYS = ["tags", "dualTags", "upBio"];
  var presetsSection = {
    tab: "tools",
    render(host, ctx) {
      const preset = document.createElement("div");
      preset.className = "sec";
      preset.innerHTML = '<label>预置规则库（点击加入对应黑名单，可叠加）</label><div class="hint">一键把整组规则加入「黑名单」（之后可在黑名单页增删）。需要持续更新的大名单请用「规则订阅」。</div><div id="bfb-presets"></div>';
      host.appendChild(preset);
      const presetBox = q(preset, "#bfb-presets");
      const applyPreset = (p2) => {
        let n = 0;
        for (const dim of Object.keys(p2.rules || {})) {
          const arr = CONFIG.block[dim];
          if (!Array.isArray(arr)) continue;
          n += pushUnique(arr, p2.rules[dim].map((v) => String(v).trim()).filter(Boolean));
        }
        if (n) {
          saveConfig();
          rescanAfterRuleChange();
        }
        toast(n ? `已加入「${p2.name}」${n} 条` : `「${p2.name}」已全部存在`);
        const needsApi = Object.keys(p2.rules || {}).some((d) => API_DIM_KEYS.includes(d));
        if (needsApi && !CONFIG.apiFilters) {
          confirmModal(`「${p2.name}」含需联网读取（标签、简介）的规则，需开启「精确过滤」才会生效。是否现在开启？`, {
            title: "开启精确过滤",
            okText: "开启"
          }).then((ok) => {
            if (ok) {
              CONFIG.apiFilters = true;
              saveConfig();
              rescanAfterRuleChange();
            }
            ctx.rerender();
          });
        } else {
          ctx.rerender();
        }
      };
      const byCat = {};
      PRESET_LIBRARY.forEach((pp) => (byCat[pp.cat] = byCat[pp.cat] || []).push(pp));
      Object.keys(byCat).forEach((cat) => {
        const cl = document.createElement("div");
        cl.style.cssText = "font-size:12px;color:#6e6e6e;margin:8px 0 4px";
        cl.textContent = cat;
        presetBox.appendChild(cl);
        const bar = document.createElement("div");
        bar.className = "toolbar";
        byCat[cat].forEach((pp) => {
          const btn = document.createElement("button");
          btn.className = "act ghost";
          btn.textContent = "+ " + pp.name;
          if (pp.desc) btn.title = pp.desc;
          btn.onclick = () => applyPreset(pp);
          bar.appendChild(btn);
        });
        presetBox.appendChild(bar);
      });
    }
  };

  // src/ui/panel/sections/regex-tester.ts
  var regexTesterSection = {
    tab: "tools",
    render(host) {
      const retest = document.createElement("div");
      retest.className = "sec";
      retest.innerHTML = `<label>🧪 正则测试器（仅调试用，不影响规则）</label>
      <div class="addrow"><input type="text" id="bfb-re-pat" placeholder="正则或普通词，如 /一口气.*看完/i"></div>
      <div class="addrow" style="margin-top:6px"><input type="text" id="bfb-re-txt" placeholder="样例文本（粘贴一个标题试试）"></div>
      <div class="hint" id="bfb-re-out" style="margin-top:6px">输入正则与样例文本，实时显示是否命中。/.../ 按正则，否则按普通词（包含即命中）。</div>`;
      host.appendChild(retest);
      const rePat = q(retest, "#bfb-re-pat");
      const reTxt = q(retest, "#bfb-re-txt");
      const reOut = q(retest, "#bfb-re-out");
      const runReTest = () => {
        const pat = (rePat.value || "").trim();
        const txt = reTxt.value || "";
        if (!pat) {
          reOut.textContent = "输入正则与样例文本，实时显示是否命中。";
          reOut.style.color = "";
          return;
        }
        let re;
        const m = pat.match(/^\/(.*)\/([a-z]*)$/);
        const reject = m && regexRejectReason(m[1]);
        if (reject) {
          reOut.textContent = `⚠ 这条正则会被规则引擎忽略（${reject}），加进名单也不会生效`;
          reOut.style.color = "#e67e22";
          return;
        }
        try {
          re = m ? new RegExp(m[1], m[2].includes("i") ? m[2] : m[2] + "i") : new RegExp(escapeRe(pat), "i");
        } catch (e) {
          reOut.textContent = "⚠ 正则语法错误：" + e.message;
          reOut.style.color = "#e74c3c";
          return;
        }
        if (!txt) {
          reOut.textContent = `已就绪（${m ? "正则" : "普通词"}），输入样例文本看是否命中。`;
          reOut.style.color = "";
          return;
        }
        const hit = re.test(txt);
        reOut.textContent = hit ? "✅ 命中" : "✗ 未命中";
        reOut.style.color = hit ? "#1b7a3d" : "#6e6e6e";
      };
      rePat.oninput = runReTest;
      reTxt.oninput = runReTest;
    }
  };

  // src/ui/panel/sections/io.ts
  var ioSection = {
    tab: "tools",
    render(host, ctx) {
      const io = document.createElement("div");
      io.className = "sec";
      io.innerHTML = `<label>规则配置导入 / 导出（备份、分享给他人）</label>
      <div class="toolbar"><button class="act" id="bfb-export">⬇ 导出为文件</button><button class="act ghost" id="bfb-import">⬆ 从文件导入</button><button class="act ghost" id="bfb-export-sub">📤 导出为订阅名单</button></div>
      <div class="hint">导出全部规则与开关（不含统计与个人偏好）；导入时规则取<b>并集</b>，开关以导入值为准。<br>「导出为订阅名单」生成订阅格式文件——传到公开 URL，别人填进「规则订阅」即可订阅并自动更新。</div>`;
      host.appendChild(io);
      q(io, "#bfb-export").onclick = () => {
        const blob = new Blob([exportConfig()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `biliHoyoFairy-rules-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2e3);
        toast("已导出规则配置文件");
      };
      q(io, "#bfb-export-sub").onclick = () => {
        promptModal("给这份名单起个标题（订阅者会看到）：", { title: "导出为订阅名单", placeholder: "如：抗黑潮公共名单", okText: "导出" }).then((input) => {
          const title = (input || "").trim();
          if (input === null) return;
          const blob = new Blob([exportSubscription(title)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `biliHoyoFairy-blocklist-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2e3);
          toast("已导出订阅名单文件，传到公开 URL 后即可被订阅", "success");
        });
      };
      q(io, "#bfb-import").onclick = () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "application/json,.json";
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            try {
              const parsed = JSON.parse(String(r.result || ""));
              const raw = parsed && parsed.config ? parsed.config : parsed;
              if (!raw || typeof raw !== "object") throw new Error("bad");
              const incoming = sanitizeConfigInput(migrateConfig(raw));
              NON_PORTABLE.forEach((k) => delete incoming[k]);
              delete incoming.schemaVersion;
              const draft = structuredClone(CONFIG);
              mergeImport(draft, incoming);
              const okObj = (o) => o && typeof o === "object" && !Array.isArray(o);
              if (!okObj(draft.block) || !okObj(draft.allow)) throw new Error("bad");
              Object.assign(CONFIG, draft);
              saveConfig();
              rescanAfterRuleChange();
              ctx.rerender();
              toast("已导入并合并规则配置");
            } catch (e) {
              toast("导入失败：文件不是有效的配置 JSON");
            }
          };
          r.readAsText(f);
        };
        inp.click();
      };
    }
  };

  // src/ui/panel/sections/backups.ts
  var REASON_TEXT = {
    upgrade: "脚本升级前",
    shrink: "⚠ 规则条数骤降前",
    restore: "恢复操作前"
  };
  var backupsSection = {
    tab: "tools",
    render(host, ctx) {
      const sec = document.createElement("div");
      sec.className = "sec";
      sec.innerHTML = `<label>🗂 配置备份（自动，最近 5 份）</label>
      <div class="hint">升级前、规则条数骤降前会自动存一份，供出岔子时回滚。本地兜底，<b>不能替代</b>「导出为文件」。</div>
      <div id="bfb-bk-list" style="margin-top:6px"></div>`;
      host.appendChild(sec);
      const listEl = q(sec, "#bfb-bk-list");
      const render = () => {
        const list = loadBackups();
        listEl.innerHTML = "";
        if (!list.length) {
          const e = document.createElement("div");
          e.className = "empty";
          e.textContent = "（暂无备份。首次安装、或安装后还没升级过时是正常的）";
          listEl.appendChild(e);
          return;
        }
        list.forEach((b) => {
          const row = document.createElement("div");
          row.className = "log-row";
          const tx = document.createElement("span");
          tx.className = "log-tx";
          const when = new Date(b.ts).toLocaleString();
          tx.innerHTML = `<span class="log-rs">[${escapeHtml(REASON_TEXT[b.reason] || b.reason)}]</span> ${escapeHtml(when)} · v${escapeHtml(b.version)} · <b>${b.rules} 条规则</b>`;
          tx.title = `备份于 ${when}，脚本版本 v${b.version}，含 ${b.rules} 条规则`;
          row.appendChild(tx);
          const btn = document.createElement("button");
          btn.className = "log-undo";
          btn.textContent = "↩恢复";
          btn.title = "用这份备份覆盖当前配置（覆盖前会先把当前状态也备份一次）";
          btn.onclick = () => {
            confirmModal(
              `用这份备份覆盖当前配置？

备份时间：${when}
含规则：${b.rules} 条

当前配置会先被自动备份一次，所以这一步也是可撤销的。`,
              { title: "恢复配置备份", okText: "恢复" }
            ).then((ok) => {
              if (!ok) return;
              if (!restoreBackup(b)) return toast("恢复失败：这份备份的内容已损坏或被清理", "error");
              rescanAfterRuleChange();
              updateBadge();
              ctx.rerender();
              toast(`已恢复到 ${when} 的备份（${b.rules} 条规则）`, "success");
            });
          };
          row.appendChild(btn);
          listEl.appendChild(row);
        });
      };
      render();
    }
  };

  // src/batch.ts
  function parseNameList(raw) {
    const uids = [];
    const names = [];
    const seen = /* @__PURE__ */ new Set();
    const addUid = (u) => {
      if (!seen.has(u)) {
        seen.add(u);
        uids.push(u);
      }
    };
    String(raw || "").split(/[\s,，;；、]+/).forEach((tok) => {
      const t = (tok || "").trim();
      if (!t || t[0] === "!" || t[0] === "#") return;
      let m;
      if (m = t.match(/^uid:\s*(\d+)$/i)) addUid(m[1]);
      else if (m = t.match(/^up:\s*(.+)$/i)) {
        const nm = m[1].trim();
        if (nm) names.push(nm);
      } else if (/^\d{3,}$/.test(t)) addUid(t);
      else names.push(t);
    });
    return { uids, names };
  }

  // src/ui/panel/sections/name-list.ts
  var nameListSection = {
    tab: "tools",
    render(host, ctx) {
      const listSec = document.createElement("div");
      listSec.className = "sec";
      listSec.innerHTML = `<label>名单批量处理（粘贴 / 文件 / URL）</label>
      <textarea id="bfb-list-input" class="bfb-listta" rows="4" placeholder="粘贴一批 UID 或 UP 名，空格、逗号、换行、分号均可分隔。&#10;纯数字识别为 UID，其余识别为 UP 名；也支持 uid:123、up:名字 前缀。"></textarea>
      <div class="toolbar" style="margin-top:6px">
        <button class="act ghost" id="bfb-list-file">📁 从文件载入</button>
        <button class="act ghost" id="bfb-list-url">🔗 从 URL 载入</button>
        <button class="act ghost" id="bfb-list-account">⬇ 从账号黑名单导回</button>
      </div>
      <div class="toolbar" style="margin-top:6px">
        <button class="act" id="bfb-list-hide">仅屏蔽（本地）</button>
        <button class="act ghost" id="bfb-list-block" style="color:#e74c3c">⛔ 拉黑（写账号黑名单）</button>
        <button class="act ghost" id="bfb-list-stop" style="display:none;color:#e67e22">⏹ 停止</button>
      </div>
      <div class="hint">「仅屏蔽」只在本地隐藏；「拉黑」会写入账号黑名单，<b>不可一键撤销</b>。「从账号黑名单导回」把账号里已拉黑的人重新填进本地名单——账号那份才是权威。仅有名称无 UID 的条目降级为本地屏蔽。</div>
      <div id="bfb-list-status" class="stat" style="margin-top:6px;min-height:1.2em"></div>`;
      host.appendChild(listSec);
      const listTa = q(listSec, "#bfb-list-input");
      const listStatus = q(listSec, "#bfb-list-status");
      const parseList = () => parseNameList(listTa.value);
      const addLocalMany = (uids, names) => {
        const n = pushUnique(CONFIG.block.uids, uids) + pushUnique(CONFIG.block.upNames, names);
        if (n) {
          saveConfig();
          rescanAfterRuleChange();
        }
        return n;
      };
      q(listSec, "#bfb-list-file").onclick = () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".txt,.csv,.json,text/plain,application/json";
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            listTa.value = (listTa.value ? listTa.value + "\n" : "") + String(r.result || "");
            toast("已载入文件内容到输入框，确认后点 仅屏蔽 / 拉黑");
          };
          r.readAsText(f);
        };
        inp.click();
      };
      q(listSec, "#bfb-list-url").onclick = () => {
        promptModal("输入名单 URL（纯文本：每行一个 UID 或 UP 名）：", { title: "从 URL 载入", placeholder: "https://…", okText: "载入" }).then((input) => {
          const url = (input || "").trim();
          if (!url) return;
          if (!/^https?:\/\//i.test(url)) return toast("请输入有效的 http(s) URL", "warn");
          toast("载入中…");
          const sent = gmRequest({
            method: "GET",
            url,
            timeout: 15e3,
            onload: (r) => {
              if (r.status >= 200 && r.status < 300 && r.responseText) {
                listTa.value = (listTa.value ? listTa.value + "\n" : "") + r.responseText;
                toast("已载入 URL 内容到输入框，确认后点 仅屏蔽 / 拉黑", "success");
              } else toast("载入失败：HTTP " + r.status, "error");
            },
            onerror: () => toast("网络错误，载入失败", "error"),
            ontimeout: () => toast("载入超时", "error")
          });
          if (!sent) toast("当前环境不支持联网载入", "warn");
        });
      };
      q(listSec, "#bfb-list-account").onclick = () => {
        const btn = q(listSec, "#bfb-list-account");
        btn.disabled = true;
        listStatus.textContent = "正在读取账号黑名单…";
        importAccountBlacklist(
          (r) => {
            btn.disabled = false;
            if (!r) {
              listStatus.textContent = "❌ 读取失败：可能未登录、网络异常或触发了风控，稍后再试。你的账号黑名单本身不受影响。";
              toast("读取账号黑名单失败（未登录 / 网络 / 风控）", "error");
              return;
            }
            const dup = r.fetched - r.added;
            listStatus.textContent = `✅ 账号黑名单共 ${r.total} 人，本次读到 ${r.fetched} 条，本地新增 ${r.added} 条` + (dup > 0 ? `（${dup} 条本地已有）` : "") + (r.truncated ? " ⚠ 达到单次读取上限，可能未读完，请再点一次继续" : "");
            toast(r.added ? `已从账号黑名单导回 ${r.added} 条` : "本地名单已与账号黑名单一致", r.truncated ? "warn" : "success");
            ctx.rerender();
          },
          (done, total, paused) => {
            listStatus.textContent = paused ? `⚠ 触发风控，已暂停约 ${Math.ceil(riskGuard.remaining() / 1e3)}s 后自动继续 · 已读 ${done}${total ? "/" + total : ""}` : `读取中 ${done}${total ? "/" + total : ""}…`;
          }
        );
      };
      q(listSec, "#bfb-list-hide").onclick = () => {
        const { uids, names } = parseList();
        if (!uids.length && !names.length) return toast("没解析到有效的 UID / 名称");
        const n = addLocalMany(uids, names);
        toast(`已本地屏蔽：新增 ${n} 条（解析到 UID ${uids.length} / 名称 ${names.length}）`);
        ctx.rerender();
      };
      q(listSec, "#bfb-list-block").onclick = () => {
        const { uids, names } = parseList();
        if (!uids.length && !names.length) return toast("没解析到有效的 UID / 名称");
        const est = Math.ceil(uids.length * 1.3);
        const nameTip = names.length ? `
另有 ${names.length} 个只有名称（无 UID）→ 仅本地屏蔽，不写账号` : "";
        const limitTip = uids.length > 200 ? "\n数量较多：账号黑名单有总量上限，且单日大批量操作更易触发风控，建议分批进行。" : "";
        const run = () => {
          const nLocal = addLocalMany([], names);
          if (!uids.length) {
            toast(`无 UID 可账号拉黑；已本地屏蔽 ${nLocal} 个名称`);
            ctx.rerender();
            return;
          }
          toast(`开始拉黑 ${uids.length} 个…执行期间请勿关闭面板`);
          listStatus.textContent = `准备拉黑 ${uids.length} 个…`;
          const stopBtn = q(listSec, "#bfb-list-stop");
          const blockBtn = q(listSec, "#bfb-list-block");
          const resetButtons = () => {
            stopBtn.style.display = "none";
            stopBtn.disabled = false;
            stopBtn.textContent = "⏹ 停止";
            blockBtn.disabled = false;
          };
          const ctl = doBlacklistMany(
            uids.map((u) => ({ uid: u, name: "" })),
            (r) => {
              resetButtons();
              const failUids = r.failed.map((f) => f.uid);
              const byCode = {};
              r.failed.forEach((f) => {
                const k = f.code == null ? "网络错误" : String(f.code);
                byCode[k] = (byCode[k] || 0) + 1;
              });
              const failBreak = Object.entries(byCode).map(([c, n]) => `${REL_ERR[c] || (c === "网络错误" ? c : "code " + c)}×${n}`).join("、");
              const head = r.cancelled ? `⏹ 已停止（已处理 ${r.done}/${r.total}）：` : `✅ 完成（共 ${r.total}）：`;
              listStatus.innerHTML = `${head}<b>新拉黑 ${r.added}</b>` + (r.already ? ` · 此前已在黑名单 ${r.already}` : "") + (failUids.length ? ` · <b style="color:#e74c3c">失败 ${failUids.length}</b>（${escapeHtml(failBreak)}；已回填可重试）` : "") + (nLocal ? ` · 另本地屏蔽 ${nLocal} 名称` : "") + `<br><span style="color:#888">官方黑名单本次新增 = 新拉黑 ${r.added} 个（“已在黑名单”的不会再叠加；如仍对不上，多为风控/已满，开调试模式看控制台 code 明细）</span>`;
              const remain = r.cancelled ? uids.slice(r.done) : [];
              const refill = failUids.concat(remain);
              listTa.value = refill.length ? refill.join("\n") : "";
              toast(`${r.cancelled ? "已停止" : "完成"}：新拉黑 ${r.added}，已在黑名单 ${r.already}，失败 ${failUids.length}`);
              ctx.refreshStats();
            },
            (pg) => {
              listStatus.textContent = pg.paused ? `⚠ 触发风控，已暂停约 ${pg.wait}s 后自动继续 · 进度 ${pg.done}/${pg.total}（新拉黑 ${pg.added}，已在 ${pg.already}，失败 ${pg.fail}）` : `拉黑中 ${pg.done}/${pg.total} · 新拉黑 ${pg.added}${pg.already ? `，已在 ${pg.already}` : ""}${pg.fail ? `，失败 ${pg.fail}` : ""}…`;
              ctx.refreshStats();
            }
          );
          blockBtn.disabled = true;
          stopBtn.style.display = "";
          stopBtn.onclick = () => {
            stopBtn.disabled = true;
            stopBtn.textContent = "停止中…";
            listStatus.textContent = "停止中：等当前这一个完成后收尾…";
            ctl.cancel();
          };
        };
        if (uids.length) {
          confirmModal(
            `将把 ${uids.length} 个 UID 写入你的账号黑名单（限速约 ${est} 秒起，触发风控会自动暂停续传、耗时更久），不可一键撤销。${nameTip}${limitTip}

执行期间请保持此页面打开，可随时点「停止」中断。`,
            { title: "批量拉黑确认", okText: `拉黑 ${uids.length} 个`, danger: true }
          ).then((ok) => {
            if (ok) run();
          });
        } else {
          run();
        }
      };
    }
  };

  // src/ui/panel/sections/subscriptions.ts
  var subscriptionsSection = {
    tab: "tools",
    render(host) {
      const subSec = document.createElement("div");
      subSec.className = "sec";
      subSec.innerHTML = `<label>规则订阅（从 URL 自动拉取并合并黑名单）</label>
      <div class="addrow"><input type="text" id="bfb-sub-url" placeholder="订阅 URL（JSON 或文本，如 GitHub raw）"></div>
      <div class="addrow" style="margin-top:6px"><input type="text" id="bfb-sub-name" placeholder="备注名（可选）"><button id="bfb-sub-add">添加</button></div>
      <div class="hint">订阅只并入<b>黑名单</b>的 7 个维度，不影响白名单与开关，按声明周期自动刷新。想自己维护一份，用「工具 → 导出为订阅名单」。</div>
      <div class="toolbar" style="margin-top:8px"><button class="act ghost" id="bfb-sub-refresh">🔄 全部刷新</button></div>
      <div id="bfb-sub-list" style="margin-top:8px"></div>`;
      host.appendChild(subSec);
      const subListEl = q(subSec, "#bfb-sub-list");
      const fmtSubTime = (t) => t ? new Date(t).toLocaleString() : "从未";
      const renderSubList = () => {
        subListEl.innerHTML = "";
        const store = loadSubStore();
        const subs = CONFIG.subscriptions || [];
        if (!subs.length) {
          const e = document.createElement("div");
          e.className = "empty";
          e.textContent = "（暂无订阅，添加 URL 后会显示在这里）";
          subListEl.appendChild(e);
          return;
        }
        const findSub = (url) => (CONFIG.subscriptions || []).find((s) => s.url === url);
        subs.forEach((sub) => {
          const e = store[sub.url] || {};
          const status = e.ok ? `✅ ${e.count || 0} 条 · ${fmtSubTime(e.lastSync)}` : e.error ? `⚠ ${e.error}` : "未同步";
          const row = document.createElement("div");
          row.className = "bfb-sub-row";
          row.innerHTML = `
          <label class="switch" style="margin:0"><input type="checkbox" class="sub-en" ${sub.enabled ? "checked" : ""}> <b>${escapeHtml(sub.name || metaGet(e.meta, "title") || "订阅")}</b></label>
          <div class="bfb-sub-url">${escapeHtml(sub.url)}</div>
          <div class="bfb-sub-status">${escapeHtml(status)}</div>
          <div class="chip-bar"><button class="chip-act sub-refresh">刷新</button><button class="chip-act sub-del">删除</button></div>`;
          q(row, ".sub-en").onchange = (ev) => {
            const cur = findSub(sub.url);
            if (!cur) return renderSubList();
            cur.enabled = ev.target.checked;
            saveConfig();
            rescanAfterRuleChange();
          };
          q(row, ".sub-refresh").onclick = () => {
            toast("刷新中…");
            syncSubscription(sub.url, (ok) => {
              rescanAfterRuleChange();
              renderSubList();
              toast(ok ? "已刷新" : "刷新失败");
            });
          };
          q(row, ".sub-del").onclick = () => {
            confirmModal("删除该订阅？其规则将立即移除。", { title: "删除订阅", okText: "删除", danger: true }).then((ok) => {
              if (!ok) return;
              const i = (CONFIG.subscriptions || []).findIndex((s) => s.url === sub.url);
              if (i >= 0) CONFIG.subscriptions.splice(i, 1);
              const st = loadSubStore();
              delete st[sub.url];
              saveSubStore(st);
              saveConfig();
              rescanAfterRuleChange();
              renderSubList();
            });
          };
          subListEl.appendChild(row);
        });
      };
      renderSubList();
      q(subSec, "#bfb-sub-add").onclick = () => {
        const urlEl = q(subSec, "#bfb-sub-url");
        const nameEl = q(subSec, "#bfb-sub-name");
        const url = (urlEl.value || "").trim();
        const name = (nameEl.value || "").trim();
        if (!/^https?:\/\//i.test(url)) return toast("请输入有效的 http(s) URL");
        if ((CONFIG.subscriptions || []).some((s) => s.url === url)) return toast("该订阅已存在");
        CONFIG.subscriptions = CONFIG.subscriptions || [];
        CONFIG.subscriptions.push({ url, name, enabled: true });
        saveConfig();
        urlEl.value = "";
        nameEl.value = "";
        renderSubList();
        toast("已添加，正在拉取…");
        syncSubscription(url, (ok) => {
          rescanAfterRuleChange();
          renderSubList();
          toast(ok ? "订阅已同步" : "拉取失败，请检查 URL");
        });
      };
      q(subSec, "#bfb-sub-refresh").onclick = () => {
        toast("刷新全部订阅…");
        refreshSubscriptions(true, (n) => {
          renderSubList();
          toast(`已刷新（${n} 条有更新）`);
        });
      };
    }
  };

  // src/ui/panel/sections/batch-block.ts
  var batchBlockSection = {
    tab: "tools",
    render(host) {
      const batch = document.createElement("div");
      batch.className = "sec";
      batch.innerHTML = `<label>批量拉黑</label>
      <button class="act" id="bfb-batch-block" style="width:100%">⛔ 拉黑当前页所有已屏蔽的 UP</button>
      <div class="hint">扫描本页所有被屏蔽的卡片并拉黑其 UP；无法获取 UID 的将通过 BV 号联网解析。此操作写入账号黑名单、不可一键撤销，执行前会二次确认。</div>`;
      host.appendChild(batch);
      q(batch, "#bfb-batch-block").onclick = () => {
        const blocked = document.querySelectorAll("[" + ATTR_BLOCKED + "]");
        if (!blocked.length) {
          toast("当前页还没有被屏蔽的卡片，先用规则屏蔽再批量拉黑");
          return;
        }
        const direct = [];
        const toResolve = [];
        let noInfo = 0;
        blocked.forEach((card) => {
          const i = extractCardInfo(card);
          const cu = !i.uid && i.bvid ? cachedUid(i.bvid) : "";
          if (i.uid) direct.push({ uid: String(i.uid), name: i.up || "" });
          else if (cu) direct.push({ uid: cu, name: i.up || "" });
          else if (i.bvid) toResolve.push({ bvid: i.bvid, name: i.up || "" });
          else noInfo++;
        });
        const est = direct.length + toResolve.length;
        if (!est) {
          toast(`本页 ${blocked.length} 张已屏蔽，但都拿不到 UID/BV，无法拉黑`);
          return;
        }
        const slowTip = toResolve.length ? `
其中 ${toResolve.length} 位需联网解析 UID（稍慢）` : "";
        const skipTip = noInfo ? `
（${noInfo} 张信息不足已跳过）` : "";
        const runBlacklist = (all) => {
          const btn = q(batch, "#bfb-batch-block");
          const origLabel = btn.textContent || "";
          btn.disabled = true;
          toast(`开始拉黑 ${all.length} 位…`);
          doBlacklistMany(
            all,
            (r) => {
              btn.disabled = false;
              btn.textContent = origLabel;
              toast(`批量拉黑完成：新拉黑 ${r.added}，已在黑名单 ${r.already}${r.failed.length ? `，失败 ${r.failed.length}（多为未登录/风控/已满）` : ""}`);
              refreshPanelIfOpen();
            },
            (pg) => {
              btn.textContent = pg.paused ? `⚠ 风控暂停 ${pg.wait}s · ${pg.done}/${pg.total}` : `拉黑中 ${pg.done}/${pg.total}…`;
            }
          );
        };
        const proceed = () => {
          if (!toResolve.length) {
            runBlacklist(direct);
            return;
          }
          toast(`正在解析 ${toResolve.length} 个 UID…`);
          const resolved = [];
          let pending = toResolve.length;
          toResolve.forEach((t) => {
            fetchView(t.bvid, (d) => {
              if (d && d.owner) resolved.push({ uid: String(d.owner.mid), name: d.owner.name || t.name });
              if (CONFIG.blacklistCollab && d && Array.isArray(d.staff)) {
                d.staff.forEach((s) => resolved.push({ uid: String(s.mid), name: s.name || "" }));
              }
              if (--pending === 0) runBlacklist(direct.concat(resolved));
            });
          });
        };
        confirmModal(`将拉黑当前页约 ${est} 位 UP。${slowTip}${skipTip}

会写入账号黑名单且不可一键撤销。`, {
          title: "批量拉黑确认",
          okText: `拉黑约 ${est} 位`,
          danger: true
        }).then((ok) => {
          if (ok) proceed();
        });
      };
    }
  };

  // src/ui/panel/sections/reset.ts
  var resetSection = {
    tab: "tools",
    render(host, ctx) {
      const tool = document.createElement("div");
      tool.className = "sec toolbar";
      tool.innerHTML = `<button class="act ghost" id="bfb-clearcount">清空计数 / 记录</button><button class="act ghost" id="bfb-reset">恢复默认</button>`;
      host.appendChild(tool);
      q(tool, "#bfb-clearcount").onclick = () => {
        CONFIG.blockedCount = 0;
        setSessionBlocked(0);
        blockedLog.length = 0;
        saveConfig();
        updateBadge();
        ctx.rerender();
        toast("已清空计数与本次记录");
      };
      q(tool, "#bfb-reset").onclick = () => {
        confirmModal("确定恢复默认配置？现有规则将全部清空，不可撤销。", { title: "恢复默认", okText: "恢复默认", danger: true }).then((ok) => {
          if (!ok) return;
          Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
          saveConfig();
          rescanAfterRuleChange();
          ctx.rerender();
        });
      };
    }
  };

  // src/ui/panel/sections/health.ts
  var healthSection = {
    tab: "tools",
    render(host) {
      const sec = document.createElement("div");
      sec.className = "sec";
      sec.innerHTML = `<label>🩺 运行自检 <button class="act ghost" id="bfb-health-refresh" style="float:right">刷新</button></label>
      <div class="stat" id="bfb-health-sum"></div>
      <div id="bfb-health-warn" style="margin-top:6px"></div>
      <div id="bfb-health-timing" style="margin-top:6px"></div>`;
      host.appendChild(sec);
      const sumEl = q(sec, "#bfb-health-sum");
      const warnEl = q(sec, "#bfb-health-warn");
      const timeEl = q(sec, "#bfb-health-timing");
      const refresh = () => {
        sumEl.textContent = healthSummary();
        const t = timingReport();
        timeEl.innerHTML = t.length ? '<label style="margin-top:8px">⏱ 耗时采样（调试模式）</label>' + t.map((x) => `<div class="stat">${escapeHtml(x)}</div>`).join("") + '<div class="hint">「共」是累计，「峰」是单次最慢——卡顿看峰值，写放大看次数。关闭调试模式即清零。</div>' : "";
        const w = healthReport();
        if (w.length) {
          warnEl.innerHTML = w.map((x) => `<div class="hint" style="color:#e74c3c">⚠ ${escapeHtml(x)}</div>`).join("");
          return;
        }
        const notes = healthNotes();
        warnEl.innerHTML = notes.length ? notes.map((x) => `<div class="hint">ℹ ${escapeHtml(x)}</div>`).join("") : '<div class="hint" style="color:#1b7a3d">✅ 拦截层与 DOM 层均工作正常</div>';
      };
      q(sec, "#bfb-health-refresh").onclick = refresh;
      refresh();
    }
  };

  // src/rulehealth.ts
  var OBSERVE_DAYS = 7;
  var DAY = 864e5;
  function ruleHealth() {
    const refs = enumerateRules();
    const stats = CONFIG.ruleStats || {};
    const byKey = new Map(refs.map((r) => [r.key, r]));
    const since = CONFIG.ruleStatsSince || 0;
    const days = since ? Math.floor((Date.now() - since) / DAY) : 0;
    const ready2 = !!since && days >= OBSERVE_DAYS;
    const hot = Object.keys(stats).map((key) => ({ key, n: stats[key], ref: byKey.get(key) || null })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    const dead = [];
    const inactive = [];
    const disabled = [];
    for (const r of refs) {
      if (!r.own || stats[r.key]) continue;
      if (r.disabled) disabled.push(r);
      else if (!r.active) inactive.push(r);
      else if (ready2) dead.push(r);
    }
    return { days, ready: ready2, hot, dead, inactive, disabled };
  }
  function pruneRuleStats() {
    const stats = CONFIG.ruleStats;
    if (!stats) return 0;
    const live = new Set(enumerateRules().map((r) => r.key));
    let n = 0;
    for (const k of Object.keys(stats)) {
      if (!live.has(k)) {
        delete stats[k];
        n++;
      }
    }
    if (n) scheduleStatsSave();
    return n;
  }

  // src/ui/panel/sections/rule-health.ts
  var HOT_N = 5;
  var DEAD_N = 50;
  var ruleHealthSection = {
    tab: "tools",
    render(host, ctx) {
      const sec = document.createElement("div");
      sec.className = "sec";
      sec.innerHTML = `<label>🩹 规则体检 <button class="act ghost" id="bfb-rh-refresh" style="float:right">刷新</button></label>
      <div class="stat" id="bfb-rh-since"></div>
      <div class="stat" id="bfb-rh-hot" style="margin-top:4px"></div>
      <div id="bfb-rh-dead" style="margin-top:6px"></div>`;
      host.appendChild(sec);
      const sinceEl = q(sec, "#bfb-rh-since");
      const hotEl = q(sec, "#bfb-rh-hot");
      const deadEl = q(sec, "#bfb-rh-dead");
      const render = () => {
        pruneRuleStats();
        const h = ruleHealth();
        sinceEl.textContent = h.days ? `已观察 ${h.days} 天，共 ${Object.keys(CONFIG.ruleStats || {}).length} 条规则有过命中` : "尚未积累命中数据（拦到第一个视频后开始统计）";
        hotEl.innerHTML = h.hot.length ? "最常命中：" + h.hot.slice(0, HOT_N).map((x) => `<span title="命中越多越可能写得过宽">${escapeHtml(x.key)}×${x.n}</span>`).join("  ") : "";
        hotEl.style.display = h.hot.length ? "" : "none";
        deadEl.innerHTML = "";
        if (h.disabled.length) {
          const n = document.createElement("div");
          n.className = "hint";
          n.textContent = `⏸ ${h.disabled.length} 条规则被你停用中（仍在名单里，不参与匹配）：${h.disabled.map((r) => r.line).join("、")}`;
          deadEl.appendChild(n);
        }
        if (h.inactive.length) {
          const n = document.createElement("div");
          n.className = "hint";
          n.textContent = `ℹ ${h.inactive.length} 条标签 / 简介类规则当前不会生效（「精确过滤」未开启），不计入下面的统计。`;
          deadEl.appendChild(n);
        }
        if (!h.ready) {
          const n = document.createElement("div");
          n.className = "hint";
          n.textContent = h.days ? `观察满 ${OBSERVE_DAYS} 天后（还差 ${OBSERVE_DAYS - h.days} 天）才会列出「从未命中」的规则——时间太短，谁都还没命中。` : `观察满 ${OBSERVE_DAYS} 天后会在这里列出「从未命中」的规则。`;
          deadEl.appendChild(n);
          return;
        }
        if (!h.dead.length) {
          const n = document.createElement("div");
          n.className = "hint";
          n.style.color = "#1b7a3d";
          n.textContent = `✅ ${OBSERVE_DAYS} 天内每条规则都命中过，没有明显的死规则。`;
          deadEl.appendChild(n);
          return;
        }
        const title = document.createElement("div");
        title.className = "hint";
        title.textContent = `⚠ ${h.dead.length} 条规则在这 ${h.days} 天里一次都没命中，可能是写错了、或对象已经不发这类内容了：`;
        deadEl.appendChild(title);
        const list = document.createElement("div");
        list.style.cssText = "max-height:180px;overflow:auto;overscroll-behavior:contain;margin-top:4px;font-size:12px";
        h.dead.slice(0, DEAD_N).forEach((r) => {
          const row = document.createElement("div");
          row.className = "log-row";
          const tx = document.createElement("span");
          tx.className = "log-tx";
          tx.innerHTML = `<span class="log-rs">[${escapeHtml(r.dim)}]</span> ${escapeHtml(r.line)}`;
          tx.title = r.line;
          row.appendChild(tx);
          const off = document.createElement("button");
          off.className = "log-pass";
          off.textContent = "⏸停用";
          off.title = "暂时停用这条规则（保留在名单里，随时可在对应名单里重新启用）";
          off.onclick = () => {
            toggleRuleDisabled("block." + r.field, r.line);
            toast(`已停用规则：${r.line}（在「${r.dim}」名单里可重新启用）`);
            ctx.rerender();
          };
          row.appendChild(off);
          const del = document.createElement("button");
          del.className = "log-pass";
          del.textContent = "✂删";
          del.title = "从名单中删除这条规则";
          del.onclick = () => {
            confirmModal(`将从「${r.dim}」名单中删除这条规则：
${r.line}`, {
              title: "删除规则",
              okText: "删除",
              danger: true
            }).then((ok) => {
              if (!ok) return;
              const arr = CONFIG.block[r.field];
              const at = arr.indexOf(r.line);
              removeFromList(arr, r.line);
              toast(`已删除规则：${r.line}`, "info", {
                label: "撤销",
                onClick: () => {
                  restoreToList(arr, r.line, at);
                  ctx.rerender();
                }
              });
              ctx.rerender();
            });
          };
          row.appendChild(del);
          list.appendChild(row);
        });
        if (h.dead.length > DEAD_N) {
          const more = document.createElement("div");
          more.className = "hint";
          more.textContent = `⋯ 另有 ${h.dead.length - DEAD_N} 条未列出（共 ${h.dead.length} 条）。UID 类规则数量大时这很正常——它们只是还没轮到被推荐，不代表写错了。`;
          list.appendChild(more);
        }
        deadEl.appendChild(list);
      };
      q(sec, "#bfb-rh-refresh").onclick = render;
      render();
    }
  };

  // src/ui/panel/sections/log.ts
  var logSection = {
    tab: "tools",
    render(host, ctx) {
      const logSec = document.createElement("div");
      logSec.className = "sec";
      logSec.innerHTML = `<label>🔎 屏蔽记录（本次会话共 <span id="bfb-log-count">0</span> 条） <button class="act ghost" id="bfb-log-toggle" style="float:right">展开 / 收起</button></label><div class="stat" id="bfb-log-tally">分类：暂无</div><div id="bfb-log-list" style="display:none;max-height:240px;overflow:auto;overscroll-behavior:contain;margin-top:6px;font-size:12px"></div>`;
      host.appendChild(logSec);
      const logList = q(logSec, "#bfb-log-list");
      const logCount = q(logSec, "#bfb-log-count");
      const logTally = q(logSec, "#bfb-log-tally");
      const foot = document.createElement("div");
      foot.className = "sec";
      foot.innerHTML = `<a class="manage" href="${BLACKLIST_MANAGE_URL}" target="_blank">→ 打开 B 站官方黑名单管理页（取消拉黑 / 查看人数）</a>
      <div class="stat" style="margin-top:6px" title="「拦」来源的计数是「已从接口数据中删除」——极少数情况下那批数据最终没被页面渲染（请求重试、组件卸载），此时计数会略高于你实际少看到的条数。">累计拦截 <span id="bfb-foot-total">0</span> 次 · 本次会话 <span id="bfb-foot-session">0</span> 次</div>`;
      host.appendChild(foot);
      const footTotal = q(foot, "#bfb-foot-total");
      const footSession = q(foot, "#bfb-foot-session");
      const refreshLog = () => {
        logCount.textContent = String(blockedLog.length);
        const tally = tallyLog();
        logTally.textContent = "分类：" + (Object.keys(tally).length ? Object.entries(tally).map(([k, v]) => `${k}×${v}`).join("  ") : "暂无");
        footTotal.textContent = String(CONFIG.blockedCount);
        footSession.textContent = String(sessionBlocked);
        if (logList.style.display === "none") return;
        logList.innerHTML = "";
        if (!blockedLog.length) {
          logList.innerHTML = '<div class="stat">暂无记录</div>';
          return;
        }
        const blacklisted = new Set(ruleLines(CONFIG.block.uids));
        blockedLog.slice(0, 100).forEach((b) => {
          const row = document.createElement("div");
          row.className = "log-row";
          const tx = document.createElement("span");
          tx.className = "log-tx";
          const desc = b.title || (b.link ? b.link.replace(/^https?:\/\//, "").slice(0, 48) : "") || b.bvid || (b.uid ? "UID " + b.uid : "") || "(无可辨识信息)";
          const srcTag = b.src === "BL" ? '<span class="log-src net">黑</span>' : b.src === "NET" ? '<span class="log-src net">拦</span>' : b.src === "CMT" ? '<span class="log-src dom">评</span>' : '<span class="log-src dom">隐</span>';
          const safeHttp = (u) => u && /^https?:\/\//i.test(u) ? u : "";
          const upHref = b.uid ? "https://space.bilibili.com/" + encodeURIComponent(b.uid) : "";
          const vidHref = b.bvid ? "https://www.bilibili.com/video/" + encodeURIComponent(b.bvid) : safeHttp(b.link);
          const A = (href, inner) => `<a class="log-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
          const upHtml = b.up ? (upHref ? A(upHref, "<b>" + escapeHtml(b.up) + "</b>") : "<b>" + escapeHtml(b.up) + "</b>") + " · " : "";
          const descHtml = vidHref ? A(vidHref, escapeHtml(desc)) : escapeHtml(desc);
          tx.innerHTML = `${srcTag}<span class="log-rs">[${escapeHtml(b.reason)}]</span> ${upHtml}${descHtml}`;
          tx.title = (b.up ? b.up + " · " : "") + (b.title || desc) + (b.bvid ? "  ·  " + b.bvid : "") + (b.uid ? "  ·  UID " + b.uid : "") + (b.link ? "\n" + b.link : "");
          row.appendChild(tx);
          if (b.up || b.uid) {
            const pass = document.createElement("button");
            pass.className = "log-pass";
            pass.textContent = "✅放行";
            pass.title = "误伤了？把该 UP 加入白名单（永不屏蔽）。DOM 隐藏的会立即恢复，网络拦截删除的刷新后恢复。";
            pass.onclick = () => {
              if (b.uid) addToList(CONFIG.allow.uids, b.uid);
              else addToList(CONFIG.allow.upNames, b.up);
              toast(`已放行并加入白名单：${b.up || "UID " + b.uid}`);
              refreshPanelIfOpen();
            };
            row.appendChild(pass);
          }
          const isBlacklisted = b.uid && blacklisted.has(String(b.uid));
          const loc = b.src === "BL" && isBlacklisted ? null : locateRule(b.reason);
          if (loc) {
            const del = document.createElement("button");
            del.className = "log-pass";
            del.textContent = "✂删规则";
            del.title = `这条是被规则「${loc.line}」拦下的。删掉它（刷新后此类视频恢复推荐）。`;
            del.onclick = () => {
              confirmModal(`删除规则「${loc.line}」？此后它不再屏蔽任何视频。`, { title: "删除规则", okText: "删除", danger: true }).then((ok) => {
                if (!ok) return;
                const arr = CONFIG.block[loc.field];
                const at = arr.indexOf(loc.line);
                removeFromList(arr, loc.line);
                toast(`已删除规则：${loc.line}`, "info", {
                  label: "撤销",
                  onClick: () => {
                    restoreToList(arr, loc.line, at);
                    refreshPanelIfOpen();
                  }
                });
                refreshPanelIfOpen();
              });
            };
            row.appendChild(del);
          } else if (b.reason.indexOf(":") > 0 && REASON_RULE_FIELD[b.reason.slice(0, b.reason.indexOf(":"))]) {
            const hint = document.createElement("span");
            hint.className = "log-src";
            hint.textContent = "订阅";
            hint.title = "这条规则来自已启用的订阅，不在你自己的名单里。要停用它请到「工具 → 规则订阅」。";
            row.appendChild(hint);
          }
          if (b.src === "BL" && isBlacklisted) {
            const undo = document.createElement("button");
            undo.className = "log-undo";
            undo.textContent = "↩撤销";
            undo.title = "撤销拉黑：账号侧移出黑名单 + 本地恢复（刷新后该 UP 恢复推荐）";
            undo.onclick = () => {
              confirmModal(`撤销拉黑「${b.up || "UID " + b.uid}」？将移出账号黑名单，刷新后恢复推荐。`, { title: "撤销拉黑", okText: "撤销" }).then((ok) => {
                if (!ok) return;
                undo.disabled = true;
                undo.textContent = "…";
                unblockUp(String(b.uid), b.up, () => refreshLog());
              });
            };
            row.appendChild(undo);
          } else if (b.up || b.uid || b.bvid) {
            const blk = document.createElement("button");
            blk.className = "log-blk";
            blk.textContent = "⛔拉黑";
            blk.title = "拉黑该 UP（同步账号黑名单）";
            blk.onclick = () => {
              confirmModal(`确定拉黑「${b.up || "UID " + b.uid || b.bvid}」并写入账号黑名单？
刷新后不再推荐、不可一键撤销（可在此处「撤销」恢复）。`, {
                title: "拉黑确认",
                okText: "拉黑",
                danger: true
              }).then((ok) => {
                if (!ok) return;
                blk.disabled = true;
                blk.textContent = "…";
                blacklistUp({ up: b.up, uid: b.uid, bvid: b.bvid }, () => refreshLog());
              });
            };
            row.appendChild(blk);
          }
          logList.appendChild(row);
        });
      };
      q(logSec, "#bfb-log-toggle").onclick = () => {
        logList.style.display = logList.style.display === "none" ? "block" : "none";
        refreshLog();
      };
      ctx.setStatsRefresh(refreshLog);
      refreshLog();
    }
  };

  // src/ui/panel/index.ts
  var PANEL_TABS = [
    ["base", "⚙ 基础", "常规开关与卡片类型过滤"],
    ["black", "🚫 黑名单", "按标题、UP 主、分区屏蔽，即时生效；以 /.../ 包裹表示正则（如 /震惊.*竟然/），否则为关键词包含匹配（不区分大小写）"],
    ["api", "🛰 进阶", "按播放量、时长，以及标签、数据等维度精细过滤（标签类维度需开启下方「精确过滤」）"],
    ["comment", "💬 评论", "过滤视频与动态评论区的引战、水军、营销及 AI 评论（基于评论数据隐藏，仅在含评论的页面生效，与视频规则相互独立）"],
    ["allow", "⭐ 白名单", "命中白名单的内容永不隐藏，优先级最高"],
    ["tools", "🧰 工具", "预置库、重置、屏蔽记录"]
  ];
  var SECTIONS = [
    baseSection,
    blackListsSection,
    advancedSection,
    apiListsSection,
    commentSection,
    allowListsSection,
    presetsSection,
    regexTesterSection,
    ioSection,
    backupsSection,
    // 紧跟导入导出：都是「配置的保存与找回」，放一块儿用户才想得起来它
    nameListSection,
    subscriptionsSection,
    batchBlockSection,
    resetSection,
    healthSection,
    ruleHealthSection,
    logSection
  ];
  var activeTab = "base";
  var finderQuery = "";
  var lastFocus = null;
  function panelEl() {
    return document.getElementById("bfb-panel");
  }
  function isPanelOpen() {
    const p = panelEl();
    return !!(p && p.classList.contains("open"));
  }
  function buildPanel() {
    const exist = panelEl();
    if (exist) return exist;
    const p = document.createElement("div");
    p.id = "bfb-panel";
    p.tabIndex = -1;
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "biliHoyoFairy 设置");
    ["keydown", "keypress", "keyup", "input"].forEach((ev) => {
      p.addEventListener(ev, (e) => {
        const t = e.target;
        if (t instanceof Element && t.matches("input, textarea, select")) e.stopPropagation();
      });
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape" || !p.classList.contains("open")) return;
        if (document.querySelector(".bfb-modal-back")) return;
        closePanel();
      },
      true
    );
    document.body.appendChild(p);
    return p;
  }
  function renderPanel(p) {
    p.innerHTML = "";
    setStatsRefresh(null);
    const h2 = document.createElement("h2");
    h2.innerHTML = `🛡 biliHoyoFairy · 抗击黑潮 <small style="font-weight:normal;opacity:.6;font-size:12px">v${VERSION} · ${pageType()}</small> <span class="x" role="button" tabindex="0" aria-label="关闭设置面板">✕</span>`;
    p.appendChild(h2);
    const xBtn = q(h2, ".x");
    xBtn.onclick = closePanel;
    xBtn.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        closePanel();
      }
    };
    const tabBar = document.createElement("div");
    tabBar.className = "tabs";
    p.appendChild(tabBar);
    if (!PANEL_TABS.some(([id]) => id === activeTab)) activeTab = "base";
    const groups = {};
    PANEL_TABS.forEach(([id, label, tip]) => {
      const tb = document.createElement("button");
      tb.className = "tab" + (id === activeTab ? " active" : "");
      tb.textContent = label;
      tabBar.appendChild(tb);
      const g = document.createElement("div");
      g.className = "bfb-group" + (id === activeTab ? " active" : "");
      const tipEl = document.createElement("div");
      tipEl.className = "grp-tip";
      tipEl.textContent = tip;
      g.appendChild(tipEl);
      p.appendChild(g);
      groups[id] = g;
      tb.onclick = () => {
        activeTab = id;
        tabBar.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        tb.classList.add("active");
        Object.values(groups).forEach((x) => x.classList.remove("active"));
        g.classList.add("active");
        p.scrollTop = 0;
      };
    });
    const finder = document.createElement("div");
    finder.className = "bfb-finder";
    const fInput = document.createElement("input");
    fInput.type = "text";
    fInput.placeholder = "搜索设置项…";
    const fClear = document.createElement("button");
    fClear.textContent = "✕";
    fClear.title = "清除";
    const fStat = document.createElement("span");
    fStat.className = "fst";
    finder.append(fInput, fClear, fStat);
    p.insertBefore(finder, tabBar.nextSibling);
    let total = 0;
    const applyFinder = () => {
      const kw = fInput.value.trim().toLowerCase();
      Object.entries(groups).forEach(([id, g]) => {
        const secs = Array.from(g.querySelectorAll(":scope > .sec"));
        let shown = 0;
        for (const sec of secs) {
          const hit = !kw || (sec.textContent || "").toLowerCase().includes(kw);
          sec.style.display = hit ? "" : "none";
          if (hit) shown++;
        }
        const tip = g.querySelector(".grp-tip");
        if (tip) tip.style.display = kw ? "none" : "";
        g.classList.toggle("active", kw ? shown > 0 : id === activeTab);
        total += shown;
      });
    };
    const runFinder = () => {
      total = 0;
      applyFinder();
      const kw = fInput.value.trim();
      fStat.textContent = kw ? total ? `${total} 项` : "无匹配" : "";
      fClear.style.display = kw ? "" : "none";
      tabBar.style.display = kw ? "none" : "";
      p.scrollTop = 0;
    };
    fInput.value = finderQuery;
    fClear.style.display = finderQuery ? "" : "none";
    fInput.addEventListener("input", () => {
      finderQuery = fInput.value;
      runFinder();
    });
    fClear.onclick = () => {
      fInput.value = "";
      finderQuery = "";
      runFinder();
      fInput.focus();
    };
    const ctx = {
      panel: p,
      groups,
      // 重渲整个面板并保持打开状态（分区改了会影响别处展示时用）
      rerender: () => {
        renderPanel(p);
        p.classList.add("open");
      },
      refreshStats: () => runStatsRefresh(),
      setStatsRefresh
    };
    for (const sec of SECTIONS) {
      const host = groups[sec.tab];
      if (!host) continue;
      sec.render(host, ctx);
    }
    if (finderQuery) runFinder();
  }
  function openPanel2() {
    lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const p = buildPanel();
    renderPanel(p);
    p.classList.add("open");
    try {
      p.focus();
    } catch (e) {
    }
  }
  function closePanel() {
    const p = panelEl();
    if (p) p.classList.remove("open");
    if (lastFocus) {
      try {
        lastFocus.focus();
      } catch (e) {
      }
    }
    lastFocus = null;
  }
  function refreshPanelIfOpen2() {
    const p = panelEl();
    if (!p || !p.classList.contains("open")) return;
    renderPanel(p);
  }
  function refreshStatsIfOpen() {
    if (hasStatsRefresh() && isPanelOpen()) runStatsRefresh();
  }

  // src/main.ts
  (function() {
    "use strict";
    configureCardDetect(() => ({ detectAd: CONFIG.hideAd }));
    setTimingEnabled(CONFIG.debug);
    setPanelHooks({
      refreshPanelIfOpen: () => refreshPanelIfOpen2(),
      openPanel: () => openPanel2()
    });
    setStatsListener(() => {
      if (document.body) updateBadge();
      refreshStatsIfOpen();
    });
    setRulesChangedHandler(() => rescanAfterRuleChange());
    setConfigNotifier((msg) => {
      logErr("配置告警", msg);
      if (document.body) toast(msg, "warn", void 0, 12e3);
    });
    installConfigSync(() => {
      rescanAfterRuleChange();
      if (document.body) updateBadge();
      const ae = document.activeElement;
      const typing = !!(ae && ae.closest("#bfb-panel") && ae.matches("input, textarea, select"));
      if (!typing) refreshPanelIfOpen2();
      toast("⚙ 配置已在另一个标签页更新，本页已同步");
    });
    function installShadowHook() {
      const orig = Element.prototype.attachShadow;
      if (orig.__bfb) return;
      const wrapped = function(init) {
        const root = orig.call(this, init);
        try {
          addShadowRoot(root);
          if (isCommentTag(this.tagName)) scheduleCommentScan();
        } catch (e) {
          logErr("attachShadow.hook", e);
        }
        return root;
      };
      wrapped.__bfb = true;
      try {
        Element.prototype.attachShadow = wrapped;
      } catch (e) {
        logErr("installShadowHook", e);
      }
    }
    function start() {
      console.log(
        `%c[biliHoyoFairy]%c v${VERSION} 已启动 | 页面:${pageType()} | 拦截:${CONFIG.enabled ? "开" : "关"}${CONFIG.debug ? " | 调试" : ""}`,
        BADGE + ";font-weight:bold",
        "color:#fb7299"
      );
      if (configRescue.corrupted) {
        logErr("配置存档损坏", `已回落到默认配置；原始内容存于 GM 存储键 ${configRescue.backupKey}，原文见下一行`);
        logErr("配置存档损坏（原始内容）", configRescue.raw);
        toast("⚠ 配置存档损坏，设置已回到默认值。原内容已备份（详见控制台），请勿急着重设规则", "error");
      }
      updateBadge();
      applyHotSearchStyle();
      harvestShadowRoots(document);
      scanAll();
      scanComments();
      refreshSubscriptions(false);
      document.addEventListener("contextmenu", safe("onContextMenu", onContextMenu), true);
      document.addEventListener("mouseover", safe("onCardHover", onCardHover), true);
      document.addEventListener("scroll", safe("hideHoverBtn", hideHoverBtn), true);
      document.addEventListener("click", safe("closeCtxMenu", closeCtxMenu), true);
      document.addEventListener("scroll", safe("closeCtxMenu", closeCtxMenu), true);
      document.addEventListener(
        "keydown",
        safe("closeCtxMenu", (e) => {
          if (e.key === "Escape") closeCtxMenu();
        }),
        true
      );
      setTimeout(() => {
        markHealthReady();
        updateBadge();
        if (!CONFIG.enabled) return;
        for (const w of healthReport()) logErr("运行自检", w);
        if (sessionBlocked <= 0) return;
        const top = Object.entries(tallyLog()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join("、");
        toast(`🛡 本次加载已拦截 ${sessionBlocked} 个：${top}（点右下角🛡看明细 / 放行）`);
      }, STARTUP_SUMMARY_MS);
      if (!CONFIG.onboarded) {
        CONFIG.onboarded = true;
        saveConfig();
        toast("👋 已启用。点这里挑几组预置规则，一分钟配好", "success", { label: "去挑选", onClick: openPanel2 }, 15e3);
      }
      GM_registerMenuCommand("打开设置面板", openPanel2);
      GM_registerMenuCommand("暂停/启用拦截", () => {
        CONFIG.enabled = !CONFIG.enabled;
        saveConfig();
        updateBadge();
        if (CONFIG.enabled) scanAll();
      });
      GM_registerMenuCommand("打开官方黑名单管理页", () => window.open(BLACKLIST_MANAGE_URL, "_blank"));
    }
    installNetworkHooks();
    installShadowHook();
    startScanner();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  })();
})();
