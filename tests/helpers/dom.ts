// 极简 DOM 替身。仓库刻意不引入 jsdom（依赖只保留 esbuild + vitest + eslint + typescript），
// 但 page.ts / cardinfo.ts 这两个模块的**全部逻辑就是选择器逻辑**——不喂它们真的元素树就等于没测。
// 于是手写一个够用的替身：只实现被测代码真正调用的那几个 API，且严格照规范语义
// （closest 返回**最近的**祖先、querySelector 返回**文档序**首个），
// 因为这两条「最近 / 文档序」正是这类代码最容易踩的坑，替身放宽了就测不出来。
//
// 支持的选择器子集：`tag`、`.cls`、`#id`、`[attr]`、`[attr=v]`、`[attr*=v]`、`[attr^=v]`、`[attr$=v]`，
// 可复合（`a.link[href*=x]`）、可空格表示后代、可逗号并列。不支持伪类/子代/兄弟——用不到就不写，
// 免得替身自己变成需要被测的东西。

interface AttrCond {
  name: string;
  op?: '=' | '*=' | '^=' | '$=';
  value?: string;
}
interface Compound {
  tag: string;
  classes: string[];
  id: string;
  attrs: AttrCond[];
}

function parseCompound(src: string): Compound | null {
  const c: Compound = { tag: '', classes: [], id: '', attrs: [] };
  let i = 0;
  const m = src.match(/^[a-zA-Z*][\w-]*/);
  if (m) {
    c.tag = m[0] === '*' ? '' : m[0].toLowerCase();
    i = m[0].length;
  }
  while (i < src.length) {
    const ch = src[i];
    if (ch === '.' || ch === '#') {
      const n = src.slice(i + 1).match(/^[\w-]+/);
      if (!n) return null;
      if (ch === '.') c.classes.push(n[0]);
      else c.id = n[0];
      i += 1 + n[0].length;
    } else if (ch === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) return null;
      const body = src.slice(i + 1, end);
      const a = body.match(/^([\w-]+)(?:(\*=|\^=|\$=|=)\s*(.*))?$/);
      if (!a) return null;
      c.attrs.push({
        name: a[1],
        op: a[2] as AttrCond['op'],
        value: a[3] ? a[3].replace(/^["']|["']$/g, '') : undefined,
      });
      i = end + 1;
    } else return null;
  }
  return c;
}

// 选择器 → 若干「后代链」（每条链自左向右，最后一段是要匹配的元素本身）。
const selCache = new Map<string, Compound[][]>();
function parseSelector(sel: string): Compound[][] {
  let out = selCache.get(sel);
  if (out) return out;
  out = [];
  for (const part of sel.split(',')) {
    const steps = part.trim().split(/\s+/).filter(Boolean).map(parseCompound);
    if (steps.length && steps.every(Boolean)) out.push(steps as Compound[]);
  }
  selCache.set(sel, out);
  return out;
}

export class El {
  tag: string;
  attrs: Record<string, string>;
  children: El[] = [];
  parentElement: El | null = null;
  /** 本元素自身的文本（不含子元素的） */
  own = '';
  style: Record<string, string> = {};

  constructor(tag: string, cls = '', attrs: Record<string, string> = {}, text = '') {
    this.tag = tag.toLowerCase();
    this.attrs = { ...attrs };
    if (cls) this.attrs.class = cls;
    this.own = text;
  }

  appendChild<T extends El>(c: T): T {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }

  /** 真 DOM 里 HTML 元素的 tagName 是大写的；按标签名查表的代码（评论宿主判定）依赖这一点。 */
  get tagName(): string {
    return this.tag.toUpperCase();
  }

  getAttribute(n: string): string | null {
    return n in this.attrs ? this.attrs[n] : null;
  }

  get classList(): string[] {
    return (this.attrs.class || '').split(/\s+/).filter(Boolean);
  }

  get textContent(): string {
    return this.own + this.children.map((c) => c.textContent).join('');
  }

  get innerHTML(): string {
    return this.children.map((c) => c.outerHTML).join('') + this.own;
  }

  get outerHTML(): string {
    const a = Object.keys(this.attrs)
      .map((k) => ` ${k}="${this.attrs[k]}"`)
      .join('');
    return `<${this.tag}${a}>${this.innerHTML}</${this.tag}>`;
  }

  private matchCompound(c: Compound): boolean {
    if (c.tag && c.tag !== this.tag) return false;
    if (c.id && this.attrs.id !== c.id) return false;
    const cls = this.classList;
    if (!c.classes.every((x) => cls.includes(x))) return false;
    return c.attrs.every((a) => {
      const v = this.getAttribute(a.name);
      if (v == null) return false;
      if (!a.op) return true;
      if (a.op === '=') return v === a.value;
      if (a.op === '*=') return v.includes(a.value!);
      if (a.op === '^=') return v.startsWith(a.value!);
      return v.endsWith(a.value!);
    });
  }

  matches(sel: string): boolean {
    return parseSelector(sel).some((chain) => {
      if (!this.matchCompound(chain[chain.length - 1])) return false;
      // 后代链自右向左回溯祖先
      let node: El | null = this.parentElement;
      let i = chain.length - 2;
      while (i >= 0) {
        if (!node) return false;
        if (node.matchCompound(chain[i])) i--;
        node = node.parentElement;
      }
      return true;
    });
  }

  closest(sel: string): El | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- closest 从自身开始向上找，起点就是 this
    let p: El | null = this;
    while (p) {
      if (p.matches(sel)) return p;
      p = p.parentElement;
    }
    return null;
  }

  /** 文档序（前序遍历）遍历后代，不含自身——与浏览器一致。 */
  private descendants(out: El[] = []): El[] {
    for (const c of this.children) {
      out.push(c);
      c.descendants(out);
    }
    return out;
  }

  querySelectorAll(sel: string): El[] {
    return this.descendants().filter((e) => e.matches(sel));
  }

  querySelector(sel: string): El | null {
    for (const e of this.descendants()) if (e.matches(sel)) return e;
    return null;
  }
}

