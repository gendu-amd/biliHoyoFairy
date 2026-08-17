// @ts-nocheck
// 规则体检：让「我的规则集」本身可被审视。
//
// 用户的规则是一年年攒下来的，攒的过程没有反馈——加了就再也不知道它有没有用。
// 于是两类问题会一直烂在名单里：一条过宽的两字词天天误伤，一条打错字的规则一次都没生效。
// 本区把持久化的规则级命中数摊开：拦得最多的排前面（过宽的嫌疑），观察够久仍零命中的单列（写错的嫌疑），
// 并就地给「✂删」——发现问题和修问题必须在同一个地方，否则用户看完还得去列表里翻。
import { CONFIG } from '../../../config';
import { ruleHealth, pruneRuleStats, OBSERVE_DAYS } from '../../../rulehealth';
import { removeFromList } from '../../../rules';
import { escapeHtml } from '../../../util';
import { toast } from '../../toast';
import { confirmModal } from '../../confirm';

const HOT_N = 5;

export const ruleHealthSection = {
  tab: 'tools',
  render(host, ctx) {
    const sec = document.createElement('div');
    sec.className = 'sec';
    sec.innerHTML = `<label>🩹 规则体检 <button class="act ghost" id="bfb-rh-refresh" style="float:right">刷新</button></label>
      <div class="stat" id="bfb-rh-since"></div>
      <div class="stat" id="bfb-rh-hot" style="margin-top:4px"></div>
      <div id="bfb-rh-dead" style="margin-top:6px"></div>`;
    host.appendChild(sec);
    const sinceEl = sec.querySelector('#bfb-rh-since');
    const hotEl = sec.querySelector('#bfb-rh-hot');
    const deadEl = sec.querySelector('#bfb-rh-dead');

    const render = () => {
      pruneRuleStats(); // 顺手清掉已删规则的遗留计数（否则存档随「加了又删」无界膨胀）
      const h = ruleHealth();

      sinceEl.textContent = h.days
        ? `已观察 ${h.days} 天，共 ${Object.keys(CONFIG.ruleStats || {}).length} 条规则有过命中`
        : '尚未积累命中数据（拦到第一个视频后开始统计）';

      hotEl.innerHTML = h.hot.length
        ? '最常命中：' +
          h.hot
            .slice(0, HOT_N)
            .map((x) => `<span title="命中越多越可能写得过宽">${escapeHtml(x.key)}×${x.n}</span>`)
            .join('  ')
        : '';
      hotEl.style.display = h.hot.length ? '' : 'none';

      deadEl.innerHTML = '';
      // 未启用 ≠ 死规则：联网维度的规则在「精确过滤」关着时根本不会被求值，
      // 把它们混进「从未命中」会诱导用户删掉一批其实没问题的规则。
      if (h.inactive.length) {
        const n = document.createElement('div');
        n.className = 'hint';
        n.textContent = `ℹ ${h.inactive.length} 条标签 / 简介类规则当前不会生效（「精确过滤」未开启），不计入下面的统计。`;
        deadEl.appendChild(n);
      }
      if (!h.ready) {
        const n = document.createElement('div');
        n.className = 'hint';
        n.textContent = h.days
          ? `观察满 ${OBSERVE_DAYS} 天后（还差 ${OBSERVE_DAYS - h.days} 天）才会列出「从未命中」的规则——时间太短，谁都还没命中。`
          : `观察满 ${OBSERVE_DAYS} 天后会在这里列出「从未命中」的规则。`;
        deadEl.appendChild(n);
        return;
      }
      if (!h.dead.length) {
        const n = document.createElement('div');
        n.className = 'hint';
        n.style.color = '#1b7a3d';
        n.textContent = `✅ ${OBSERVE_DAYS} 天内每条规则都命中过，没有明显的死规则。`;
        deadEl.appendChild(n);
        return;
      }
      const title = document.createElement('div');
      title.className = 'hint';
      title.textContent = `⚠ ${h.dead.length} 条规则在这 ${h.days} 天里一次都没命中，可能是写错了、或对象已经不发这类内容了：`;
      deadEl.appendChild(title);
      const list = document.createElement('div');
      list.style.cssText = 'max-height:180px;overflow:auto;overscroll-behavior:contain;margin-top:4px;font-size:12px';
      h.dead.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'log-row';
        const tx = document.createElement('span');
        tx.className = 'log-tx';
        tx.innerHTML = `<span class="log-rs">[${escapeHtml(r.dim)}]</span> ${escapeHtml(r.line)}`;
        tx.title = r.line;
        row.appendChild(tx);
        const del = document.createElement('button');
        del.className = 'log-pass';
        del.textContent = '✂删';
        del.title = '从名单中删除这条规则';
        del.onclick = () => {
          confirmModal({
            title: '删除规则',
            body: `将从「${r.dim}」名单中删除：\n${r.line}`,
            okText: '删除',
            danger: true,
            onOk: () => {
              removeFromList(CONFIG.block[r.field], r.line);
              toast(`已删除规则：${r.line}`);
              ctx.rerender();
            },
          });
        };
        row.appendChild(del);
        list.appendChild(row);
      });
      deadEl.appendChild(list);
    };

    sec.querySelector('#bfb-rh-refresh').onclick = render;
    render();
  },
};
