// 通用列表字段组件：折叠头 / 添加行 / 批量管理 / chip 渲染共一套；不同字段（关键词、UP名+UID、组合标签…）
// 只需提供一个轻量 model 适配器。供设置面板复用。
import { CONFIG, isRuleDisabled, saveConfig, setUidName } from '../config';
import { addToList, clearLists, removeEntries, removeFromList, restoreToList, toggleRuleDisabled } from '../rules';
import { splitRuleInput } from '../match/normalize';
import { fetchCard } from '../api';
import { toast } from './toast';
import { confirmModal } from './confirm';
import { filterBy } from './listfilter';
import { CHIP_RENDER_MAX, LIST_SEARCH_MIN, NAME_RESOLVE_MAX } from '../constants';

/** 名单里的一条。key 是勾选集的身份（UP 字段把名称与 UID 放在同一列，故加 n:/u: 前缀区分）。 */
export interface FieldEntry {
  key: string;
  value: string;
  arr: string[]; // 该条所属的底层数组（删除时直接操作它）
  uid?: boolean;
  /** 该条在配置里的名单路径（如 'block.keywords'），停用状态按它索引。缺省则不提供停用按钮。 */
  path?: string;
}

/** 列表字段的数据适配器。组件只认这个接口——新增一类名单 = 写一个 model，不动组件。 */
export interface FieldModel {
  count(): number;
  entries(): FieldEntry[];
  clear(): void;
  /** 返回 false 表示没添加成功（输入为空/校验不过），调用方据此不清空输入框。 */
  add(raw: string): boolean;
  decorate(entry: FieldEntry, chip: HTMLElement, txt: HTMLElement, rerender: () => void): void;
  /** 可搜文本，缺省取 value。见 listfilter.ts。 */
  texts?(entry: FieldEntry): string[];
}

export interface ListFieldOpts {
  label: string;
  model: FieldModel;
  hint?: string;
  placeholder?: string;
  inputTitle?: string;
  isAllow?: boolean;
}

// 记住每个字段的折叠状态（renderPanel 重建时保留）。
const collapseState: Record<string, boolean> = {};

// 本次渲染还能为多少个缺名字的 UID 发请求。renderChips 每次开头重置；upModel.decorate 消费。
// 放模块级而不是穿参：decorate 的签名是 FieldModel 的公共契约，为一个内部限流去改它不划算。
let nameBudget = 0;

// 解析出的 UP 名攒批落盘 + 攒批重渲。
//
// 曾经是「每收到一个名字就 saveConfig() + rerender()」，而这两件事现在都很贵：saveConfig 是
// 全量三方合并，rerender 会重建整列 chip。更糟的是重渲会把 nameBudget 重置成满额，
// 于是为**还在飞行中**的那些 UID 又发一轮请求——一批解析能放大成数百个请求 + 数十次全量存盘。
// 攒批之后：一批解析 = 一次存盘 + 一次重渲。（请求侧的重复由 api.ts 的 in-flight 表兜底。）
let nameFlushTimer: ReturnType<typeof setTimeout> | null = null;
const NAME_FLUSH_MS = 400;
function scheduleNameFlush(rerender: () => void): void {
  if (nameFlushTimer) clearTimeout(nameFlushTimer);
  nameFlushTimer = setTimeout(() => {
    nameFlushTimer = null;
    saveConfig();
    rerender();
  }, NAME_FLUSH_MS);
}

