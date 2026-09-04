// 设置面板：外壳（Tab 条 + 分组容器 + 打开/关闭/重渲）+ 分区注册表。
//
// 这里只负责「骨架」与「顺序」，每个分区的内容都在 ./sections/*。想加一个新分区，
// 写一个 { tab, render(host, ctx) } 模块并加进下面的 SECTIONS 数组即可，不必再动这个文件的其它部分。
import { VERSION } from '../../constants';
import { pageType } from '../../page';
import { setStatsRefresh, runStatsRefresh, hasStatsRefresh, q } from './ctx';
import type { PanelCtx, PanelGroups, PanelSection } from './ctx';
import '../panel.styles';

import { baseSection } from './sections/base';
import { blackListsSection, apiListsSection, allowListsSection } from './sections/lists';
import { advancedSection } from './sections/advanced';
import { commentSection } from './sections/comment';
import { presetsSection } from './sections/presets';
import { regexTesterSection } from './sections/regex-tester';
import { ioSection } from './sections/io';
import { backupsSection } from './sections/backups';
import { nameListSection } from './sections/name-list';
import { subscriptionsSection } from './sections/subscriptions';
import { batchBlockSection } from './sections/batch-block';
import { resetSection } from './sections/reset';
import { healthSection } from './sections/health';
import { ruleHealthSection } from './sections/rule-health';
import { logSection } from './sections/log';

// 顶部分组 Tab：把杂乱的长列表归类成「基础 / 黑名单 / 进阶 / 评论 / 白名单 / 工具」
const PANEL_TABS: [id: string, label: string, tip: string][] = [
  ['base', '⚙ 基础', '常规开关与卡片类型过滤'],
  ['black', '🚫 黑名单', '按标题、UP 主、分区屏蔽，即时生效；以 /.../ 包裹表示正则（如 /震惊.*竟然/），否则为关键词包含匹配（不区分大小写）'],
  ['api', '🛰 进阶', '按播放量、时长，以及标签、数据等维度精细过滤（标签类维度需开启下方「精确过滤」）'],
  ['comment', '💬 评论', '过滤视频与动态评论区的引战、水军、营销及 AI 评论（基于评论数据隐藏，仅在含评论的页面生效，与视频规则相互独立）'],
  ['allow', '⭐ 白名单', '命中白名单的内容永不隐藏，优先级最高'],
  ['tools', '🧰 工具', '预置库、重置、屏蔽记录'],
];

// 分区注册表：**数组顺序即面板内的显示顺序**（按 tab 分流后依次 render）。
const SECTIONS: PanelSection[] = [
  baseSection,
  blackListsSection,
  advancedSection,
  apiListsSection,
  commentSection,
  allowListsSection,
  presetsSection,
  regexTesterSection,
  ioSection,
  backupsSection, // 紧跟导入导出：都是「配置的保存与找回」，放一块儿用户才想得起来它
  nameListSection,
  subscriptionsSection,
  batchBlockSection,
  resetSection,
  healthSection,
  ruleHealthSection,
  logSection,
];

let activeTab = 'base'; // 记住当前激活的 Tab（重渲时保留）
let lastFocus: HTMLElement | null = null; // 打开面板前的焦点，关闭时归还（键盘可达性）

function panelEl(): HTMLElement | null {
  return document.getElementById('bfb-panel');
}
function isPanelOpen(): boolean {
  const p = panelEl();
  return !!(p && p.classList.contains('open'));
}

// 建壳（只建一次，不渲内容）。返回面板根节点，让调用方不必再 getElementById 一遍去处理「理论上的 null」。
function buildPanel(): HTMLElement {
  const exist = panelEl();
  if (exist) return exist;
  const p = document.createElement('div');
  p.id = 'bfb-panel';
  p.tabIndex = -1; // 可编程聚焦：打开时把焦点移入面板，便于键盘操作
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', 'biliHoyoFairy 设置');
  // 拦住面板输入框的键盘事件，别冒泡到 B 站全局「按键即搜索」快捷键
  ['keydown', 'keypress', 'keyup', 'input'].forEach((ev) => {
    p.addEventListener(ev, (e: Event) => {
      const t = e.target;
      if (t instanceof Element && t.matches('input, textarea, select')) e.stopPropagation();
    });
  });
  // Esc 关闭面板；若此刻有确认弹窗，则让弹窗先吃掉 Esc（弹窗自带 Esc=取消）。
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !p.classList.contains('open')) return;
      if (document.querySelector('.bfb-modal-back')) return;
      closePanel();
    },
    true
  );
  document.body.appendChild(p);
  return p;
}

