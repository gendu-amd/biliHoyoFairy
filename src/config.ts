// 配置：默认值 + 本地存储（GM）+ 载入合并 + 导入/导出。CONFIG 为全局共享单例（对象被各模块就地读写）。
import {
  BACKUP_KEY,
  BACKUP_MAX,
  SAVE_DEBOUNCE_MS,
  SCHEMA_VERSION,
  SHRINK_ALERT_MIN,
  STATS_KEY,
  STORE_BACKUP_KEY,
  STORE_KEY,
  SYNC_COALESCE_MS,
  UNSAFE_KEYS,
  VERSION,
} from './constants';
import { timed } from './health';
import { SUB_DIMS } from './subscriptions/parse';

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
  // 简繁归一：匹配前把繁体归到简体，「原神/原神」互通（单向，见 match/t2s.ts）。
  tradNorm: boolean;
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
  // 每条规则的累计命中次数（键 = 原因串 `维度:规则`）。跨会话持久化：一条规则是不是「死规则」，
  // 单次会话根本判不出来（今天首页没推这类视频不代表规则写错了），必须看长期计数。
  ruleStats: Record<string, number>;
  // 开始统计的时间戳。没有它就无法区分「装了三个月没命中=可疑」和「昨天刚装=正常」。
  ruleStatsSince: number;
  // 首次安装引导是否已展示过（一次性，展示后置 true）。
  onboarded: boolean;
  // 被「停用」的规则：键 = 'block.keywords' 这样的名单路径，值 = 停用的**原行**。
  // 存原行而不是下标——名单会增删，下标会漂到别的规则上。
  disabled: Record<string, string[]>;
  subscriptions: Subscription[];
}

export const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  reviewMode: false, // 审查模式：被拦视频不删/不隐，而是标记+就地放行，便于核对防误伤
  rightClickBlock: true,
  cardHoverBtn: false, // 悬停卡片时显示快捷「拉黑」浮层按钮（独立浮层，不改 B 站卡片 DOM）
  fuzzyMatch: true, // 反绕过：普通关键词匹配前剔除分隔符（“原 神/原.神”也命中）；隐形字符始终剔除
  tradNorm: false, // 简繁归一（默认关：多数用户用不到，且要多建一张 2.8k 条的表）
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
  ruleStats: {}, // 规则 -> 累计命中次数（规则体检：过宽 / 从未命中）
  ruleStatsSince: 0, // 首次记账的时间戳（0=尚未开始统计）
  onboarded: false,
  disabled: {}, // 规则停用表（见 AppConfig.disabled / isRuleDisabled）
  // 规则订阅：每条 { url, name, enabled }。拉取到的规则数据另存于 SUB_STORE_KEY 缓存（不进 config，不外传）
  subscriptions: [],
};

