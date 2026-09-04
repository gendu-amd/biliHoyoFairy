// 一键拉黑：调官方 relation/modify (act=5) 写入账号黑名单，刷新后不再被推荐（未登录则仅本地屏蔽）。
// 复用接口层的 view 缓存/限速队列与风控熔断；支持联合投稿连带拉黑与顺序批量拉黑。
//
// 本模块的返回值形状是**跨层契约**（面板的批量拉黑 / 名单批量处理都按它渲染进度与结果），
// 所以下面的 interface 是导出的：调用方不该再各自猜一遍形状——猜错了不报错，只是进度条数字不对。
import { fetchView, riskGuard } from './api';
import { RISK_CODES } from './constants';
import { getCookie } from './util';
import { gmRequest } from './gm';
import { CONFIG, saveConfig, setUidName } from './config';
import { addToList, pushUnique, removeFromList } from './rules';
import { emitRulesChanged } from './events';
import { toast } from './ui/toast';
import { extractCardInfo } from './cardinfo';
import type { CardInfo } from './cardinfo';
import { logBlocked } from './stats';
import { log } from './logging';

/** 待拉黑目标。uid 允许数字：联合投稿名单里的 mid 就是数字。 */
export interface BlockTarget {
  uid: string | number;
  name?: string;
}

/** 没拉成的一条。code 为 null 表示网络层就失败了（压根没拿到业务码）。 */
export interface BlockFail {
  uid: string;
  code: number | null;
}

/** 批量拉黑的最终结果。added/already/failed 三者互斥，如实分类——不把失败算进成功。 */
export interface BlockResult {
  added: number; // code 0：本次新写入账号黑名单
  already: number; // 22120：此前已在黑名单
  failed: BlockFail[];
  total: number;
  done: number;
  cancelled: boolean;
}

/** 批量拉黑的实时进度。paused=风控退避中，wait=预计还要等的秒数。 */
export interface BlockProgress {
  done: number;
  added: number;
  already: number;
  ok: number;
  fail: number;
  total: number;
  paused: boolean;
  wait: number;
  cancelled: boolean;
}

/** 批量拉黑的控制器：cancel() 中断后续（在途请求会先正常收尾）。 */
export interface BlockController {
  cancel(): void;
}

/** 拉黑入口的入参。只要 up/uid/bvid 三样里的任意一样——调用方常常只拿得到其中一两个，
 *  「哪样都没有时怎么退化」正是 blacklistUp 的主要职责。 */
export type BlockSource = Partial<CardInfo>;

/** 单次拉黑/撤销的回调：(是否成功, 业务码)。code 为 null 表示网络错误。 */
export type BlockCb = (ok: boolean, code: number | null) => void;

// 用 BV 号反查 UP 的 uid/name（页面取不到 UID 时的兜底，走视频详情接口）。复用接口层 view 缓存。
function resolveUidByBvid(bvid: string, cb: (uid: string, name: string) => void): void {
  fetchView(bvid, (d) => {
    if (d && d.owner) cb(String(d.owner.mid), d.owner.name || '');
    else cb('', '');
  });
}

// relation/modify 常见错误码 → 友好文案。
export const REL_ERR: Record<string, string> = {
  '-101': '未登录或登录已过期',
  '-111': 'CSRF 校验失败，请刷新页面重试',
  '-352': '触发 B 站风控，请稍后再试',
  22120: '该用户已在你的黑名单中',
};

// 业务码 → 文案。code 可能是 null（网络错误），查表统一走这里，省得每处都判一次空。
const relErr = (code: number | null): string => (code == null ? '' : REL_ERR[String(code)] || '');

/** 一次 relation/modify 的归一结果。
 *  outcome 三态是必需的：未登录（压根没发）、网络错误、拿到了响应，三种情况 code 都可能不是正常业务码，
 *  但对用户要说的话完全不同（「未登录」/「网络错误」/「账号侧失败(code X)」）——只看 code 分不开。 */
type RelationOutcome = 'noauth' | 'neterr' | 'replied';
interface RelationRes {
  code: number | null; // null = 网络层失败或响应不是 JSON，没拿到业务码
  msg: string;
  outcome: RelationOutcome;
}

