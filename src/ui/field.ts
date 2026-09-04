// 列表字段组件的对外门面。四块各自成文件：
//   types    —— FieldEntry / FieldModel / ListFieldOpts 契约
//   models   —— 名单适配器（普通词 / 组合标签 / UP名+UID 合一）
//   list     —— renderListField：折叠头 / 添加行 / 搜索 / 批量管理 / chip 渲染
//   controls —— bindControl 与按描述表渲染字段
export type { FieldEntry, FieldModel, ListFieldOpts } from './field/types';
export { chipModel } from './field/models';
export { renderListField } from './field/list';
export { bindControl, renderFields } from './field/controls';
export type { BindOpts, FieldDef } from './field/controls';
