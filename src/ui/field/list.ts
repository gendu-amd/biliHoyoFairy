// 通用列表字段组件：折叠头 / 添加行 / 语法速查 / 搜索 / 批量管理 / chip 渲染共一套。
import { isRuleDisabled } from '../../config';
import { removeEntries, removeFromList, restoreToList, toggleRuleDisabled } from '../../rules';
import { toast } from '../toast';
import { confirmModal } from '../confirm';
import { filterBy } from '../listfilter';
import { CHIP_RENDER_MAX, LIST_SEARCH_MIN } from '../../constants';
import { resetNameBudget } from './models';
import type { FieldEntry, ListFieldOpts } from './types';

// 规则语法速查（写死的静态文案，不含用户数据，可直接 innerHTML）。
const SYNTAX_CHEATSHEET =
  '<b>规则语法速查</b><br>' +
  '· <code>原神</code> —— 普通词，<b>包含</b>即命中，忽略大小写与全角半角<br>' +
  '· <code>/震惊.*竟然/</code> —— 以 <code>/</code> 包裹为<b>正则</b>，可加 <code>/…/i</code> 等标志<br>' +
  '· <code>title:原神</code> / <code>up:营销号</code> / <code>part:资讯</code> —— 只匹配 标题 / UP 名 / 分区（不写前缀 = 三者都匹配）<br>' +
  '· <code>原神 鸣潮</code> —— 仅「组合标签」字段：<b>同时</b>含这一组全部标签才屏蔽<br>' +
  '· 一次可粘贴多条，用<b>换行</b>或<b>逗号</b>分隔；以 <code>/</code> 开头的行整行保留，不会被逗号拆断<br>' +
  '· 拿不准就用「工具 → 🧪 正则测试器」先试，它会告诉你会不会被引擎拒收';

// 记住每个字段的折叠状态（renderPanel 重建时保留）。
const collapseState: Record<string, boolean> = {};


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
  // 规则语法是自创 DSL（/正则/、title:/up:/part: 前缀、A+B 组合），此前只在 README 和
  // 正则测试器里有说明——写规则的人不会为了一行前缀去翻文档。摊在输入框旁边，默认折叠。
  const help = document.createElement('button');
  help.type = 'button';
  help.className = 'chip-search-x';
  help.textContent = '?';
  help.title = '规则语法速查';
  addrow.appendChild(input);
  addrow.appendChild(btn);
  addrow.appendChild(help);
  body.appendChild(addrow);
  const cheat = el('div', 'hint');
  cheat.style.display = 'none';
  cheat.innerHTML = SYNTAX_CHEATSHEET;
  help.onclick = () => (cheat.style.display = cheat.style.display === 'none' ? 'block' : 'none');
  body.appendChild(cheat);
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
  // 一次渲染里 visible() 会被问好几次，而它每次都要 model.entries() 重新分配 N 个条目对象。
  // 按渲染轮次缓存：renderChips 开头置空。
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
      // 一次性删完再存盘重扫：逐条会把「全量存盘 + 重建匹配器 + 全页重扫」跑 N 遍。
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
  // 勾选态变了但名单没变：只刷已渲染 chip 的样式 + 更新按钮计数，不重建 DOM。
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
    // 渲染上限：几千条 chip 全量建 DOM 会卡死面板。截断的是显示不是数据——
    // 批量操作照旧作用于全部筛选结果，并在下面的提示里写明。
    resetNameBudget();
    const shown = list.slice(0, CHIP_RENDER_MAX);
    shown.forEach((entry) => {
      const chip = el('span', 'chip' + (manage && selected.has(entry.key) ? ' sel' : ''));
      const txt = document.createElement('span');
      model.decorate(entry, chip, txt, renderChips);
      chip.appendChild(txt);
      if (manage) {
        chip.style.cursor = 'pointer';
        chip.title = '点击勾选 / 取消';
        // 勾选只切自己的样式 + 更新按钮计数：原先每点一下都重建整列（最多 300 个节点）。
        chip.onclick = () => {
          if (selected.has(entry.key)) selected.delete(entry.key);
          else selected.add(entry.key);
          chip.classList.toggle('sel', selected.has(entry.key));
          renderBar();
        };
      } else {
        // 停用：留在名单里、灰显、不参与编译。没有这个中间态，用户只能在「忍着」和「删掉」之间二选一。
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
          // 误删规则比误拉黑常见得多，而拉黑早就有撤销了。插回原位，不打乱用户攒出来的顺序。
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
