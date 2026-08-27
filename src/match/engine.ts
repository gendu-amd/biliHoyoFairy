// 规则匹配引擎（白名单优先 + 维度注册表）。拦截层与 DOM 层共用同一套规则，数据源不同、判定一致。
// M（编译后的匹配器）与 ruleVersion 是共享可变状态，经 rebuildRules 重建；以 ESM 实时绑定导出，
// 其它模块 import 后读到的是最新值（切勿解构后缓存）。
import { CONFIG } from '../config';
import { compileScopedKeywords, compileLines, kwHit, kwWhich, textHit, whichHit, lc, ruleLines, configureFuzzy } from './normalize';
import type { Matcher, ScopedKw, KwScope } from './normalize';
import type { CardInfo } from '../cardinfo';
import { collectSubRules } from '../subscriptions/store';
import { SUB_DIMS } from '../subscriptions/parse';
import type { SubDim, SubRules } from '../subscriptions/parse';

// 关键时序：必须在下方首次 buildMatchers() 之前接好 fuzzy 取值器，否则初始匹配器会以 fuzzy=false 编译，
// 导致首屏（网络层过滤 + 首次扫描）对默认开启的反绕过匹配失效，直到某次 rebuildRules 才纠正。
configureFuzzy(() => CONFIG.fuzzyMatch);

// 订阅能携带的维度是 SUB_DIMS 的子集（dualTags 不在其列——组合规则语义太重，不接受外部订阅下发）。
// 用一个类型守卫把「这个维度有没有订阅来源」表达出来，取代过去的 `sub: any`：
// 少了 any，多写一个 dualTags 维度时编译器会直接告诉你订阅侧要不要跟着改。
const SUB_DIM_SET = new Set<string>(SUB_DIMS);
const isSubDim = (f: RuleListField): f is SubDim & RuleListField => SUB_DIM_SET.has(f);
// 一条维度当前生效的全部规则行 = 用户名单 ∪ 已启用订阅。ruleLines 是唯一入口：
// 存档/导入/订阅里的字段可能不是数组（甚至是字符串），直接 map 会得到按字符拆开的伪规则。
function userAndSubLines(dim: RuleListField, sub: SubRules): string[] {
  const own = ruleLines(CONFIG.block[dim]);
  return isSubDim(dim) ? own.concat(ruleLines(sub[dim])) : own;
}

// 编译后的匹配器集合：精确维度预编译成 Set、关键词/正则维度编译成 Matcher，热路径直接复用。
export interface Matchers {
  blockKw: ScopedKw;
  blockPartition: Matcher;
  allowKw: ScopedKw;
  blockTag: Matcher;
  dualTags: DualTagRule[];
  upBio: Matcher;
  blockUidSet: Set<string>;
  blockBvidSet: Set<string>;
  // lc(UP名) -> 规则原行。存原行是为了命中后能报「哪条规则」而不是「视频里那个名字」——
  // 两者仅大小写不同时，报视频值会让 locateRule 反查不到（精确比对），删规则按钮就静默消失了。
  blockUpNameMap: Map<string, string>;
  allowUidSet: Set<string>;
  allowUpNameSet: Set<string>;
  cmtKw: Matcher;
  cmtUserKw: Matcher;
  cmtUserSet: Set<string>;
  needUid: boolean;
  tagActive: boolean;
  upBioActive: boolean;
}

// 「双标签」规则的编译形态：src 是名单里的**原行**（命中原因串要用它，且不能 trim，
// 否则与 ruleKeyOf 对不上、规则体检会误报死规则）；parts 是拆好并预先小写的各分量。
// 编译成这个形状而不是在 match 里现拆，一是让它和其它维度一样只在 ruleLines 这一个口子进，
// 二是每张卡不再重复跑 split/map/filter。
export interface DualTagRule {
  src: string;
  parts: string[];
}
function compileDualTags(lines: unknown): DualTagRule[] {
  const out: DualTagRule[] = [];
  for (const src of ruleLines(lines)) {
    const parts = src.split('+').map((s) => lc(s.trim())).filter(Boolean);
    if (parts.length >= 2) out.push({ src, parts }); // 少于两个分量的行不成其为「双标签」，编译期就丢掉
  }
  return out;
}

