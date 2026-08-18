// 名单搜索的判定部分。刻意与渲染分开：本仓库不引 jsdom，逻辑留在 DOM 代码里就等于没测，
// 而「搜索该怎么算匹配」恰恰是这类功能唯一会出错的地方（大小写、正则写到一半、UID 显示名）。
//
// 语法与名单里的规则保持一致：普通词=包含（忽略大小写），/.../ =正则。用户已经在关键词框里
// 学过这套写法，搜索框再发明第二套只会让人猜。

// 返回 null 表示「没有筛选」——调用方据此走原样渲染的快路径，而不是拿一个恒真谓词过一遍。
export function makeMatcher(query: string): ((text: string) => boolean) | null {
  const q = (query || '').trim();
  if (!q) return null;
  if (q.length > 2 && q.startsWith('/') && q.endsWith('/')) {
    try {
      const re = new RegExp(q.slice(1, -1), 'i');
      return (t) => re.test(t);
    } catch (e) {
      // 正则写到一半（`/(/`）是常态而不是异常：降级成按字面量搜，绝不让搜索框抛异常把面板打断。
    }
  }
  const lc = q.toLowerCase();
  return (t) => t.toLowerCase().indexOf(lc) >= 0;
}

// texts 是**一条目的所有可搜文本**：UID 条目既要能按 UID 搜到，也要能按解析出来的 UP 名搜到——
// 用户记得住的是名字，不是一串数字。
export function filterBy<T>(items: T[], query: string, textsOf: (item: T) => string[]): T[] {
  const m = makeMatcher(query);
  if (!m) return items;
  return items.filter((it) => textsOf(it).some((t) => !!t && m(t)));
}
