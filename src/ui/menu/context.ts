// 右键菜单：视频卡 / 评论 / 播放页 UP 三种上下文，共用同一个菜单渲染。
import { CONFIG } from '../../config';
import { PROCESSED } from '../../constants';
import { extractCardInfo } from '../../cardinfo';
import { readCmt } from '../../comments';
import { blockVideo } from '../../dom';
import { blacklistUp } from '../../blacklist';
import { addToList } from '../../rules';
import { toast } from '../toast';
import { refreshPanelIfOpen, openPanel } from '../hooks';
import { findCard, findCommentHost, findVideoPageUp } from './locate';
import { confirmBlacklist } from './shared';

// 播放页 UP 的右键菜单。与卡片菜单的差别：没有「隐藏这一张」（你正在看它，没有卡可隐），
// 屏蔽/拉黑的效果要等下次推荐才看得到，所以文案里说清楚。
function showVideoPageUpMenu(e: MouseEvent): void {
  const info = findVideoPageUp(e);
  if (!info) return;
  const label = info.up || 'UID ' + info.uid;

  e.preventDefault();
  e.stopPropagation();
  closeCtxMenu();

  const items: CtxItem[] = [];
  const sel = selectedText();
  if (sel) {
    items.push({
      label: `🚫 屏蔽含「${sel}」关键词`,
      act: () => {
        addToList(CONFIG.block.keywords, sel);
        toast(`已加入关键词：${sel}`);
        refreshPanelIfOpen();
      },
    });
  }
  items.push({
    label: `🚫 屏蔽 UP「${label}」`,
    act: () => {
      addToList(CONFIG.block.uids, info.uid);
      toast(`已屏蔽 UP：${label}（此后不再向你推荐其视频）`);
      refreshPanelIfOpen();
    },
  });
  items.push({
    label: `⛔ 拉黑 UP「${label}」（同步账号黑名单）`,
    act: () => {
      confirmBlacklist(label).then((ok) => {
        if (ok) blacklistUp(info, refreshPanelIfOpen);
      });
    },
  });
  items.push({
    label: `⭐ 加入白名单（永不屏蔽此 UP）`,
    act: () => {
      addToList(CONFIG.allow.uids, info.uid);
      toast(`已加入白名单：${label}`);
      refreshPanelIfOpen();
    },
  });
  if (info.bvid) {
    items.push({
      label: `🚫 屏蔽此视频（${info.bvid}）`,
      act: () => {
        addToList(CONFIG.block.bvids, info.bvid);
        toast(`已屏蔽视频：${info.bvid}`);
        refreshPanelIfOpen();
      },
    });
  }
  items.push({ label: '⚙️ 打开设置面板', act: openPanel });

  renderCtxMenu(e, items);
}

interface CtxItem {
  label: string;
  act: () => void;
}

let ctxMenuEl: HTMLElement | null = null;
export function closeCtxMenu(): void {
  if (ctxMenuEl) {
    ctxMenuEl.remove();
    ctxMenuEl = null;
  }
}

// 选中文本：过长（多半是误拖选）不作为规则候选。
function selectedText(): string {
  const s = window.getSelection && window.getSelection();
  const t = (s && s.toString().trim()) || '';
  return t.length <= 30 ? t : '';
}

export function onContextMenu(e: MouseEvent): void {
  // 先关掉上一个菜单：下面几条分支都可能直接 return（右键在空白处、拿不到任何信息的卡…），
  // 不先关的话旧菜单会一直挂在屏幕上。
  closeCtxMenu();
  if (!CONFIG.enabled || !CONFIG.rightClickBlock) return;

  // 评论区右键（优先于视频卡）：在评论上右键 → 屏蔽该评论用户 / 选中文本加评论关键词
  if (CONFIG.comment.enabled) {
    const cmtHost = findCommentHost(e);
    if (cmtHost) {
      const c = readCmt(cmtHost);
      const citems: CtxItem[] = [];
      const csel = selectedText();
      if (csel) {
        citems.push({
          label: `🚫 评论含「${csel}」关键词`,
          act: () => {
            addToList(CONFIG.comment.keywords, csel);
            toast(`已加入评论关键词：${csel}`);
            refreshPanelIfOpen();
          },
        });
      }
      if (c.uname) {
        citems.push({
          label: `🚫 屏蔽评论用户「${c.uname}」`,
          act: () => {
            addToList(CONFIG.comment.userNames, c.uname);
            toast(`已屏蔽评论用户：${c.uname}`);
            refreshPanelIfOpen();
          },
        });
      }
      if (citems.length) {
        e.preventDefault();
        e.stopPropagation();
        closeCtxMenu();
        renderCtxMenu(e, citems);
        return;
      }
    }
  }

  const card = findCard(e);
  if (!card) return showVideoPageUpMenu(e); // 不是卡片 → 试试播放页的 UP 信息区
  // 右键为低频用户操作：强制深度提取，确保拿到权威 UID（扫描期缓存可能未解析 UID）
  const info = extractCardInfo(card, true);
  if (!info.up && !info.bvid) return;

  e.preventDefault();
  e.stopPropagation();
  closeCtxMenu();

  const items: CtxItem[] = [];
  const sel = selectedText();
  if (sel) {
    items.push({
      label: `🚫 屏蔽含「${sel}」关键词`,
      act: () => {
        addToList(CONFIG.block.keywords, sel);
        toast(`已加入关键词：${sel}`);
        refreshPanelIfOpen();
      },
    });
  }
  if (info.up) {
    const up = info.up;
    items.push({
      label: `🚫 屏蔽 UP「${up}」`,
      act: () => {
        if (info.uid) addToList(CONFIG.block.uids, info.uid);
        else addToList(CONFIG.block.upNames, up);
        toast(`已屏蔽 UP：${up}`);
        refreshPanelIfOpen();
      },
    });
    items.push({
      label: `⛔ 拉黑 UP「${up}」（同步账号黑名单）`,
      act: () => {
        confirmBlacklist(up).then((ok) => {
          if (ok) blacklistUp(info, refreshPanelIfOpen, card);
        });
      },
    });
    items.push({
      label: `⭐ 加入白名单（永不屏蔽此 UP）`,
      act: () => {
        addToList(CONFIG.allow.upNames, up);
        toast(`已加入白名单：${up}`);
        refreshPanelIfOpen();
      },
    });
  }
  if (info.bvid) {
    const bvid = info.bvid;
    items.push({
      label: `🚫 屏蔽此视频（${bvid}）`,
      act: () => {
        addToList(CONFIG.block.bvids, bvid);
        toast(`已屏蔽视频：${bvid}`);
        refreshPanelIfOpen();
      },
    });
  }
  items.push({
    label: '🙈 隐藏这一张',
    act: () => {
      card.setAttribute(PROCESSED, '1');
      blockVideo(card, '手动', info);
    },
  });
  items.push({ label: '⚙️ 打开设置面板', act: openPanel });

  renderCtxMenu(e, items);
}

// 在鼠标处弹出自定义菜单（视频卡 / 评论 共用）。
function renderCtxMenu(e: MouseEvent, items: CtxItem[]) {
  const menu = document.createElement('div');
  menu.id = 'bfb-ctxmenu';
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'bfb-ctx-item';
    row.textContent = it.label;
    row.onclick = () => {
      closeCtxMenu();
      it.act();
    };
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  menu.style.left = Math.min(e.clientX, window.innerWidth - 270) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px';
  ctxMenuEl = menu;
}