export function buildMatchers(): Matchers {
  // 精确匹配维度预编译成 Set，避免每张卡每次都 map/includes/some 重建数组（大黑名单下显著更快）
  const lcSet = (arr: unknown) => new Set(ruleLines(arr).map((x) => lc(x)).filter(Boolean));
  const strSet = (arr: unknown) => new Set(ruleLines(arr));
  // 黑名单 = 用户规则 ∪ 已启用订阅规则（订阅只并入黑名单维度，不碰白名单/开关）
  const sub = collectSubRules();
  const u = (dim: RuleListField) => userAndSubLines(dim, sub);
  const blockUidSet = strSet(u('uids'));
  const allowUidSet = strSet(CONFIG.allow.uids);
  const blockTag = compileLines(u('tags'));
  const dualTags = compileDualTags(u('dualTags'));
  const upBio = compileLines(u('upBio'));
  return {
    blockKw: compileScopedKeywords(u('keywords')),
    blockPartition: compileLines(u('partitions')),
    allowKw: compileScopedKeywords(CONFIG.allow.keywords),
    blockTag,
    dualTags,
    upBio,
    blockUidSet,
    blockBvidSet: new Set(u('bvids')),
    blockUpNameMap: new Map(ruleLines(u('upNames')).map((x) => [lc(x), x.trim()] as [string, string]).filter(([k]) => k)),
    allowUidSet,
    allowUpNameSet: lcSet(CONFIG.allow.upNames),
    // 评论区维度（独立编译）
    cmtKw: compileLines(CONFIG.comment.keywords),
    cmtUserKw: compileLines(CONFIG.comment.userNameKeywords),
    cmtUserSet: lcSet(CONFIG.comment.userNames),
    // 是否存在 UID 规则：决定扫描时要不要为缺 UID 的卡做昂贵的 innerHTML 兜底解析
    needUid: blockUidSet.size > 0 || allowUidSet.size > 0,
    // API 维度是否需要拉取（含订阅并入的规则）：标签 = 仅当有专门的「视频标签」规则；简介 = 有简介词。
    // 注意：普通关键词只匹配 标题/UP名/分区（本地、免联网），不再隐式触发每张卡的标签请求。
    tagActive: !blockTag.empty,
    upBioActive: !upBio.empty,
  };
}

export let M = buildMatchers();
// 规则版本号：每次重建自增；评论扫描据此判断某条评论是否需重新评估（避免重复处理 + 规则变更后能刷新）
export let ruleVersion = 0;
export function rebuildRules(): void {
  M = buildMatchers();
  ruleVersion++;
}

export function isWhitelisted(info: CardInfo): boolean {
  if (kwHit(M.allowKw, 'title', info.title)) return true;
  if (info.up && kwHit(M.allowKw, 'up', info.up)) return true;
  if (info.partition && kwHit(M.allowKw, 'part', info.partition)) return true;
  if (info.up && M.allowUpNameSet.has(lc(info.up))) return true;
  if (info.uid && M.allowUidSet.has(info.uid)) return true;
  return false;
}

// ——————————————————————————————————————————————————————————————
// 维度注册表（Schema）：一处声明，多端派生
//   match(info[,ctx]) 返回命中原因字符串或 null；命中即拦（按数组顺序）。
//   active()         可选，当前是否启用（联网维度用它推导 apiNeeds，省去请求）。
//   source/needs     仅联网维度：source=数据来源(tag/view/card)，needs=要拉哪个接口。
// 新增一个过滤维度 = 往对应数组里加一条，matchRule / matchApi / apiNeeds 自动生效。
// ——————————————————————————————————————————————————————————————

// 匹配上下文：把原始接口数据整理成 API_DIMS 共用的形状。
export interface ApiCtx {
  tags: string[];
  view: any;
  sign?: string;
}

export interface SyncDim {
  match: (i: CardInfo) => string | null;
}
export interface ApiDim {
  source: 'tag' | 'view' | 'card';
  needs: 'tag' | 'view' | 'card';
  active: () => boolean;
  match: (info: CardInfo, ctx: ApiCtx) => string | null;
}

