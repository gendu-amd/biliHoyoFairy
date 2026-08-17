// @ts-nocheck
// 入口 bootstrap：在 document-start 安装拦截层 + shadow 钩子，文档就绪后启动 DOM 兜底/评论扫描，
// 接线各模块的注入 seam（面板回调 / stats 监听 / 规则变更 / 卡片检测开关），注册菜单命令与 MutationObserver。
// 业务逻辑全部在各 src 模块；本文件只负责装配。仍保留 @ts-nocheck（事件 glue，渐进类型化），但受 eslint(no-undef) 约束。
// bootstrap 只依赖各模块的「入口/接线」符号；其余模块经依赖图传递性加载（无需在此直接 import）。
import { VERSION, BLACKLIST_MANAGE_URL } from './constants';
import { CONFIG, saveConfig } from './config';
import { safe, logErr, BADGE } from './logging';
import { healthReport } from './health';
import { configureCardDetect } from './cardinfo';
import { pageType } from './page';
import { installNetworkHooks } from './net';
import { shadowRoots, harvestShadowRoots } from './shadow';
import { sessionBlocked, tallyLog, setStatsListener } from './stats';
import { updateBadge, toast } from './ui/toast';
import { setPanelHooks } from './ui/hooks';
import { refreshSubscriptions } from './subscriptions/refresh';
import { setRulesChangedHandler } from './events';
import { CMT_TAGS, scanComments, scheduleCommentScan } from './comments';
import { applyHotSearchStyle } from './hotsearch';
import { scanAll, rescanAfterRuleChange } from './dom';
import { startScanner } from './scanner';
import { onContextMenu, onCardHover, hideHoverBtn } from './ui/menu';
import { openPanel, refreshPanelIfOpen, refreshStatsIfOpen } from './ui/panel';
/*
 * 架构（拦截优先 + DOM 兜底）：
 *   1. 拦截层（主）：document-start 时 hook fetch / XHR，被动过滤 B 站自身请求的 JSON 列表
 *      （首页推荐 / 排行榜 / 热门 / 播放页相关推荐），命中规则的项直接从数组删掉，
 *      页面只渲染保留项 → 无遮罩、无留白、无闪烁，且不重发请求、不需 WBI、不触发风控。
 *   2. DOM 兜底（薄）：处理拦截层覆盖不到的部分——首屏 SSR 漏网、需联网取数的进阶维度
 *      （标签 / UP简介 / 等级）、搜索热搜词。命中即安全隐藏整张卡（不留洞）。
 *   3. 同一套规则：拦截层与 DOM 层共用 matchRule + 维度注册表，数据源不同、判定一致。
 *   4. 彻底移除：一键拉黑写入账号黑名单，刷新后不再被推荐。
 */
