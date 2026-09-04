// 右键菜单 + 悬停浮层的对外门面。三块各自成文件：
//   locate  —— 从鼠标事件定位视频卡 / 评论宿主 / 播放页 UP（composedPath，穿 shadow）
//   context —— 右键菜单
//   hover   —— 悬停快捷操作浮层
export { onContextMenu } from './menu/context';
export { onCardHover, hideHoverBtn } from './menu/hover';
