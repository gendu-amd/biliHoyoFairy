// 配置备份：自动快照的查看与回滚。
//
// 没有 UI 的备份等于没有备份——存在 GM 存储里、用户翻不到的东西，出事时救不了任何人。
// 这一区把它摊开：什么时候、因为什么备的、当时有多少条规则，以及一个「恢复」按钮。
import { loadBackups, restoreBackup } from '../../../config';
import type { ConfigBackup } from '../../../config';
import { rescanAfterRuleChange } from '../../../dom';
import { escapeHtml } from '../../../util';
import { toast, updateBadge } from '../../toast';
import { confirmModal } from '../../confirm';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

// 备了什么、为什么备，得说人话——「reason: shrink」对用户毫无信息量。
const REASON_TEXT: Record<string, string> = {
  upgrade: '脚本升级前',
  shrink: '⚠ 规则条数骤降前',
  restore: '恢复操作前',
};

export const backupsSection: PanelSection = {
  tab: 'tools',
  render(host, ctx) {
    const sec = document.createElement('div');
    sec.className = 'sec';
    sec.innerHTML = `<label>🗂 配置备份（自动，最近 5 份）</label>
      <div class="hint">脚本升级前、以及规则条数发生骤降时会自动存一份，供出岔子时回滚。这是本地兜底，<b>不能替代</b>「⬇ 导出为文件」——存储被整个清掉时它也会一起没。</div>
      <div id="bfb-bk-list" style="margin-top:6px"></div>`;
    host.appendChild(sec);
    const listEl = q(sec, '#bfb-bk-list');

    const render = () => {
      const list = loadBackups();
      listEl.innerHTML = '';
      if (!list.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.textContent = '（暂无备份。首次安装、或安装后还没升级过时是正常的）';
        listEl.appendChild(e);
        return;
      }
      list.forEach((b: ConfigBackup) => {
        const row = document.createElement('div');
        row.className = 'log-row';
        const tx = document.createElement('span');
        tx.className = 'log-tx';
        const when = new Date(b.ts).toLocaleString();
        tx.innerHTML =
          `<span class="log-rs">[${escapeHtml(REASON_TEXT[b.reason] || b.reason)}]</span> ` +
          `${escapeHtml(when)} · v${escapeHtml(b.version)} · <b>${b.rules} 条规则</b>`;
        tx.title = `备份于 ${when}，脚本版本 v${b.version}，含 ${b.rules} 条规则`;
        row.appendChild(tx);

        const btn = document.createElement('button');
        btn.className = 'log-undo';
        btn.textContent = '↩恢复';
        btn.title = '用这份备份覆盖当前配置（覆盖前会先把当前状态也备份一次）';
        btn.onclick = () => {
          confirmModal(
            `用这份备份覆盖当前配置？\n\n备份时间：${when}\n含规则：${b.rules} 条\n\n当前配置会先被自动备份一次，所以这一步也是可撤销的。`,
            { title: '恢复配置备份', okText: '恢复' }
          ).then((ok) => {
            if (!ok) return;
            if (!restoreBackup(b)) return toast('恢复失败：这份备份的内容已损坏', 'error');
            rescanAfterRuleChange();
            updateBadge();
            ctx.rerender();
            toast(`已恢复到 ${when} 的备份（${b.rules} 条规则）`, 'success');
          });
        };
        row.appendChild(btn);
        listEl.appendChild(row);
      });
    };
    render();
  },
};
