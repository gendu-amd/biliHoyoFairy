// 预置规则库：一键把整组规则并入黑名单。
import { CONFIG, saveConfig } from '../../../config';
import { PRESET_LIBRARY } from '../../../presets';
import type { Preset } from '../../../presets';
import { rescanAfterRuleChange } from '../../../dom';
import { pushUnique } from '../../../rules';
import { toast } from '../../toast';
import { confirmModal } from '../../confirm';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

// 需联网读取才生效的维度：含这些维度的预置若未开「精确过滤」会静默失效，必须显式引导。
const API_DIM_KEYS = ['tags', 'dualTags', 'upBio'];

export const presetsSection: PanelSection = {
  tab: 'tools',
  render(host, ctx) {
    const preset = document.createElement('div');
    preset.className = 'sec';
    preset.innerHTML =
      '<label>预置规则库（点击加入对应黑名单，可叠加）</label>' +
      '<div class="hint">一键把整组规则加入「黑名单」（之后可在黑名单页增删）。需要持续更新的大名单请用「规则订阅」。</div>' +
      '<div id="bfb-presets"></div>';
    host.appendChild(preset);
    const presetBox = q(preset, '#bfb-presets');

    // 应用一条预置：各维度去重加进 CONFIG.block，最后统一存盘+重扫（避免逐条重扫）
    const applyPreset = (p2: Preset) => {
      let n = 0;
      for (const dim of Object.keys(p2.rules || {})) {
        const arr = (CONFIG.block as unknown as Record<string, unknown>)[dim];
        if (!Array.isArray(arr)) continue;
        n += pushUnique(arr as string[], p2.rules[dim].map((v: string) => String(v).trim()).filter(Boolean));
      }
      if (n) {
        saveConfig();
        rescanAfterRuleChange();
      }
      toast(n ? `已加入「${p2.name}」${n} 条` : `「${p2.name}」已全部存在`);
      const needsApi = Object.keys(p2.rules || {}).some((d) => API_DIM_KEYS.includes(d));
      if (needsApi && !CONFIG.apiFilters) {
        confirmModal(`「${p2.name}」含需联网读取（标签、简介）的规则，需开启「精确过滤」才会生效。是否现在开启？`, {
          title: '开启精确过滤',
          okText: '开启',
        }).then((ok) => {
          if (ok) {
            CONFIG.apiFilters = true;
            saveConfig();
            rescanAfterRuleChange();
          }
          ctx.rerender();
        });
      } else {
        ctx.rerender();
      }
    };

    // 按大类分组渲染
    const byCat: Record<string, Preset[]> = {};
    PRESET_LIBRARY.forEach((pp) => (byCat[pp.cat] = byCat[pp.cat] || []).push(pp));
    Object.keys(byCat).forEach((cat) => {
      const cl = document.createElement('div');
      cl.style.cssText = 'font-size:12px;color:#6e6e6e;margin:8px 0 4px';
      cl.textContent = cat;
      presetBox.appendChild(cl);
      const bar = document.createElement('div');
      bar.className = 'toolbar';
      byCat[cat].forEach((pp: Preset) => {
        const btn = document.createElement('button');
        btn.className = 'act ghost';
        btn.textContent = '+ ' + pp.name;
        if (pp.desc) btn.title = pp.desc;
        btn.onclick = () => applyPreset(pp);
        bar.appendChild(btn);
      });
      presetBox.appendChild(bar);
    });
  },
};
