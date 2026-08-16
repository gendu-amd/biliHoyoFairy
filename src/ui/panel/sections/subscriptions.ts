// @ts-nocheck
// 规则订阅：从 URL 自动拉取并合并黑名单。订阅只并入黑名单维度，不碰白名单与开关。
import { CONFIG, saveConfig } from '../../../config';
import { rescanAfterRuleChange } from '../../../dom';
import { escapeHtml } from '../../../util';
import { refreshSubscriptions, syncSubscription, metaGet } from '../../../subscriptions/refresh';
import { loadSubStore, saveSubStore } from '../../../subscriptions/store';
import { toast } from '../../toast';
import { confirmModal } from '../../confirm';

export const subscriptionsSection = {
  tab: 'tools',
  render(host) {
    const subSec = document.createElement('div');
    subSec.className = 'sec';
    subSec.innerHTML = `<label>规则订阅（从 URL 自动拉取并合并黑名单）</label>
      <div class="addrow"><input type="text" id="bfb-sub-url" placeholder="订阅 URL（JSON 或文本，如 GitHub raw）"></div>
      <div class="addrow" style="margin-top:6px"><input type="text" id="bfb-sub-name" placeholder="备注名（可选）"><button id="bfb-sub-add">添加</button></div>
      <div class="hint">订阅只并入<b>黑名单</b>（UID、UP 主名、关键词、分区、标签、简介、BV 号），不影响你的白名单与开关；启用后按声明周期自动刷新。自建 / 共享名单见仓库 examples/ 模板。</div>
      <div class="toolbar" style="margin-top:8px"><button class="act ghost" id="bfb-sub-refresh">🔄 全部刷新</button></div>
      <div id="bfb-sub-list" style="margin-top:8px"></div>`;
    host.appendChild(subSec);

    const subListEl = subSec.querySelector('#bfb-sub-list');
    const fmtSubTime = (t) => (t ? new Date(t).toLocaleString() : '从未');
    const renderSubList = () => {
      subListEl.innerHTML = '';
      const store = loadSubStore();
      const subs = CONFIG.subscriptions || [];
      if (!subs.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.textContent = '（暂无订阅，添加 URL 后会显示在这里）';
        subListEl.appendChild(e);
        return;
      }
      subs.forEach((sub, idx) => {
        const e = store[sub.url] || {};
        const status = e.ok ? `✅ ${e.count || 0} 条 · ${fmtSubTime(e.lastSync)}` : e.error ? `⚠ ${e.error}` : '未同步';
        const row = document.createElement('div');
        row.className = 'bfb-sub-row';
        row.innerHTML = `
          <label class="switch" style="margin:0"><input type="checkbox" class="sub-en" ${sub.enabled ? 'checked' : ''}> <b>${escapeHtml(sub.name || metaGet(e.meta, 'title') || '订阅')}</b></label>
          <div class="bfb-sub-url">${escapeHtml(sub.url)}</div>
          <div class="bfb-sub-status">${escapeHtml(status)}</div>
          <div class="chip-bar"><button class="chip-act sub-refresh">刷新</button><button class="chip-act sub-del">删除</button></div>`;
        row.querySelector('.sub-en').onchange = (ev) => {
          sub.enabled = ev.target.checked;
          saveConfig();
          rescanAfterRuleChange();
        };
        row.querySelector('.sub-refresh').onclick = () => {
          toast('刷新中…');
          syncSubscription(sub.url, (ok) => {
            rescanAfterRuleChange();
            renderSubList();
            toast(ok ? '已刷新' : '刷新失败');
          });
        };
        row.querySelector('.sub-del').onclick = () => {
          confirmModal('删除该订阅？其规则将立即移除。', { title: '删除订阅', okText: '删除', danger: true }).then((ok) => {
            if (!ok) return;
            CONFIG.subscriptions.splice(idx, 1);
            const st = loadSubStore();
            delete st[sub.url];
            saveSubStore(st);
            saveConfig();
            rescanAfterRuleChange();
            renderSubList();
          });
        };
        subListEl.appendChild(row);
      });
    };
    renderSubList();

    subSec.querySelector('#bfb-sub-add').onclick = () => {
      const urlEl = subSec.querySelector('#bfb-sub-url');
      const nameEl = subSec.querySelector('#bfb-sub-name');
      const url = (urlEl.value || '').trim();
      const name = (nameEl.value || '').trim();
      if (!/^https?:\/\//i.test(url)) return toast('请输入有效的 http(s) URL');
      if ((CONFIG.subscriptions || []).some((s) => s.url === url)) return toast('该订阅已存在');
      CONFIG.subscriptions = CONFIG.subscriptions || [];
      CONFIG.subscriptions.push({ url, name, enabled: true });
      saveConfig();
      urlEl.value = '';
      nameEl.value = '';
      renderSubList();
      toast('已添加，正在拉取…');
      syncSubscription(url, (ok) => {
        rescanAfterRuleChange();
        renderSubList();
        toast(ok ? '订阅已同步' : '拉取失败，请检查 URL');
      });
    };
    subSec.querySelector('#bfb-sub-refresh').onclick = () => {
      toast('刷新全部订阅…');
      refreshSubscriptions(true, (n) => {
        renderSubList();
        toast(`已刷新（${n} 条有更新）`);
      });
    };
  },
};
