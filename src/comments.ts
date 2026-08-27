// 评论区过滤（读评论 Web Component 的 .__data，DOM 层隐藏/折叠）。
// B 站新版评论是 Web Component（bili-comment-thread-renderer=一级 / bili-comment-reply-renderer=二级），
// 数据挂在宿主元素的 .__data 上；靠 attachShadow 钩子把这些组件的 shadowRoot 收进 shadowRoots，再读 __data 判定。
// 全部字段访问走可选链，缺字段=不命中，绝不抛错。
import { CONFIG } from './config';
import { COMMENT_BOTS, COMMENT_AD_RE } from './constants';
import { lc, textHit } from './match/normalize';
import { M, ruleVersion } from './match/engine';
import { shadowRoots } from './shadow';
import { recordBlock } from './stats';
import { log, safe } from './logging';
import { escapeHtml } from './util';
import { COMMENT_TAGS, isCommentTag } from './selectors';

// —— B 站挂在宿主上的数据（.__data）——
// 只声明我们真正读的字段，全部可选：这是别人家的结构，会随改版变，缺字段必须等价于「不命中」而不是抛错。
// 写出来的好处是「我们依赖了对方哪些字段」有一份可查的清单，改版排查时不用再翻实现。
interface CmtMember {
  uname?: string;
  avatar?: string;
  level_info?: { current_level?: number };
  vip?: { vipStatus?: number };
}
interface CmtContent {
  message?: string;
  members?: CmtMember[]; // 评论里 @ 到的人（用于「召唤 AI」判定）
}
interface CmtData {
  mid?: string | number;
  member?: CmtMember;
  content?: CmtContent;
  reply_control?: { is_up_top?: boolean };
}

// 评论宿主元素上的附加字段，两类来源，集中声明在此，避免每个访问点各写一次 as any：
//   1) B 站组件挂的：__data / __upMid / __user（只读）
//   2) 本脚本挂的：__bfbCmt*（折叠占位条、已评估的规则版本、命中标记、用户手动展开标记）
export interface CommentHost extends HTMLElement {
  __data?: CmtData;
  __upMid?: string | number; // 视频 UP 的 mid（可能缺）
  __user?: { uname?: string }; // 当前登录用户（可能缺）
  __bfbCmtPh?: HTMLElement | null;
  __bfbCmtV?: number;
  __bfbCmtHit?: boolean;
  __bfbCmtExpanded?: boolean;
}

// Element → CommentHost 的收窄只发生在这两处（DOM 给我们的静态类型只到 Element/EventTarget）：
//   hostOf：shadowRoot.host，标签名随后由调用方查表确认
//   asCommentHost：标签名对得上就当评论宿主 —— 右键菜单等外部调用点用这个，不必自己拼断言
function hostOf(root: ShadowRoot): CommentHost {
  return root.host as CommentHost;
}
export function asCommentHost(el: Element | null | undefined): CommentHost | null {
  return el && el.tagName && isCommentTag(el.tagName) ? (el as CommentHost) : null;
}

// readCmt 的产物：从别人家的松散结构里抽出来的、本模块内部约定好的规整形状。
export interface CmtInfo {
  uname: string;
  mid: string | number | undefined;
  level: number | null;
  noface: boolean;
  message: string;
  members: CmtMember[];
  isUpTop: boolean;
  upMid: string | number | undefined;
  me: string | undefined;
}

// 归一评论正文：去掉开头“回复 @x:”、去 @提及、去 [表情] 占位，便于关键词/空洞判定。
function cmtCleanMsg(msg: unknown, isSub: boolean): string {
  let s = (msg || '').toString();
  if (isSub) s = s.replace(/^回复\s?@[^@\s:：]+\s?[:：]/, '');
  return s.replace(/@[^@\s]+/g, ' ').replace(/(\[[^[\]]+\])+/g, ' ').trim();
}
// 去表情后是否为空（纯表情/纯 @）
// 这里就是要按**码点**逐个剔除表情的组成部分（ZWJ、肤色/变体选择符、keycap），
// 组合出来的整串（如 👨‍👩‍👦）被拆成零件删掉正是想要的效果，故定点豁免该规则。
// eslint-disable-next-line no-misleading-character-class
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u200d\u{20E3}]/gu;