/** 建树糖：h('div', '.cls', {attr}, 子元素或文本…) */
export function h(tag: string, cls = '', attrs: Record<string, string> = {}, ...kids: (El | string)[]): El {
  const el = new El(tag, cls, attrs);
  for (const k of kids) {
    if (typeof k === 'string') el.own += k;
    else el.appendChild(k);
  }
  return el;
}

// isUnsafeHideTarget 会拿元素和 document.body / documentElement 比对；node 环境没有 document。
// 返回 restore 以免污染其它测试文件（vitest 默认同进程跑多个文件）。
export function installDocument(body: El, documentElement?: El): () => void {
  const g = globalThis as any;
  const prev = g.document;
  g.document = { body, documentElement: documentElement || body };
  return () => {
    g.document = prev;
  };
}

// —— 从 HTML 片段建树 ——
//
// 目的是把**真实页面的卡片 HTML**固化成契约测试的样本：B 站改类名是这个脚本最常见的失效路径，
// 而它一旦发生，脚本照常运行、只是什么都不再拦——单测里手搓 h() 树复现不出这种漂移。
// 不引 jsdom：仓库刻意只保留 esbuild + vitest + eslint + typescript 四个依赖，
// 而这里需要的只是「把一段静态 HTML 变成上面这棵替身树」，一个够用的解析器比一个浏览器实现划算。
// 支持：标签、属性（双/单引号或裸值）、自闭合、注释、文本；不支持隐式闭合标签与实体解码——
// 固化样本时把它们规避掉即可（fixtures 是我们自己裁剪的，不是任意网页）。
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

export function parseHtml(html: string): El {
  const root = new El('div');
  const stack: El[] = [root];
  const top = (): El => stack[stack.length - 1];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      top().own += html.slice(i);
      break;
    }
    if (lt > i) {
      const text = html.slice(i, lt);
      if (text.trim()) top().own += text.trim();
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    const raw = html.slice(lt + 1, gt).trim();
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      // 就近闭合：碰到不匹配的结束标签就忽略，样本裁剪出错时不至于整棵树错位
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = body.match(/^([\w-]+)\s*([\s\S]*)$/);
    if (!m) {
      i = gt + 1;
      continue;
    }
    const el = new El(m[1]);
    for (const a of m[2].matchAll(/([\w:.-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+)))?/g)) {
      el.attrs[a[1]] = a[3] ?? a[4] ?? a[5] ?? '';
    }
    top().appendChild(el);
    if (!selfClose && !VOID_TAGS.has(el.tag)) stack.push(el);
    i = gt + 1;
  }
  return root;
}

/** 解析 HTML 并返回第一个匹配选择器的元素（fixtures 的常用入口）。 */
export function fromHtml(html: string, selector: string): El {
  const el = parseHtml(html).querySelector(selector);
  if (!el) throw new Error('样本里找不到 ' + selector);
  return el;
}
