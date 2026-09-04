// 接口层：缓存 + 小并发限速队列 + 风控熔断。API 取数与批量拉黑共用。
import { RISK_CODES } from './constants';
import { gmRequest } from './gm';
import { CONFIG, scheduleStatsSave, setUidName } from './config';
import { capMapSet } from './util';
import { logErr } from './logging';
import { toast } from './ui/toast';

// 缓存容量上限（防长会话内存无界）：view/card 对象较大用 800，tag 较小用 1200。
const VIEW_CACHE_MAX = 800;
const TAG_CACHE_MAX = 1200;
const CARD_CACHE_MAX = 800;

// 风控熔断：B 站返回风控码时全局暂停联网并指数退避，保护账号。
export const riskGuard = {
  until: 0,
  strikes: 0,
  blocked(): boolean {
    return Date.now() < this.until;
  },
  remaining(): number {
    return Math.max(0, this.until - Date.now());
  },
  // 任何联网响应都喂进来：风控码→升级退避；正常码→冷却期过后清零。
  note(code: number | null | undefined): void {
    if (code == null || !RISK_CODES.has(code)) {
      if (code === 0 && this.strikes && !this.blocked()) this.strikes = 0;
      return;
    }
    const wasBlocked = this.blocked();
    this.strikes = Math.min(this.strikes + 1, 6);
    const backoff = Math.min(60000, 2000 * 2 ** (this.strikes - 1)); // 2s→4s→…→封顶 60s
    this.until = Date.now() + backoff;
    if (!wasBlocked) {
      logErr('风控熔断', `code ${code}，暂停联网 ${Math.round(backoff / 1000)}s`);
      toast(`⚠️ 触发 B 站风控(code ${code})，已暂停联网 ${Math.round(backoff / 1000)} 秒以保护账号`, 'error');
    }
  },
};

type ApiCb = (data: any) => void;

// 小并发 + 较短冷却：兼顾速度与风控。每个请求完成后冷却 DELAY 再释放并发位。
const API = {
  view: new Map<string, any>(),
  tag: new Map<string, any>(),
  card: new Map<string, any>(),
  queue: [] as Array<(done: () => void) => void>,
  active: 0,
  waiting: false,
  CONCURRENCY: 3,
  DELAY: 120,
};

function apiPump(): void {
  // 熔断中：不派发新请求，等退避窗口结束再恢复（已入队任务保持排队，不丢）
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
    const task = API.queue.shift()!;
    API.active++;
    task(() => {
      setTimeout(() => {
        API.active--;
        apiPump();
      }, API.DELAY);
    });
  }
}

function apiEnqueue(task: (done: () => void) => void): void {
  API.queue.push(task);
  apiPump();
}

function gmGet(url: string, cb: ApiCb): void {
  // withCredentials（携带 Cookie）由 gm.ts 的类型垫片补上；环境没有 GM_xmlhttpRequest 时它返回 false。
  const sent = gmRequest({
    method: 'GET',
    url,
    withCredentials: true,
    timeout: 12000,
    onload: (r: { responseText: string }) => {
      try {
        const j = JSON.parse(r.responseText);
        riskGuard.note(j && j.code); // 风控码喂给熔断器
        cb(j);
      } catch (e) {
        cb(null);
      }
    },
    onerror: () => cb(null),
    ontimeout: () => cb(null),
  });
  if (!sent) cb(null);
}