// 深合并：override 的同名对象递归并入 base，其余标量直接覆盖（原型链污染键已被 UNSAFE_KEYS 拦掉）。
//
// 不变量：**并入不会替换 base 里任何已存在的对象或数组，只改它们的内容**。
// 这不是洁癖——面板的名单控件在渲染时就闭包持有了数组本身（chipModel(CONFIG.block.keywords)），
// 把 CONFIG.block.keywords 换成一个新数组，控件此后的增删就写进了一个脱钩的旧数组：
// 界面上「已添加」，存盘时却什么都没有。对象层早就靠递归保住了身份，数组层原先是直接赋值，
// 于是 installConfigSync 采纳别的标签页的配置时会踩到这个坑。
export function deepMerge(base: Record<string, any>, override: any): Record<string, any> {
  for (const k of Object.keys(override || {})) {
    if (UNSAFE_KEYS.has(k)) continue;
    const v = override[k];
    if (Array.isArray(v) && Array.isArray(base[k])) {
      base[k].length = 0;
      for (const x of v) base[k].push(x); // 不用 push(...v)：名单可达数万条，展开会撑爆参数表
    } else if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object') {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
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

// 存档损坏的抢救记录。config 是底层模块（logging 反过来依赖它），不能自己弹 toast 或写日志，
// 所以只留状态，由 main 在页面就绪后报给用户——「所有设置一夜回到出厂」这种事必须有人说一声。
export const configRescue = {
  corrupted: false,
  backupKey: STORE_BACKUP_KEY,
  raw: null as unknown, // 原始内容，供报错时打进控制台（备份键在 GM 存储里，用户自己翻不到）
};

// 高频后台字段（见 constants.STATS_KEY）。内存里仍住在 CONFIG 上，只有持久化分开。
const STATS_FIELDS = ['blockedCount', 'uidNames', 'ruleStats', 'ruleStatsSince'] as const;

function readJson(key: string): any {
  const raw = GM_getValue(key, null);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
}

function pickStats(src: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of STATS_FIELDS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

// 读取存档：先按 schemaVersion 逐级迁移，再与默认值合并（新增字段由 deepMerge 自动补默认值）。
// 高频字段随后从 STATS_KEY 覆盖上来——老存档把它们写在 STORE_KEY 里，那份仍然读得到（自动迁移），
// 直到下一次 saveConfig 把它们从 STORE_KEY 里剔除为止。
export function loadConfig(): AppConfig {
  const raw = GM_getValue(STORE_KEY, null);
  if (!raw) return deepMerge(structuredClone(DEFAULT_CONFIG), pickStats(readJson(STATS_KEY))) as AppConfig;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const cfg = deepMerge(structuredClone(DEFAULT_CONFIG), migrateConfig(parsed)) as AppConfig;
    return deepMerge(cfg, pickStats(readJson(STATS_KEY))) as AppConfig;
  } catch (e) {
    // 存档读不出来（写入被打断、存储被改坏…）。直接回落默认值的话，随后任何一次存盘
    // 就把那份也许还能抢救的原始内容永久盖掉，而存盘会被后台计数悄悄触发——用户看到的是
    // 「所有设置一夜回到出厂」且毫无提示。先原样另存一份再回落，首次为准。
    try {
      if (!GM_getValue(STORE_BACKUP_KEY, null)) GM_setValue(STORE_BACKUP_KEY, raw);
    } catch (_) {
      /* 备份也写不进去（存储满/权限）：不能因此让脚本起不来，继续走默认值 */
    }
    configRescue.corrupted = true;
    configRescue.raw = raw;
    // 规则那份坏了，但计数那份未必——它是独立的键，能读回来就读回来。
    return deepMerge(structuredClone(DEFAULT_CONFIG), pickStats(readJson(STATS_KEY))) as AppConfig;
  }
}

// 全局共享配置单例。
export const CONFIG: AppConfig = loadConfig();

// —— 自动备份 ——
// 三方合并防的是事故发生，这两条兜底管的是事故发生之后还有得救，与「具体是哪个 bug」无关：
//   1) 脚本版本变了 → 写任何东西之前先原样存一份（升级时旧标签页还跑着旧代码，最危险）；
//   2) 一次写入让规则总数骤降 → 把写入前的内容存一份再写。
// 刻意不拒绝写入：清空/删除匹配/恢复默认都是正当操作，拦下来只会变成「我删不掉规则」这种新 bug。
// 备份索引项。内容（整份配置的字符串）另存一个键——面板每次重渲都要读索引，
// 混在一起就是「为了显示三行文字 JSON.parse 几 MB」。
export interface ConfigBackup {
  ts: number;
  version: string;
  reason: string; // 'upgrade' | 'shrink' | 'restore'
  rules: number; // 备份时的规则条数，面板里直接显示，不必让用户去读 JSON
}

/** 某份备份的内容键。用时间戳区分，索引与内容一一对应。 */
const backupBlobKey = (ts: number): string => BACKUP_KEY + ':' + ts;

/** 数一份配置里的规则总条数（黑/白/评论三处的名单）。用于骤降判定与备份展示。 */
export function countRules(cfg: any): number {
  if (!cfg || typeof cfg !== 'object') return 0;
  let n = 0;
  for (const scope of [cfg.block, cfg.allow, cfg.comment]) {
    if (!scope || typeof scope !== 'object') continue;
    for (const v of Object.values(scope)) if (Array.isArray(v)) n += v.length;
  }
  return n;
}

export function loadBackups(): ConfigBackup[] {
  const v = readJson(BACKUP_KEY);
  return Array.isArray(v) ? v : [];
}

/** 读某份备份的内容（仅在用户点「恢复」时才需要）。 */
export function loadBackupRaw(b: ConfigBackup): string | null {
  const v = GM_getValue(backupBlobKey(b.ts), null);
  return typeof v === 'string' && v ? v : null;
}

// 备份写失败绝不能连累主流程：存储满、配额超限时，宁可没有备份也要让脚本正常跑。
function pushBackup(raw: string, reason: string, rules: number): void {
  try {
    const ts = Date.now();
    const list = loadBackups();
    list.unshift({ ts, version: VERSION, reason, rules });
    const keep = list.slice(0, BACKUP_MAX);
    GM_setValue(backupBlobKey(ts), raw);
    GM_setValue(BACKUP_KEY, JSON.stringify(keep));
    // 被挤出去的那几份，内容也要一并删掉——只删索引会在存储里留下永远没人引用的大字符串。
    // 被挤出去的那几份要把内容也清掉，只删索引会在存储里留下永远没人引用的大字符串。
    // GM_deleteValue 在个别环境/权限下可能没有，降级为写空串——占位很小，且 loadBackupRaw 读到空即视为失效。
    for (const old of list.slice(BACKUP_MAX)) {
      if (typeof GM_deleteValue === 'function') GM_deleteValue(backupBlobKey(old.ts));
      else GM_setValue(backupBlobKey(old.ts), '');
    }
  } catch (e) {
    /* 存不下就算了 */
  }
}

/** 面板「恢复」用：把某份备份写回并载入内存。返回是否成功。 */
export function restoreBackup(b: ConfigBackup): boolean {
  try {
    const raw = loadBackupRaw(b);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    // 恢复本身也先备份一次当前状态——「点错了恢复键」同样是需要后悔药的操作。
    const cur = GM_getValue(STORE_KEY, null);
    if (typeof cur === 'string') pushBackup(cur, 'restore', countRules(readJson(STORE_KEY)));
    GM_setValue(STORE_KEY, raw);
    deepMerge(CONFIG, loadConfig());
    baseSnapshot = snapshotConfig();
    return true;
  } catch (e) {
    return false;
  }
}

// 升级快照。必须在本次运行的任何一次 saveConfig 之前跑，否则备下来的已经是被改过的内容。
// 版本号存在备份列表里而不是另开一个键：少一个键、也不会出现「标记写了但备份没写成」的错位。
function snapshotOnUpgrade(): void {
  const raw = GM_getValue(STORE_KEY, null);
  if (typeof raw !== 'string' || !raw) return; // 首次安装，没什么可备份的
  const list = loadBackups();
  if (list.some((b) => b.reason === 'upgrade' && b.version === VERSION)) return; // 本版本已备过
  pushBackup(raw, 'upgrade', countRules(readJson(STORE_KEY)));
}
snapshotOnUpgrade();

// 骤降告警的通知口子。config 是底层模块（logging/toast 反过来依赖它），不能自己弹提示，
// 由 main 注入。没注入时静默——备份照存，只是没人念出来。
type Notify = (msg: string) => void;
let notify: Notify = () => {};
export function setConfigNotifier(fn: Notify): void {
  notify = fn;
}

// —— 存盘：写时三方合并，不整份覆盖 ——
// 本页手里的 CONFIG 随时可能过期（别的标签页刚加的规则不在里面），整份写回去就是把它抹掉。
// 所以写前先读回存储当下的内容，与 baseSnapshot（本页上次与存储一致时的样子）逐字段比对，
// 只盖本页真正改过的部分——「谁写得晚」不再决定结果。代价是每次存盘多一次读，而它是低频操作。
let baseSnapshot: Record<string, any> = {};

function stripStats(src: any): Record<string, any> {
  const out = src && typeof src === 'object' ? { ...src } : {};
  for (const k of STATS_FIELDS) delete out[k];
  return out;
}

/** 本页「与存储一致」的那一份快照（不含高频字段，它们不走这条路）。 */
function snapshotConfig(): Record<string, any> {
  return stripStats(structuredClone(CONFIG));
}

// 名单按**集合**合并：本页新增的加进去、本页删掉的删出去，其余保留对面的（顺序以存储那份为准）。
// 对象元素（订阅）按 url 认同一条——enabled 一变 JSON 就变，整体比对会看成「删一条又加一条」。
function mergeList(base: any[], mine: any[], theirs: any[]): any[] {
  const keyOf = (x: any): string =>
    typeof x === 'string' ? x : x && typeof x === 'object' && x.url ? 'u:' + String(x.url) : JSON.stringify(x);
  const baseMap = new Map(base.map((x) => [keyOf(x), x]));
  const mineMap = new Map(mine.map((x) => [keyOf(x), x]));
  // 本页删掉的（base 里有、内存里没了）：从对面那份里也删掉，否则删除永远同步不出去。
  const removed = new Set([...baseMap.keys()].filter((k) => !mineMap.has(k)));
  const out: any[] = [];
  const seen = new Set<string>();
  for (const x of theirs) {
    const k = keyOf(x);
    if (removed.has(k) || seen.has(k)) continue;
    seen.add(k);
    const m = mineMap.get(k);
    const b = baseMap.get(k);
    // 同一条目本页改过内容（如订阅的启用开关）→ 用本页的；没改过 → 用对面的。
    // 字符串元素直接跳过：keyOf 就是它自己，同 key 必然同值，比较恒为 false——
    // 5 万条 UID 的名单在这里白跑 10 万次 JSON.stringify。只有对象元素（订阅）才需要真比。
    if (m !== undefined && b !== undefined && typeof m !== 'string' && JSON.stringify(m) !== JSON.stringify(b)) out.push(m);
    else out.push(x);
  }
  for (const x of mine) {
    const k = keyOf(x);
    // 只追加本页新增的：base 里有、对面已删的不复活（那是对面的删除，不是本页的新增）。
    if (baseMap.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// base=本页上次与存储一致时的样子，mine=当前内存，theirs=存储里现在的内容。
// 标量逐字段判断「本页改过没有」：改过用本页的，没改过用存储的（别的标签页可能改了）。
function threeWayMerge(base: any, mine: any, theirs: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})])) {
    if (UNSAFE_KEYS.has(k)) continue;
    const b = base ? base[k] : undefined;
    const m = mine ? mine[k] : undefined;
    const t = theirs ? theirs[k] : undefined;
    if (Array.isArray(m) && Array.isArray(t)) out[k] = mergeList(Array.isArray(b) ? b : [], m, t);
    else if (m && typeof m === 'object' && !Array.isArray(m) && t && typeof t === 'object' && !Array.isArray(t))
      out[k] = threeWayMerge(b, m, t);
    // 键的「消失」有两种含义，靠 base 区分：base 里没有 = 对方新增的，收下；base 里有 = 本页删的，别捡回来。
    else if (m === undefined) {
      if (b === undefined) out[k] = t;
    } else if (t === undefined) {
      // 反过来同理：对面删掉的键，本页没动过就跟着删；本页改过则以本页为准。
      if (b === undefined || JSON.stringify(m) !== JSON.stringify(b)) out[k] = m;
    } else {
      // 标量先用 === 短路，真需要深比的只剩「一边是数组/对象、另一边不是」这种畸形存档。
      out[k] = m === b || JSON.stringify(m) === JSON.stringify(b) ? t : m; // 本页没动过 → 采纳存储里的
    }
  }
  return out;
}

