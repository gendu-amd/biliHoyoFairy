// 评论区分组：总开关 + 各项判定开关 + 三个关键词列表。与视频规则完全独立。
import { CONFIG } from '../../../config';
import { rescanAfterRuleChange } from '../../../dom';
import { bindControl, chipModel, renderListField } from '../../field';
import { q } from '../ctx';
import type { PanelSection } from '../ctx';

export const commentSection: PanelSection = {
  tab: 'comment',
  render(host) {
    const cmt = document.createElement('div');
    cmt.className = 'sec';
    cmt.innerHTML = `
      <label>💬 评论区过滤</label>
      <div class="switch"><input type="checkbox" id="bfb-cmt"> <b>启用评论区过滤</b></div>
      <div class="hint">仅在含评论的页面生效；以下规则与视频黑名单相互独立。</div>
      <div id="bfb-cmt-body" style="margin-top:6px">
        <div class="switch" style="font-weight:400">评论者等级低于 <input type="number" id="bfb-cmt-level" min="0" max="6" style="width:56px"> 级则隐藏（0=不启用）</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-noface"> 隐藏 默认头像且非会员（疑似小号、水军）</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-bot"> 隐藏 AI 机器人发布的评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-callbot"> 隐藏 召唤 AI 的评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-ad"> 隐藏 带货 / 导流广告评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-callonly"> 隐藏 只含 @他人 的空评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-emoji"> 隐藏 纯表情评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-collapse"> 命中后折叠为一行（点击展开），而非直接隐藏</div>
        <label style="margin-top:10px">⭐ 免过滤（白名单）</label>
        <div class="switch"><input type="checkbox" id="bfb-cmt-up"> UP 主的评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-pin"> 置顶评论</div>
        <div class="switch"><input type="checkbox" id="bfb-cmt-me"> 我自己 / @我 的评论</div>
      </div>`;
    host.appendChild(cmt);
    const cmtBody = q(cmt, '#bfb-cmt-body');
    const syncCmtBody = () => {
      cmtBody.style.opacity = CONFIG.comment.enabled ? '1' : '.4';
      cmtBody.style.pointerEvents = CONFIG.comment.enabled ? 'auto' : 'none';
    };
    bindControl(cmt, 'bfb-cmt', CONFIG.comment, 'enabled', {
      after: () => {
        syncCmtBody();
        rescanAfterRuleChange();
      },
    });
    bindControl(cmt, 'bfb-cmt-level', CONFIG.comment, 'minLevel', { number: true, int: true, after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-noface', CONFIG.comment, 'hideNoFace', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-bot', CONFIG.comment, 'hideBot', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-callbot', CONFIG.comment, 'hideCallBot', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-ad', CONFIG.comment, 'hideAd', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-callonly', CONFIG.comment, 'hideCallOnly', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-emoji', CONFIG.comment, 'hideEmojiOnly', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-collapse', CONFIG.comment, 'collapse', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-up', CONFIG.comment, 'allowUp', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-pin', CONFIG.comment, 'allowPin', { after: rescanAfterRuleChange });
    bindControl(cmt, 'bfb-cmt-me', CONFIG.comment, 'allowMe', { after: rescanAfterRuleChange });
    syncCmtBody();

    renderListField(host, {
      label: '🚫 评论关键词',
      placeholder: '如：引战词 或 /.../',
      hint: '评论正文命中即隐藏。普通词为包含匹配，/.../ 为正则。与视频关键词相互独立。',
      model: chipModel(CONFIG.comment.keywords, false, 'comment.keywords'),
    });
    renderListField(host, {
      label: '🚫 评论用户名（精确）',
      placeholder: '精确用户名',
      hint: '按评论者用户名精确隐藏其评论。可在评论区右键用户名快捷加入。',
      model: chipModel(CONFIG.comment.userNames, false, 'comment.userNames'),
    });
    renderListField(host, {
      label: '🚫 用户名关键词',
      placeholder: '如：营销 或 /.../',
      hint: '按评论者昵称关键词隐藏。普通词为包含匹配，/.../ 为正则。',
      model: chipModel(CONFIG.comment.userNameKeywords, false, 'comment.userNameKeywords'),
    });
  },
};
