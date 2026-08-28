// 网络拦截层（数据层过滤，主路径）：hook fetch / XHR，被动过滤 B 站自身请求的 JSON 列表，
// 把命中本地规则的项从数组删掉，让页面只渲染保留项。只读不发——不重发请求、不需 WBI、不触发风控。
import { CONFIG } from './config';
import { log, logErr } from './logging';
import { normFeedItem } from './cardinfo';
import { matchRule } from './match/engine';
import { recordBlock } from './stats';
import { health } from './health';

// 接口注册：re=URL 匹配，get=从 data 里取出可过滤的数组（就地 splice 即生效）。
export interface FeedHook {
  re: RegExp;
  get: (d: any) => any[] | null;
}
export const FEED_HOOKS: FeedHook[] = [
  { re: /\/x\/web-interface\/wbi\/index\/top\/feed\/rcmd/, get: (d) => (d && Array.isArray(d.item) ? d.item : null) },
  { re: /\/x\/web-interface\/index\/top\/feed\/rcmd/, get: (d) => (d && Array.isArray(d.item) ? d.item : null) },
  { re: /\/x\/web-interface\/ranking\/v2/, get: (d) => (d && Array.isArray(d.list) ? d.list : null) },
  { re: /\/x\/web-interface\/popular(\/|\?|$)/, get: (d) => (d && Array.isArray(d.list) ? d.list : null) },
  { re: /\/x\/web-interface\/archive\/related/, get: (d) => (Array.isArray(d) ? d : null) },
  // 搜索页：type=视频 时 data.result 直接是视频数组；综合(all/v2) 时 data.result 是分组，取 result_type==='video' 的 data
  {
    re: /\/x\/web-interface\/wbi\/search\/(type|all\/v2)/,
    get: (d) => {
      if (!d || !Array.isArray(d.result)) return null;
      if (d.result.length && d.result[0] && d.result[0].result_type) {
        const g = d.result.find((x: any) => x.result_type === 'video');
        return g && Array.isArray(g.data) ? g.data : null;
      }
      return d.result;
    },
  },
];

// hook 查找：单条 URL 通常会被查两次（钩子入口判定 + filterFeedJson 取数组），
// 用一格 memo 让第二次 O(1)，避免对整张 FEED_HOOKS 表重复跑正则。
let memoUrl: string | null = null;
let memoHook: FeedHook | null = null;
export function findFeedHook(url: string | null | undefined): FeedHook | null {
  if (!url) return null;
  if (url === memoUrl) return memoHook;
  let hit: FeedHook | null = null;
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
export const isFeedUrl = (url: string | null | undefined): boolean => !!findFeedHook(url);

// 就地过滤一个已解析的 JSON 响应：命中项从 json.data 的数组里原地 splice 删除。
// 返回删除条数（0 表示未改动），调用方据此决定是否需要重建响应/重序列化。
export function filterFeedJson(url: string, json: any): number {
  if (!json || json.code !== 0 || !json.data) return 0;
  const hook = findFeedHook(url);
  if (!hook) return 0;
  const arr = hook.get(json.data);
  if (!arr || !arr.length) return 0;
  // 自检先于开关记账：这两个计数反映的是「管线还通不通」，与用户是否启用拦截无关。
  // B 站改字段名时 feedParsed 会停在 0，健康检查据此报警。
  health.feedParsed++;
  health.feedItems += arr.length;
  // 审查模式下不在数据层删项，让视频照常渲染，交给 DOM 层标记，便于核对
  if (!CONFIG.enabled || CONFIG.reviewMode) return 0;
  let removed = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    try {
      const info = normFeedItem(arr[i]);
      if (!info) continue; // 白名单由 matchRule 内部短路，无需在此重复判断
      const reason = matchRule(info);
      if (reason) {
        recordBlock(reason, info, 'NET');
        arr.splice(i, 1);
        removed++;
      }
    } catch (e) {
      // 逐项容错：单条畸形 item 抛错只跳过该项，不让整条响应放弃过滤（B站偶发异形数据时尤其重要）。
      // 走 debug 日志而非 logErr：异形项可能成批出现，不该刷屏正常用户的控制台。
      log('拦截层 单项判定异常（已跳过）', e);
    }
  }
  if (removed) log(`拦截层 删除 ${removed} 项 @ ${url.split('?')[0]}`);
  return removed;
}

// 可插拔网络管线（以「JSON 原地过滤」为中心，fetch 与 XHR 共用一套）。
//   preFn:  (url) => newUrl|void   —— 渲染前改写请求 URL（仅处理字符串 URL）
//   postFn: (url, json) => removedCount —— 原地修改解析后的 JSON，返回删除条数
type PreFn = (url: string) => string | void;
type PostFn = (url: string, json: any) => number;