/** 保存规则与开关（低频）。写前先读回存储做三方合并，绝不整份覆盖。 */
export function saveConfig(): void {
  // 计时挂在这里而不是各调用点：这条路径是「写放大」的源头（全量读回 + 深拷贝 + 合并 + 两次序列化），
  // 想知道某个批量操作贵在哪，先看它调了几次 saveConfig。
  timed('config.save', saveConfigInner);
}

function saveConfigInner(): void {
  const stored = readJson(STORE_KEY);
  const mine = snapshotConfig();
  const merged = stored ? threeWayMerge(baseSnapshot, mine, stripStats(migrateConfig(stored))) : mine;
  // 合并结果回灌内存：否则本页看不到刚并进来的、别的标签页加的规则，
  // 而下一次存盘又会拿这份内存去当 base，等于把刚合并好的结果再丢一次。
  // 规则骤降熔断：不阻止写入，但保证写入前那一份留得下来、且有人说一声。
  if (stored) {
    const before = countRules(stored);
    const after = countRules(merged);
    const drop = before - after;
    if (before > 0 && (after === 0 || drop >= SHRINK_ALERT_MIN)) {
      pushBackup(JSON.stringify(stored), 'shrink', before);
      notify(`⚠ 规则条数从 ${before} 降到 ${after}。若非你本人操作，可在「工具 → 🗂 配置备份」里恢复。`);
    }
  }
  deepMerge(CONFIG, merged);
  GM_setValue(STORE_KEY, JSON.stringify(merged));
  baseSnapshot = structuredClone(merged);
  // 顺带落盘高频那份：存储拆成两个键，但对调用方来说「存一下」就该存全部，
  // 否则 `CONFIG.blockedCount = 0; saveConfig()` 会静默不生效，而这类错误编译期看不出来。
  saveStats();
}

