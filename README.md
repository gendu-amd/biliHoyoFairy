# biliHoyoFairy

**净化 B 站推荐流的用户脚本。** 在推荐数据抵达页面之前就把命中规则的视频删掉——不是事后隐藏，所以没有遮罩、留白和闪烁。

[![Install](https://img.shields.io/badge/Tampermonkey-一键安装-fb7299)](https://raw.githubusercontent.com/gendu-amd/biliHoyoFairy/main/biliHoyoFairy.user.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.0.8-lightgrey)](CHANGELOG.md)

![拦截前后对比](https://github.com/user-attachments/assets/49cb7653-931d-407d-9369-ac65e018b8f9)

<table>
<tr>
<td width="33%" valign="top"><b>设置面板</b><br>即改即生效<br><br><img alt="设置面板" src="https://github.com/user-attachments/assets/73b25954-3bd7-49d1-a002-6e354043db3d"></td>
<td width="33%" valign="top"><b>屏蔽记录</b><br>看得见拦了什么，可就地放行<br><br><img alt="屏蔽记录" src="https://github.com/user-attachments/assets/4a2148cb-785a-42ad-9362-b4506ea2176f"></td>
<td width="33%" valign="top"><b>评论区过滤</b><br>引战 / 水军 / 营销评论<br><br><img alt="评论区过滤" src="https://github.com/user-attachments/assets/b0ea0c59-1a6d-46e8-a121-321339777d2c"></td>
</tr>
</table>

## 安装

1. 装 [Tampermonkey](https://www.tampermonkey.net/)（Edge / Chrome / Firefox）
2. 点上面的 **一键安装** 徽章
3. 打开 B 站，右下角出现 🛡 角标即可用

> 升级后请把已打开的 B 站标签页刷新一遍。

## 能做什么

**过滤维度** — 关键词（支持正则与 `title:` / `up:` / `part:` 作用域）、UP 主 / UID、BV 号、分区、视频标签、组合标签、UP 简介、播放量、点赞数、时长、广告卡、直播卡。白名单优先级最高。

**覆盖范围** — 首页、热门、排行榜、搜索、播放页推荐、动态、评论区。

**一键拉黑** — 右键卡片或播放页 UP 即可拉黑，同步到 B 站账号黑名单，刷新后不再推荐；可撤销。支持批量。

**看得见** — 屏蔽记录显示每条被拦的原因**具体是哪条规则**，并提供「放行」与「删规则」；规则体检列出过宽和从未命中的规则；运行自检在 B 站改版导致脚本静默失效时报警。

**规则订阅** — 从 URL 自动拉取并合并黑名单，也能把自己的名单一键导出成订阅格式分享出去。

## 规则语法

| 写法 | 含义 |
| --- | --- |
| `原神` | 包含即命中，忽略大小写与全半角 |
| `/震惊.*竟然/` | 正则，可加 `/…/i` 等标志 |
| `title:原神` | 只匹配标题（另有 `up:` / `part:`） |
| `原神 鸣潮` | 仅「组合标签」字段：同时含这一组才屏蔽 |

一次可粘贴多条，用换行或逗号分隔。面板每个输入框旁的 `?` 里有同一份速查。

## 隐私

无自有服务器，不上传任何数据。只向 `api.bilibili.com`（取数 / 拉黑）与**你自己添加**的订阅源发起请求。全部规则与统计存在浏览器本地。

## 注意事项

- **拉黑写入你的 B 站账号黑名单**，执行前有二次确认；批量拉黑限速并在触发风控时自动暂停续传。
- 「精确过滤」开启后才会按需读取视频标签、UP 简介、点赞数等数据；不开则完全不联网。
- 规则改动会自动备份（升级前、规则条数骤降前），可在「工具 → 🗂 配置备份」回滚。

## 开发

```bash
npm ci
npm run build      # TypeScript → biliHoyoFairy.user.js（提交进仓库）
npm test           # vitest
npm run typecheck && npm run lint
```

架构、分层约定与设计红线见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)；发版前的冒烟清单见 [`docs/review/SMOKE-TEST.md`](docs/review/SMOKE-TEST.md)；变更记录见 [`CHANGELOG.md`](CHANGELOG.md)。

欢迎 Issue 与 PR。改了 `src/` 请一并提交重新构建的产物，并升 `src/meta.js` 的 `@version`。

## 致谢

设计调研并借鉴了 [tjxwork 的多维过滤脚本](https://greasyfork.org/zh-CN/scripts/481629)、[festoney8/bilibili-cleaner](https://github.com/festoney8/bilibili-cleaner)、[codertesla/bilibili-1-click-blocker](https://github.com/codertesla/bilibili-1-click-blocker)、[nanatuo/bilibili-blocker](https://github.com/nanatuo/bilibili-blocker) 与 [tjsky/TabulaBili](https://github.com/tjsky/TabulaBili)。

## License

[MIT](LICENSE)

繁简对照表来自 [OpenCC](https://github.com/BYVoid/OpenCC) 的 `TSCharacters.txt`（Apache-2.0），已过滤为单字一一对应；仅在开启「简繁归一」时使用。