// 本地同步维度（matchRule，按序短路）。各 match 自带空配置守卫，故无需 active。
export const SYNC_DIMS: SyncDim[] = [
  { match: (i) => (CONFIG.hideAd && i.isAd ? '广告卡' : null) },
  { match: (i) => (CONFIG.hideLiveCard && i.isLive ? '直播卡' : null) },
  {
    match: (i) => {
      const b = CONFIG.block;
      return b.minViews > 0 && i.views != null && i.views < b.minViews * 1e4 ? `播放<${b.minViews}万` : null;
    },
  },
  // 营销号/搬运号：高播放却极低赞（点赞率异常）。仅在拿得到点赞数(feed 层)时判定。
  {
    match: (i) => {
      const b = CONFIG.block;
      if (b.spamLikeRatio <= 0 || i.likes == null || !i.views) return null;
      if (i.views < b.spamMinViews * 1e4) return null;
      return (i.likes / i.views) * 100 < b.spamLikeRatio ? `营销号(赞率<${b.spamLikeRatio}%)` : null;
    },
  },
  // 关键词：标题 / UP名 / 分区任一命中即拦（标签维度在 matchApi 里补判）
  // 关键词命中要说清是**哪一条**词命中的——关键词是规则最多、最容易误伤的维度，
  // 只报「关键词」等于让用户去上百条规则里自己猜。判定仍走 kwHit 的合并正则（热路径不变），
  // 仅在确定命中后再 kwWhich 回查一次（每次拦截一次，不是每张卡一次）。
  {
    match: (i) => {
      const field: KwScope | null = kwHit(M.blockKw, 'title', i.title)
        ? 'title'
        : i.up && kwHit(M.blockKw, 'up', i.up)
          ? 'up'
          : kwHit(M.blockKw, 'part', i.partition)
            ? 'part'
            : null;
      if (!field) return null;
      const text = field === 'title' ? i.title : field === 'up' ? i.up : i.partition;
      const rule = kwWhich(M.blockKw, field, text);
      return rule ? '关键词:' + rule : '关键词';
    },
  },
  { match: (i) => (i.partition && textHit(i.partition, M.blockPartition) ? '分区:' + (whichHit(i.partition, M.blockPartition) || i.partition) : null) },
  { match: (i) => (i.up && M.blockUpNameMap.has(lc(i.up)) ? 'UP主:' + M.blockUpNameMap.get(lc(i.up)) : null) },
  { match: (i) => (i.uid && M.blockUidSet.has(i.uid) ? 'UID:' + i.uid : null) },
  { match: (i) => (i.bvid && M.blockBvidSet.has(i.bvid) ? 'BV:' + i.bvid : null) },
  {
    match: (i) => {
      const b = CONFIG.block;
      if (i.duration == null) return null;
      if (b.minDuration > 0 && i.duration < b.minDuration) return `时长<${b.minDuration}s`;
      if (b.maxDuration > 0 && i.duration > b.maxDuration) return `时长>${b.maxDuration}s`;
      return null;
    },
  },
];

// 联网维度（matchApi，按序短路）。source 数据缺失时跳过；active 用于 apiNeeds 推导。
export const API_DIMS: ApiDim[] = [
  {
    source: 'tag',
    needs: 'tag',
    active: () => M.tagActive, // 含订阅并入的「视频标签」维度
    match: (info, ctx) => {
      for (const t of ctx.tags) {
        if (!textHit(t, M.blockTag)) continue;
        // 报「哪条规则」而不是「视频的哪个标签」：规则若是 /正则/ 或部分词，
        // 只看标签值用户仍不知道该改哪一条。原因串统一为 `维度:规则`，UI 才能据此定位到规则去删。
        return '标签:' + (whichHit(t, M.blockTag) || t);
      }
      return null;
    },
  },
  {
    source: 'tag',
    needs: 'tag',
    active: () => M.dualTags.length > 0,
    match: (info, ctx) => {
      for (const rule of M.dualTags) {
        if (rule.parts.every((p) => ctx.tags.some((t) => lc(t).includes(p)))) return '双标签:' + rule.src;
      }
      return null;
    },
  },
  {
    source: 'view',
    needs: 'view',
    active: () => CONFIG.hideCharging,
    match: (info, ctx) => (CONFIG.hideCharging && ctx.view.is_upower_exclusive ? '充电专属' : null),
  },
  {
    source: 'card',
    needs: 'card',
    active: () => M.upBioActive, // 含订阅并入的简介词
    match: (info, ctx) => {
      if (M.upBio.empty || !textHit(ctx.sign, M.upBio)) return null;
      const rule = whichHit(ctx.sign, M.upBio);
      return rule ? 'UP简介:' + rule : 'UP简介';
    },
  },
];