export function renderListField(host: HTMLElement, o: ListFieldOpts): void {
  const model = o.model;
  const el = <K extends keyof HTMLElementTagNameMap>(t: K, c?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(t);
    if (c) e.className = c;
    return e;
  };
  const sec = el('div', 'sec field' + (o.isAllow ? ' allow' : ''));
  const lab = el('label', 'field-head');
  const collapsed = !!collapseState[o.label];
  // 三个子元素直接持引用，不走 innerHTML 再 querySelector 反查：查的是自己刚拼的字符串，
  // 绕一圈只是把「拼错类名」从编译期错误变成运行期静默失效。顺带免去 o.label 的转义问题。
  const caret = el('span', 'caret');
  caret.textContent = collapsed ? '▸' : '▾';
  const lt = el('span', 'lt');
  lt.textContent = o.label;
  const cnt = el('span', 'cnt');
  cnt.textContent = String(model.count() || '');
  lab.append(caret, ' ', lt, ' ', cnt);
  sec.appendChild(lab);
  const body = el('div', 'field-body');
  body.style.display = collapsed ? 'none' : 'block';
  sec.appendChild(body);
  lab.onclick = () => {
    const now = body.style.display === 'none';
    body.style.display = now ? 'block' : 'none';
    collapseState[o.label] = !now;
    caret.textContent = now ? '▾' : '▸';
  };
  const addrow = el('div', 'addrow');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = o.placeholder || '输入后点添加';
  if (o.inputTitle) input.title = o.inputTitle;
  const btn = document.createElement('button');
  btn.textContent = '添加';
  addrow.appendChild(input);
  addrow.appendChild(btn);
  body.appendChild(addrow);
  if (o.hint) {
    const h = el('div', 'hint');
    h.style.marginTop = '6px';
    h.textContent = o.hint;
    body.appendChild(h);
  }
  // 搜索行：名单攒到几十上百条后，「这个词我是不是加过」「把那条打错字的删掉」全靠肉眼在
  // chip 堆里找。少量条目时不显示——三五条时一个空搜索框只是噪音。
  const search = el('div', 'chip-search');
  const sInput = document.createElement('input');
  sInput.type = 'text';
  sInput.placeholder = '搜索本列表（支持 /正则/）';
  const sClear = el('button', 'chip-search-x');
  sClear.textContent = '✕';
  sClear.title = '清除搜索';
  search.appendChild(sInput);
  search.appendChild(sClear);
  body.appendChild(search);

  const bar = el('div', 'chip-bar');
  body.appendChild(bar);
  const chips = el('div', 'chips');
  body.appendChild(chips);

  let manage = false;
  let query = '';
  const selected = new Set<string>();
  // 当前可见条目。**所有**批量操作都走它，不走 model.entries()：搜「原神」筛出 3 条后点
  // 「全选 → 删除所选」，删掉的必须是这 3 条而不是整个名单——按搜索结果操作是这个功能的
  // 全部意义，也是它唯一能酿成大祸的地方。
  // 一次渲染里 visible() 会被问好几次（renderChips 一次、renderBar 一次、全选/反选各一次），
  // 而它每次都要 model.entries() 重新分配 N 个条目对象——几千条名单下就是每次渲染一两万个临时对象。
  // 按渲染轮次缓存：renderChips 开头置空，本轮内共用同一份。
  let visCache: FieldEntry[] | null = null;
  const visible = (): FieldEntry[] => {
    if (!visCache) visCache = filterBy(model.entries(), query, (e) => (model.texts ? model.texts(e) : [String(e.value)]));
    return visCache;
  };
  const invalidateVis = () => (visCache = null);
  const filtering = () => !!query.trim();
  const renderBar = () => {
    bar.innerHTML = '';
    if (!model.count()) {
      manage = false;
      return;
    }
    const mk = (text: string, fn: () => void, primary?: boolean) => {
      const b = el('button', 'chip-act' + (primary ? ' primary' : ''));
      b.textContent = text;
      b.onclick = fn;
      bar.appendChild(b);
    };
    if (!manage) {
      mk('批量管理', () => {
        manage = true;
        selected.clear();
        renderChips();
      });
      return;
    }
    mk(filtering() ? '全选匹配' : '全选', () => {
      visible().forEach((e) => selected.add(e.key));
      syncSelection();
    });
    mk('反选', () => {
      visible().forEach((e) => (selected.has(e.key) ? selected.delete(e.key) : selected.add(e.key)));
      syncSelection();
    });
    mk(`删除所选(${selected.size})`, () => {
      if (!selected.size) {
        toast('未勾选任何项');
        return;
      }
      const byKey: Record<string, FieldEntry> = {};
      model.entries().forEach((e) => (byKey[e.key] = e));
      // 一次性删完再存盘重扫。逐条 removeFromList 会把「全量存盘 + 重建匹配器 + 全页重扫」
      // 跑 N 遍，几千条名单下就是秒级冻结。
      const n = removeEntries([...selected].map((k) => byKey[k]).filter(Boolean));
      selected.clear();
      renderChips();
      toast(`已删除 ${n} 条`);
    }, true);
    // 搜索生效时「清空」只清筛出来的这些——按钮旁边就是筛选结果，清掉屏幕外看不见的东西
    // 是背刺。文案里把范围和条件都念出来，不让用户靠猜。
    const vis = visible();
    mk(filtering() ? `删除匹配(${vis.length})` : '清空', () => {
      if (!model.count()) return;
      if (filtering()) {
        if (!vis.length) return;
        confirmModal(`确定删除匹配「${query.trim()}」的 ${vis.length} 条？此操作不可撤销（其余 ${model.count() - vis.length} 条保留）。`, { title: '删除匹配项', okText: '删除', danger: true }).then((ok) => {
          if (!ok) return;
          removeEntries(vis);
          selected.clear();
          renderChips();
          toast(`已删除 ${vis.length} 条`);
        });
        return;
      }
      confirmModal(`确定清空该列表全部 ${model.count()} 条？此操作不可撤销。`, { title: '清空列表', okText: '清空', danger: true }).then((ok) => {
        if (!ok) return;
        model.clear();
        selected.clear();
        renderChips();
      });
    });
    mk('完成', () => {
      manage = false;
      selected.clear();
      renderChips();
    });
  };
  // 勾选态变了但名单没变：只把已渲染的 chip 的样式刷一遍 + 更新按钮计数，不重建 DOM。
  const syncSelection = () => {
    const nodes = chips.querySelectorAll<HTMLElement>('.chip');
    let i = 0;
    for (const e of visible().slice(0, CHIP_RENDER_MAX)) {
      const node = nodes[i++];
      if (node) node.classList.toggle('sel', selected.has(e.key));
    }
    renderBar();
  };

  const renderChips = () => {
    invalidateVis(); // 名单可能已被改动，本轮重新算一次
    chips.innerHTML = '';
    const total = model.count();
    const list = visible();
    // 搜索时角标显示「匹配/总数」：只显示匹配数会让人以为名单被删空了。
    cnt.textContent = filtering() && total ? `${list.length}/${total}` : String(total || '');
    // 搜索框只在名单长到「找不着」时出现；已经在搜的时候不能因为筛剩几条就把框收走。
    search.style.display = total > LIST_SEARCH_MIN || filtering() ? 'flex' : 'none';
    if (!total) {
      const e = el('div', 'empty');
      e.textContent = '（暂无，添加后会显示在这里）';
      chips.appendChild(e);
      renderBar();
      return;
    }
    if (!list.length) {
      const e = el('div', 'empty');
      e.textContent = `（${total} 条里没有匹配「${query.trim()}」的项）`;
      chips.appendChild(e);
      renderBar();
      return;
    }
    // 渲染上限：几千条 chip 全量建 DOM 会把面板卡死好几秒。截断的是**显示**，不是数据——
    // 批量操作照旧作用于全部筛选结果（见下面的提示文案），不能让「看到 300 条、删掉 3000 条」
    // 这种事发生在用户没被告知的情况下。
    nameBudget = NAME_RESOLVE_MAX;
    const shown = list.slice(0, CHIP_RENDER_MAX);
    shown.forEach((entry) => {
      const chip = el('span', 'chip' + (manage && selected.has(entry.key) ? ' sel' : ''));
      const txt = document.createElement('span');
      model.decorate(entry, chip, txt, renderChips);
      chip.appendChild(txt);
      if (manage) {
        chip.style.cursor = 'pointer';
        chip.title = '点击勾选 / 取消';
        // 勾选只切自己的样式 + 更新按钮上的计数。原先每点一下都重建整列 chip
        // （最多 300 个节点、各带 2~3 个子元素和事件处理器），勾 10 条就是重建 10 次。
        chip.onclick = () => {
          if (selected.has(entry.key)) selected.delete(entry.key);
          else selected.add(entry.key);
          chip.classList.toggle('sel', selected.has(entry.key));
          renderBar();
        };
      } else {
        // 停用：留在名单里、灰显、不参与编译。删除是不可逆的，而「先关两天看看」才是
        // 面对一条可疑规则时最常见的诉求——没有这个中间态，用户只能在「忍着」和「删掉」之间二选一。
        if (entry.path) {
          const off = isRuleDisabled(entry.path, entry.value);
          if (off) chip.classList.add('off');
          const t = document.createElement('b');
          t.className = 'chip-toggle';
          t.textContent = off ? '▶' : '⏸';
          t.title = off ? '重新启用这条规则' : '暂时停用这条规则（保留在名单里，不参与匹配）';
          t.onclick = (ev) => {
            ev.stopPropagation();
            toggleRuleDisabled(entry.path!, entry.value);
            renderChips();
          };
          chip.appendChild(t);
        }
        const x = document.createElement('b');
        x.textContent = '✕';
        x.title = '删除';
        x.onclick = () => {
          const { arr, value } = entry;
          const at = arr.indexOf(value);
          removeFromList(arr, value);
          renderChips();
          // 误删规则比误拉黑常见得多，而拉黑早就有撤销了。原位插回去，不是追加到末尾——
          // 名单顺序是用户自己攒出来的，撤销不该顺手把它打乱。
          toast(`已删除：${value}`, 'info', {
            label: '撤销',
            onClick: () => {
              restoreToList(arr, value, at);
              renderChips();
            },
          });
        };
        chip.appendChild(x);
      }
      chips.appendChild(chip);
    });
    if (list.length > shown.length) {
      const more = el('div', 'empty');
      more.textContent = `⋯ 还有 ${list.length - shown.length} 条未显示（共 ${list.length} 条）。用上面的搜索框查找具体条目；批量操作仍作用于全部 ${list.length} 条。`;
      chips.appendChild(more);
    }
    renderBar();
  };
  // 改搜索词就清空勾选，保证「勾选集 ⊆ 屏幕上看得见的」这条不变式。否则用户搜 A 勾三条、
  // 再搜 B 勾两条，「删除所选(5)」会连屏幕外那三条一起删——数字对得上，人却对不上。
  const setQuery = (v: string) => {
    if (query === v) return;
    query = v;
    selected.clear();
    renderChips();
  };
  sInput.addEventListener('input', () => setQuery(sInput.value));
  sClear.onclick = () => {
    sInput.value = '';
    setQuery('');
    sInput.focus();
  };

  const doAdd = () => {
    if (model.add(input.value)) {
      input.value = '';
      // 新增的条目多半不匹配当前搜索词，留着筛选等于「加完就不见了」。加 = 换意图，撤掉筛选。
      sInput.value = '';
      setQuery('');
      renderChips();
    }
  };
  btn.onclick = doAdd;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAdd();
  });
  renderChips();
  host.appendChild(sec);
}

