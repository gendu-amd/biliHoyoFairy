// 屏蔽记录 + 底部累计计数。命中记账后由 stats 监听器经 ctx.setStatsRefresh 注册的刷新器实时更新，
// 三处显示（头部条数 / 分类统计 / 底部累计）共用同一个 refreshLog，避免对不上。
import { CONFIG } from '../../../config';
import { BLACKLIST_MANAGE_URL } from '../../../constants';
import { blockedLog, tallyLog, sessionBlocked } from '../../../stats';
import { blacklistUp, unblockUp } from '../../../blacklist';
import { addToList, removeFromList, restoreToList } from '../../../rules';
import { locateRule, REASON_RULE_FIELD } from '../../../match/engine';
import { ruleLines } from '../../../match/normalize';
import { escapeHtml } from '../../../util';
import { toast } from '../../toast';
import { confirmModal } from '../../confirm';
import { refreshPanelIfOpen } from '../../hooks';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

export const logSection: PanelSection = {
  tab: 'tools',
  render(host, ctx) {
    const logSec = document.createElement('div');
    logSec.className = 'sec';
    logSec.innerHTML =
      `<label>🔎 屏蔽记录（本次会话共 <span id="bfb-log-count">0</span> 条） <button class="act ghost" id="bfb-log-toggle" style="float:right">展开 / 收起</button></label>` +
      `<div class="stat" id="bfb-log-tally">分类：暂无</div>` +
      `<div id="bfb-log-list" style="display:none;max-height:240px;overflow:auto;overscroll-behavior:contain;margin-top:6px;font-size:12px"></div>`;
    host.appendChild(logSec);
    const logList = q(logSec, '#bfb-log-list');
    const logCount = q(logSec, '#bfb-log-count');
    const logTally = q(logSec, '#bfb-log-tally');

    const foot = document.createElement('div');
    foot.className = 'sec';
    foot.innerHTML = `<a class="manage" href="${BLACKLIST_MANAGE_URL}" target="_blank">→ 打开 B 站官方黑名单管理页（取消拉黑 / 查看人数）</a>
      <div class="stat" style="margin-top:6px">累计拦截 <span id="bfb-foot-total">0</span> 次 · 本次会话 <span id="bfb-foot-session">0</span> 次</div>`;
    host.appendChild(foot);
    const footTotal = q(foot, '#bfb-foot-total');
    const footSession = q(foot, '#bfb-foot-session');

    // 头部计数/分类/列表 三者用同一函数刷新，命中时实时更新，避免对不上
    const refreshLog = () => {
      logCount.textContent = String(blockedLog.length);
      const tally = tallyLog();
      logTally.textContent =
        '分类：' + (Object.keys(tally).length ? Object.entries(tally).map(([k, v]) => `${k}×${v}`).join('  ') : '暂无');
      footTotal.textContent = String(CONFIG.blockedCount);
      footSession.textContent = String(sessionBlocked);
      if (logList.style.display === 'none') return;
      logList.innerHTML = '';
      if (!blockedLog.length) {
        logList.innerHTML = '<div class="stat">暂无记录</div>';
        return;
      }
      // 「这个 UID 在不在黑名单里」每行都要判一次，建一次 Set 给所有行共用。
      // 走 ruleLines 而不是 .map(String)：字段被写坏时 .map 会直接抛，把整个记录面板打空。
      const blacklisted = new Set(ruleLines(CONFIG.block.uids));
      blockedLog.slice(0, 100).forEach((b) => {
        const row = document.createElement('div');
        row.className = 'log-row';
        const tx = document.createElement('span');
        tx.className = 'log-tx';
        // 标题缺失（常见于广告卡）时退而显示 落地页 / BV / UID，至少能辨识拦了什么
        const desc =
          b.title ||
          (b.link ? b.link.replace(/^https?:\/\//, '').slice(0, 48) : '') ||
          b.bvid ||
          (b.uid ? 'UID ' + b.uid : '') ||
          '(无可辨识信息)';
        const srcTag =
          b.src === 'BL'
            ? '<span class="log-src net">黑</span>'
            : b.src === 'NET'
            ? '<span class="log-src net">拦</span>'
            : b.src === 'CMT'
            ? '<span class="log-src dom">评</span>'
            : '<span class="log-src dom">隐</span>';
        // 超链接：UP 名 → 空间页（有 UID 才链）；标题/描述 → 视频页（有 BV 用 BV，否则用落地页，仅 http(s)）。
        // 跳转 URL 经 encodeURIComponent / 白名单 http(s) 校验 + escapeHtml 属性转义，杜绝 javascript: 等注入。
        const safeHttp = (u: string) => (u && /^https?:\/\//i.test(u) ? u : '');
        const upHref = b.uid ? 'https://space.bilibili.com/' + encodeURIComponent(b.uid) : '';
        const vidHref = b.bvid ? 'https://www.bilibili.com/video/' + encodeURIComponent(b.bvid) : safeHttp(b.link);
        const A = (href: string, inner: string) => `<a class="log-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
        const upHtml = b.up ? (upHref ? A(upHref, '<b>' + escapeHtml(b.up) + '</b>') : '<b>' + escapeHtml(b.up) + '</b>') + ' · ' : '';
        const descHtml = vidHref ? A(vidHref, escapeHtml(desc)) : escapeHtml(desc);
        tx.innerHTML = `${srcTag}<span class="log-rs">[${escapeHtml(b.reason)}]</span> ${upHtml}${descHtml}`;
        // hover 显示完整信息（标题常被截断，便于二次确认是否拉黑）：UP · 完整标题 · BV，附落地页
        tx.title =
          (b.up ? b.up + ' · ' : '') +
          (b.title || desc) +
          (b.bvid ? '  ·  ' + b.bvid : '') +
          (b.uid ? '  ·  UID ' + b.uid : '') +
          (b.link ? '\n' + b.link : '');
        row.appendChild(tx);
        // 放行（撤销/防误伤）：把该 UP 加白名单，永不再拦。DOM 隐藏的立刻恢复；网络拦截删掉的需刷新页面。
        if (b.up || b.uid) {
          const pass = document.createElement('button');
          pass.className = 'log-pass';
          pass.textContent = '✅放行';
          pass.title = '误伤了？把该 UP 加入白名单（永不屏蔽）。DOM 隐藏的会立即恢复，网络拦截删除的刷新后恢复。';
          pass.onclick = () => {
            if (b.uid) addToList(CONFIG.allow.uids, b.uid);
            else addToList(CONFIG.allow.upNames, b.up);
            toast(`已放行并加入白名单：${b.up || 'UID ' + b.uid}`);
            refreshPanelIfOpen();
          };
          row.appendChild(pass);
        }
        // 误伤自愈：原因里带了具体规则时，直接定位到那一行并删。
        // 上面的「放行」只赦免这一个 UP，规则本身还会继续误伤别人——关键词类误伤的病灶
        // 通常是规则写得太宽（比如一个两字词），治标不治本。
        // 已写入账号黑名单（BL 来源且该 UID 仍在 block.uids）→ 下面会给「撤销拉黑」。
        // 走 ruleLines 而不是 .map(String)：名单字段被写成非数组时 .map 会直接抛，把整个屏蔽记录面板打空。
        const isBlacklisted = b.uid && blacklisted.has(String(b.uid));
        // 这种行不给「删规则」：它只删本地那条 UID 规则，**不会**把人从账号黑名单移出，
        // 与旁边的「撤销拉黑」看着像但语义不同，同一行摆两个含义不同的撤销按钮必然误操作。
        const loc = b.src === 'BL' && isBlacklisted ? null : locateRule(b.reason);
        if (loc) {
          const del = document.createElement('button');
          del.className = 'log-pass';
          del.textContent = '✂删规则';
          del.title = `这条是被规则「${loc.line}」拦下的。删掉它（刷新后此类视频恢复推荐）。`;
          del.onclick = () => {
            confirmModal(`删除规则「${loc.line}」？此后它不再屏蔽任何视频。`, { title: '删除规则', okText: '删除', danger: true }).then((ok) => {
              if (!ok) return;
              const arr = CONFIG.block[loc.field];
              const at = arr.indexOf(loc.line);
              removeFromList(arr, loc.line);
              // 误删规则比误拉黑常见得多，而拉黑早就有撤销了
              toast(`已删除规则：${loc.line}`, 'info', {
                label: '撤销',
                onClick: () => {
                  restoreToList(arr, loc.line, at);
                  refreshPanelIfOpen();
                },
              });
              refreshPanelIfOpen();
            });
          };
          row.appendChild(del);
        } else if (b.reason.indexOf(':') > 0 && REASON_RULE_FIELD[b.reason.slice(0, b.reason.indexOf(':'))]) {
          // 维度认得、但规则不在用户名单里 → 来自已启用的订阅。不给删除按钮（删不掉），
          // 但要说清楚，否则用户会在自己的名单里翻半天找不到这条规则。
          const hint = document.createElement('span');
          hint.className = 'log-src';
          hint.textContent = '订阅';
          hint.title = '这条规则来自已启用的订阅，不在你自己的名单里。要停用它请到「工具 → 规则订阅」。';
          row.appendChild(hint);
        }
        // 已写入账号黑名单 → 提供「撤销拉黑」；否则提供「拉黑」。
        if (b.src === 'BL' && isBlacklisted) {
          const undo = document.createElement('button');
          undo.className = 'log-undo';
          undo.textContent = '↩撤销';
          undo.title = '撤销拉黑：账号侧移出黑名单 + 本地恢复（刷新后该 UP 恢复推荐）';
          undo.onclick = () => {
            confirmModal(`撤销拉黑「${b.up || 'UID ' + b.uid}」？将移出账号黑名单，刷新后恢复推荐。`, { title: '撤销拉黑', okText: '撤销' }).then((ok) => {
              if (!ok) return;
              undo.disabled = true;
              undo.textContent = '…';
              unblockUp(String(b.uid), b.up, () => refreshLog());
            });
          };
          row.appendChild(undo);
        } else if (b.up || b.uid || b.bvid) {
          const blk = document.createElement('button');
          blk.className = 'log-blk';
          blk.textContent = '⛔拉黑';
          blk.title = '拉黑该 UP（同步账号黑名单）';
          blk.onclick = () => {
            confirmModal(`确定拉黑「${b.up || 'UID ' + b.uid || b.bvid}」并写入账号黑名单？\n刷新后不再推荐、不可一键撤销（可在此处「撤销」恢复）。`, {
              title: '拉黑确认',
              okText: '拉黑',
              danger: true,
            }).then((ok) => {
              if (!ok) return;
              blk.disabled = true;
              blk.textContent = '…';
              blacklistUp({ up: b.up, uid: b.uid, bvid: b.bvid }, () => refreshLog());
            });
          };
          row.appendChild(blk);
        }
        logList.appendChild(row);
      });
    };
    q(logSec, '#bfb-log-toggle').onclick = () => {
      logList.style.display = logList.style.display === 'none' ? 'block' : 'none';
      refreshLog();
    };
    ctx.setStatsRefresh(refreshLog);
    refreshLog();
  },
};
