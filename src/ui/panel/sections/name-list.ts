// 名单批量处理：粘贴 / 文件 / URL 载入一批 UID 或名称 → 仅屏蔽（本地）或 拉黑（写账号黑名单）。
// 归到「导入/导出」一族，注册顺序紧跟 io section。
import { CONFIG, saveConfig } from '../../../config';
import { doBlacklistMany, REL_ERR } from '../../../blacklist';
import { rescanAfterRuleChange } from '../../../dom';
import { pushUnique } from '../../../rules';
import { parseNameList } from '../../../batch';
import { escapeHtml } from '../../../util';
import { toast } from '../../toast';
import { confirmModal, promptModal } from '../../confirm';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

// blacklist.ts 尚未类型化（渐进推进中），就地声明其批量接口的出入参形状，
// 让本文件内的用法先受检；等 blacklist.ts 去掉 @ts-nocheck 后可直接删。
interface BlockFail {
  uid: string;
  code: number | string;
}
interface BlockResult {
  added: number;
  already: number;
  total: number;
  done: number;
  cancelled?: boolean;
  failed: BlockFail[];
}
interface BlockProgress {
  done: number;
  total: number;
  added: number;
  already: number;
  fail: number;
  paused?: boolean;
  wait?: number;
}

export const nameListSection: PanelSection = {
  tab: 'tools',
  render(host, ctx) {
    const listSec = document.createElement('div');
    listSec.className = 'sec';
    listSec.innerHTML = `<label>名单批量处理（粘贴 / 文件 / URL）</label>
      <textarea id="bfb-list-input" class="bfb-listta" rows="4" placeholder="粘贴一批 UID 或 UP 名，空格、逗号、换行、分号均可分隔。&#10;纯数字识别为 UID，其余识别为 UP 名；也支持 uid:123、up:名字 前缀。"></textarea>
      <div class="toolbar" style="margin-top:6px">
        <button class="act ghost" id="bfb-list-file">📁 从文件载入</button>
        <button class="act ghost" id="bfb-list-url">🔗 从 URL 载入</button>
      </div>
      <div class="toolbar" style="margin-top:6px">
        <button class="act" id="bfb-list-hide">仅屏蔽（本地）</button>
        <button class="act ghost" id="bfb-list-block" style="color:#e74c3c">⛔ 拉黑（写账号黑名单）</button>
        <button class="act ghost" id="bfb-list-stop" style="display:none;color:#e67e22">⏹ 停止</button>
      </div>
      <div class="hint">「仅屏蔽」只在本地隐藏；「拉黑」会写入账号黑名单（限速执行、触发风控自动续传、<b>不可一键撤销</b>、执行前确认）。仅有名称、无 UID 的条目将降级为本地屏蔽。</div>
      <div id="bfb-list-status" class="stat" style="margin-top:6px;min-height:1.2em"></div>`;
    host.appendChild(listSec);

    const listTa = q<HTMLTextAreaElement>(listSec, '#bfb-list-input');
    const listStatus = q(listSec, '#bfb-list-status');
    // 输入解析的纯逻辑在 ./batch.parseNameList（可单测）
    const parseList = () => parseNameList(listTa.value);
    // 仅屏蔽：UID→block.uids，名称→block.upNames（批量去重，最后统一存盘+重扫，避免逐条重扫）
    const addLocalMany = (uids: string[], names: string[]) => {
      const n = pushUnique(CONFIG.block.uids, uids) + pushUnique(CONFIG.block.upNames, names);
      if (n) {
        saveConfig();
        rescanAfterRuleChange();
      }
      return n;
    };

    q(listSec, '#bfb-list-file').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.txt,.csv,.json,text/plain,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          listTa.value = (listTa.value ? listTa.value + '\n' : '') + String(r.result || '');
          toast('已载入文件内容到输入框，确认后点 仅屏蔽 / 拉黑');
        };
        r.readAsText(f);
      };
      inp.click();
    };

    q(listSec, '#bfb-list-url').onclick = () => {
      promptModal('输入名单 URL（纯文本：每行一个 UID 或 UP 名）：', { title: '从 URL 载入', placeholder: 'https://…', okText: '载入' }).then((input) => {
        const url = (input || '').trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) return toast('请输入有效的 http(s) URL', 'warn');
        if (typeof GM_xmlhttpRequest !== 'function') return toast('当前环境不支持联网载入', 'warn');
        toast('载入中…');
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: 15000,
          onload: (r) => {
            if (r.status >= 200 && r.status < 300 && r.responseText) {
              listTa.value = (listTa.value ? listTa.value + '\n' : '') + r.responseText;
              toast('已载入 URL 内容到输入框，确认后点 仅屏蔽 / 拉黑', 'success');
            } else toast('载入失败：HTTP ' + r.status, 'error');
          },
          onerror: () => toast('网络错误，载入失败', 'error'),
          ontimeout: () => toast('载入超时', 'error'),
        });
      });
    };

    q(listSec, '#bfb-list-hide').onclick = () => {
      const { uids, names } = parseList();
      if (!uids.length && !names.length) return toast('没解析到有效的 UID / 名称');
      const n = addLocalMany(uids, names);
      toast(`已本地屏蔽：新增 ${n} 条（解析到 UID ${uids.length} / 名称 ${names.length}）`);
      ctx.rerender();
    };

    q(listSec, '#bfb-list-block').onclick = () => {
      const { uids, names } = parseList();
      if (!uids.length && !names.length) return toast('没解析到有效的 UID / 名称');
      const est = Math.ceil(uids.length * 1.3); // 约 0.9~1.6s/个
      const nameTip = names.length ? `\n另有 ${names.length} 个只有名称（无 UID）→ 仅本地屏蔽，不写账号` : '';
      // 日限/总量提示：账号黑名单有总量上限，单日大批量更易触发风控，数量多时提醒分批。
      const limitTip = uids.length > 200 ? '\n数量较多：账号黑名单有总量上限，且单日大批量操作更易触发风控，建议分批进行。' : '';

      const run = () => {
        const nLocal = addLocalMany([], names); // 名称部分仅本地屏蔽
        if (!uids.length) {
          toast(`无 UID 可账号拉黑；已本地屏蔽 ${nLocal} 个名称`);
          ctx.rerender();
          return;
        }
        toast(`开始拉黑 ${uids.length} 个…执行期间请勿关闭面板`);
        listStatus.textContent = `准备拉黑 ${uids.length} 个…`;
        const stopBtn = q<HTMLButtonElement>(listSec, '#bfb-list-stop');
        const blockBtn = q<HTMLButtonElement>(listSec, '#bfb-list-block');
        const resetButtons = () => {
          stopBtn.style.display = 'none';
          stopBtn.disabled = false;
          stopBtn.textContent = '⏹ 停止';
          blockBtn.disabled = false;
        };
        const ctl = doBlacklistMany(
          uids.map((u: string) => ({ uid: u, name: '' })),
          (r: BlockResult) => {
            resetButtons();
            // 如实拆分：新拉黑(code0) / 此前已在黑名单(22120) / 失败(各 code)。失败 + 未处理(停止时) 回填输入框便于续传/重试。
            const failUids = r.failed.map((f) => f.uid);
            const byCode: Record<string, number> = {};
            r.failed.forEach((f) => (byCode[f.code] = (byCode[f.code] || 0) + 1));
            const failBreak = Object.entries(byCode)
              .map(([c, n]) => `${(REL_ERR as Record<string, string>)[c] || 'code ' + c}×${n}`)
              .join('、');
            const head = r.cancelled ? `⏹ 已停止（已处理 ${r.done}/${r.total}）：` : `✅ 完成（共 ${r.total}）：`;
            listStatus.innerHTML =
              `${head}<b>新拉黑 ${r.added}</b>` +
              (r.already ? ` · 此前已在黑名单 ${r.already}` : '') +
              (failUids.length ? ` · <b style="color:#e74c3c">失败 ${failUids.length}</b>（${escapeHtml(failBreak)}；已回填可重试）` : '') +
              (nLocal ? ` · 另本地屏蔽 ${nLocal} 名称` : '') +
              `<br><span style="color:#888">官方黑名单本次新增 = 新拉黑 ${r.added} 个（“已在黑名单”的不会再叠加；如仍对不上，多为风控/已满，开调试模式看控制台 code 明细）</span>`;
            const remain = r.cancelled ? uids.slice(r.done) : []; // 停止时把未处理的一并回填，便于续传
            const refill = failUids.concat(remain);
            listTa.value = refill.length ? refill.join('\n') : '';
            toast(`${r.cancelled ? '已停止' : '完成'}：新拉黑 ${r.added}，已在黑名单 ${r.already}，失败 ${failUids.length}`);
            ctx.refreshStats();
          },
          (pg: BlockProgress) => {
            listStatus.textContent = pg.paused
              ? `⚠ 触发风控，已暂停约 ${pg.wait}s 后自动继续 · 进度 ${pg.done}/${pg.total}（新拉黑 ${pg.added}，已在 ${pg.already}，失败 ${pg.fail}）`
              : `拉黑中 ${pg.done}/${pg.total} · 新拉黑 ${pg.added}${pg.already ? `，已在 ${pg.already}` : ''}${pg.fail ? `，失败 ${pg.fail}` : ''}…`;
            ctx.refreshStats();
          }
        );
        // 执行期间：禁用「拉黑」、亮出「停止」。停止只中断后续，在途请求会正常收尾。
        blockBtn.disabled = true;
        stopBtn.style.display = '';
        stopBtn.onclick = () => {
          stopBtn.disabled = true;
          stopBtn.textContent = '停止中…';
          listStatus.textContent = '停止中：等当前这一个完成后收尾…';
          ctl.cancel();
        };
      };

      // 有 UID 才需账号写操作确认；纯名称直接走本地屏蔽（run 内已处理无 UID 分支）。
      if (uids.length) {
        confirmModal(
          `将把 ${uids.length} 个 UID 写入你的账号黑名单（限速约 ${est} 秒起，触发风控会自动暂停续传、耗时更久），不可一键撤销。${nameTip}${limitTip}\n\n执行期间请保持此页面打开，可随时点「停止」中断。`,
          { title: '批量拉黑确认', okText: `拉黑 ${uids.length} 个`, danger: true }
        ).then((ok) => {
          if (ok) run();
        });
      } else {
        run();
      }
    };
  },
};