// 普通 chip 列表（关键词 / BV / 标签 / 白名单…）；groupMode=组合标签。
export function chipModel(arr: string[], groupMode = false, path?: string): FieldModel {
  return {
    count: () => arr.length,
    entries: () => arr.map((v) => ({ key: v, value: v, arr, path })),
    clear: () => {
      clearLists(arr);
    },
    add: (raw: string) => {
      if (groupMode) {
        const parts = raw.split(/[+,，、\s]+/).map((s: string) => s.trim()).filter(Boolean);
        if (parts.length < 2) {
          toast('组合标签至少要 2 个，如：原神 鸣潮');
          return false;
        }
        if (addToList(arr, parts.join('+'))) {
          toast(`已添加组合：${parts.join(' & ')}`);
          return true;
        }
        toast('该组合已存在');
        return false;
      }
      const parts = splitRuleInput(raw);
      if (!parts.length) return false;
      let added = 0;
      for (const v of parts) if (addToList(arr, v)) added++;
      if (added) toast(`已添加 ${added} 条${parts.length > added ? `（${parts.length - added} 条已存在）` : ''}`);
      else toast('均已存在，未重复添加');
      return true;
    },
    decorate: (entry, chip, txt) => {
      if (groupMode) chip.classList.add('group');
      txt.textContent = groupMode ? String(entry.value).split('+').join(' & ') : entry.value;
    },
    // 可搜文本 = 存的值 + 显示的值（组合标签存 `a+b`、显示 `a & b`，两种写法都得搜得到）。
    texts: (entry) => (groupMode ? [String(entry.value), String(entry.value).split('+').join(' & ')] : [String(entry.value)]),
  };
}

