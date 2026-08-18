// 正则测试器：纯调试工具，不读也不写任何规则。
import { escapeRe } from '../../../match/normalize';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

export const regexTesterSection: PanelSection = {
  tab: 'tools',
  render(host) {
    const retest = document.createElement('div');
    retest.className = 'sec';
    retest.innerHTML = `<label>🧪 正则测试器（仅调试用，不影响规则）</label>
      <div class="addrow"><input type="text" id="bfb-re-pat" placeholder="正则或普通词，如 /一口气.*看完/i"></div>
      <div class="addrow" style="margin-top:6px"><input type="text" id="bfb-re-txt" placeholder="样例文本（粘贴一个标题试试）"></div>
      <div class="hint" id="bfb-re-out" style="margin-top:6px">输入正则与样例文本，实时显示是否命中。/.../ 按正则，否则按普通词（包含即命中）。</div>`;
    host.appendChild(retest);
    const rePat = q<HTMLInputElement>(retest, '#bfb-re-pat');
    const reTxt = q<HTMLInputElement>(retest, '#bfb-re-txt');
    const reOut = q(retest, '#bfb-re-out');
    const runReTest = () => {
      const pat = (rePat.value || '').trim();
      const txt = reTxt.value || '';
      if (!pat) {
        reOut.textContent = '输入正则与样例文本，实时显示是否命中。';
        reOut.style.color = '';
        return;
      }
      let re;
      const m = pat.match(/^\/(.*)\/([a-z]*)$/);
      try {
        re = m ? new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i') : new RegExp(escapeRe(pat), 'i');
      } catch (e) {
        reOut.textContent = '⚠ 正则语法错误：' + (e as Error).message;
        reOut.style.color = '#e74c3c';
        return;
      }
      if (!txt) {
        reOut.textContent = `已就绪（${m ? '正则' : '普通词'}），输入样例文本看是否命中。`;
        reOut.style.color = '';
        return;
      }
      const hit = re.test(txt);
      reOut.textContent = hit ? '✅ 命中' : '✗ 未命中';
      reOut.style.color = hit ? '#1b7a3d' : '#6e6e6e';
    };
    rePat.oninput = runReTest;
    reTxt.oninput = runReTest;
  },
};
