import { describe, it, expect } from 'vitest';
import { createScanScheduler, STEADY_THROTTLE_MS } from '../src/scanner';

// 用假的 raf/timeout 驱动，把「何时扫描」的策略与真实 DOM/计时器解耦后单测。
// 这些用例锁的是**首屏不闪烁**这个行为：首屏阶段必须每帧（绘制前）扫一次，
// 而不是等 250ms 节流——那时卡片早画出来了。
function harness() {
  const calls = { scan: 0 };
  const rafQ: (() => void)[] = [];
  const timerQ: { cb: () => void; ms: number }[] = [];
  const s = createScanScheduler({
    scan: () => calls.scan++,
    raf: (cb) => rafQ.push(cb),
    timeout: (cb, ms) => timerQ.push({ cb, ms }),
  });
  return {
    s,
    calls,
    rafQ,
    timerQ,
    flushRaf: () => rafQ.splice(0).forEach((cb) => cb()),
    flushTimers: () => timerQ.splice(0).forEach((t) => t.cb()),
  };
}

describe('扫描调度：首屏阶段', () => {
  it('走 rAF（绘制前）而不是节流计时器', () => {
    const h = harness();
    h.s.request();
    expect(h.rafQ).toHaveLength(1);
    expect(h.timerQ).toHaveLength(0);
  });

  it('同一帧内多次请求合批成一次扫描', () => {
    const h = harness();
    h.s.request();
    h.s.request();
    h.s.request();
    expect(h.rafQ).toHaveLength(1);
    h.flushRaf();
    expect(h.calls.scan).toBe(1);
  });

  it('上一帧跑完后，下一帧能再排一次（合批不是「只扫一次」）', () => {
    const h = harness();
    h.s.request();
    h.flushRaf();
    h.s.request();
    h.flushRaf();
    expect(h.calls.scan).toBe(2);
  });
});

describe('扫描调度：稳态阶段', () => {
  it('切换后走 250ms 节流', () => {
    const h = harness();
    h.s.toSteadyState();
    h.s.request();
    expect(h.rafQ).toHaveLength(0);
    expect(h.timerQ).toHaveLength(1);
    expect(h.timerQ[0].ms).toBe(STEADY_THROTTLE_MS);
    h.flushTimers();
    expect(h.calls.scan).toBe(1);
  });

  it('节流窗口内多次请求合批成一次', () => {
    const h = harness();
    h.s.toSteadyState();
    h.s.request();
    h.s.request();
    expect(h.timerQ).toHaveLength(1);
  });
});

describe('阶段切换不丢扫描', () => {
  // 回归护栏：DOMContentLoaded 恰好落在「已排队但还没跑」的那一帧之间时，
  // 若切换阶段时把 queued 清掉，那次 rAF 会变成空跑，而真正的请求已被合批吞掉
  // —— 首屏最后一批卡就永远不会被判定（静默漏屏蔽，无任何报错）。
  it('切换稳态时，已排队的那次 rAF 仍会真正执行扫描', () => {
    const h = harness();
    h.s.request();
    h.s.toSteadyState();
    h.flushRaf();
    expect(h.calls.scan).toBe(1);
  });

  it('切换稳态后再请求，不会因为旧的 queued 标记被吞掉', () => {
    const h = harness();
    h.s.request();
    h.s.toSteadyState();
    h.flushRaf(); // 释放 queued
    h.s.request();
    h.flushTimers();
    expect(h.calls.scan).toBe(2);
  });

  it('重复切换稳态是幂等的', () => {
    const h = harness();
    h.s.toSteadyState();
    h.s.toSteadyState();
    h.s.request();
    expect(h.timerQ).toHaveLength(1);
    expect(h.rafQ).toHaveLength(0);
  });
});