// 「UP 名 + UID」合一：纯数字→uids，否则→names；UID chip 异步解析显示名。
export function upModel(names: string[], uids: string[], namePath?: string, uidPath?: string): FieldModel {
  return {
    count: () => names.length + uids.length,
    entries: () =>
      names
        .map((v) => ({ key: 'n:' + v, value: v, arr: names, uid: false, path: namePath }))
        .concat(uids.map((v) => ({ key: 'u:' + v, value: v, arr: uids, uid: true, path: uidPath }))),
    clear: () => {
      clearLists(names, uids);
    },
    add: (raw) => {
      const parts = splitRuleInput(raw);
      if (!parts.length) return false;
      let added = 0;
      for (const v of parts) if (addToList(/^\d+$/.test(v) ? uids : names, v)) added++;
      toast(added ? `已添加 ${added} 条` : '均已存在，未重复添加');
      return true;
    },
    // UID 条目按数字和解析出的 UP 名都能搜到——用户记得住的是名字，不是一串数字。
    texts: (entry) => (entry.uid ? [String(entry.value), CONFIG.uidNames[String(entry.value)] || ''] : [String(entry.value)]),
    decorate: (entry, chip, txt, rerender) => {
      if (!entry.uid) {
        txt.textContent = entry.value;
        return;
      }
      const nm = CONFIG.uidNames[String(entry.value)];
      txt.textContent = nm || entry.value;
      chip.classList.add('uidchip');
      chip.title = 'UID ' + entry.value + (nm ? '' : nameBudget > 0 ? '（正在解析名称…）' : '（名单过长，本次未解析名称）');
      if (!nm && nameBudget > 0) {
        nameBudget--;
        fetchCard(entry.value, (d) => {
          const name = d && d.card && d.card.name;
          if (name) {
            setUidName(entry.value, name);
            scheduleNameFlush(rerender);
          }
        });
      }
    },
  };
}

