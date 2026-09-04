// 名单适配器：把不同形状的名单（普通词 / 组合标签 / UP名+UID 合一）适配成 FieldModel。
import { CONFIG, saveConfig, setUidName } from '../../config';
import { addEntries, addToList, clearLists } from '../../rules';
import { splitRuleInput } from '../../match/normalize';
import { fetchCard } from '../../api';
import { toast } from '../toast';
import { NAME_RESOLVE_MAX } from '../../constants';
import type { FieldModel } from './types';

// 本次渲染还能为多少个缺名字的 UID 发请求。放模块级而非穿参：decorate 的签名是公共契约。
let nameBudget = 0;
export function resetNameBudget(): void {
  nameBudget = NAME_RESOLVE_MAX;
}

// 解析出的 UP 名攒批落盘 + 攒批重渲：逐个落盘的话，重渲会把 nameBudget 重置成满额，
// 为还在飞行中的 UID 再发一轮——一批解析能放大成数百个请求 + 数十次全量存盘。
let nameFlushTimer: ReturnType<typeof setTimeout> | null = null;
const NAME_FLUSH_MS = 400;
function scheduleNameFlush(rerender: () => void): void {
  if (nameFlushTimer) clearTimeout(nameFlushTimer);
  nameFlushTimer = setTimeout(() => {
    nameFlushTimer = null;
    saveConfig();
    rerender();
  }, NAME_FLUSH_MS);
}

// 普通 chip 列表（关键词 / BV / 标签 / 白名单…）；groupMode=组合标签。
export function chipModel(arr: string[], groupMode = false, path?: string): FieldModel {
  return {
    count: () => arr.length,
    entries: () => arr.map((v) => ({ key: v, value: v, arr, path })),
    clear: () => {
      clearLists(arr);
    },
    add: (raw: string) => {
      if (groupMode) {
        const parts = raw.split(/[+,，、\s]+/).map((s: string) => s.trim()).filter(Boolean);
        if (parts.length < 2) {
          toast('组合标签至少要 2 个，如：原神 鸣潮');
          return false;
        }
        if (addToList(arr, parts.join('+'))) {
          toast(`已添加组合：${parts.join(' & ')}`);
          return true;
        }
        toast('该组合已存在');
        return false;
      }
      const parts = splitRuleInput(raw);
      if (!parts.length) return false;
      const added = addEntries(parts.map((v) => ({ arr, value: v })));
      if (added) toast(`已添加 ${added} 条${parts.length > added ? `（${parts.length - added} 条已存在）` : ''}`);
      else toast('均已存在，未重复添加');
      return true;
    },
    decorate: (entry, chip, txt) => {
      if (groupMode) chip.classList.add('group');
      txt.textContent = groupMode ? String(entry.value).split('+').join(' & ') : entry.value;
    },
    // 可搜文本 = 存的值 + 显示的值（组合标签存 `a+b`、显示 `a & b`，两种写法都得搜得到）。
    texts: (entry) => (groupMode ? [String(entry.value), String(entry.value).split('+').join(' & ')] : [String(entry.value)]),
  };
}

// 「UP 名 + UID」合一：纯数字→uids，否则→names；UID chip 异步解析显示名。
export function upModel(names: string[], uids: string[], namePath?: string, uidPath?: string): FieldModel {
  return {
    count: () => names.length + uids.length,
    entries: () =>
      names
        .map((v) => ({ key: 'n:' + v, value: v, arr: names, uid: false, path: namePath }))
        .concat(uids.map((v) => ({ key: 'u:' + v, value: v, arr: uids, uid: true, path: uidPath }))),
    clear: () => {
      clearLists(names, uids);
    },
    add: (raw) => {
      const parts = splitRuleInput(raw);
      if (!parts.length) return false;
      const added = addEntries(parts.map((v) => ({ arr: /^\d+$/.test(v) ? uids : names, value: v })));
      toast(added ? `已添加 ${added} 条` : '均已存在，未重复添加');
      return true;
    },
    // UID 条目按数字和解析出的 UP 名都能搜到——用户记得住的是名字，不是一串数字。
    texts: (entry) => (entry.uid ? [String(entry.value), CONFIG.uidNames[String(entry.value)] || ''] : [String(entry.value)]),
    decorate: (entry, chip, txt, rerender) => {
      if (!entry.uid) {
        txt.textContent = entry.value;
        return;
      }
      const nm = CONFIG.uidNames[String(entry.value)];
      txt.textContent = nm || entry.value;
      chip.classList.add('uidchip');
      chip.title = 'UID ' + entry.value + (nm ? '' : nameBudget > 0 ? '（正在解析名称…）' : '（名单过长，本次未解析名称）');
      if (!nm && nameBudget > 0) {
        nameBudget--;
        fetchCard(entry.value, (d) => {
          const name = d && d.card && d.card.name;
          if (name) {
            setUidName(entry.value, name);
            scheduleNameFlush(rerender);
          }
        });
      }
    },
  };
}

// 通用控件绑定器：把「读配置 → 回填控件」与「控件变更 → 存盘 + 回调」收敛到一处。
// 支持 checkbox / select / number。obj 为目标对象（CONFIG / CONFIG.block / CONFIG.comment）。