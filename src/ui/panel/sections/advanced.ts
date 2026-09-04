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
    // 三项各自独立、互不依赖：任一命中即屏蔽，不是「同时满足」。
    // 每行两端都可以只填一边（单向阈值），也可以两边都填（区间外屏蔽）。
    num.innerHTML = `<label>数值阈值</label>
      <table class="numgrid">
        <tr><th></th><th>低于则屏蔽</th><th>高于则屏蔽</th></tr>
        <tr>
          <td>播放量</td>
          <td><input type="number" id="bfb-minviews" min="0" step="0.1"><span class="u">万</span></td>
          <td><input type="number" id="bfb-maxviews" min="0" step="0.1"><span class="u">万</span></td>
        </tr>
        <tr>
          <td>点赞数</td>
          <td><input type="number" id="bfb-minlikes" min="0" step="1"><span class="u"></span></td>
          <td><input type="number" id="bfb-maxlikes" min="0" step="1"><span class="u"></span></td>
        </tr>
        <tr>
          <td>时长</td>
          <td><input type="number" id="bfb-dmin" min="0" step="1"><span class="u">秒</span></td>
          <td><input type="number" id="bfb-dmax" min="0" step="1"><span class="u">秒</span></td>
        </tr>
      </table>
      <div class="hint">留空或 0 = 该项不启用。三项<b>各自独立</b>，任一命中即屏蔽；同一行两端都填则表示「区间之外的屏蔽」。<br>⚠ <b>点赞数</b>：B 站的卡片上并不显示点赞数，只有接口才有。所以它在首页/热门这类由接口驱动的信息流里<b>刷新后</b>生效；要让它在所有页面、对已经显示出来的卡片也生效，请打开下方的<b>「精确过滤」</b>（会按需读取视频数据）。</div>`;
    host.appendChild(num);
    const numOpts = { number: true, after: rescanAfterRuleChange };
    bindControl(num, 'bfb-minviews', CONFIG.block, 'minViews', numOpts);
    bindControl(num, 'bfb-maxviews', CONFIG.block, 'maxViews', numOpts);
    bindControl(num, 'bfb-minlikes', CONFIG.block, 'minLikes', { ...numOpts, int: true });
    bindControl(num, 'bfb-maxlikes', CONFIG.block, 'maxLikes', { ...numOpts, int: true });
    bindControl(num, 'bfb-dmin', CONFIG.block, 'minDuration', { ...numOpts, int: true });
    bindControl(num, 'bfb-dmax', CONFIG.block, 'maxDuration', { ...numOpts, int: true });

    const spam = document.createElement('div');
    spam.className = 'sec';
    // 营销号是**复合**条件（低赞率 + 高播放同时成立），跟上面那张表的「各自独立」语义不同，
    // 混在一起会让人以为那些行之间也是「且」。单独一块，语义自明。
    spam.innerHTML = `<label>营销号识别</label>
      <div class="switch" style="font-weight:400">点赞率低于 <input type="number" id="bfb-spamratio" min="0" max="100" step="0.1" style="width:56px"> %
        <b>且</b> 播放量 ≥ <input type="number" id="bfb-spamviews" min="0" step="1" style="width:56px"> 万</div>
      <div class="hint">两个条件<b>同时</b>成立才判为营销号——搬运号常表现为「高播放、极低赞」。填 0 不启用。它同样依赖点赞数，生效条件与上面那条一致。</div>`;
    host.appendChild(spam);
    bindControl(spam, 'bfb-spamratio', CONFIG.block, 'spamLikeRatio', numOpts);
    bindControl(spam, 'bfb-spamviews', CONFIG.block, 'spamMinViews', { ...numOpts, int: true });

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
