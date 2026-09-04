// 批量拉黑当前页：扫描本页所有被屏蔽的卡片并拉黑其 UP。
import { CONFIG } from '../../../config';
import { ATTR_BLOCKED } from '../../../constants';
import { doBlacklistMany } from '../../../blacklist';
import type { BlockTarget, BlockResult, BlockProgress } from '../../../blacklist';
import { extractCardInfo } from '../../../cardinfo';
import { fetchView, cachedUid } from '../../../api';
import { toast } from '../../toast';
import { confirmModal } from '../../confirm';
import { refreshPanelIfOpen } from '../../hooks';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

export const batchBlockSection: PanelSection = {
  tab: 'tools',
  render(host) {
    const batch = document.createElement('div');
    batch.className = 'sec';
    batch.innerHTML = `<label>批量拉黑</label>
      <button class="act" id="bfb-batch-block" style="width:100%">⛔ 拉黑当前页所有已屏蔽的 UP</button>
      <div class="hint">扫描本页所有被屏蔽的卡片并拉黑其 UP；无法获取 UID 的将通过 BV 号联网解析。此操作写入账号黑名单、不可一键撤销，执行前会二次确认。</div>`;
    host.appendChild(batch);

    q(batch, '#bfb-batch-block').onclick = () => {
      const blocked = document.querySelectorAll('[' + ATTR_BLOCKED + ']');
      if (!blocked.length) {
        toast('当前页还没有被屏蔽的卡片，先用规则屏蔽再批量拉黑');
        return;
      }
      const direct: BlockTarget[] = []; // 卡片直接带 UID
      const toResolve: { bvid: string; name: string }[] = []; // 只有 BV，需联网反查
      let noInfo = 0;
      blocked.forEach((card) => {
        const i = extractCardInfo(card); // 实时重抠，避免首屏缓存空值
        const cu = !i.uid && i.bvid ? cachedUid(i.bvid) : '';
        if (i.uid) direct.push({ uid: String(i.uid), name: i.up || '' });
        else if (cu) direct.push({ uid: cu, name: i.up || '' });
        else if (i.bvid) toResolve.push({ bvid: i.bvid, name: i.up || '' });
        else noInfo++;
      });
      const est = direct.length + toResolve.length;
      if (!est) {
        toast(`本页 ${blocked.length} 张已屏蔽，但都拿不到 UID/BV，无法拉黑`);
        return;
      }
      const slowTip = toResolve.length ? `\n其中 ${toResolve.length} 位需联网解析 UID（稍慢）` : '';
      const skipTip = noInfo ? `\n（${noInfo} 张信息不足已跳过）` : '';

      const runBlacklist = (all: BlockTarget[]) => {
        const btn = q<HTMLButtonElement>(batch, '#bfb-batch-block');
        const origLabel = btn.textContent || '';
        btn.disabled = true;
        toast(`开始拉黑 ${all.length} 位…`);
        doBlacklistMany(
          all,
          (r: BlockResult) => {
            btn.disabled = false;
            btn.textContent = origLabel;
            toast(`批量拉黑完成：新拉黑 ${r.added}，已在黑名单 ${r.already}${r.failed.length ? `，失败 ${r.failed.length}（多为未登录/风控/已满）` : ''}`);
            refreshPanelIfOpen();
          },
          (pg: BlockProgress) => {
            btn.textContent = pg.paused ? `⚠ 风控暂停 ${pg.wait}s · ${pg.done}/${pg.total}` : `拉黑中 ${pg.done}/${pg.total}…`;
          }
        );
      };

      const proceed = () => {
        if (!toResolve.length) {
          runBlacklist(direct);
          return;
        }
        toast(`正在解析 ${toResolve.length} 个 UID…`);
        const resolved: BlockTarget[] = [];
        let pending = toResolve.length;
        toResolve.forEach((t) => {
          fetchView(t.bvid, (d) => {
            if (d && d.owner) resolved.push({ uid: String(d.owner.mid), name: d.owner.name || t.name });
            if (CONFIG.blacklistCollab && d && Array.isArray(d.staff)) {
              d.staff.forEach((s: { mid: number | string; name?: string }) => resolved.push({ uid: String(s.mid), name: s.name || '' }));
            }
            if (--pending === 0) runBlacklist(direct.concat(resolved));
          });
        });
      };

      confirmModal(`将拉黑当前页约 ${est} 位 UP。${slowTip}${skipTip}\n\n会写入账号黑名单且不可一键撤销。`, {
        title: '批量拉黑确认',
        okText: `拉黑约 ${est} 位`,
        danger: true,
      }).then((ok) => {
        if (ok) proceed();
      });
    };
  },
};