function renderPanel(p: HTMLElement) {
  p.innerHTML = '';
  setStatsRefresh(null); // 旧的刷新器指向已销毁的节点，log section 会在下面重新注册
  const h2 = document.createElement('h2');
  h2.innerHTML = `🛡 biliHoyoFairy · 抗击黑潮 <small style="font-weight:normal;opacity:.6;font-size:12px">v${VERSION} · ${pageType()}</small> <span class="x" role="button" tabindex="0" aria-label="关闭设置面板">✕</span>`;
  p.appendChild(h2);
  const xBtn = q(h2, '.x');
  xBtn.onclick = closePanel;
  xBtn.onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      closePanel();
    }
  };

  // —— Tab 条 + 各分组容器（一次性全部渲染，切 Tab 只切显隐，保证绑定与记录刷新始终有效）——
  const tabBar = document.createElement('div');
  tabBar.className = 'tabs';
  p.appendChild(tabBar);
  if (!PANEL_TABS.some(([id]) => id === activeTab)) activeTab = 'base';
  const groups: PanelGroups = {};
  PANEL_TABS.forEach(([id, label, tip]) => {
    const tb = document.createElement('button');
    tb.className = 'tab' + (id === activeTab ? ' active' : '');
    tb.textContent = label;
    tabBar.appendChild(tb);
    const g = document.createElement('div');
    g.className = 'bfb-group' + (id === activeTab ? ' active' : '');
    const tipEl = document.createElement('div');
    tipEl.className = 'grp-tip';
    tipEl.textContent = tip;
    g.appendChild(tipEl);
    p.appendChild(g);
    groups[id] = g;
    tb.onclick = () => {
      activeTab = id;
      tabBar.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      tb.classList.add('active');
      Object.values(groups).forEach((x) => x.classList.remove('active'));
      g.classList.add('active');
      p.scrollTop = 0;
    };
  });

  const ctx: PanelCtx = {
    panel: p,
    groups,
    // 重渲整个面板并保持打开状态（分区改了会影响别处展示时用）
    rerender: () => {
      renderPanel(p);
      p.classList.add('open');
    },
    refreshStats: () => runStatsRefresh(),
    setStatsRefresh,
  };

  for (const sec of SECTIONS) {
    const host = groups[sec.tab];
    if (!host) continue; // 分区声明了不存在的 tab：跳过而不是让整个面板渲染失败
    sec.render(host, ctx);
  }
}

export function openPanel(): void {
  // 只记住真正能收回焦点的元素（activeElement 静态类型只到 Element，SVG/自定义元素上没有 focus）
  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const p = buildPanel();
  renderPanel(p);
  p.classList.add('open');
  try {
    p.focus();
  } catch (e) {
    /* 焦点是可达性增强，拿不到不影响面板可用 */
  }
}
function closePanel() {
  const p = panelEl();
  if (p) p.classList.remove('open');
  if (lastFocus) {
    try {
      lastFocus.focus();
    } catch (e) {
      /* 原焦点元素可能已被页面移除，归还失败无所谓 */
    }
  }
  lastFocus = null;
}
export function refreshPanelIfOpen(): void {
  const p = panelEl();
  if (!p || !p.classList.contains('open')) return;
  renderPanel(p);
}
// 命中记账后由 stats 监听器调用：面板打开时刷新「屏蔽记录」计数（角标更新在 main 里另做）。
export function refreshStatsIfOpen(): void {
  if (hasStatsRefresh() && isPanelOpen()) runStatsRefresh();
}