// 拉黑与撤销拉黑打的是同一个接口，只差一个 act：把「发请求 + 取 csrf + 解析响应 + 喂熔断器」
// 收成这一个函数。至于本地名单怎么改、弹什么文案、成功怎么算，两个动作本就不同，留给调用方——
// 硬塞进来只会换成一堆回调参数，不比重复两遍好。
function relationModify(uid: string, act: 5 | 6, done: (r: RelationRes) => void): void {
  const csrf = getCookie('bili_jct');
  if (!csrf) {
    done({ code: -101, msg: '', outcome: 'noauth' });
    return;
  }
  gmRequest({
    method: 'POST',
    url: 'https://api.bilibili.com/x/relation/modify',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    // gaia_source=web_main 贴合当前官方 web 端行为，降低被风控/失败概率
    data: `fid=${encodeURIComponent(uid)}&act=${act}&re_src=11&gaia_source=web_main&csrf=${encodeURIComponent(csrf)}`,
    withCredentials: true,
    onload: (res) => {
      let code: number | null = null;
      let msg = '';
      try {
        const j = JSON.parse(res.responseText);
        code = j.code;
        msg = j.message || '';
      } catch (e) {
        /* 响应不是 JSON（风控页/网关错误）：code 保持 null，调用方按「未知失败」处理 */
      }
      riskGuard.note(code); // 两个方向的响应都喂给熔断器（批量拉黑触发风控时全局退避）
      done({ code, msg, outcome: 'replied' });
    },
    onerror: () => done({ code: null, msg: '', outcome: 'neterr' }),
  });
}

// 真正调接口拉黑（已确定 uid）。quiet=true 时不弹单条提示（批量/联合投稿场景由调用方汇总）。
function doBlacklist(uid: string, upName: string, cb?: BlockCb, quiet?: boolean): void {
  const label = upName || uid;
  const addLocal = () => {
    if (upName) setUidName(uid, upName);
    // 批量(quiet) 不逐条存盘/重扫——由 doBlacklistMany.finish 统一一次 saveConfig+重扫，避免 N 次全页重扫卡顿。
    if (quiet) pushUnique(CONFIG.block.uids, [String(uid)]);
    else addToList(CONFIG.block.uids, String(uid));
  };
  relationModify(uid, 5, ({ code, msg, outcome }) => {
    // 本地屏蔽无条件落地：账号侧不管成没成，用户的意图都是「别再让我看到这个人」。
    addLocal();
    // 22120 = 已在黑名单，视作成功（幂等）
    const ok = code === 0 || code === 22120;
    // 成功拉黑写入屏蔽记录（单发/批量共用），让用户能看到“这次拉黑了谁”
    if (ok) logBlocked('拉黑', { up: upName || (CONFIG.uidNames && CONFIG.uidNames[String(uid)]) || '', uid: String(uid) }, 'BL');
    if (!quiet) {
      if (outcome === 'noauth') toast(`未登录，已本地屏蔽「${label}」(未同步账号黑名单)`, 'warn');
      else if (outcome === 'neterr') toast(`网络错误，已本地屏蔽：${label}`, 'error');
      // 仅对「本次新拉黑(code 0)」提供撤销：22120 是此前就已在黑名单，撤销它可能误删用户早先的设置，故不提供。
      else if (code === 0) toast(`已拉黑并同步账号黑名单：${label}（刷新后不再推荐）`, 'success', { label: '撤销', onClick: () => unblockUp(String(uid), upName) });
      else if (code === 22120) toast(`「${label}」此前已在账号黑名单，已本地同步`, 'success');
      else toast(`账号侧拉黑失败（${relErr(code) || msg || 'code ' + code}），已本地屏蔽：${label}`, 'warn');
    }
    cb?.(ok, code);
  });
}

