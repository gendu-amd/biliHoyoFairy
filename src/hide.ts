// 隐藏 / 恢复元素的唯一入口。
//
// 两条都踩过的坑，所以两条都不能用：
//   1. 文档级 class（.bfb-hidden）——GM_addStyle 注入的样式到不了 shadow tree，而评论宿主住在
//      <bili-comments> 的影子树里、界面替换类扩展的卡片也是。对它们那就是个空操作。
//   2. 隐藏后用 removeProperty('display') 恢复——那会把站点原本写在内联上的值一并删掉，
//      自定义元素退回 display:inline，布局直接塌。
// 所以：内联写入 + 原值存档 + 按存档还原。两处影子树内外都成立。

interface Hidable extends HTMLElement {
  __bfbDisp?: { value: string; priority: string } | null;
}

export function hideEl(el: HTMLElement): void {
  const h = el as Hidable;
  if (!h.__bfbDisp) {
    h.__bfbDisp = { value: h.style.getPropertyValue('display'), priority: h.style.getPropertyPriority('display') };
  }
  h.style.setProperty('display', 'none', 'important');
}

export function showEl(el: HTMLElement): void {
  const h = el as Hidable;
  const saved = h.__bfbDisp;
  h.__bfbDisp = null;
  if (!saved) {
    // 没存档 = 我们没藏过它。此时若内联上有 display 那是站点自己的，不能动。
    if (h.style.getPropertyValue('display') === 'none') h.style.removeProperty('display');
    return;
  }
  if (saved.value) h.style.setProperty('display', saved.value, saved.priority);
  else h.style.removeProperty('display');
}

export function isHidden(el: HTMLElement): boolean {
  return el.style.getPropertyValue('display') === 'none';
}