// 「这条请求已带 WBI 签名」的标记。
//
// B 站的 wbi 接口把**全部** query 参数按 key 排序后连同 mixin_key 一起 MD5，得出 w_rid。
// 也就是说签名覆盖每一个参数——签完名再动其中任何一个（哪怕只是把 ps=12 改成 ps=30、
// 或加个防缓存随机数），服务端校验必然对不上，直接返回 -403 校验失败，该接口这一次就白发了。
// 首页推荐早已迁到 wbi 路径（FEED_HOOKS 第一条），所以这不是理论风险。
//
// 兜底放在管线出口而不是某个 preFn 里：B 站把接口往 wbi 迁是持续在发生的事，按「有没有
// w_rid」这个确定性标记判定，才不会在下一次迁移时又悄悄破一遍。代价是相应的改写功能
// 在已签名接口上不生效——这由 health 显式报出来，而不是让用户对着刷不出的首页猜。
const SIGNED_RE = /[?&]w_rid=/;
const NET = (() => {
  const preFns: PreFn[] = [];
  const postFns: PostFn[] = [];
  return {
    addPre: (fn: PreFn) => preFns.push(fn),
    addPost: (fn: PostFn) => postFns.push(fn),
    hasPre: () => preFns.length > 0,
    rewriteUrl(url: string): string {
      let u = url;
      for (const fn of preFns) {
        try {
          const r = fn(u);
          if (typeof r === 'string' && r) u = r;
        } catch (e) {
          logErr('NET.pre', e); // 管线内异常不静默：改写失效会让 boostFeedLoad 之类的功能无声失灵
        }
      }
      // 已签名请求兜底（见 SIGNED_RE）：宁可这次改写不生效，也不能把请求改成必然 -403 的形状。
      if (u !== url && SIGNED_RE.test(url)) {
        health.signedSkipped++;
        return url;
      }
      return u;
    },
    runJson(url: string, json: any): number {
      let removed = 0;
      for (const fn of postFns) {
        try {
          removed += fn(url, json) || 0;
        } catch (e) {
          logErr('NET.post', e); // 同上：过滤器整体抛错=该页不再拦截，必须可见
        }
      }
      return removed;
    },
  };
})();

/** 跑一遍请求改写管线（含已签名 URL 的兜底）。非字符串 URL 不处理，原样返回。 */
export function rewriteRequestUrl(url: string): string {
  return NET.hasPre() ? NET.rewriteUrl(url) : url;
}

// 首页推荐接口（增大加载数量用）。与 FEED_HOOKS 里的两条 rcmd 规则同源，避免两处各写一份。
// 保留 wbi/ 那一路的匹配：改写会被上面的 SIGNED_RE 兜底拦下并计数，比在这里假装 wbi 不存在
// 更诚实——用户开了开关却没效果时，自检能说出原因。未签名的旧路径上它照常生效。
const RCMD_RE = /\/x\/web-interface\/(wbi\/)?index\/top\/feed\/rcmd/;

// 注册唯一的内容过滤 postFn（即 filterFeedJson）；以后新增过滤器只需再 addPost 一条。
NET.addPost(filterFeedJson);
// 注册「增大首页推荐请求数」preFn（默认关，opt-in）：拦截层会删项，调大 ps 可让信息流删后仍饱满。
NET.addPre((url) => {
  if (!CONFIG.boostFeedLoad) return;
  if (RCMD_RE.test(url) && /[?&]ps=\d+/.test(url)) {
    return url.replace(/([?&]ps=)\d+/, '$1' + 30);
  }
});

// 过滤文本响应：无删项时原样返回 raw（省一次序列化、且保持字节一致）。
function computeFilteredText(url: string, raw: string): string {
  try {
    const json = JSON.parse(raw);
    return NET.runJson(url, json) ? JSON.stringify(json) : raw;
  } catch (e) {
    return raw;
  }
}