// 撤销拉黑（relation/modify act=6 取消拉黑）：账号侧移出黑名单 + 本地移出 block.uids（刷新后该 UP 恢复推荐）。
// 给「不可逆账号写操作」一个可恢复路径：单条拉黑成功后的撤销 toast、面板屏蔽记录的撤销按钮共用。
export function unblockUp(uid: string, upName?: string, cb?: BlockCb): void {
  const label = upName || uid;
  relationModify(uid, 6, ({ code, msg, outcome }) => {
    removeFromList(CONFIG.block.uids, String(uid)); // 无论账号侧成败都移出本地屏蔽，避免界面与意图不一致
    const ok = code === 0 && outcome === 'replied';
    if (outcome === 'noauth') toast(`已移出本地屏蔽：${label}（未登录，账号黑名单未变动）`, 'warn');
    else if (outcome === 'neterr') toast(`网络错误，已移出本地屏蔽：${label}`, 'error');
    else toast(ok ? `已撤销拉黑：${label}（刷新后恢复推荐）` : `账号侧撤销失败（${relErr(code) || msg || 'code ' + code}），已移出本地屏蔽：${label}`, ok ? 'success' : 'warn');
    cb?.(ok, code);
  });
}

// 顺序拉黑多个 UP。targets:[{uid,name}]。按真实返回码如实分类，避免把失败误报为成功。
//   cb({ added, already, failed:[{uid,code}], total })  —— 完成回调
//   onProgress({done,added,already,ok,fail,total,paused,wait}) —— 实时进度（可选）
// 限速 + 抖动：批量比单发更保守，降低被风控概率；触发风控由 riskGuard 自动指数退避并在此暂停等待。
const BL_DELAY = 900; // 每次之间基础间隔(ms)
const BL_JITTER = 700; // 叠加随机抖动(ms)，降低规律性
export function doBlacklistMany(targets: BlockTarget[], cb?: (r: BlockResult) => void, onProgress?: (p: BlockProgress) => void): BlockController {
  const list: { uid: string; name: string }[] = [];
  const seen = new Set();
  for (const t of targets) {
    const uid = String((t && t.uid) || '');
    if (uid && !seen.has(uid)) {
      seen.add(uid);
      list.push({ uid, name: (t && t.name) || '' });
    }
  }
  let added = 0; // code 0：本次新写入账号黑名单
  let already = 0; // 22120：此前已在黑名单
  let done = 0;
  let i = 0;
  const failed: BlockFail[] = []; // 真正没拉成的
  let cancelled = false; // 用户点「停止」
  let finished = false; // 防止「取消」与在途回调重复收尾
  let timer: ReturnType<typeof setTimeout> | null = null; // 当前等待中的定时器（限速/退避），取消时清掉
  const noCsrf = !getCookie('bili_jct'); // 未登录：每条都只走本地降级、不发请求，无需限速空转
  const snapshot = (paused: boolean): BlockProgress => ({
    done,
    added,
    already,
    ok: added + already,
    fail: failed.length,
    total: list.length,
    paused: !!paused,
    wait: paused ? Math.ceil(riskGuard.remaining() / 1000) : 0,
    cancelled,
  });
  const report = (paused: boolean) => onProgress?.(snapshot(paused));
  const finish = () => {
    if (finished) return;
    finished = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (CONFIG.debug && failed.length) {
      const byCode: Record<string, number> = {};
      failed.forEach((f) => (byCode[String(f.code)] = (byCode[String(f.code)] || 0) + 1));
      log('批量拉黑失败按 code 分布：', byCode, failed);
    }
    // 批量本地屏蔽（含失败降级项）已逐条 pushUnique 进 block.uids，这里统一一次存盘 + 重扫（避免逐条 N 次重扫）。
    if (list.length) {
      saveConfig();
      emitRulesChanged();
    }
    cb?.({ added, already, failed, total: list.length, done, cancelled });
  };
  const next = () => {
    if (cancelled || i >= list.length) return finish();
    // 熔断中：等退避窗口结束再继续，并把“暂停中 + 已完成进度”实时告知调用方（避免界面看起来无响应）
    if (riskGuard.blocked()) {
      report(true);
      timer = setTimeout(next, riskGuard.remaining() + 50);
      return;
    }
    timer = null; // 进入「在途请求」阶段：清掉已触发的旧间隔句柄，使 cancel() 必然延后到本次回调收尾（而非立即 finish）
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
        if (cancelled) return finish(); // 停止：在途请求收尾后即结束，不再排下一个
        timer = setTimeout(next, noCsrf ? 0 : BL_DELAY + Math.random() * BL_JITTER);
      },
      true
    );
  };
  if (!list.length) finish();
  else next();
  // 返回控制器：cancel() 中断后续拉黑（在途请求会先正常完成；等待中则立即收尾）。
  return {
    cancel() {
      if (finished) return;
      cancelled = true;
      if (timer) finish();
    },
  };
}

