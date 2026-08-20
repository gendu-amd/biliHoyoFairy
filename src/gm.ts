// GM_xmlhttpRequest 的类型垫片（叶子模块，不 import 任何本仓库代码）。
//
// 为什么需要它：@types/tampermonkey 的 Request 类型里没有 withCredentials，而 TM 运行期支持它，
// 且我们**必须**带上它——拉黑（relation/modify）和视频详情都要携带 B 站 Cookie。
// 过去的做法是在调用点写 `as any`，代价是把整个请求对象的类型检查一起丢掉：onload 打错名字、
// data 拼错字段都不会报错，而这些是发出去才知道的错。这里补一次类型，调用点就恢复受检。
export type GmRequest<T = unknown> = Tampermonkey.Request<T> & { withCredentials?: boolean };

/** 环境里没有 GM_xmlhttpRequest（非 TM 环境 / 权限没给）时返回 false，调用方据此降级。 */
export function gmRequest<T = unknown>(opts: GmRequest<T>): boolean {
  if (typeof GM_xmlhttpRequest !== 'function') return false;
  GM_xmlhttpRequest(opts as Tampermonkey.Request<T>);
  return true;
}
