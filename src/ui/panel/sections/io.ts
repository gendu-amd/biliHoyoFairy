// 规则配置导入 / 导出。
//
// ⚠ 安全红线（见 docs/ARCHITECTURE.md §9）：导入的文件可能来自任何人。
// 三道关卡缺一不可——迁移旧结构 → 按 DEFAULT_CONFIG 形状清洗 → 剔除不可移植键（尤其 subscriptions，
// 否则一份「规则文件」就能悄悄给别人装上会自动联网拉取的订阅源）。
import {
  CONFIG,
  saveConfig,
  exportConfig,
  mergeImport,
  migrateConfig,
  sanitizeConfigInput,
  NON_PORTABLE,
} from '../../../config';
import { rescanAfterRuleChange } from '../../../dom';
import { toast } from '../../toast';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

export const ioSection: PanelSection = {
  tab: 'tools',
  render(host, ctx) {
    const io = document.createElement('div');
    io.className = 'sec';
    io.innerHTML = `<label>规则配置导入 / 导出（备份、分享给他人）</label>
      <div class="toolbar"><button class="act" id="bfb-export">⬇ 导出为文件</button><button class="act ghost" id="bfb-import">⬆ 从文件导入</button></div>
      <div class="hint">导出你的全部过滤规则与开关（不含统计、缓存、个人偏好）。导入时规则列表取<b>并集</b>（不会丢失现有规则），开关以导入值为准。</div>`;
    host.appendChild(io);

    q(io, '#bfb-export').onclick = () => {
      const blob = new Blob([exportConfig()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `biliHoyoFairy-rules-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('已导出规则配置文件');
    };

    q(io, '#bfb-import').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          try {
            const parsed = JSON.parse(String(r.result || ''));
            const raw = parsed && parsed.config ? parsed.config : parsed;
            if (!raw || typeof raw !== 'object') throw new Error('bad');
            // 先按存档结构版本迁移（可能是老版本导出的文件），再按 DEFAULT_CONFIG 形状清洗：
            // 未知键、类型不符的值、数组里的非字符串元素一律丢弃。
            const incoming = sanitizeConfigInput(migrateConfig(raw));
            NON_PORTABLE.forEach((k) => delete incoming[k]);
            delete incoming.schemaVersion; // 版本号跟本机存档走，不由导入文件决定
            // 先合并到副本并校验结构，避免坏配置原地写坏 CONFIG 并被持久化
            const draft = structuredClone(CONFIG);
            mergeImport(draft, incoming);
            const okObj = (o: unknown) => o && typeof o === 'object' && !Array.isArray(o);
            if (!okObj(draft.block) || !okObj(draft.allow)) throw new Error('bad');
            Object.assign(CONFIG, draft);
            saveConfig();
            rescanAfterRuleChange();
            ctx.rerender();
            toast('已导入并合并规则配置');
          } catch (e) {
            toast('导入失败：文件不是有效的配置 JSON');
          }
        };
        r.readAsText(f);
      };
      inp.click();
    };
  },
};
