// 配置：默认值 + 本地存储（GM）+ 载入合并 + 导入/导出。CONFIG 为全局共享单例（对象被各模块就地读写）。
import { SCHEMA_VERSION, STORE_KEY, UNSAFE_KEYS, VERSION } from './constants';

export interface BlockConfig {
  keywords: string[];
  partitions: string[];
  upNames: string[];
  uids: string[];
  bvids: string[];
  minDuration: number;
  maxDuration: number;
  minViews: number;
  spamLikeRatio: number;
  spamMinViews: number;
  tags: string[];
  dualTags: string[];
  upBio: string[];
}

export interface AllowConfig {
  keywords: string[];
  upNames: string[];
  uids: string[];
}

export interface CommentConfig {
  enabled: boolean;
  keywords: string[];
  userNames: string[];
  userNameKeywords: string[];
  minLevel: number;
  hideNoFace: boolean;
  hideEmojiOnly: boolean;
  hideCallOnly: boolean;
  hideAd: boolean;
  hideCallBot: boolean;
  hideBot: boolean;
  allowUp: boolean;
  allowPin: boolean;
  allowMe: boolean;
  collapse: boolean;
}

export interface Subscription {
  url: string;
  name: string;
  enabled: boolean;
}

export interface AppConfig {
  schemaVersion: number;
  enabled: boolean;
  reviewMode: boolean;
  rightClickBlock: boolean;
  cardHoverBtn: boolean;
  fuzzyMatch: boolean;
  blacklistCollab: boolean;
  block: BlockConfig;
  allow: AllowConfig;
  hideAd: boolean;
  hideLiveCard: boolean;
  hideHotSearch: boolean;
  apiFilters: boolean;
  hideCharging: boolean;
  boostFeedLoad: boolean;
  comment: CommentConfig;
  debug: boolean;
  blockedCount: number;
  uidNames: Record<string, string>;
  subscriptions: Subscription[];
}

export const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  reviewMode: false, // 审查模式：被拦视频不删/不隐，而是标记+就地放行，便于核对防误伤
  rightClickBlock: true,
  cardHoverBtn: false, // 悬停卡片时显示快捷「拉黑」浮层按钮（独立浮层，不改 B 站卡片 DOM）
  fuzzyMatch: true, // 反绕过：普通关键词匹配前剔除分隔符（“原 神/原.神”也命中）；隐形字符始终剔除
  blacklistCollab: false, // 拉黑联合投稿时，是否把所有合作者一并拉黑
  block: {
    keywords: [], // 命中 标题/UP名/分区（纯本地，不联网；标签匹配请用 tags 维度）；普通词=包含，/.../ =正则
    partitions: [], // 视频分区(tname)黑名单；普通词=包含，/.../ =正则（网络拦截层最准）
    upNames: [],
    uids: [],
    bvids: [],
    minDuration: 0,
    maxDuration: 0,
    minViews: 0, // 万；>0 时播放量低于此值的视频被拦
    spamLikeRatio: 0, // %；>0 时，点赞率(点赞/播放)低于此值且播放≥下方阈值的视频判为营销号/搬运号（仅 feed 有点赞数据时生效）
    spamMinViews: 10, // 万；营销号识别的最低播放门槛（避免冤枉小/新视频）
    // —— 以下为需要读取接口数据的维度（仅在开启「精确过滤」后生效）——
    tags: [], // 视频标签黑名单（标题区看不到，需调接口；支持 /正则/）
    dualTags: [], // 双重标签，“原神+鸣潮” 形式，同时命中两组才拦（治引战）
    upBio: [], // UP 简介关键词黑名单（支持 /正则/）
  },
  allow: { keywords: [], upNames: [], uids: [] },
  hideAd: false,
  hideLiveCard: false, // 屏蔽信息流里的直播推荐卡（首页/动态里链向 live.bilibili.com 的卡）
  hideHotSearch: false,
  apiFilters: false, // 精确过滤总开关（关闭时完全不联网）
  hideCharging: false, // 充电专属视频（API）
  boostFeedLoad: false, // 增大首页推荐每次请求的视频数（拦截层删项后仍保持信息流饱满）
  // —— 评论区过滤（独立一套，读评论组件 __data；仅在有评论的页面生效）——
  comment: {
    enabled: false, // 评论区过滤总开关（关=完全不处理评论）
    keywords: [], // 评论正文关键词黑名单（独立于视频关键词；支持 /正则/、作用域前缀无意义）
    userNames: [], // 评论用户名精确黑名单
    userNameKeywords: [], // 评论用户名昵称关键词黑名单（支持 /正则/）
    minLevel: 0, // 评论者等级低于此值则隐藏（0=不启用）
    hideNoFace: false, // 默认头像且非会员（小号/水军特征）
    hideEmojiOnly: false, // 纯表情/纯 @ 的空洞评论
    hideCallOnly: false, // 只含 @其他用户、无实质内容
    hideAd: false, // 带货/导流广告评论
    hideCallBot: false, // 召唤 AI 的评论
    hideBot: false, // AI 机器人发布的评论
    allowUp: true, // 白名单：UP 主本人的评论免过滤
    allowPin: true, // 白名单：置顶评论免过滤
    allowMe: true, // 白名单：自己发布/被 @ 的评论免过滤
    collapse: true, // 命中后折叠为一行灰条（点击展开），而非直接隐藏
  },
  debug: false,
  blockedCount: 0,
  uidNames: {}, // uid -> UP 名 缓存（仅用于面板按名称展示；拉黑仍用 uid）
  // 规则订阅：每条 { url, name, enabled }。拉取到的规则数据另存于 SUB_STORE_KEY 缓存（不进 config，不外传）
  subscriptions: [],
};

