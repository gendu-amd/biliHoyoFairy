// 列表字段组件的公共契约：组件只认这几个形状，新增一类名单 = 写一个 model，不动组件。

export interface FieldEntry {
  key: string;
  value: string;
  arr: string[]; // 该条所属的底层数组（删除时直接操作它）
  uid?: boolean;
  /** 该条在配置里的名单路径（如 'block.keywords'），停用状态按它索引。缺省则不提供停用按钮。 */
  path?: string;
}

/** 列表字段的数据适配器。组件只认这个接口——新增一类名单 = 写一个 model，不动组件。 */
export interface FieldModel {
  count(): number;
  entries(): FieldEntry[];
  clear(): void;
  /** 返回 false 表示没添加成功（输入为空/校验不过），调用方据此不清空输入框。 */
  add(raw: string): boolean;
  decorate(entry: FieldEntry, chip: HTMLElement, txt: HTMLElement, rerender: () => void): void;
  /** 可搜文本，缺省取 value。见 listfilter.ts。 */
  texts?(entry: FieldEntry): string[];
}

export interface ListFieldOpts {
  label: string;
  model: FieldModel;
  hint?: string;
  placeholder?: string;
  inputTitle?: string;
  isAllow?: boolean;
}

// 规则语法速查（写死的静态文案，不含用户数据，可直接 innerHTML）。