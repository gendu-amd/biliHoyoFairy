// 进阶分组：数值阈值（播放量/时长/营销号）、信息流加载、精确过滤总开关。
import { CONFIG } from '../../../config';
import { rescanAfterRuleChange } from '../../../dom';
import { bindControl } from '../../field';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

export const advancedSection: PanelSection = {
  tab: 'api',
  render(host) {
    const num = document.createElement('div');
    num.className = 'sec';
    num.innerHTML = `<label>播放量 / 时长</label>
      <div class="switch" style="margin-top:4px;font-weight:400">播放量低于 <input type="number" id="bfb-minviews" min="0" step="0.1" style="width:64px"> 万则屏蔽（0 为不启用）</div>
      <div class="switch" style="margin-top:8px;font-weight:400">时长　最短 <input type="number" id="bfb-dmin" min="0" style="width:64px"> 秒　最长 <input type="number" id="bfb-dmax" min="0" style="width:64px"> 秒</div>
      <div class="switch" style="margin-top:8px;font-weight:400">营销号：点赞率低于 <input type="number" id="bfb-spamratio" min="0" max="100" step="0.1" style="width:56px"> % 且播放量≥ <input type="number" id="bfb-spamviews" min="0" step="1" style="width:56px"> 万则屏蔽</div>
      <div class="hint">填 0 = 不启用。营销号常表现为「高播放、极低赞」；点赞率仅在接口返回点赞数时生效，其余卡片自动跳过。</div>`;
    host.appendChild(num);
    bindControl(num, 'bfb-minviews', CONFIG.block, 'minViews', { number: true, after: rescanAfterRuleChange });
    bindControl(num, 'bfb-dmin', CONFIG.block, 'minDuration', { number: true, int: true, after: rescanAfterRuleChange });
    bindControl(num, 'bfb-dmax', CONFIG.block, 'maxDuration', { number: true, int: true, after: rescanAfterRuleChange });
    bindControl(num, 'bfb-spamratio', CONFIG.block, 'spamLikeRatio', { number: true, after: rescanAfterRuleChange });
    bindControl(num, 'bfb-spamviews', CONFIG.block, 'spamMinViews', { number: true, int: true, after: rescanAfterRuleChange });

    const feed = document.createElement('div');
    feed.className = 'sec';
    feed.innerHTML = `<label>信息流加载</label>
      <div class="switch"><input type="checkbox" id="bfb-boost"> 增大首页推荐每批加载数量</div>
      <div class="hint">每批多取一些视频，删除命中项后信息流更饱满，下次加载生效。<br>⚠ B 站推荐接口大多已带 <b>WBI 签名</b>（签名覆盖全部参数），这类接口上本功能<b>不会生效</b>——脚本跳过改写而不是把请求改坏。</div>`;
    host.appendChild(feed);
    bindControl(feed, 'bfb-boost', CONFIG, 'boostFeedLoad');

    const api = document.createElement('div');
    api.className = 'sec api';
    api.innerHTML = `
      <label>🛰 精确过滤</label>
      <div class="switch"><input type="checkbox" id="bfb-api"> <b>启用精确过滤</b></div>
      <div class="hint">按需读取视频标签、UP 简介等数据来判断，命中时会略有延迟；不开启则完全不联网。</div>
      <div id="bfb-api-body" style="margin-top:6px">
        <div class="switch"><input type="checkbox" id="bfb-charging"> 屏蔽充电专属视频</div>
      </div>`;
    host.appendChild(api);
    const apiBody = q(api, '#bfb-api-body');
    // 未启用精确过滤时把子项置灰禁用：这些开关不联网就不会生效，直接可点会造成「设了没用」的误解
    const syncApiBody = () => {
      apiBody.style.opacity = CONFIG.apiFilters ? '1' : '.4';
      apiBody.style.pointerEvents = CONFIG.apiFilters ? 'auto' : 'none';
    };
    bindControl(api, 'bfb-api', CONFIG, 'apiFilters', {
      after: () => {
        syncApiBody();
        rescanAfterRuleChange();
      },
    });
    bindControl(api, 'bfb-charging', CONFIG, 'hideCharging', { after: rescanAfterRuleChange });
    syncApiBody();
  },
};
