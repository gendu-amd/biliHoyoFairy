// 右键菜单与悬停浮层共用的小件。
import { confirmModal } from '../confirm';

// 账号拉黑不可一键撤销，且与「本地屏蔽」相邻、易误点 → 执行前二次确认。
export function confirmBlacklist(name: string): Promise<boolean> {
  return confirmModal(`确定拉黑「${name}」并写入账号黑名单？\n刷新后不再推荐、不可一键撤销（未登录则仅本地屏蔽）。`, {
    title: '拉黑确认',
    okText: '拉黑',
    danger: true,
  });
}