// —— 高频后台数据（拦截计数 / 规则命中数 / UID→名 缓存）——
// 单独一个键、单独一条防抖。丢一点计数无所谓，所以这里不做合并、直接覆盖：
// 关键是它**不再碰规则那份存储**，后台刷首页不会再把别的标签页的规则冲掉。
let statsTimer: ReturnType<typeof setTimeout> | null = null;

export function saveStats(): void {
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }
  const out: Record<string, any> = {};
  for (const k of STATS_FIELDS) out[k] = (CONFIG as unknown as Record<string, any>)[k];
  GM_setValue(STATS_KEY, JSON.stringify(out));
}

export function scheduleStatsSave(): void {
  if (statsTimer) clearTimeout(statsTimer);
  statsTimer = setTimeout(saveStats, SAVE_DEBOUNCE_MS);
}

// 合并基准的初值：刚载入时本页与存储一致。
baseSnapshot = snapshotConfig();

// —— 多标签页同步 ——
// 三方合并只保证**存储**是对的，不保证**本页看到的**是对的：别的标签页刚加的规则本页内存里还没有。
// 所以仍要监听存储变更，把远端改动采纳进内存并让它可见。
export function installConfigSync(onAdopt: () => void): void {
  // 老版本脚本管理器没有这个 API：降级为「不自动采纳」。存盘的合并逻辑不依赖它，规则不会因此丢，
  // 只是本页要等下一次自己存盘（那时会把远端内容合并回来）或刷新才看得到对面的改动。
  if (typeof GM_addValueChangeListener !== 'function') return;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  GM_addValueChangeListener(STORE_KEY, (_name, _old, _new, remote) => {
    if (!remote) return; // 自己写的回声：不理，否则每次存盘都会自我重载一遍
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      // 用 deepMerge 就地并入，而不是 Object.assign(CONFIG, fresh)：后者会把 CONFIG.block /
      // CONFIG.comment 换成新对象，而面板的输入框在渲染时就绑定了这些**对象引用**，
      // 换掉之后用户再改设置就写进了脱钩的旧对象，看得见改不生效。
      deepMerge(CONFIG, loadConfig());
      // 采纳之后本页与存储一致：重置合并基准，否则下一次存盘会把刚采纳的内容当成「本页的改动」，
      // 反过来把对面之后的删除又顶回去。
      baseSnapshot = snapshotConfig();
      onAdopt();
    }, SYNC_COALESCE_MS);
  });
}