// 深合并：override 的同名对象递归并入 base，其余标量直接覆盖（原型链污染键已被 UNSAFE_KEYS 拦掉）。
export function deepMerge(base: Record<string, any>, override: any): Record<string, any> {
  for (const k of Object.keys(override || {})) {
    if (UNSAFE_KEYS.has(k)) continue;
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k]) && typeof base[k] === 'object') {
      deepMerge(base[k], override[k]);
    } else {
      base[k] = override[k];
    }
  }
  return base;
}

// 结构迁移表：键 = 存档的当前 schemaVersion，值 = 把它就地升到 键+1 的函数。
// 只有「改字段名/改语义/改单位」这类 deepMerge 补不了的变更才需要在这里登记；
// 纯新增字段不需要（deepMerge 会自动补默认值），也就不需要动 SCHEMA_VERSION。
//
// 例：把旧的分钟单位时长改成秒，就写
//   1: (c) => { if (c.block) c.block.minDuration = (c.block.minDuration || 0) * 60; },
// 并把 SCHEMA_VERSION 提到 2。
const MIGRATIONS: Record<number, (c: any) => void> = {};

// 把任意来源（存档/导入文件）的原始配置对象升级到当前结构版本，就地修改。
// 缺 schemaVersion 的老存档视为 0，从头逐级跑；单级迁移抛错时停在该级，
// 剩下的交给 deepMerge 用默认值兜底——宁可丢一部分配置，也不要让脚本起不来。
export function migrateConfig(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') return parsed;
  let v = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break; // 无登记迁移=该级无需改写，直接跳过
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

// 读取存档：先按 schemaVersion 逐级迁移，再与默认值合并（新增字段由 deepMerge 自动补默认值）。
export function loadConfig(): AppConfig {
  const raw = GM_getValue(STORE_KEY, null);
  if (!raw) return structuredClone(DEFAULT_CONFIG);
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return deepMerge(structuredClone(DEFAULT_CONFIG), migrateConfig(parsed)) as AppConfig;
  } catch (e) {
    return structuredClone(DEFAULT_CONFIG);
  }
}

// 全局共享配置单例。
export const CONFIG: AppConfig = loadConfig();