// 原因串的「维度名 → 该规则住在 CONFIG.block 的哪个字段」。
// 供 UI 从一条屏蔽记录反查到具体规则行、一键删除（误伤自愈）。
// ⚠ 必须与上面各 DIM 产出的 `维度:规则` 前缀保持一致——改了原因串就要改这里，
// tests/explain.test.ts 会核对两侧不漂移。未列出的维度（广告卡/直播卡/播放</ 时长< 等阈值类）
// 没有「一条可删的规则」，是开关或数值，UI 不给删除入口。
// 只有「字符串列表型」字段才有可定位、可删除的规则行（阈值类是数字，不在此列）。
// 收窄成这个联合类型后，CONFIG.block[field] 直接就是 string[]，调用方不必再断言。
export type RuleListField = 'keywords' | 'partitions' | 'upNames' | 'uids' | 'bvids' | 'tags' | 'dualTags' | 'upBio';

export const REASON_RULE_FIELD: Record<string, RuleListField> = {
  关键词: 'keywords',
  分区: 'partitions',
  UP主: 'upNames',
  UID: 'uids',
  BV: 'bvids',
  标签: 'tags',
  双标签: 'dualTags',
  UP简介: 'upBio',
};

// 从一条屏蔽原因反查到用户名单里的**那一行**规则（供 UI 一键删除）。
// 找不到 = 该规则不在用户自己的名单里，多半来自已启用的订阅——此时不能假装能删。
export function locateRule(reason: string): { field: RuleListField; line: string } | null {
  const i = reason.indexOf(':');
  if (i <= 0) return null;
  const field = REASON_RULE_FIELD[reason.slice(0, i)];
  const rule = reason.slice(i + 1);
  if (!field || !rule) return null;
  for (const line of ruleLines(CONFIG.block[field])) {
    if (line.trim() === rule) return { field, line };
    // 关键词的 title:/up:/part: 前缀在编译时已被剥掉，原因串里是剥后的词，
    // 回查必须认得带前缀的原行，否则会把用户自己的规则误判成「来自订阅」。
    const m = !line.trim().startsWith('/') && line.trim().match(/^(?:title|up|part)\s*:\s*(.+)$/i);
    if (m && m[1].trim() === rule) return { field, line };
  }
  return null;
}

// REASON_RULE_FIELD 的反向表（字段 -> 维度名），供 enumerateRules 由规则行推出原因串。
const FIELD_REASON_DIM: Partial<Record<RuleListField, string>> = {};
for (const dim of Object.keys(REASON_RULE_FIELD)) FIELD_REASON_DIM[REASON_RULE_FIELD[dim]] = dim;

// 联网维度的规则在「精确过滤」关闭时根本不会被求值——此时它们零命中是配置使然，不是规则写错。
const API_FIELDS = new Set<RuleListField>(['tags', 'dualTags', 'upBio']);

export interface RuleRef {
  key: string; // 命中时记账所用的原因串 `维度:规则`
  dim: string;
  field: RuleListField;
  line: string; // 名单里的原行（可直接交给 removeFromList）
  own: boolean; // true=用户自己的名单；false=来自已启用的订阅
  active: boolean; // 当前配置下这条规则是否有可能命中
}

