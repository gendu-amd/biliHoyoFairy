// @ts-nocheck
// 清空计数 / 记录、恢复默认配置。
import { CONFIG, DEFAULT_CONFIG, saveConfig } from '../../../config';
import { blockedLog, setSessionBlocked } from '../../../stats';
import { rescanAfterRuleChange } from '../../../dom';
import { toast, updateBadge } from '../../toast';
import { confirmModal } from '../../confirm';

export const resetSection = {
  tab: 'tools',
  render(host, ctx) {
    const tool = document.createElement('div');
    tool.className = 'sec toolbar';
    tool.innerHTML = `<button class="act ghost" id="bfb-clearcount">清空计数 / 记录</button><button class="act ghost" id="bfb-reset">恢复默认</button>`;
    host.appendChild(tool);

    tool.querySelector('#bfb-clearcount').onclick = () => {
      CONFIG.blockedCount = 0;
      setSessionBlocked(0);
      blockedLog.length = 0;
      saveConfig();
      updateBadge();
      ctx.rerender();
      toast('已清空计数与本次记录');
    };
    tool.querySelector('#bfb-reset').onclick = () => {
      confirmModal('确定恢复默认配置？现有规则将全部清空，不可撤销。', { title: '恢复默认', okText: '恢复默认', danger: true }).then((ok) => {
        if (!ok) return;
        Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
        saveConfig();
        rescanAfterRuleChange();
        ctx.rerender();
      });
    };
  },
};