export function readCmt(host: CommentHost | null | undefined): CmtInfo {
  const d: CmtData = (host && host.__data) || {};
  const member: CmtMember = d.member || {};
  const content: CmtContent = d.content || {};
  const lv = member.level_info && member.level_info.current_level;
  const vipStatus = member.vip && member.vip.vipStatus;
  return {
    uname: ((member.uname || '') + '').trim(),
    mid: d.mid,
    level: typeof lv === 'number' ? lv : null,
    noface: (member.avatar || '').endsWith('noface.jpg') && (vipStatus === 0 || vipStatus == null),
    message: (content.message || '') + '',
    members: Array.isArray(content.members) ? content.members : [],
    isUpTop: !!(d.reply_control && d.reply_control.is_up_top),
    upMid: host ? host.__upMid : undefined, // B 站组件挂的视频 UP mid（可能缺，缺则 isUp 白名单不生效）
    me: host && host.__user ? host.__user.uname : undefined, // 当前登录用户名（可能缺）
  };
}

// 返回命中原因或 null。白名单优先（UP/置顶/自己）。
// 导出的是本模块「判定」的那一半（纯函数，只依赖 CONFIG 与编译好的匹配器）——DOM 那一半没法在
// 无 jsdom 的测试环境里跑，判定这半必须能单独测，否则十几条评论规则等于没有回归保护。
export function matchComment(c: CmtInfo, isSub: boolean): string | null {
  const cc = CONFIG.comment;
  // —— 白名单 ——
  if (cc.allowUp && c.upMid != null && c.mid != null && String(c.mid) === String(c.upMid)) return null;
  if (cc.allowPin && !isSub && c.isUpTop) return null;
  if (cc.allowMe && c.me && (c.uname === c.me || c.message.includes('@' + c.me))) return null;
  // —— 黑名单 ——
  if (c.uname && M.cmtUserSet.has(lc(c.uname))) return '评论用户:' + c.uname;
  if (c.uname && textHit(c.uname, M.cmtUserKw)) return '评论昵称词';
  const clean = cmtCleanMsg(c.message, isSub);
  if (textHit(clean, M.cmtKw)) return '评论关键词';
  if (cc.minLevel > 0 && c.level != null && c.level < cc.minLevel) return `评论等级<${cc.minLevel}`;
  if (cc.hideNoFace && c.noface) return '默认头像非会员';
  if (cc.hideBot && c.uname && COMMENT_BOTS.has(c.uname)) return 'AI机器人';
  if (cc.hideCallBot && c.members.some((m) => !!(m && m.uname && COMMENT_BOTS.has(m.uname)))) return '召唤AI';
  if (cc.hideAd && COMMENT_AD_RE.test(c.message)) return '带货评论';
  if (cc.hideCallOnly && c.message.replace(/@[^@\s]+/g, ' ').trim() === '') return '纯@评论';
  if (cc.hideEmojiOnly && clean.replace(EMOJI_RE, '').trim() === '') return '纯表情评论';
  return null;
}

// 折叠：把命中评论收成一行灰条（点击展开），而非直接隐藏。占位条插在宿主前，宿主仍 display:none。
// 占位条处于评论组件的 shadowRoot 内，文档级 CSS 够不着，样式必须全内联。
function collapseComment(host: CommentHost, reason: string) {
  if (host.__bfbCmtPh && host.__bfbCmtPh.isConnected) {
    // 已折叠：仅更新原因文案
    const t = host.__bfbCmtPh.querySelector('.bfb-ph-txt');
    if (t) t.textContent = '已折叠 · 命中：' + reason;
    return;
  }
  const parent = host.parentNode;
  if (!parent) {
    host.style.setProperty('display', 'none', 'important');
    return;
  }
  const ph = document.createElement('div');
  ph.className = 'bfb-cmt-ph';
  ph.style.cssText =
    'display:flex;align-items:center;gap:8px;margin:4px 0;padding:6px 10px;border-radius:8px;' +
    'background:rgba(251,114,153,.08);border:1px dashed rgba(251,114,153,.45);' +
    'font-size:12px;color:#9499a0;cursor:pointer;user-select:none;line-height:1.5';
  ph.innerHTML =
    '<span class="bfb-ph-txt" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">已折叠 · 命中：' +
    escapeHtml(reason) +
    '</span><span style="color:#fb7299;flex:none">点击展开 ▾</span>';
  ph.addEventListener('click', function () {
    ph.remove();
    host.style.removeProperty('display');
    host.__bfbCmtPh = null;
    host.__bfbCmtExpanded = true; // 用户已手动展开，后续重扫不再折叠
  });
  parent.insertBefore(ph, host);
  host.__bfbCmtPh = ph;
  host.style.setProperty('display', 'none', 'important');
}
function removeCmtPlaceholder(host: CommentHost) {
  if (host.__bfbCmtPh) {
    try {
      host.__bfbCmtPh.remove();
    } catch (e) {
      /* 占位条已被 B 站的重渲染摘走：引用置空即可，下次命中会重新插一个 */
    }
    host.__bfbCmtPh = null;
  }
}