// —— 失败的两种性质要分开对待 ——
//
// 过去三个取数函数一律把结果（含失败时的 null）写进长期缓存，于是 `cache.has(key)` 恒为真，
// 这个 bvid/mid **整个会话内不再重试**。一次网络抖动、一次超时、一段风控退避，就能让一批视频
// 永久拿不到标签/简介数据——标签、双标签、充电、UP简介这些联网维度对它们静默失效。
// 方向是安全的那一侧（漏过而非误伤），但它静默且不可恢复，用户只会觉得「有时候标签规则不灵」。
//
// 现在按响应性质分流：
//   - code === 0            成功，长期缓存。
//   - code !== 0 且非风控码  服务端的**确定性否定**（稿件不存在/已删除等），结论不会变，长期缓存 null。
//   - 无响应 / 风控码        瞬时失败，**不进长期缓存**，只压一段冷却，之后可重试。
// 冷却是必要的：完全不记会让每轮重扫都对同一批 key 重发请求，风控期间尤其糟。
const RETRY_AFTER_MS = 30000;
const COOLDOWN_MAX = 2000;
// key 带命名空间前缀：view 与 tag 都以 bvid 为键，共用一张表会让一次 view 失败连带压住 tag 请求。
const cooldown = new Map<string, number>();
function inCooldown(k: string): boolean {
  const until = cooldown.get(k);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  cooldown.delete(k);
  return false;
}

// 在途请求表：同一个 key 第二次进来时不再发第二个请求，而是挂在第一个的回调队列上。
//
// 没有它就会重复发：cache 只在**响应回来之后**才写，所以同一 bvid/mid 在这之前来几次就发几次。
// 现实里这很常见——同一个 UP 的两张卡同屏、面板里一批 UID chip 同时解析名称、
// 一次重渲把还在飞行中的请求又发一遍。纯浪费之外还实打实地把风控风险抬高了。
const inflight = new Map<string, ApiCb[]>();

// 三个取数接口的公共骨架：命中缓存/冷却直接回调，否则入队请求并按上面的分流写缓存。
function cachedGet(cache: Map<string, any>, cap: number, ns: string, key: string, url: string, pick: (j: any) => any, cb: ApiCb): void {
  if (!key) return cb(null);
  if (cache.has(key)) return cb(cache.get(key));
  if (inCooldown(ns + key)) return cb(null);
  const flightKey = ns + key;
  const waiting = inflight.get(flightKey);
  if (waiting) {
    waiting.push(cb); // 已有同 key 的请求在路上，等它的结果即可
    return;
  }
  inflight.set(flightKey, [cb]);
  const settle = (d: any) => {
    const cbs = inflight.get(flightKey) || [];
    inflight.delete(flightKey);
    for (const f of cbs) f(d);
  };
  apiEnqueue((done) => {
    gmGet(url, (j) => {
      const code = j && typeof j.code === 'number' ? j.code : null;
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

export function fetchView(bvid: string, cb: ApiCb): void {
  // d.owner.mid 即可反查 uid（cachedUid），无需另设缓存
  cachedGet(API.view, VIEW_CACHE_MAX, 'v:', bvid, 'https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid), (j) => j.data, (d) => {
    if (d && d.owner && d.owner.mid && d.owner.name && CONFIG.uidNames[String(d.owner.mid)] === undefined) {
      setUidName(d.owner.mid, d.owner.name); // 持久化（软上限内）：面板按名展示
      scheduleStatsSave();
    }
    cb(d);
  });
}

export function fetchTags(bvid: string, cb: ApiCb): void {
  cachedGet(
    API.tag,
    TAG_CACHE_MAX,
    't:',
    bvid,
    'https://api.bilibili.com/x/web-interface/view/detail/tag?bvid=' + encodeURIComponent(bvid),
    (j) => (Array.isArray(j.data) ? j.data.map((x: any) => x.tag_name).filter(Boolean) : null),
    cb
  );
}

export function fetchCard(mid: string, cb: ApiCb): void {
  cachedGet(API.card, CARD_CACHE_MAX, 'c:', mid, 'https://api.bilibili.com/x/web-interface/card?mid=' + encodeURIComponent(mid), (j) => j.data, cb);
}

// 从 view 缓存里同步取 uid（已请求过的 bvid 才有；否则返回空串）。
export function cachedUid(bvid: string): string {
  const d = bvid && API.view.get(bvid);
  return d && d.owner && d.owner.mid ? String(d.owner.mid) : '';
}