// 通用控件绑定器：把「读配置 → 回填控件」与「控件变更 → 存盘 + 回调」收敛到一处。
// 支持 checkbox / select / number。obj 为目标对象（CONFIG / CONFIG.block / CONFIG.comment）。
export interface BindOpts {
  number?: boolean; // 按数字读写
  int?: boolean; // 配合 number：取整
  after?: () => void; // 存盘后的副作用（多为重扫）
}

// 泛型绑定：key 必须是 obj 上真实存在的字段名——写错字段名过去只是「开关点了没反应」，现在编译期就报。
export function bindControl<T extends object, K extends keyof T & string>(root: Element | Document, id: string, obj: T, key: K, opts: BindOpts = {}): void {
  const el = root.querySelector<HTMLInputElement | HTMLSelectElement>('#' + id);
  if (!el) return; // 该控件不在本次渲染的分区里（分区可按开关裁剪），静默跳过
  const isCheck = el instanceof HTMLInputElement && el.type === 'checkbox';
  if (isCheck) el.checked = !!obj[key];
  else el.value = obj[key] != null ? String(obj[key]) : opts.number ? '0' : '';
  el.onchange = () => {
    let v: unknown;
    if (isCheck) v = (el as HTMLInputElement).checked;
    else if (opts.number) v = (opts.int ? parseInt(el.value, 10) : parseFloat(el.value)) || 0;
    else v = el.value;
    // 唯一的断言点：控件类型由调用方按字段类型选定（数字字段配 number:true、布尔字段配 checkbox），
    // 类型系统跟不到这层对应关系。收敛在这一处，好过每个调用点各写一次。
    obj[key] = v as T[K];
    saveConfig();
    if (opts.after) opts.after();
  };
}

// 列表型字段的描述表条目。kind:'up' 是唯一的特例（UP 名与 UID 合成一个字段）。
export interface FieldDef {
  label: string;
  kind?: 'up';
  scope?: 'allow';
  key?: string; // CONFIG.block / CONFIG.allow 下的名单数组字段名
  placeholder?: string;
  hint?: string;
  groupMode?: boolean;
}

// 描述表里的 key 取出对应的名单数组。取不到（写错字段名 / 指到了阈值字段）是编程错误：
// 直接抛，而不是渲染出一个空列表让用户以为「我的词都没了」。
function listOf(obj: object, key: string | undefined): string[] {
  const v = key ? (obj as unknown as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(v)) throw new Error('[bfb] 字段描述表的 key 不是名单数组: ' + key);
  return v as string[];
}

// 按描述表渲染一组「列表型」字段（黑/白名单等），新增过滤项 = 表里加一行。
export function renderFields(host: HTMLElement, defs: FieldDef[]): void {
  defs.forEach((f) => {
    if (f.kind === 'up') {
      renderListField(host, {
        label: f.label,
        hint: f.hint,
        placeholder: '输入 UP 名 或 UID（纯数字自动识别）',
        inputTitle: '可一次粘贴多条，用逗号或换行分隔；纯数字按 UID，其余按 UP 名',
        model: upModel(CONFIG.block.upNames, CONFIG.block.uids, 'block.upNames', 'block.uids'),
      });
      return;
    }
    const arr = listOf(f.scope === 'allow' ? CONFIG.allow : CONFIG.block, f.key);
    renderListField(host, {
      label: f.label,
      hint: f.hint,
      placeholder: f.placeholder,
      isAllow: f.scope === 'allow',
      inputTitle: f.groupMode ? '输入一组标签，用空格或逗号分隔，表示同时含这些标签才拦' : '可一次粘贴多条，用逗号或换行分隔',
      model: chipModel(arr, f.groupMode, `${f.scope === 'allow' ? 'allow' : 'block'}.${f.key}`),
    });
  });
}
