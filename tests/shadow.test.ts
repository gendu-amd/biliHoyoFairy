// shadow root 注册表：收口成单一入口 + 一个「发现新 root」回调。
//
// 这里锁的不是「Set 会不会去重」，而是一条会静默漏屏蔽的链路：
// **shadow root 内部的 DOM 变动不会冒泡到 document 级的 MutationObserver**。
// scanner 只观察 document 的话，影子树里新增的卡永远不触发重扫，只能靠光 DOM 的某次变动
// 偶然捎带一次——表现为「有的拦了有的没拦」「滚一会儿就不拦了」，且不报任何错。
// 所以每个新 root 都必须被单独观察一次，而这靠的就是下面这个回调。
import { beforeEach, describe, expect, it } from 'vitest';
import { addShadowRoot, harvestShadowRoots, setShadowRootHandler, shadowRoots } from '../src/shadow';

// node 环境没有真的 ShadowRoot；用最小假件，只需身份可比较。
const fakeRoot = (name: string) => ({ name }) as unknown as ShadowRoot;

// 假宿主元素：querySelectorAll('*') 返回一批带/不带 shadowRoot 的元素。
function fakeTree(els: Array<{ id?: string; shadowRoot?: ShadowRoot }>): Document {
  return { querySelectorAll: () => els } as unknown as Document;
}

let seen: ShadowRoot[];
beforeEach(() => {
  shadowRoots.clear();
  seen = [];
  setShadowRootHandler((r) => seen.push(r));
});

describe('addShadowRoot：单一入口', () => {
  it('新 root 进注册表并触发一次回调', () => {
    const r = fakeRoot('a');
    addShadowRoot(r);
    expect(shadowRoots.has(r)).toBe(true);
    expect(seen).toEqual([r]);
  });

  it('同一个 root 重复收录不重复回调（否则会被重复观察）', () => {
    const r = fakeRoot('a');
    addShadowRoot(r);
    addShadowRoot(r);
    expect(seen).toHaveLength(1);
  });

  it('null / undefined 不炸也不入表', () => {
    addShadowRoot(null);
    addShadowRoot(undefined);
    expect(shadowRoots.size).toBe(0);
    expect(seen).toHaveLength(0);
  });
});

describe('setShadowRootHandler：对已收集的 root 补跑', () => {
  // main 里的 attachShadow 钩子先于 startScanner 安装，中间创建的 root 会先进表、后有观察器。
  // 不补跑的话，那些 root 就永远没人观察——正是「首屏那批评论/卡片不随规则更新」的成因。
  it('注册前就已入表的 root 也会被处理一次', () => {
    const early = fakeRoot('early');
    addShadowRoot(early); // 此时的处理器还是本文件 beforeEach 里那个
    const late: ShadowRoot[] = [];
    setShadowRootHandler((r) => late.push(r));
    expect(late).toEqual([early]);
  });
});

describe('harvestShadowRoots：全量采集也走同一入口', () => {
  it('采到的 root 同样触发回调', () => {
    const r1 = fakeRoot('r1');
    const r2 = fakeRoot('r2');
    harvestShadowRoots(fakeTree([{ shadowRoot: r1 }, {}, { shadowRoot: r2 }]));
    expect(seen).toEqual([r1, r2]);
  });

  it('跳过我们自己的浮层宿主（它的影子树里没有 B 站内容）', () => {
    const mine = fakeRoot('mine');
    harvestShadowRoots(fakeTree([{ id: 'bfb-overlay-host', shadowRoot: mine }]));
    expect(shadowRoots.size).toBe(0);
  });

  it('入参为空或不可遍历时安静返回', () => {
    harvestShadowRoots(null);
    expect(seen).toHaveLength(0);
  });
});
