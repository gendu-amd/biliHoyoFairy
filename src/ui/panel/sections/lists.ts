// 纯「列表型字段」分区：黑名单、进阶标签、白名单。
// 字段描述表即扩展点——新增一类列表过滤只要往对应数组加一行。
import { renderFields } from '../../field';
import type { PanelSection } from '../ctx';

const BLACK_FIELDS = [
  { key: 'keywords', label: '🎯 关键词', placeholder: '如：原神 或 /震惊.*竟然/', hint: '匹配标题、UP 主名、分区任一即拦截（纯本地）。普通词为包含匹配，/.../ 为正则。可加前缀限定字段：title: / up: / part:。按视频标签拦截请用下方「视频标签」。' },
  { kind: 'up', label: 'UP 主', hint: '输入 UP 名 或 UID（纯数字自动识别为 UID）；可一次粘贴多条，用逗号或换行分隔。' },
  { key: 'bvids', label: 'BV 号', placeholder: '如：BV1xx411c7XX', hint: '按视频 BV 号精确屏蔽单个视频。' },
  { key: 'partitions', label: '视频分区', placeholder: '如：资讯 或 /综艺|娱乐/', hint: '按视频分区（tname）屏蔽，网络拦截层判定最准。普通词为包含匹配，以 /.../ 包裹为正则。' },
];

const API_CHIP_FIELDS = [
  { key: 'tags', label: '视频标签', placeholder: '如：原神 或 /鬼畜|二创/', hint: '匹配视频的完整标签（tag），需开启上方「精确过滤」。普通词为包含匹配，以 /.../ 包裹为正则。' },
  { key: 'dualTags', label: '组合标签', placeholder: '如：原神 鸣潮（空格分隔）', groupMode: true, hint: '同时含这一组里所有标签才屏蔽，专治对立引战内容；需开启「精确过滤」。' },
  { key: 'upBio', label: 'UP 简介关键词', placeholder: '如：商务合作', hint: '匹配 UP 主个人简介，需开启「精确过滤」。' },
];

const ALLOW_FIELDS = [
  { scope: 'allow', key: 'keywords', label: '关键词', placeholder: '喜欢的题材', hint: '命中即永不隐藏（优先级最高）。作用于视频标题与 UP 主名；普通词为包含匹配，/.../ 为正则。' },
  { scope: 'allow', key: 'upNames', label: 'UP 主名', placeholder: '喜欢的 UP 主名', hint: '该 UP 的视频永不隐藏（按名称精确匹配）。' },
  { scope: 'allow', key: 'uids', label: 'UID', placeholder: '喜欢的 UP 的 UID（纯数字）', hint: '该 UP 的视频永不隐藏（按 UID 精确匹配，最可靠）。' },
];

export const blackListsSection: PanelSection = {
  tab: 'black',
  render: (host) => renderFields(host, BLACK_FIELDS),
};

// 进阶页的标签类字段：排在数值/开关分区之后（注册顺序即渲染顺序）。
export const apiListsSection: PanelSection = {
  tab: 'api',
  render: (host) => renderFields(host, API_CHIP_FIELDS),
};

export const allowListsSection: PanelSection = {
  tab: 'allow',
  render: (host) => renderFields(host, ALLOW_FIELDS),
};
