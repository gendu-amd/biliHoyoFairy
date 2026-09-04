// BewlyCat 兼容性探针（v2）：在 B 站首页按 F12 → Console，整段粘贴回车。只读，不修改页面。
//
// v1 有两个毛病，这版都改了：
//   - 用 [class*="video-card"] 模糊匹配，把卡片内部每个子元素都算成了「卡片」，数字虚高几千；
//   - 从 document 开始找，只要页面上有原生卡就必然先命中它，BewlyCat 的卡永远轮不到。
// 现在先用 BewlyCat 源码里的两个确定性标记判断它到底在不在，再按 shadow root 分别汇报。
(() => {
  const P = 'color:#fb7299;font-weight:bold';
  const cls = (e) => String((e && e.className) || '').trim();

  // 收集所有开放 shadow root
  const roots = [document];
  const collect = (r) => r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) { roots.push(e.shadowRoot); collect(e.shadowRoot); } });
  collect(document);
  console.log('%c[探针] shadow root 数量:', P, roots.length - 1);

  // —— BewlyCat 在不在 ——
  // 两个确定性标记，取自它的源码：注入的样式标签 data-bewly-bundled-styles、
  // 卡片根节点上的 data-layout-settings-menu="BewlyComponents"。
  let bewlyRoot = null;
  const marks = [];
  for (const r of roots) {
    const hit = r.querySelector('[data-bewly-bundled-styles], [data-layout-settings-menu], [data-layout-edit-target]');
    if (hit) { marks.push(cls(hit) || hit.tagName); if (!bewlyRoot) bewlyRoot = r; }
  }
  console.log('%c[探针] BewlyCat:', P, bewlyRoot ? '✅ 检测到（标记: ' + marks.join(' / ') + '）' : '❌ 未检测到（下面测的就是原生 B 站）');

  // —— 卡片统计（精确选择器，不再模糊匹配）——
  const NATIVE = 'div.bili-video-card, div.video-page-card-small, li.bili-rank-list-video__item, div.video-card, li.rank-item, div.bili-dyn-list__item';
  const BEWLY = '.video-card-container, [data-layout-edit-target="video-card"]';
  let nat = 0, bew = 0, processed = 0, blocked = 0;
  for (const r of roots) {
    nat += r.querySelectorAll(NATIVE).length;
    bew += r.querySelectorAll(BEWLY).length;
    processed += r.querySelectorAll('[data-bfb-done]').length;
    blocked += r.querySelectorAll('[data-bfb-blocked]').length;
  }
  console.log('%c[探针] 原生卡:', P, nat, '| BewlyCat 卡:', bew);
  console.log('%c[探针] 本脚本已处理:', P, processed, '| 已判定拦截:', blocked);
  if (!bewlyRoot) return console.log('%c[探针] BewlyCat 不在，兼容性无从验证。请先启用它并刷新，再跑一次。', P);

  // —— 只在 BewlyCat 的那棵树里取样 ——
  const card = bewlyRoot.querySelector(BEWLY) || bewlyRoot.querySelector('.video-card');
  if (!card) return console.log('%c[探针] 检测到 BewlyCat 但没找到它的卡片：可能还没渲染完，滚两屏再跑。', P);
  console.log('%c[探针] 取样卡片 class:', P, cls(card));
  console.log('%c[探针] 祖先链:', P, (() => { const out = []; let e = card.parentElement; for (let i = 0; i < 3 && e; i++, e = e.parentElement) out.push(cls(e) || '(无 class)'); return out; })());
  console.log('%c[探针] 本脚本处理过这张卡吗:', P, card.hasAttribute('data-bfb-done') ? '是' : '否 ← 扫描没覆盖到');
  console.log('%c[探针] 内部字段候选（最多 20 条）:', P);
  let n = 0;
  for (const e of card.querySelectorAll('*')) {
    const c = cls(e);
    if (c && /title|tit\b|name|author|owner|up|duration|play|view|stat|channel/i.test(c) && n++ < 20) {
      console.log('   ', c, '→', (e.textContent || '').trim().slice(0, 28));
    }
  }
  const a = card.querySelector('a[href*="space.bilibili.com"]');
  const v = card.querySelector('a[href*="/video/"]');
  console.log('%c[探针] UP 链接:', P, a ? a.getAttribute('href') : '（没有 → UID 抠不到，拉黑/UID 规则失效）');
  console.log('%c[探针] 视频链接:', P, v ? v.getAttribute('href') : '（没有 → BV 抠不到）');
  console.log('%c[探针] 卡片 HTML 头 600 字（对不上时把这段发我）:', P);
  console.log(card.outerHTML.slice(0, 600));
})();