// 处理单条评论宿主（错误边界 + 版本号去重）。
const processComment = safe('processComment', function (host: CommentHost, isSub: boolean) {
  if (host.__bfbCmtV === ruleVersion) return; // 本版本已评估过
  const c = readCmt(host);
  // 数据未 hydrate 时**不打版本号**：评论宿主常常先入 DOM、__data 后到，
  // 提前打标会让这条评论在本规则版本内被永久跳过（下一轮扫描直接 return），规则形同虚设。
  if (!c.uname && !c.message) return; // 还没渲染出数据，等下一轮
  host.__bfbCmtV = ruleVersion;
  const reason = matchComment(c, isSub);
  if (reason) {
    if (CONFIG.reviewMode) {
      removeCmtPlaceholder(host);
      host.style.setProperty('outline', '2px solid #fb7299', 'important');
      host.title = '[biliHoyoFairy] 命中：' + reason;
      host.style.removeProperty('display');
    } else if (CONFIG.comment.collapse && !host.__bfbCmtExpanded) {
      collapseComment(host, reason);
    } else if (host.__bfbCmtExpanded) {
      // 用户已展开过：保持可见，不再折叠/隐藏
      removeCmtPlaceholder(host);
      host.style.removeProperty('display');
    } else {
      // 评论组件常带 :host{display:..!important}，必须用 important 内联才能压过
      removeCmtPlaceholder(host);
      host.style.setProperty('display', 'none', 'important');
    }
    if (!host.__bfbCmtHit) {
      host.__bfbCmtHit = true;
      recordBlock(reason, { up: c.uname, title: cmtCleanMsg(c.message, isSub).slice(0, 40) }, 'CMT');
    }
  } else {
    // 不命中：撤销之前可能的隐藏/折叠/标记（规则放宽后恢复）
    removeCmtPlaceholder(host);
    host.style.removeProperty('display');
    host.style.removeProperty('outline');
    host.removeAttribute('title');
    host.__bfbCmtHit = false;
    host.__bfbCmtExpanded = false;
  }
});

// 还原所有被评论过滤隐藏/标记的评论（关闭过滤时调用）。
function revertComments() {
  for (const root of shadowRoots) {
    const host = hostOf(root);
    if (!host || !isCommentTag(host.tagName)) continue;
    if (host.__bfbCmtHit || host.__bfbCmtPh || host.style.display === 'none' || host.style.outline) {
      removeCmtPlaceholder(host);
      host.style.removeProperty('display');
      host.style.removeProperty('outline');
      host.removeAttribute('title');
      host.__bfbCmtHit = false;
      host.__bfbCmtExpanded = false;
      host.__bfbCmtV = undefined;
    }
  }
}
let lastCmtDiag = '';
export function scanComments(): void {
  if (!CONFIG.enabled || !CONFIG.comment.enabled) {
    revertComments(); // 关闭时恢复曾隐藏的评论
    return;
  }
  let cmtHosts = 0;
  for (const root of shadowRoots) {
    const host = hostOf(root);
    if (!host) continue;
    if (!host.isConnected) {
      shadowRoots.delete(root);
      continue;
    }
    const isSub = COMMENT_TAGS[host.tagName];
    if (isSub === undefined) continue;
    cmtHosts++;
    processComment(host, isSub);
  }
  // 诊断：调试模式下，输出当前捕获到的全部 shadow 宿主标签 + 评论宿主数（标签集变化才打，避免刷屏）
  if (CONFIG.debug) {
    const tags: Record<string, number> = {};
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
// 评论增量很碎（每条评论各自 attachShadow），用节流聚合扫描。
let cmtTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleCommentScan(): void {
  if (!CONFIG.comment.enabled) return;
  if (cmtTimer) return;
  cmtTimer = setTimeout(() => {
    cmtTimer = null;
    scanComments();
  }, 300);
}