// 规则行 -> 命中时会产生的原因串。**必须**与各 DIM 的产出字节级一致，否则规则体检会把
// 一条天天在拦的规则报成「从未命中」。两处的差异都出在「用不用 trim / 剥不剥前缀」上：
//   - 关键词：compileScopedKeywords 剥掉 title:/up:/part: 前缀并 trim，原因串里是剥后的词
//   - 分区/标签/UP简介：compileLines 内部 trim 后存 plainSrc，原因串是 trim 过的
//   - UID/BV/双标签：直接拿数组元素原样拼进原因串，不能 trim（trim 了就对不上）
// tests/rulehealth.test.ts 走真实 matchRule/matchApi 核对两侧不漂移。
export function ruleKeyOf(field: RuleListField, line: string): string | null {
  const dim = FIELD_REASON_DIM[field];
  if (!dim) return null;
  if (field === 'uids' || field === 'bvids' || field === 'dualTags') return line ? dim + ':' + line : null;
  let v = line.trim();
  if (!v) return null;
  if (field === 'keywords') {
    const m = !v.startsWith('/') && v.match(/^(?:title|up|part)\s*:\s*(.+)$/i);
    if (m) v = m[1].trim();
    if (!v) return null;
  }
  return dim + ':' + v;
}

// 枚举当前生效的每一条「可定位规则」（用户名单 + 已启用订阅）。
// 规则体检据此与 CONFIG.ruleStats 求差集：有键无命中 = 可疑的死规则。
export function enumerateRules(): RuleRef[] {
  const out: RuleRef[] = [];
  const sub = collectSubRules();
  const seen = new Set<string>();
  for (const field of Object.keys(REASON_RULE_FIELD).map((d) => REASON_RULE_FIELD[d])) {
    const active = !API_FIELDS.has(field) || !!CONFIG.apiFilters;
    const own = new Set(ruleLines(CONFIG.block[field]));
    for (const line of userAndSubLines(field, sub)) {
      const key = ruleKeyOf(field, line);
      // 同一条规则可能同时存在于用户名单与订阅里；只留一条，且以「用户自己的」为准（那份能删）。
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, dim: FIELD_REASON_DIM[field]!, field, line, own: own.has(line), active });
    }
  }
  return out;
}

export function matchRule(info: CardInfo): string | null {
  if (isWhitelisted(info)) return null;
  for (const d of SYNC_DIMS) {
    const r = d.match(info);
    if (r) return r;
  }
  return null;
}

// 算出「联网维度」各需要哪些接口（由注册表的 active/needs 推导）。
export function apiNeeds(): { needTag: boolean; needView: boolean; needCard: boolean } {
  let needTag = false;
  let needView = false;
  let needCard = false;
  for (const d of API_DIMS) {
    if (!d.active()) continue;
    if (d.needs === 'tag') needTag = true;
    else if (d.needs === 'view') needView = true;
    else if (d.needs === 'card') needCard = true;
  }
  if (needCard) needView = true; // 取 card 需要 mid，无 uid 时用 view.owner 兜底
  return { needTag, needView, needCard };
}
// 是否有任一联网规则启用（决定要不要发请求）。
export function apiRulesActive(): boolean {
  if (!CONFIG.apiFilters) return false;
  const n = apiNeeds();
  return n.needTag || n.needView || n.needCard;
}

// 把原始接口数据整理成匹配上下文，供 API_DIMS 的 match 共用。
function buildApiCtx(info: CardInfo, view: any, tags: string[] | null | undefined, cardData: any): ApiCtx {
  const ctx: ApiCtx = { tags: tags || [], view: view || {} };
  if (cardData) {
    const c = cardData.card || cardData;
    ctx.sign = c.sign || '';
  }
  return ctx;
}

// 联网维度匹配：view=视频详情, tags=标签数组, cardData=UP卡片。
export function matchApi(info: CardInfo, view: any, tags: string[] | null | undefined, cardData: any): string | null {
  if (isWhitelisted(info)) return null; // 与 matchRule 对齐：白名单对联网维度同样优先（防新增调用点遗漏）
  const ctx = buildApiCtx(info, view, tags, cardData);
  for (const d of API_DIMS) {
    if (d.source === 'tag' && !(tags && tags.length)) continue;
    if (d.source === 'view' && !view) continue;
    if (d.source === 'card' && !cardData) continue;
    const r = d.match(info, ctx);
    if (r) return r;
  }
  return null;
}
