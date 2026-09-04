// 空洞排查探针 v2：在**出问题的页面**（热门 / 首页 / 搜索…）按 F12 → Console 整段粘贴回车。
// 只读，不修改页面。
//
// 隐藏卡片时必须上移到「网格项」那一层，否则格子仍占位 → 留空洞、后面的卡不补位。
// 本探针把每一张被判定拦截的卡按**列**分组，逐张报告：cellOf 取到了谁、有没有真的被隐藏、
// 以及没隐藏的原因（没找到容器 / 撞上护栏）。左右两列表现不同时，对比着看一眼就知道差在哪。
(() => {
  const P = 'color:#fb7299;font-weight:bold';
  const SEL =
    'div.bili-video-card,div.video-page-card-small,li.bili-rank-list-video__item,div.video-card,li.rank-item,div.video-card-reco,div.video-card-common,div.bili-dyn-list__item,div.floor-card.single-card';
  const CELLS = ['div.feed-card', 'div.floor-single-card', 'div.bili-feed-card', 'div.video-card-container'];
  const UNSAFE = '.container, .feed2, .bili-feed4, #i_cecream, #app, .bili-header';

  const roots = [document];
  const collect = (r) => r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) { roots.push(e.shadowRoot); collect(e.shadowRoot); } });
  collect(document);

  const desc = (e) => {
    if (!e) return '(无)';
    const c = String(e.className || '').trim().split(/\s+/).slice(0, 3).join('.');
    return e.tagName.toLowerCase() + (c ? '.' + c : '');
  };
  const cellOf = (el) => {
    for (const s of CELLS) { const f = el.closest(s); if (f) return f; }
    return el;
  };
  const unsafe = (el) => {
    if (!el || el === document.body || el === document.documentElement) return '是（body/html）';
    if (el.matches && el.matches(UNSAFE)) return '是（页面级大容器）';
    const n = el.querySelectorAll(SEL).length;
    if (n > 1) return `是（这个格子里装着 ${n} 张卡）`;
    return '否';
  };

  const all = [];
  for (const r of roots) all.push(...r.querySelectorAll(SEL));
  const blocked = all.filter((c) => c.hasAttribute('data-bfb-blocked'));
  console.log('%c[空洞探针] 页面:', P, location.pathname, '| 卡片', all.length, '| 已判定拦截', blocked.length);
  if (document.querySelector('.bfb-review')) {
    // 直接中止而不是只警告：审查模式下「格子没被隐藏」是**预期行为**，继续跑只会得出
    // 「这就是留洞的位置」这种错误结论——探针给错结论比不给结论更糟。
    console.warn(
      '%c[空洞探针] ⛔ 审查模式开着（.bfb-review），本次不做判断。\n' +
        '那个模式按设计就不隐藏卡片，继续跑会把「没隐藏」误报成留洞。\n' +
        '请到「基础 → 审查模式」关掉 → 刷新页面 → 加一条必然命中的关键词 → 滚两屏 → 重跑。',
      'color:#e74c3c;font-weight:bold'
    );
    return;
  }
  if (!blocked.length) return console.log('这一页还没有被拦下的卡。加一条必然命中的关键词，滚两屏再跑。');

  // 容器的对齐方式：卡片本身就是网格/flex 项时，藏得再对也可能因为容器的 justify-content
  // 让剩下的项重新分散排列，于是跟上下行对不齐——那是布局问题，不是 cellOf 问题。
  const box = blocked[0].parentElement;
  if (box) {
    const b = getComputedStyle(box);
    const i = getComputedStyle(blocked[0]);
    console.log('%c[空洞探针] 容器:', P, desc(box));
    console.log('   display:', b.display, '| flex-wrap:', b.flexWrap, '| justify-content:', b.justifyContent, '| align-content:', b.alignContent);
    console.log('   gap:', b.gap, '| grid-template-columns:', b.gridTemplateColumns);
    console.log('   子项宽度:', i.width, '| flex:', i.flex, '| margin:', i.margin, '| 同容器子项数:', box.children.length);
  }

  // 按左边距分列（同一列的 left 基本相同）
  const cols = new Map();
  for (const c of blocked) {
    const cell = cellOf(c);
    const left = Math.round((cell.getBoundingClientRect().left || 0) / 20) * 20;
    if (!cols.has(left)) cols.set(left, []);
    cols.get(left).push(c);
  }
  const holes = [];
  for (const left of [...cols.keys()].sort((a, b) => a - b)) {
    const list = cols.get(left);
    console.log(`%c[空洞探针] ——— 第 ${[...cols.keys()].sort((a, b) => a - b).indexOf(left) + 1} 列（left≈${left}px，${list.length} 张）`, P);
    const c = list[0];
    const cell = cellOf(c);
    const cs = getComputedStyle(cell);
    const hidden = cs.display === 'none';
    console.log('   卡片:', desc(c), '| cellOf →', desc(cell), cell === c ? '⚠ 没找到容器，停在卡片本身' : '');
    console.log('   格子是否已隐藏:', hidden ? '是 ✅' : '否 ⚠', '| 护栏判定 isUnsafeHideTarget:', unsafe(cell));
    console.log('   格子尺寸:', Math.round(cell.getBoundingClientRect().width) + '×' + Math.round(cell.getBoundingClientRect().height));
    // A 现象（卡片没了、位置还空着）的决定性诊断：
    //   computed display 不是 none → 我们的内联隐藏被 !important 压过了（隐藏根本没生效）
    //   是 none 但仍有人占位     → 占位的是某个祖先，下面直接把它指出来
    const cd = getComputedStyle(c).display;
    const r = c.getBoundingClientRect();
    console.log('   卡片自身: computed display =', cd, '| 尺寸', Math.round(r.width) + '×' + Math.round(r.height), '| 内联 style =', c.getAttribute('style') || '(无)');
    if (cd === 'none') {
      let occ = c.parentElement, depth = 0;
      while (occ && depth < 5) {
        const or = occ.getBoundingClientRect();
        const onlyThis = occ.querySelectorAll(SEL).length <= 1;
        if (or.height > 0 && onlyThis) { console.log('   ⚠ 占着位置的是祖先:', desc(occ), Math.round(or.width) + '×' + Math.round(or.height), '→ 该把它登记进 CELL_CONTAINERS'); break; }
        occ = occ.parentElement; depth++;
      }
      if (!occ || depth >= 5) console.log('   ✅ 卡片已彻底移出布局，没有祖先在占位（空洞不在这一层）');
    } else {
      console.log('   ⚠ 隐藏没生效：computed display 不是 none，多半是 B 站样式带了 !important 压过了内联');
    }
    if (!hidden) {
      holes.push(cell);
      let e = cell, chain = [];
      for (let i = 0; i < 4 && e; i++, e = e.parentElement) {
        const p = e.parentElement;
        const pd = p ? getComputedStyle(p).display : '';
        chain.push(desc(e) + (pd === 'grid' || pd === 'flex' ? ` ← 网格项（父 ${desc(p)} 是 ${pd}）` : ''));
      }
      console.log('   祖先链:', chain.join('  ⟶  '));
      console.log('   格子 HTML 头 300 字：', cell.outerHTML.slice(0, 300));
    }
  }
  // 布局快照：把容器所有子项的实际位置摊开。少一项之后哪里错位、间距是谁给的，
  // 看这张表比看任何单个属性都直接。
  if (box) {
    console.log('%c[空洞探针] 容器子项排布（前 12 个）:', P);
    [...box.children].slice(0, 12).forEach((e, i) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      const hidden = cs.display === 'none';
      console.log(
        `   #${i} ${desc(e)}` +
          (hidden ? '  [已隐藏]' : `  left:${Math.round(r.left)} top:${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`) +
          `  margin:${cs.margin}`
      );
    });
  }
  console.log('%c[空洞探针] 小结:', P, holes.length ? `有 ${holes.length} 列的格子没被隐藏 → 这就是留洞的位置` : '所有列的格子都已隐藏，空洞不是 cellOf 的问题');
})();
