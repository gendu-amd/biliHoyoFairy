// 取数层的缓存语义：哪些失败该被记住，哪些不该。
//
// 这里真正的风险不是「请求发错了」，而是**记错了失败**：一次超时或一段风控退避若被当成
// 「这个视频没有数据」永久缓存下来，那批视频在整个会话里都不会再被联网维度判定，
// 页面照常、控制台干净、用户只觉得「标签规则有时候不灵」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// gmRequest 桩：按 responses 队列依次应答，并记录实际发出的 URL（用来断言「有没有重发」）。
const h = vi.hoisted(() => ({ responses: [] as any[], calls: [] as string[] }));
vi.mock('../src/gm', () => ({
  gmRequest: (opts: any) => {
    h.calls.push(opts.url);
    const r = h.responses.shift();
    if (r === 'neterr') opts.onerror();
    else if (r === 'timeout') opts.ontimeout();
    else if (r === 'badjson') opts.onload({ responseText: '<html>502</html>' });
    else opts.onload({ responseText: JSON.stringify(r) });
    return true;
  },
}));
// 风控码会让 riskGuard 弹 toast，而 node 环境没有 document。
vi.mock('../src/ui/toast', () => ({ toast: () => {}, updateBadge: () => {} }));

import { fetchTags, fetchView, riskGuard } from '../src/api';

// 每个用例换一个 bvid：缓存是模块级单例，共用键会让用例互相污染。
let seq = 0;
const nextBv = () => `BV1test${seq++}`;
const tagsOk = (...names: string[]) => ({ code: 0, data: names.map((tag_name) => ({ tag_name })) });

// 队列每完成一个请求要等 API.DELAY 才释放并发位；假定时器下不推进时间的话，
// 三个用例过后并发位就耗尽、后续请求全卡在队列里。每次取完顺手推进一点。
function get(bvid: string): any {
  let out: any = 'NOT_CALLED';
  fetchTags(bvid, (d) => (out = d));
  vi.advanceTimersByTime(200);
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.responses.length = 0;
  h.calls.length = 0;
  riskGuard.until = 0;
  riskGuard.strikes = 0;
});
afterEach(() => vi.useRealTimers());

describe('fetchTags：成功结果长期缓存', () => {
  it('第二次不再发请求', () => {
    const bv = nextBv();
    h.responses.push(tagsOk('鬼畜', '搞笑'));
    expect(get(bv)).toEqual(['鬼畜', '搞笑']);
    expect(get(bv)).toEqual(['鬼畜', '搞笑']);
    expect(h.calls.length).toBe(1);
  });
});

describe('fetchTags：确定性否定（服务端答了非 0 码）也长期缓存', () => {
  it('稿件不存在这类结论不会变，不必反复去问', () => {
    const bv = nextBv();
    h.responses.push({ code: -404, message: '啥都木有' });
    expect(get(bv)).toBeNull();
    expect(get(bv)).toBeNull();
    expect(h.calls.length).toBe(1);
  });
});

describe('fetchTags：瞬时失败只压冷却，不永久化', () => {
  it.each([['网络错误', 'neterr'], ['超时', 'timeout'], ['响应不是 JSON', 'badjson'], ['风控码', { code: -352 }]])(
    '%s：冷却期内不重发，冷却过后重试并拿到真实数据',
    (_name, failure) => {
      const bv = nextBv();
      h.responses.push(failure);
      expect(get(bv)).toBeNull();
      expect(h.calls.length).toBe(1);

      // 冷却期内：同一 bvid 直接回 null，不再打接口（否则每轮重扫都会重发一批）
      expect(get(bv)).toBeNull();
      expect(h.calls.length).toBe(1);

      // 冷却过后：允许重试。旧实现在这里会因为缓存里存着 null 而永远拿不到标签。
      riskGuard.until = 0; // 风控退避与本用例无关，避免请求被熔断器压住
      vi.advanceTimersByTime(31000);
      h.responses.push(tagsOk('鬼畜'));
      expect(get(bv)).toEqual(['鬼畜']);
      expect(h.calls.length).toBe(2);
    }
  );

  // view 与 tag 都以 bvid 为键：冷却表若不分命名空间，一次 view 失败会连带压住 tag 请求。
  it('不同接口的冷却互不牵连', () => {
    const bv = nextBv();
    h.responses.push('neterr');
    let viewOut: any = 'NOT_CALLED';
    fetchView(bv, (d) => (viewOut = d));
    vi.advanceTimersByTime(200);
    expect(viewOut).toBeNull();

    h.responses.push(tagsOk('鬼畜'));
    expect(get(bv)).toEqual(['鬼畜']); // 没有被 view 的冷却挡住
    expect(h.calls.length).toBe(2);
  });
});