// —— 规则「停用」：留在名单里、灰显、不参与编译 ——
// 只有增删两态时，面对一条可疑规则用户只能删（而删不可逆），于是大多数人选择放着不管。
export function isRuleDisabled(path: string, line: string): boolean {
  const off = CONFIG.disabled[path];
  return Array.isArray(off) && off.indexOf(line) >= 0;
}

export function setRuleDisabled(path: string, line: string, off: boolean): void {
  const list = Array.isArray(CONFIG.disabled[path]) ? CONFIG.disabled[path] : (CONFIG.disabled[path] = []);
  const i = list.indexOf(line);
  if (off && i < 0) list.push(line);
  else if (!off && i >= 0) list.splice(i, 1);
  // 空数组不留着：停用表会跟着名单一起被合并/同步，留一堆空键只是噪音
  if (!list.length) delete CONFIG.disabled[path];
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

// 导出：仅含可分享的规则与过滤开关，剔除统计/缓存/个人会话偏好。
// 不可移植键：导出时剔除、导入时同样剔除（对称）。尤其 subscriptions——否则别人分享的「规则文件」
// 可借导入悄悄塞进会自动联网拉取的订阅 URL（安全风险）。
// ruleStats/ruleStatsSince 属于个人使用数据而非规则本身：别人的命中次数对你没有意义，
// 更会让导入者的「死规则」判断建立在别人的浏览历史上。
// disabled 属个人使用状态，且导入侧的 sanitizeConfigInput 本来就会丢掉它；列在这里是让两侧对称。
export const NON_PORTABLE = ['blockedCount', 'uidNames', 'enabled', 'debug', 'reviewMode', 'subscriptions', 'ruleStats', 'ruleStatsSince', 'disabled', 'onboarded'];
// 把自己的黑名单导出成**订阅格式**文件（examples/blocklist.example.json 那个形状）。
// 「我维护一份名单给别人订阅」此前要求会用 Git 手写 JSON，这一步把门槛降到「点一下」。
// 只带订阅支持的 7 个黑名单维度——白名单/开关/数值阈值订阅侧本来就不收，导出了也是误导。
export function exportSubscription(title: string): string {
  const b = CONFIG.block as unknown as Record<string, unknown>;
  const rules: Record<string, string[]> = {};
  for (const dim of SUB_DIMS) {
    const arr = b[dim];
    if (Array.isArray(arr) && arr.length) rules[dim] = arr.filter((x): x is string => typeof x === 'string');
  }
  return JSON.stringify(
    {
      app: 'biliHoyoFairy',
      format: 1,
      meta: {
        title: title || '我的名单',
        description: '由 biliHoyoFairy 导出。托管到公开 URL（GitHub raw / Gist raw）后，别人在「工具 → 规则订阅」填入即可。',
        version: new Date().toISOString().slice(0, 10),
        expires: '1d',
      },
      rules,
    },
    null,
    2
  );
}

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
