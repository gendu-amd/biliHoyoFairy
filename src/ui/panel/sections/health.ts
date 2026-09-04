// 运行自检：把 health 计数器摊开给用户看。
// 存在的意义是「失败可见」——B 站换接口/换类名时脚本会静默失效，用户在这里能一眼看出
// 是拦截层没命中、还是 DOM 层没识别到卡，从而知道该更新脚本而不是以为自己规则写错了。
import { healthNotes, healthReport, healthSummary, timingReport } from '../../../health';
import { escapeHtml } from '../../../util';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

export const healthSection: PanelSection = {
  tab: 'tools',
  render(host) {
    const sec = document.createElement('div');
    sec.className = 'sec';
    sec.innerHTML = `<label>🩺 运行自检 <button class="act ghost" id="bfb-health-refresh" style="float:right">刷新</button></label>
      <div class="stat" id="bfb-health-sum"></div>
      <div id="bfb-health-warn" style="margin-top:6px"></div>
      <div id="bfb-health-timing" style="margin-top:6px"></div>`;
    host.appendChild(sec);
    const sumEl = q(sec, '#bfb-health-sum');
    const warnEl = q(sec, '#bfb-health-warn');
    const timeEl = q(sec, '#bfb-health-timing');
    const refresh = () => {
      sumEl.textContent = healthSummary();
      // 耗时采样只在调试模式下记账（见 health.timed）。不开时整块不显示，免得占地方。
      const t = timingReport();
      timeEl.innerHTML = t.length
        ? '<label style="margin-top:8px">⏱ 耗时采样（调试模式）</label>' +
          t.map((x) => `<div class="stat">${escapeHtml(x)}</div>`).join('') +
          '<div class="hint">「共」是累计，「峰」是单次最慢——卡顿看峰值，写放大看次数。关闭调试模式即清零。</div>'
        : '';
      const w = healthReport();
      if (w.length) {
        warnEl.innerHTML = w.map((x) => `<div class="hint" style="color:#e74c3c">⚠ ${escapeHtml(x)}</div>`).join('');
        return;
      }
      // 没有警告 ≠ 一切都在跑：拦截层可能只是还没轮到它（首屏 SSR）。这种情况说明原因而不是报绿，
      // 否则「显示正常但我看到空洞」会让人更困惑。
      const notes = healthNotes();
      warnEl.innerHTML = notes.length
        ? notes.map((x) => `<div class="hint">ℹ ${escapeHtml(x)}</div>`).join('')
        : '<div class="hint" style="color:#1b7a3d">✅ 拦截层与 DOM 层均工作正常</div>';
    };
    q(sec, '#bfb-health-refresh').onclick = refresh;
    refresh();
  },
};
