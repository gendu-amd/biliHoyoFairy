// 基础分组：常规开关 + 卡片类型过滤。
import { CONFIG } from '../../../config';
import { rescanAfterRuleChange } from '../../../dom';
import { applyHotSearchStyle } from '../../../hotsearch';
import { bindControl } from '../../field';
import { hideHoverBtn } from '../../menu';
import { updateBadge } from '../../toast';
import { setTimingEnabled } from '../../../health';
import type { PanelSection } from '../ctx';

export const baseSection: PanelSection = {
  tab: 'base',
  render(host) {
    const sw = document.createElement('div');
    sw.className = 'sec';
    sw.innerHTML = `
      <div class="switch"><input type="checkbox" id="bfb-enabled"> 启用拦截</div>
      <div class="switch"><input type="checkbox" id="bfb-review"> 🔍 审查模式（不隐藏，仅标记被拦视频并提供就地放行，便于核对）</div>
      <div class="switch"><input type="checkbox" id="bfb-collapse-cards"> 📎 折叠模式（命中的视频收成一行灰条，可展开查看，而非直接消失）</div>
      <div class="switch"><input type="checkbox" id="bfb-rclick"> 右键卡片弹出菜单（屏蔽、拉黑、加入白名单）</div>
      <div class="switch"><input type="checkbox" id="bfb-hoverbtn"> 悬停卡片显示快捷「拉黑 / 不看这个」按钮</div>
      <div class="switch"><input type="checkbox" id="bfb-collab"> 联合投稿一并拉黑合作者</div>
      <div class="switch"><input type="checkbox" id="bfb-fuzzy"> 反绕过模糊匹配（「原 神」「原.神」同样拦截；隐形字符始终拦截）</div>
      <div class="switch"><input type="checkbox" id="bfb-trad"> 简繁归一（规则写「原神」也能拦住繁体标题；单向繁→简）</div>
      <div class="switch"><input type="checkbox" id="bfb-debug"> 调试模式（控制台逐卡打印拦截 / 放行原因；并在「工具 → 运行自检」里记录耗时）</div>
      <div class="hint">所有开关与规则均<b>即时生效</b>，无需保存。<b>审查模式</b>与<b>折叠模式</b>都会让拦截层停止在数据层删项（否则你只会看到一部分被折叠、另一部分凭空消失），代价是失去「从头就不出现」的无闪烁效果，切换后建议<b>刷新页面</b>。如需让视频真正从推荐流中消失，请使用<b>拉黑</b>。</div>`;
    host.appendChild(sw);
    bindControl(sw, 'bfb-enabled', CONFIG, 'enabled', {
      after: () => {
        updateBadge();
        rescanAfterRuleChange();
      },
    });
    bindControl(sw, 'bfb-review', CONFIG, 'reviewMode', { after: rescanAfterRuleChange });
    bindControl(sw, 'bfb-collapse-cards', CONFIG, 'collapseCards', { after: rescanAfterRuleChange });
    bindControl(sw, 'bfb-rclick', CONFIG, 'rightClickBlock');
    bindControl(sw, 'bfb-hoverbtn', CONFIG, 'cardHoverBtn', { after: hideHoverBtn });
    bindControl(sw, 'bfb-collab', CONFIG, 'blacklistCollab');
    bindControl(sw, 'bfb-fuzzy', CONFIG, 'fuzzyMatch', { after: rescanAfterRuleChange });
    bindControl(sw, 'bfb-trad', CONFIG, 'tradNorm', { after: rescanAfterRuleChange });
    bindControl(sw, 'bfb-debug', CONFIG, 'debug', {
      after: () => {
        setTimingEnabled(CONFIG.debug); // 顺带开/关耗时采样，结果见「工具 → 🩺 运行自检」
        rescanAfterRuleChange();
      },
    });

    const ct = document.createElement('div');
    ct.className = 'sec';
    ct.innerHTML = `
      <label>卡片类型过滤</label>
      <div class="switch"><input type="checkbox" id="bfb-ad"> 屏蔽广告 / 推广卡片</div>
      <div class="switch"><input type="checkbox" id="bfb-live"> 屏蔽信息流中的直播推荐卡</div>
      <div class="switch"><input type="checkbox" id="bfb-hotsearch"> 屏蔽搜索框热搜词</div>
      <div class="hint">广告由脚本自动识别，偶有误差，可在下方「屏蔽记录」核对实际拦截的内容。直播卡指首页与动态中指向直播间的推荐卡。</div>`;
    host.appendChild(ct);
    bindControl(ct, 'bfb-ad', CONFIG, 'hideAd', { after: rescanAfterRuleChange });
    bindControl(ct, 'bfb-live', CONFIG, 'hideLiveCard', { after: rescanAfterRuleChange });
    bindControl(ct, 'bfb-hotsearch', CONFIG, 'hideHotSearch', { after: applyHotSearchStyle });
  },
};
