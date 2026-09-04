// 全局常量：存储键、DOM 标记属性、风控码、内置名单等。纯数据、无副作用、无依赖（L0 叶子）。

// 单一来源：直接读脚本头 @version，避免与常量双写漂移。
export const VERSION: string =
  (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '0.0.1';

export const STORE_KEY = 'bfb_config_v2';
// 存档解析失败时，原始内容被原样另存到这里等人工抢救（见 config.ts loadConfig 的 catch）。
// 不带版本号后缀：它存的是「当时 STORE_KEY 里那坨东西」，本来就没有可信的结构版本。
export const STORE_BACKUP_KEY = 'bfb_config_corrupt_backup';
// 高频后台数据（拦截计数 / 规则命中数 / UID→名 缓存）单独一个键。
//
// 为什么必须拆开：这些字段每拦一个视频就变一次，跟着 saveConfig 走的话，一个纯计数器自增
// 就会触发「把你全部规则一起重写」——而重写用的是本标签页那份可能已经过期的内存快照。
// 于是「B 页在后台挂着刷首页」这件毫无危害的事，能把你在 A 页刚加的规则整份冲掉。
// 高频写和低频写不该共用一把锁：规则/开关走 STORE_KEY（低频、要合并、丢不起），
// 计数走 STATS_KEY（高频、丢一点无所谓）。
export const STATS_KEY = 'bfb_stats_v1';
// 配置快照（自动备份）。滚动保留最近几份，供「升级出岔子」「规则被谁清空了」时回滚。
// 独立于 STORE_KEY：备份要能在规则那份被写坏之后仍然读得出来，就不能和它住在一起。
export const BACKUP_KEY = 'bfb_backups_v1';
export const BACKUP_MAX = 5;
// 规则总数一次掉这么多（或掉光）就先备份再写。阈值不宜太小：删两三条是日常操作，
// 每次都存快照只会把备份位挤满，真正的事故反而被挤出去。
export const SHRINK_ALERT_MIN = 5;
// 配置结构版本。**只在需要就地改写老存档时**递增（改字段名、改语义、改单位），
// 单纯新增带默认值的字段不用动它——deepMerge 会自动补齐。递增时必须在 config.ts 的
// MIGRATIONS 里补上对应迁移函数，否则老用户升级后会静默丢配置。
export const SCHEMA_VERSION = 1;
// 订阅拉取结果缓存：{ [url]: { meta, rules, lastSync, ok, count, error } }
export const SUB_STORE_KEY = 'bfb_subs_v1';
export const BLACKLIST_MANAGE_URL = 'https://account.bilibili.com/account/blacklist';

// DOM 标记属性（集中常量，避免散落硬编码改一处漏一处）。
export const ATTR_API = 'data-bfb-api'; // 卡片已发起 API 评估
export const ATTR_BLOCKED = 'data-bfb-blocked'; // 卡片已被拦截（供批量拉黑扫描）
export const PROCESSED = 'data-bfb-done'; // 卡片已处理标记

// 评论区已知 AI 机器人账号名单。
export const COMMENT_BOTS = new Set<string>([
  '机器工具人', '有趣的程序员', 'AI视频小助理', 'AI视频小助理总结一下', 'AI笔记侠', 'AI视频助手',
  '哔哩哔理点赞姬', '课代表猫', 'AI课代表呀', '木几萌Moe', '星崽丨StarZai', 'AI沈阳美食家', 'AI头脑风暴',
  'GPT_5', 'Juice_AI', 'AI全文总结', 'AI视频总结', 'AI总结视频', 'AI工具集', 'Ai的评论', 'AI识片酱',
  'AI知识总结', 'AI小精灵呀', 'AI课程教学', 'Ai好记', 'MilkyAi', '视频AI问答助手',
]);
// 带货/导流广告评论特征。
export const COMMENT_AD_RE = /(bili2233\.cn|b23\.tv)\/(mall-|cm-)|领券|gaoneng\.bilibili\.com/i;

// 合并外部数据（存档/导入）时必须跳过这些键，否则 JSON.parse 出来的 own "__proto__"
// 会被写进 Object.prototype，污染全局并可能破坏 B 站自身脚本。
export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// —— 预算与时序 ——
// 单独成组是因为这几个数要**放在一起**权衡：存盘太频伤磁盘、太疏丢配置；
// 会话日志留太多吃内存、太少看不到刚才拦了什么；启动汇总弹太早统计还没跑完、太晚用户已经在滑了。
// 分散在各模块里时没人能一眼看到这份预算（各模块自己的缓存上限仍留在原地，那是实现细节不是预算）。
export const BLOCKED_LOG_MAX = 300; // 本次会话屏蔽记录条数上限
export const SAVE_DEBOUNCE_MS = 1200; // 配置存盘防抖
// 多标签页同步：收到别的标签页写入后，等这么久再整份采纳（对面连改几条规则时只重载一次）。
// 要明显短于 SAVE_DEBOUNCE_MS，否则本页在采纳之前就可能先把旧快照写回去。
export const SYNC_COALESCE_MS = 300;
export const STARTUP_SUMMARY_MS = 3500; // 首屏稳定后弹「本次拦截」汇总 + 跑运行自检的延时
export const LIST_SEARCH_MIN = 8; // 名单超过这么多条才显示搜索框（三五条时肉眼就够，多一个框只是噪音）
// 一次最多渲染多少个 chip。名单可能有几千条（从账号黑名单导回时尤其），全量建 DOM 会让面板
// 卡住好几秒。超出的部分不渲染，但**批量操作仍作用于全部筛选结果**，且在提示里写明——
// 悄悄只显示一部分、批量却动了全部，才是真正会出事的组合。
export const CHIP_RENDER_MAX = 300;
// 每次渲染最多为多少个缺名字的 UID 去请求 UP 名。不限的话，打开一次面板就会为几百个 UID
// 各发一个请求——纯展示需求换来一轮风控，不值。剩下的照常显示 UID，搜索时也搜得到数字。
export const NAME_RESOLVE_MAX = 20;

// B 站风控返回码：触发后全局退避保护账号（校验失败/被拦截/请求过频）。
export const RISK_CODES = new Set<number>([-352, -412, -509, -799]);
