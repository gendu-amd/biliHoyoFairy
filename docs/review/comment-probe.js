// 评论状态探针：在**播放页**（评论过滤已开、审查模式已开）按 F12 → Console 整段粘贴回车。只读。
//
// 回答一个问题：审查模式下命中的评论为什么看不见。
// 代码路径写的是「撤掉折叠条 + 描边 + 取消隐藏」，与实际现象相反，所以要看每条评论的真实状态。
(() => {
  const P = 'color:#fb7299;font-weight:bold';
  const TAGS = { 'BILI-COMMENT-THREAD-RENDERER': 1, 'BILI-COMMENT-REPLY-RENDERER': 1 };

  const roots = [];
  const collect = (r) => r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) { roots.push(e.shadowRoot); collect(e.shadowRoot); } });
  collect(document);
  const hosts = roots.map((r) => r.host).filter((h) => h && TAGS[h.tagName]);
  console.log('%c[评论探针] shadow root:', P, roots.length, '| 评论宿主:', hosts.length);
  if (!hosts.length) return console.log('没找到评论组件。滚到评论区、等它加载出来再跑。');

  let hidden = 0, marked = 0, bar = 0, untouched = 0;
  const samples = [];
  for (const h of hosts) {
    const cs = getComputedStyle(h);
    const inline = h.getAttribute('style') || '';
    const r = h.getBoundingClientRect();
    const st = {
      tag: h.tagName,
      尺寸: Math.round(r.width) + '×' + Math.round(r.height),
      正文长度: (h.textContent || '').trim().length,
      computedDisplay: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      父容器display: h.parentElement ? getComputedStyle(h.parentElement).display : '(无)',
      inline,
      outline: cs.outlineStyle + ' ' + cs.outlineWidth,
      title: h.getAttribute('title') || '',
      评估版本: h.__bfbCmtV,
      命中过: !!h.__bfbCmtHit,
      有折叠条: !!(h.__bfbCmtPh && h.__bfbCmtPh.isConnected),
      前一个兄弟: h.previousElementSibling ? h.previousElementSibling.className || h.previousElementSibling.tagName : '(无)',
    };
    if (cs.display === 'none') hidden++;
    else if (cs.outlineStyle !== 'none') marked++;
    else if (st.有折叠条) bar++;
    else untouched++;
    if (samples.length < 3 && (cs.display === 'none' || h.__bfbCmtHit)) samples.push(st);
  }
  console.log('%c[评论探针] 统计:', P, `隐藏 ${hidden} · 带描边 ${marked} · 有折叠条 ${bar} · 未处理 ${untouched}`);
  console.log('%c[评论探针] 样本（最多 3 条命中/隐藏的）:', P);
  samples.forEach((s, i) => console.log(`   #${i}`, JSON.stringify(s, null, 1)));

  // 关键交叉验证：内存里的规则版本 vs 评论上打的版本。对不上说明这批评论根本没被重新评估。
  // 决定性判据：有尺寸 = 渲染出来了（问题不在我们）；0 高 = 真的塌了。
  const sized = hosts.filter((h) => h.getBoundingClientRect().height > 0).length;
  console.log('%c[评论探针] 有实际尺寸的宿主:', P, sized, '/', hosts.length,
    sized === hosts.length ? '← 全部渲染出来了：评论没有消失，问题不在隐藏逻辑' : '← 有塌掉的');
  console.log('%c[评论探针] 提示:', P, '若样本里 computedDisplay 是 none 且 inline 带 display:none !important，' +
    '说明处理它的是「隐藏」分支而不是审查分支——把 评估版本 一起发我，能判断是不是压根没重跑。');
})();