export function installNetworkHooks(): void {
  const W: any = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // —— fetch ——
  const RespCtor = W.Response || Response;
  if (typeof W.fetch === 'function' && !W.fetch.__bfb) {
    const origFetch = W.fetch;
    const wrapped: any = function (this: unknown, input: any, init: any) {
      // 请求改写（preFn）：仅当输入是字符串 URL 时处理，避免重建 Request 对象的副作用
      let input2 = input;
      if (typeof input === 'string') input2 = rewriteRequestUrl(input);
      const url = typeof input2 === 'string' ? input2 : (input2 && input2.url) || '';
      const p = origFetch.call(this, input2, init);
      health.noteRequest(url);
      if (!isFeedUrl(url)) return p;
      health.feedMatched++;
      return p.then((resp: Response) =>
        resp
          .clone()
          .json()
          .then((json: any) => {
            // 无命中删项：原样返回真实响应，保留 url/type/redirected 等元信息，且不重序列化
            if (!NET.runJson(url, json)) return resp;
            // 有删项才重建响应：剔除 content-encoding/length（正文已是明文 JSON，旧头会误导消费者）
            const h = new Headers(resp.headers);
            h.delete('content-encoding');
            h.delete('content-length');
            return new RespCtor(JSON.stringify(json), { status: resp.status, statusText: resp.statusText, headers: h });
          })
          .catch(() => resp)
      );
    };
    wrapped.__bfb = true;
    try {
      W.fetch = wrapped;
    } catch (e) {
      logErr('installNetworkHooks.fetch', e);
    }
  }

  // —— XMLHttpRequest —— 在 open 时给目标请求实例装上惰性 getter，
  // 读取时（readyState 4）才解析+过滤，规避页面处理器先于我们读取的时序问题。
  const XHR = W.XMLHttpRequest;
  if (XHR && XHR.prototype && !XHR.prototype.__bfb) {
    const origOpen = XHR.prototype.open;
    const dText = Object.getOwnPropertyDescriptor(XHR.prototype, 'responseText');
    const dResp = Object.getOwnPropertyDescriptor(XHR.prototype, 'response');
    // async/user/password 照原样透传：签名写全，既不必再摸 arguments，也让「透传」这件事看得见。
    XHR.prototype.open = function (this: any, method: string, url: string, async = true, user?: string | null, password?: string | null) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- 下面 defineProperty 的 getter 有自己的 this，必须在这里捕获实例
      const self = this;
      // ⚠ XHR 实例是可复用的（同一个对象可以连续 open 多次）。上一轮装的惰性 getter 与文本 memo
      // 若不清理，第二次请求会读到第一次的过滤结果；第二次若是非 feed URL（不再进入下面的分支），
      // 残留的 getter 会把完全无关接口的响应替换成上一次的 JSON。故每次 open 先无条件复位。
      if (self.__bfbHooked) {
        delete self.responseText;
        delete self.response;
        self.__bfbHooked = false;
      }
      self.__bfbText = undefined;
      self.__bfbResp = undefined;
      // 请求改写（preFn）：仅处理字符串 URL
      const url2 = typeof url === 'string' ? rewriteRequestUrl(url) : url;
      health.noteRequest(url2);
      if (isFeedUrl(url2)) {
        health.feedMatched++;
        // 同一次响应只过滤一次：responseText 与 response(text 型) 共用这份文本 memo，
        // 避免消费者同时读两者时过滤跑两遍、导致计数与屏蔽记录翻倍。
        const filteredText = (getRaw: () => string): string => {
          if (self.__bfbText === undefined) self.__bfbText = computeFilteredText(url2, getRaw());
          return self.__bfbText;
        };
        if (dText && dText.get) {
          Object.defineProperty(self, 'responseText', {
            configurable: true,
            get() {
              if (self.readyState !== 4) return dText.get!.call(self);
              return filteredText(() => dText.get!.call(self));
            },
          });
          self.__bfbHooked = true;
        }
        if (dResp && dResp.get) {
          Object.defineProperty(self, 'response', {
            configurable: true,
            get() {
              if (self.readyState !== 4) return dResp.get!.call(self);
              const rt = self.responseType;
              // json 型只能读 .response（读 responseText 会抛错），单独 memo 一份对象
              if (rt === 'json') {
                if (self.__bfbResp === undefined) {
                  const orig = dResp.get!.call(self);
                  try {
                    if (orig && typeof orig === 'object') NET.runJson(url2, orig); // 原地删项
                    self.__bfbResp = orig;
                  } catch (e) {
                    self.__bfbResp = orig;
                  }
                }
                return self.__bfbResp;
              }
              // text/'' 型：与 responseText 共用同一份文本 memo
              if (rt === '' || rt === 'text') {
                const orig = dResp.get!.call(self);
                return typeof orig === 'string' ? filteredText(() => orig) : orig;
              }
              return dResp.get!.call(self);
            },
          });
          self.__bfbHooked = true;
        }
      }
      // 用改写后的 url2 调原始 open（保留 async/user/password 透传）
      return origOpen.call(this, method, url2, async, user, password);
    };
    XHR.prototype.__bfb = true;
  }
}
