// vitest 全局桩：config.ts / subscriptions/store.ts 在模块初始化时会调用 GM_* 与 GM_info，
// 这里在任何测试模块导入前提供内存实现，使纯逻辑可在 node 环境下被测试。
const store: Record<string, string> = {};
const g = globalThis as any;
g.GM_getValue = (k: string, d: unknown) => (k in store ? store[k] : d);
g.GM_setValue = (k: string, v: string) => {
  store[k] = v;
};
g.GM_info = { script: { version: '0.0.5' } };
// GM_addValueChangeListener（多标签页同步）：桩只收集监听器，由测试手动触发来模拟
// 「另一个标签页写入了存储」。GM_setValue 故意**不**触发它——那是本页自己的写入（remote=false）。
const valueListeners: Record<string, Array<(...a: any[]) => void>> = {};
g.__gmFireValueChange = (key: string, remote: boolean) => {
  (valueListeners[key] || []).forEach((fn) => fn(key, null, store[key], remote));
};
g.GM_addValueChangeListener = (name: string, fn: (...a: any[]) => void) => {
  (valueListeners[name] = valueListeners[name] || []).push(fn);
  return 1;
};
// page.ts 在模块初始化时读 location.host 判定页面类型；node 环境没有 location，给一个首页形态的桩。
if (typeof g.location === 'undefined') {
  g.location = { host: 'www.bilibili.com', hostname: 'www.bilibili.com', pathname: '/', href: 'https://www.bilibili.com/' };
}
