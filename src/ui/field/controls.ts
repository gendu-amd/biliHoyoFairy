// 开关/数值控件绑定，以及「按描述表渲染一组列表字段」——新增一类过滤 = 表里加一行。
import { CONFIG, saveConfig } from '../../config';
import { chipModel, upModel } from './models';
import { renderListField } from './list';

// 支持 checkbox / select / number。obj 为目标对象（CONFIG / CONFIG.block / CONFIG.comment）。
export interface BindOpts {
  number?: boolean; // 按数字读写
  int?: boolean; // 配合 number：取整
  after?: () => void; // 存盘后的副作用（多为重扫）
}

// 泛型绑定：key 必须是 obj 上真实存在的字段名——写错字段名过去只是「开关点了没反应」，现在编译期就报。
export function bindControl<T extends object, K extends keyof T & string>(root: Element | Document, id: string, obj: T, key: K, opts: BindOpts = {}): void {
  const el = root.querySelector<HTMLInputElement | HTMLSelectElement>('#' + id);
  if (!el) return; // 该控件不在本次渲染的分区里（分区可按开关裁剪），静默跳过
  const isCheck = el instanceof HTMLInputElement && el.type === 'checkbox';
  if (isCheck) el.checked = !!obj[key];
  else el.value = obj[key] != null ? String(obj[key]) : opts.number ? '0' : '';
  el.onchange = () => {
    let v: unknown;
    if (isCheck) v = (el as HTMLInputElement).checked;
    else if (opts.number) v = (opts.int ? parseInt(el.value, 10) : parseFloat(el.value)) || 0;
    else v = el.value;
    // 唯一的断言点：控件类型由调用方按字段类型选定（数字字段配 number:true、布尔字段配 checkbox），
    // 类型系统跟不到这层对应关系。收敛在这一处，好过每个调用点各写一次。
    obj[key] = v as T[K];
    saveConfig();
    if (opts.after) opts.after();
  };
}

// 列表型字段的描述表条目。kind:'up' 是唯一的特例（UP 名与 UID 合成一个字段）。
export interface FieldDef {
  label: string;
  kind?: 'up';
  scope?: 'allow';
  key?: string; // CONFIG.block / CONFIG.allow 下的名单数组字段名
  placeholder?: string;
  hint?: string;
  groupMode?: boolean;
}

// 描述表里的 key 取出对应的名单数组。取不到（写错字段名 / 指到了阈值字段）是编程错误：
// 直接抛，而不是渲染出一个空列表让用户以为「我的词都没了」。
function listOf(obj: object, key: string | undefined): string[] {
  const v = key ? (obj as unknown as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(v)) throw new Error('[bfb] 字段描述表的 key 不是名单数组: ' + key);
  return v as string[];
}

// 按描述表渲染一组「列表型」字段（黑/白名单等），新增过滤项 = 表里加一行。
export function renderFields(host: HTMLElement, defs: FieldDef[]): void {
  defs.forEach((f) => {
    if (f.kind === 'up') {
      renderListField(host, {
        label: f.label,
        hint: f.hint,
        placeholder: '输入 UP 名 或 UID（纯数字自动识别）',
        inputTitle: '可一次粘贴多条，用逗号或换行分隔；纯数字按 UID，其余按 UP 名',
        model: upModel(CONFIG.block.upNames, CONFIG.block.uids, 'block.upNames', 'block.uids'),
      });
      return;
    }
    const arr = listOf(f.scope === 'allow' ? CONFIG.allow : CONFIG.block, f.key);
    renderListField(host, {
      label: f.label,
      hint: f.hint,
      placeholder: f.placeholder,
      isAllow: f.scope === 'allow',
      inputTitle: f.groupMode ? '输入一组标签，用空格或逗号分隔，表示同时含这些标签才拦' : '可一次粘贴多条，用逗号或换行分隔',
      model: chipModel(arr, f.groupMode, `${f.scope === 'allow' ? 'allow' : 'block'}.${f.key}`),
    });
  });
}