// 入口：info 至少含 up；优先用 uid，没有则用 bvid 反查；都没有才退回按 UP 名本地屏蔽。
// 传 cardEl 时会先实时重抠一遍 DOM（避免用到首屏未渲染时缓存的空 uid）。
export function blacklistUp(info: BlockSource, cb?: (ok: boolean) => void, cardEl: Element | null = null): void {
  let uid = info && info.uid ? String(info.uid) : '';
  let upName = (info && info.up) || '';
  let bvid = (info && info.bvid) || '';
  if (cardEl) {
    const live = extractCardInfo(cardEl);
    uid = uid || live.uid;
    upName = upName || live.up;
    bvid = bvid || live.bvid;
  }
  // 联合投稿：开了开关且能拿到 BV → 读取合作者名单，主作者 + 全部合作者一并拉黑
  if (CONFIG.blacklistCollab && bvid) {
    toast('正在读取联合投稿名单…');
    fetchView(bvid, (d) => {
      const targets: BlockTarget[] = [];
      if (d && d.owner) targets.push({ uid: d.owner.mid, name: d.owner.name || '' });
      if (d && Array.isArray(d.staff)) d.staff.forEach((s: any) => targets.push({ uid: s.mid, name: s.name || '' }));
      if (!targets.length && uid) targets.push({ uid, name: upName });
      if (!targets.length) {
        if (upName) {
          addToList(CONFIG.block.upNames, upName);
          toast(`未能解析名单，已按 UP 名本地屏蔽：${upName}`);
        } else {
          toast('该卡片信息不足，无法拉黑');
        }
        cb?.(false);
        return;
      }
      doBlacklistMany(targets, (r) => {
        const ok = r.added + r.already;
        toast(targets.length > 1 ? `联合投稿：已拉黑 ${ok}/${r.total} 位作者${r.failed.length ? `（失败 ${r.failed.length}）` : ''}` : `已拉黑：${targets[0].name || targets[0].uid}`);
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
    toast('正在解析该 UP 的 UID…');
    resolveUidByBvid(bvid, (rid, rname) => {
      if (rid) {
        doBlacklist(rid, rname || upName, cb);
      } else if (upName) {
        addToList(CONFIG.block.upNames, upName);
        toast(`未能解析 UID，已按 UP 名本地屏蔽：${upName}`);
        cb?.(false);
      } else {
        toast('未能解析该 UP，已跳过');
        cb?.(false);
      }
    });
    return;
  }
  if (upName) {
    addToList(CONFIG.block.upNames, upName);
    toast(`该卡片没拿到 UID/BV，已按 UP 名本地屏蔽：${upName}`);
  } else {
    toast('该卡片信息不足，无法拉黑');
  }
  cb?.(false);
}

// —— 从账号黑名单导回本地 ——
// 「拉黑」写两处：账号黑名单（服务端，权威）与本地 block.uids（镜像，只为让 DOM 层也能拦）。
// 镜像会丢而权威那份还在，所以要有一条从权威源重建的路。顺带回填 UP 名——
// 光有一串数字，用户在面板里认不出自己拉黑过谁。
export interface ImportBlacksResult {
  total: number; // 账号黑名单里的总人数（接口自报）
  fetched: number; // 实际读到的条数
  added: number; // 本地新增的条数（已存在的不重复计）
  truncated: boolean; // 撞上页数上限提前停了——必须如实告诉用户，否则少导一半也看不出来
}

const BLACKS_PAGE_SIZE = 50;
// 翻页节奏：只读 GET，比批量拉黑（写账号）宽松，但仍要留抖动。3000 人 = 60 页，
// 按下面的节奏约 35 秒——慢一点换不触发风控，划算得多。
const BLACKS_DELAY = 400;
const BLACKS_JITTER = 300;
// 同一页因风控最多重试几次。超了就带着已读到的部分收工，而不是无限转下去。
const BLACKS_RETRY_MAX = 4;
// 页数上限：纯粹防「接口一直返回满页」时死循环，不是业务限制，所以要开得比任何真实名单都大。
// 上一版设成 40（= 2000 人）并把停下来报成 cancelled——名单上千的人会被静默截断，
// 而界面上只显示「共 N 人，新增 M 条」，看不出少了一半。宁可多转几圈也不能悄悄少导。
const BLACKS_MAX_PAGES = 400;

export function importAccountBlacklist(
  cb: (r: ImportBlacksResult | null) => void,
  onProgress?: (done: number, total: number, paused: boolean) => void
): void {
  const uids: string[] = [];
  const names: Record<string, string> = {};
  let total = 0;
  let retries = 0;

  const finish = (truncated: boolean) => {
    // 一次性写入 + 一次重扫：逐页写会让大名单期间页面反复重扫。
    const added = pushUnique(CONFIG.block.uids, uids);
    for (const uid of Object.keys(names)) setUidName(uid, names[uid]);
    if (added || Object.keys(names).length) {
      saveConfig();
      emitRulesChanged();
    }
    cb({ total, fetched: uids.length, added, truncated });
  };

  const page = (pn: number) => {
    if (pn > BLACKS_MAX_PAGES) return finish(true);
    // 熔断中先等：不然第 5 页触发风控后，第 6…60 页会照旧撞上去，把退避窗口撑得更长。
    if (riskGuard.blocked()) {
      onProgress?.(uids.length, total, true);
      setTimeout(() => page(pn), riskGuard.remaining() + 50);
      return;
    }
    const sent = gmRequest({
      method: 'GET',
      url: `https://api.bilibili.com/x/relation/blacks?re_version=0&ps=${BLACKS_PAGE_SIZE}&pn=${pn}`,
      withCredentials: true,
      timeout: 12000,
      onload: (r) => {
        let j: any = null;
        try {
          j = JSON.parse(r.responseText);
        } catch (e) {
          /* 不是 JSON（风控页/网关错误）：按失败处理 */
        }
        const code = j && typeof j.code === 'number' ? j.code : null;
        riskGuard.note(code);
        // 风控码是可重试的，不是「这次导入失败了」：等退避结束重试同一页，别把已读到的几十页扔掉。
        if (code !== null && RISK_CODES.has(code)) {
          if (++retries > BLACKS_RETRY_MAX) return finish(true); // 反复撞墙：带着已读到的部分收工
          onProgress?.(uids.length, total, true);
          setTimeout(() => page(pn), riskGuard.remaining() + 50);
          return;
        }
        // 未登录（-101）这类是确定性失败，重试没意义；如实返回 null 让调用方说人话，
        // 而不是把空名单当成「你的黑名单是空的」——那会让用户以为账号那边也没了。
        if (!j || code !== 0 || !j.data) return cb(null);
        retries = 0;
        const list: any[] = Array.isArray(j.data.list) ? j.data.list : [];
        total = typeof j.data.total === 'number' ? j.data.total : total;
        for (const it of list) {
          if (!it || it.mid == null) continue;
          const uid = String(it.mid);
          uids.push(uid);
          if (it.uname) names[uid] = String(it.uname);
        }
        onProgress?.(uids.length, total, false);
        // 拿满一页就还有下一页；不足一页说明到底了。不看 has_more——各接口对它的语义并不一致。
        if (list.length >= BLACKS_PAGE_SIZE) setTimeout(() => page(pn + 1), BLACKS_DELAY + Math.random() * BLACKS_JITTER);
        else finish(false);
      },
      onerror: () => cb(null),
      ontimeout: () => cb(null),
    });
    if (!sent) cb(null);
  };
  page(1);
}
