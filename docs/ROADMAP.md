# 路线图与候选功能

记录候选功能、优先级与「为什么做 / 不做」的决策依据，以及同类项目调研。**本文件是内部规划，不代表已实现。**

## 候选功能（按优先级）

### 已实现

- **bvid 级「不再显示这个视频」+ 卡片快捷按钮**（v0.0.7）：悬停浮层「拉黑」下方新增「🚫 不看这个」，复用 `block.bvids` 单条隐藏、带撤销、可在黑名单移除。参考 [aisensiy/my-bilibili-rcmd](https://github.com/aisensiy/my-bilibili-rcmd)。

### 评估中（需更多信息 / 取舍）

- **触发 B 站原生「不感兴趣」反馈**（受限，深度核查后下调）：理念好（能回流推荐模型）。但已核实——有文档的 dislike 接口（`app.bilibili.com/x/feed/dislike`、`app.biliapi.net/x/v2/view/dislike`）**都要 APP 端 `access_key`**，网页脚本只有 web cookie 拿不到；网页 PC 的「不感兴趣」走未公开 + WBI 签名的内部接口，脆弱且影响账号。结论：**网页脚本暂不可靠落地**，待 web 端可用接口明确后再议。
- **收藏 / 投币比信号**（待验证）：首页 feed 的 `item.stat` 历史上多为 `{view, like, danmaku}` 精简集，**通常不含 favorite/coin**。若直接读 feed → 该维度恒不触发（死功能）；可靠做需每卡发详情请求（重，且与现有点赞率识营销号收益重叠）。结论：**先抓真实登录态 feed 响应确认是否含 `stat.favorite/coin` 再决定**。
- **动态流（t.bilibili.com）按类型过滤**：当前动态页主要靠 DOM 兜底，未拦动态 feed 接口。可评估加 hook（移除充电问答、带货转发等类型）。参考 Bilibili-Evolved 动态过滤器。
- **遮罩模式（半透明遮罩 + 原因，替代隐藏）**：我们已有「审查模式（标记 + 放行）」，接近；可加一个显示选项。参考 BiliBlockFusion 叠加层模式。
- **更多评论维度**：仅看硬核会员、字数下限、按装扮屏蔽。参考 BiliBlockFusion。
- **搜索页去「推荐注入」污染**：见下方「决策记录」——**受限**，无可靠低误伤标准，暂不做或仅做明确标注的「钝刀」可选项。

### 明确不做（超出定位）

- **全面 UI 净化**（顶栏 / 播放器 / banner）：那是「界面美化」赛道，与我们「推荐流内容过滤」不同，扩张会模糊定位。参考 bilibili-cleaner（其核心是 UI 净化）。
- **LLM 画像过滤**：需本地 LLM，远超用户脚本边界，顶多远期愿景。

## 决策记录

- **搜索去污染（受限）**：登录态站内搜索会把「看过 / 推荐」视频混入结果，痛点真实。但「相关性」正是搜索引擎的活，我们无 ground truth；任何启发式（如标题含搜索词）都双向误判。结论：不做，或仅做**默认关 + 明确标注「会漏掉部分相关结果」的钝刀严格模式**，把取舍权交给用户。
- **弹幕过滤（低优先）**：B 站播放器**自带**正则弹幕屏蔽系统，社区已有成熟规则集可直接导入（见下）。我们重复造轮子价值低；如需要，引导用户用原生功能 + 现成规则集即可。

## 同类项目调研

| 项目 | 形态 | 借鉴点 / 备注 |
| --- | --- | --- |
| [festoney8/bilibili-cleaner](https://github.com/festoney8/bilibili-cleaner) | 油猴 TS（~830★） | 分页独立菜单、白名单优先、关键词收集库（NOTE.md）、脚本管理器兼容矩阵；核心是 UI 净化（不借鉴该方向） |
| [the1812/Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved) | 油猴（巨型） | 动态过滤器（类型/关键词，动作=隐藏/标记/折叠）、移除充电/带货动态、隐藏热搜 |
| [BRaysMK/BiliBlockFusion](https://github.com/BRaysMK/BiliBlockFusion) | 油猴 | 收藏/投币比、叠加层模式、用户空间按签名屏蔽、评论多维度、规则 JSON 导入导出 |
| [aisensiy/my-bilibili-rcmd](https://github.com/aisensiy/my-bilibili-rcmd) | Chrome 扩展 | 原生「不感兴趣」反馈、bvid 级隐藏、LLM 画像（不借鉴 LLM） |
| [codertesla/bilibili-1-click-blocker](https://github.com/codertesla/bilibili-1-click-blocker) | 油猴 | 拉黑按钮铺到多页面 + 即时清理 + 主题自适应 |
| [jnxyp/Bilibili-Block-List](https://github.com/jnxyp/Bilibili-Block-List) | **弹幕规则集（XML）** | **弹幕**正则屏蔽规则，导入 B 站原生播放器使用；不同赛道（我们不做弹幕）、CC-BY-NC 协议、2018 停更 → 不直接借鉴；仅「分级规则集 + 可分享」的理念印证我们的预置库/订阅方向 |