export function saveConfig(): void {
  GM_setValue(STORE_KEY, JSON.stringify(CONFIG));
}

// uidNames（持久化）软上限：达上限后不再写入「新」键，避免存档 blob 无界膨胀（仅影响新 UP 按名展示，退回显示 uid）。
// 单点 setter：api 自动回填 / 拉黑写名 / 面板手动解析 三处统一调用，杜绝将来漏限。不负责存盘，由调用方决定时机。
const UID_NAMES_MAX = 5000;
export function setUidName(uid: unknown, name: string): void {
  const k = String(uid || '');
  if (!k || !name) return;
  if (CONFIG.uidNames[k] !== undefined || Object.keys(CONFIG.uidNames).length < UID_NAMES_MAX) {
    CONFIG.uidNames[k] = name;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConfig, 1200);
}

// 导出：仅含可分享的规则与过滤开关，剔除统计/缓存/个人会话偏好。
// 不可移植键：导出时剔除、导入时同样剔除（对称）。尤其 subscriptions——否则别人分享的「规则文件」
// 可借导入悄悄塞进会自动联网拉取的订阅 URL（安全风险）。
export const NON_PORTABLE = ['blockedCount', 'uidNames', 'enabled', 'debug', 'reviewMode', 'subscriptions'];
export function exportConfig(): string {
  const c: Record<string, any> = structuredClone(CONFIG);
  NON_PORTABLE.forEach((k) => delete c[k]);
  return JSON.stringify({ app: 'biliHoyoFairy', version: VERSION, config: c }, null, 2);
}

// 单个规则数组导入后的容量上限：防恶意/超大「规则文件」灌入无界列表拖垮匹配。
const IMPORT_ARRAY_CAP = 50000;

// 按 DEFAULT_CONFIG 的形状清洗**不可信**输入（导入的规则文件、订阅里带的配置）。
// 只保留默认配置里存在的键，且类型必须对得上：
//   - 类型不符的标量直接丢弃（保留原值，不做强转——把 "abc" 转成 0 比丢掉更难排查）
//   - 数组：非数组丢弃；元素只留字符串（曾经的坑：keywords 被写成字符串时，
//     下游 for..of 会按**字符**遍历，把 "原神" 变成两条单字规则，几乎屏蔽整个首页）
//   - 对象：按默认值递归；DEFAULT 里是空对象的（uidNames）无形状可依，整块丢弃
// 只用于导入路径，不用于 loadConfig——本地存档里 uidNames/subscriptions 是有内容的合法数据。
export function sanitizeConfigInput(input: any, ref: any = DEFAULT_CONFIG): Record<string, any> {
  const out: Record<string, any> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const k of Object.keys(ref)) {
    if (UNSAFE_KEYS.has(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(input, k)) continue;
    const v = input[k];
    const r = ref[k];
    if (Array.isArray(r)) {
      if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
    } else if (r && typeof r === 'object') {
      const sub = sanitizeConfigInput(v, r);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (typeof v === typeof r) {
      out[k] = v;
    }
  }
  return out;
}

// 导入合并：规则数组取并集（不丢已有），对象递归，标量以导入值为准。
export function mergeImport(base: Record<string, any>, inc: any): void {
  for (const k of Object.keys(inc || {})) {
    if (UNSAFE_KEYS.has(k)) continue;
    const v = inc[k];
    if (Array.isArray(v)) {
      if (!Array.isArray(base[k])) base[k] = [];
      const seen = new Set(base[k].map(String)); // 一次性建索引，避免 O(n²)
      for (const it of v) {
        if (base[k].length >= IMPORT_ARRAY_CAP) break;
        const s = String(it);
        if (!seen.has(s)) {
          seen.add(s);
          base[k].push(it);
        }
      }
    } else if (v && typeof v === 'object' && base[k] && typeof base[k] === 'object') {
      mergeImport(base[k], v);
    } else {
      base[k] = v;
    }
  }
}
