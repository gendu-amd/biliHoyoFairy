// BewlyCat 兼容性探针：在装了 BewlyCat 的 B 站首页按 F12 → Console，整段粘贴回车。
//
// 它回答四个问题（不修改页面，只读）：
//   1. 页面上有几个开放 shadow root，我们的卡片选择器在里面能不能选中东西；
//   2. 选中的卡有没有被本脚本处理过（data-bfb-done）——没有就是扫描没覆盖到；
//   3. 卡片本身、外层网格项、内部字段的**真实类名**是什么（我们登记的三条是照源码写的，需实测核对）；
//   4. UP 链接与视频链接在不在（UID / BV 号能不能抠出来）。
// 输出直接截图或复制给维护者即可。
(() => {
  // 收集所有开放 shadow root（BewlyCat 的界面就挂在里面）
  const roots = [document];
  const collect = (r) => r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) { roots.push(e.shadowRoot); collect(e.shadowRoot); } });
  collect(document);
  console.log('%c[探针] shadow root 数量:', 'color:#fb7299;font-weight:bold', roots.length - 1);

  // 找卡片
  let card = null, cards = 0;
  for (const r of roots) {
    const found = r.querySelectorAll('.video-card, [class*="video-card"]');
    cards += found.length;
    if (!card && found.length) card = found[0];
  }
  console.log('%c[探针] 卡片候选总数:', 'color:#fb7299;font-weight:bold', cards);
  if (!card) return console.log('没找到卡片。BewlyCat 可能还没渲染完，滚动几屏再跑一次。');

  // 我们的脚本处理过它吗
  let processed = 0, blocked = 0;
  for (const r of roots) {
    processed += r.querySelectorAll('[data-bfb-done]').length;
    blocked += r.querySelectorAll('[data-bfb-blocked]').length;
  }
  console.log('%c[探针] 已被本脚本处理的卡:', 'color:#fb7299;font-weight:bold', processed, '| 已判定拦截:', blocked);

  const cls = (e) => String((e && e.className) || '').trim();
  console.log('%c[探针] 卡片本身 class:', 'color:#fb7299;font-weight:bold', cls(card));
  console.log('%c[探针] 外层链（找网格项）:', 'color:#fb7299;font-weight:bold',
    [card.parentElement, card.parentElement && card.parentElement.parentElement].filter(Boolean).map(cls));
  console.log('%c[探针] 内部字段候选:', 'color:#fb7299;font-weight:bold');
  card.querySelectorAll('*').forEach((e) => {
    const c = cls(e);
    if (/title|name|author|duration|play|view|stat/i.test(c)) {
      console.log('   ', c, '→', (e.textContent || '').trim().slice(0, 28));
    }
  });
  const a = card.querySelector('a[href*="space.bilibili.com"]');
  console.log('%c[探针] UP 链接:', 'color:#fb7299;font-weight:bold', a ? a.getAttribute('href') : '（没有，UID 抠不到）');
  const v = card.querySelector('a[href*="/video/"]');
  console.log('%c[探针] 视频链接:', 'color:#fb7299;font-weight:bold', v ? v.getAttribute('href') : '（没有，BV 抠不到）');
})();