(function () {
  'use strict';

  /* ===================== 1. 注入 seam 接线 ===================== */
  // 匹配引擎 ./match/engine 在自身模块加载时已绑定 fuzzy 取值器并构建首个 M；
  // 此处仅把卡片广告/直播检测开关注入 ./cardinfo（保持 cardinfo 不直接依赖 CONFIG）。
  configureCardDetect(() => ({ detectAd: CONFIG.hideAd, detectLive: CONFIG.hideLiveCard }));
  // 注入 UI 回调桥：低层模块（stats 等）经此回调到面板/角标，避免 import 面板成环。
  setPanelHooks({
    refreshPanelIfOpen: () => refreshPanelIfOpen(),
    openPanel: () => openPanel(),
  });
  // stats 命中记账后回调：更新角标 + 面板打开时刷新计数（document.body 未就绪时跳过角标）。
  setStatsListener(() => {
    if (document.body) updateBadge();
    refreshStatsIfOpen();
  });
  // 规则变更 seam：rules / subscriptions 发事件，这里落到 DOM 层的重建+重扫（打断 dom↔rules 环）。
  setRulesChangedHandler(() => rescanAfterRuleChange());

  /* ===================== 2. shadow 钩子（依赖 comments/shadow，故留在 bootstrap） ===================== */
  // hook Element.prototype.attachShadow：把页面创建的每个开放 shadowRoot 收进注册表（评论组件定位、卡片穿透共用）。
  // 必须在 document-start 安装，先于 B 站构建评论 Web Component。借鉴 bilibili-cleaner Shadow.hook。
  function installShadowHook() {
    if (Element.prototype.attachShadow.__bfb) return;
    const orig = Element.prototype.attachShadow;
    const wrapped = function (init) {
      const root = orig.call(this, init);
      try {
        shadowRoots.add(root);
        if (CMT_TAGS[this.tagName] !== undefined) scheduleCommentScan();
      } catch (e) {
        logErr('attachShadow.hook', e); // 记录但不吞掉原生行为：下面照常返回 root
      }
      return root;
    };
    wrapped.__bfb = true;
    try {
      Element.prototype.attachShadow = wrapped;
    } catch (e) {
      logErr('installShadowHook', e); // 装不上=评论过滤与 shadow 内卡片穿透失效，必须可见
    }
  }

  /* ===================== 3. 启动 ===================== */
  function start() {
    console.log(
      `%c[biliHoyoFairy]%c v${VERSION} 已启动 | 页面:${pageType()} | 拦截:${CONFIG.enabled ? '开' : '关'}${CONFIG.debug ? ' | 调试' : ''}`,
      BADGE + ';font-weight:bold',
      'color:#fb7299'
    );
    updateBadge();
    applyHotSearchStyle();
    harvestShadowRoots(document);
    scanAll();
    scanComments();
    // 订阅：用缓存先生效（buildMatchers 已并入），再按 expires 后台刷新（到期才拉，完成自动重扫）
    refreshSubscriptions(false);
    // 事件处理全部走错误边界，单次异常不致让监听器静默失效
    document.addEventListener('contextmenu', safe('onContextMenu', onContextMenu), true);
    document.addEventListener('mouseover', safe('onCardHover', onCardHover), true);
    document.addEventListener('scroll', safe('hideHoverBtn', hideHoverBtn), true);

    // 信息流的增量扫描由 ./scanner 负责，且早在 document-start 就已装好（首屏 SSR 的卡
    // 必须在解析出来的当帧判定，等到这里就已经画在屏幕上了）。此处不再另装观察器。

    // 首屏稳定后弹一次「本次拦截」汇总：让你确认脚本真的在干活（区别于 B 站随机换批）
    setTimeout(() => {
      if (!CONFIG.enabled) return;
      // 运行自检：B 站换接口/换类名会让脚本静默失效（照常运行、什么都不拦）。
      // 只在控制台报警、不弹 toast——误报的代价是骚扰所有人，而排查的人一定会看控制台。
      for (const w of healthReport()) logErr('运行自检', w);
      if (sessionBlocked <= 0) return;
      const top = Object.entries(tallyLog())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k}×${v}`)
        .join('、');
      toast(`🛡 本次加载已拦截 ${sessionBlocked} 个：${top}（点右下角🛡看明细 / 放行）`);
    }, 3500);

    GM_registerMenuCommand('打开设置面板', openPanel);
    GM_registerMenuCommand('暂停/启用拦截', () => {
      CONFIG.enabled = !CONFIG.enabled;
      saveConfig();
      updateBadge();
      if (CONFIG.enabled) scanAll();
    });
    GM_registerMenuCommand('打开官方黑名单管理页', () => window.open(BLACKLIST_MANAGE_URL, '_blank'));
  }

  // 拦截层必须尽早安装（document-start，先于页面脚本发起请求 / 构建评论组件）
  installNetworkHooks();
  installShadowHook();
  // DOM 兜底层的**扫描**同样要尽早：首页首屏是 SSR，卡片由解析器一张张吐出来，
  // 拦截层（改 JSON）够不着，等 DOMContentLoaded 再扫它们早就绘制出来了。
  // 只隐藏肯定命中的卡，故不存在「脚本挂了 → 空白首页」的失败模式。
  startScanner();

  // 其余 DOM 相关启动（事件监听 / 评论 / 菜单 / 汇总）延迟到文档就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
