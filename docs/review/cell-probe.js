// 网格格子探针：在**出问题的那个页面**（如热门 https://www.bilibili.com/v/popular/all）
// 按 F12 → Console，整段粘贴回车。只读，不修改页面。
//
// 要回答的问题只有一个：这张卡的「网格格子」是哪个祖先？
// 隐藏卡片时必须上移到那个格子，否则格子还占着位 → 留下空洞、后面的卡不补位。
// 输出里 ← 网格项 标记的那一层，就是该登记进 selectors.ts CELL_CONTAINERS 的元素。
(() => {
  const P = 'color:#fb7299;font-weight:bold';
  const SEL =
    'div.bili-video-card,div.video-page-card-small,li.bili-rank-list-video__item,div.video-card,li.rank-item,div.video-card-reco,div.video-card-common,div.bili-dyn-list__item,div.floor-card.single-card';
  const CELLS = ['div.feed-card', 'div.floor-single-card', 'div.bili-feed-card', 'div.video-card-container'];

  const roots = [document];
  const collect = (r) => r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) { roots.push(e.shadowRoot); collect(e.shadowRoot); } });
  collect(document);

  const cards = [];
  for (const r of roots) cards.push(...r.querySelectorAll(SEL));
  console.log('%c[格子探针] 页面:', P, location.pathname, '| 找到卡片:', cards.length);
  if (!cards.length) return console.log('没找到卡片，滚两屏再跑一次。');

  const desc = (e) => {
    if (!e) return '(无)';
    const c = String(e.className || '').trim().split(/\s+/).slice(0, 4).join('.');
    return e.tagName.toLowerCase() + (c ? '.' + c : '');
  };
  // 我们当前的 cellOf 逻辑：按 CELL_CONTAINERS 顺序逐个 closest
  const cellOf = (el) => {
    for (const s of CELLS) { const f = el.closest(s); if (f) return f; }
    return el;
  };

  // 取两张：第一张，以及第一张被我们隐藏掉的（后者最能暴露留洞问题）
  const samples = [cards[0], cards.find((c) => c.hasAttribute('data-bfb-blocked') || getComputedStyle(c).display === 'none')].filter(Boolean);
  const seen = new Set();
  for (const card of samples) {
    if (seen.has(card)) continue;
    seen.add(card);
    console.log('%c[格子探针] ——— 卡片:', P, desc(card), card.hasAttribute('data-bfb-blocked') ? '（已被本脚本判定拦截）' : '');
    const cell = cellOf(card);
    console.log('%c[格子探针] 当前 cellOf 取到:', P, desc(cell), cell === card ? '← ⚠ 没找到容器，停在卡片本身（这就是留洞的原因）' : '');
    let e = card;
    for (let i = 0; i < 6 && e; i++, e = e.parentElement) {
      const p = e.parentElement;
      const pd = p ? getComputedStyle(p).display : '';
      const isItem = pd === 'grid' || pd === 'flex' || pd === 'inline-grid' || pd === 'inline-flex';
      const cs = getComputedStyle(e);
      console.log(
        `   ${i === 0 ? '卡片' : '祖先' + i}: ${desc(e)}  [display:${cs.display} w:${Math.round(e.getBoundingClientRect().width)} h:${Math.round(e.getBoundingClientRect().height)}]` +
          (isItem ? `  ← 网格项（父 ${desc(p)} 是 ${pd}）` : '')
      );
    }
  }
})();
