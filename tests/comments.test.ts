import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_CONFIG } from '../src/config';
import { rebuildRules } from '../src/match/engine';
import { readCmt, matchComment, asCommentHost } from '../src/comments';
import type { CmtInfo, CommentHost } from '../src/comments';
import { h, El } from './helpers/dom';

// 评论过滤有十几条规则、四条白名单，且全部依赖 B 站塞在宿主元素上的 __data ——
// 判定这半是纯函数，这里按规则逐条钉住；隐藏/折叠那半是 DOM 操作，不在无 jsdom 的环境里测。
function reset() {
  Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
  CONFIG.comment.enabled = true;
  rebuildRules();
}
beforeEach(reset);

// 造一个评论宿主替身：只带 readCmt 会读的那几个字段。
type HostStub = Partial<Pick<CommentHost, '__data' | '__upMid' | '__user'>>;
const host = (stub: HostStub): CommentHost => stub as CommentHost;

// 直接造判定输入（跳过 readCmt，专测规则本身）
const cmt = (over: Partial<CmtInfo> = {}): CmtInfo => ({
  uname: '',
  mid: undefined,
  level: null,
  noface: false,
  message: '',
  members: [],
  isUpTop: false,
  upMid: undefined,
  me: undefined,
  ...over,
});

describe('readCmt：从 __data 抽取', () => {
  it('无 host / 无 __data 都不抛，返回安全默认值', () => {
    for (const c of [readCmt(null), readCmt(undefined), readCmt(host({}))]) {
      expect(c.uname).toBe('');
      expect(c.message).toBe('');
      expect(c.level).toBe(null);
      expect(c.members).toEqual([]);
      expect(c.isUpTop).toBe(false);
      expect(c.noface).toBe(false);
    }
  });

  it('常规字段：用户名去空白、等级、正文、@到的人', () => {
    const c = readCmt(
      host({
        __data: {
          mid: 42,
          member: { uname: ' 张三 ', level_info: { current_level: 3 } },
          content: { message: '你好', members: [{ uname: 'AI视频小助理' }] },
        },
      })
    );
    expect(c.uname).toBe('张三');
    expect(c.mid).toBe(42);
    expect(c.level).toBe(3);
    expect(c.message).toBe('你好');
    expect(c.members.length).toBe(1);
  });

  it('等级不是数字（缺字段/字符串）→ null，而不是 NaN 或 0', () => {
    expect(readCmt(host({ __data: { member: { level_info: {} } } })).level).toBe(null);
    expect(readCmt(host({ __data: { member: {} } })).level).toBe(null);
  });

  it('noface：默认头像且非会员才算；vipStatus>0 不算', () => {
    const noface = (vipStatus?: number) =>
      readCmt(host({ __data: { member: { avatar: 'https://i0.hdslb.com/bfs/face/member/noface.jpg', vip: { vipStatus } } } })).noface;
    expect(noface(0)).toBe(true);
    expect(noface(undefined)).toBe(true); // 没有 vip 字段 = 不是会员
    expect(noface(1)).toBe(false);
    expect(readCmt(host({ __data: { member: { avatar: 'https://i0.hdslb.com/bfs/face/abc.jpg' } } })).noface).toBe(false);
  });

  it('置顶标记 / UP mid / 当前登录用户名', () => {
    const c = readCmt(host({ __data: { reply_control: { is_up_top: true } }, __upMid: 99, __user: { uname: '我' } }));
    expect(c.isUpTop).toBe(true);
    expect(c.upMid).toBe(99);
    expect(c.me).toBe('我');
  });
});

describe('matchComment：白名单优先', () => {
  it('UP 主本人的评论免过滤（mid 与 upMid 类型不同也要判等）', () => {
    CONFIG.comment.keywords.push('原神');
    rebuildRules();
    expect(matchComment(cmt({ message: '原神启动', mid: '123', upMid: 123 }), false)).toBe(null);
    expect(matchComment(cmt({ message: '原神启动', mid: '124', upMid: 123 }), false)).toBe('评论关键词');
  });

  it('allowUp 关掉后 UP 本人也照常判定', () => {
    CONFIG.comment.keywords.push('原神');
    CONFIG.comment.allowUp = false;
    rebuildRules();
    expect(matchComment(cmt({ message: '原神启动', mid: 123, upMid: 123 }), false)).toBe('评论关键词');
  });

  it('置顶评论免过滤；楼中楼没有「置顶」一说，同样的数据仍要判定', () => {
    CONFIG.comment.keywords.push('原神');
    rebuildRules();
    expect(matchComment(cmt({ message: '原神启动', isUpTop: true }), false)).toBe(null);
    expect(matchComment(cmt({ message: '原神启动', isUpTop: true }), true)).toBe('评论关键词');
  });

  it('自己发的、以及 @ 到自己的评论免过滤', () => {
    CONFIG.comment.keywords.push('原神');
    rebuildRules();
    expect(matchComment(cmt({ uname: '我', me: '我', message: '原神启动' }), false)).toBe(null);
    expect(matchComment(cmt({ uname: '别人', me: '我', message: '@我 原神启动' }), false)).toBe(null);
    expect(matchComment(cmt({ uname: '别人', me: '我', message: '原神启动' }), false)).toBe('评论关键词');
  });
});

describe('matchComment：黑名单各维度', () => {
  it('评论用户名精确黑名单（大小写无关），原因串带用户名', () => {
    CONFIG.comment.userNames.push('SpamBot');
    rebuildRules();
    expect(matchComment(cmt({ uname: 'spambot' }), false)).toBe('评论用户:spambot');
    expect(matchComment(cmt({ uname: 'spambot2' }), false)).toBe(null); // 精确匹配，不是包含
  });

  it('昵称关键词（含正则）', () => {
    CONFIG.comment.userNameKeywords.push('代刷', '/^小号\\d+$/');
    rebuildRules();
    expect(matchComment(cmt({ uname: '专业代刷播放' }), false)).toBe('评论昵称词');
    expect(matchComment(cmt({ uname: '小号123' }), false)).toBe('评论昵称词');
    expect(matchComment(cmt({ uname: '正经人' }), false)).toBe(null);
  });

  it('正文关键词', () => {
    CONFIG.comment.keywords.push('加群');
    rebuildRules();
    expect(matchComment(cmt({ message: '加群领资料' }), false)).toBe('评论关键词');
  });

  it('楼中楼剥掉「回复 @某人:」前缀后再匹配；一级评论不剥（它本没有这种前缀）', () => {
    CONFIG.comment.keywords.push('回复');
    rebuildRules();
    expect(matchComment(cmt({ message: '回复 @某人: 说得对' }), true)).toBe(null);
    expect(matchComment(cmt({ message: '回复 @某人: 说得对' }), false)).toBe('评论关键词');
  });

  it('@提及本身不参与匹配（否则会被「被 @ 者的昵称」误伤）', () => {
    CONFIG.comment.keywords.push('原神');
    rebuildRules();
    expect(matchComment(cmt({ message: '回复 @原神老玩家: 说得对' }), true)).toBe(null);
    expect(matchComment(cmt({ message: '@原神老玩家 说得对' }), false)).toBe(null);
    expect(matchComment(cmt({ message: '回复 @某人: 原神启动' }), true)).toBe('评论关键词');
  });

  it('[表情] 占位不参与匹配', () => {
    CONFIG.comment.keywords.push('妙');
    rebuildRules();
    expect(matchComment(cmt({ message: '[妙啊]' }), false)).toBe(null);
    expect(matchComment(cmt({ message: '妙啊' }), false)).toBe('评论关键词');
  });

  it('等级下限：0=不启用；等级缺失（读不到）不误伤', () => {
    CONFIG.comment.minLevel = 4;
    rebuildRules();
    expect(matchComment(cmt({ level: 2 }), false)).toBe('评论等级<4');
    expect(matchComment(cmt({ level: 4 }), false)).toBe(null);
    expect(matchComment(cmt({ level: null }), false)).toBe(null);
    CONFIG.comment.minLevel = 0;
    expect(matchComment(cmt({ level: 1 }), false)).toBe(null);
  });

  it('默认头像非会员', () => {
    CONFIG.comment.hideNoFace = true;
    expect(matchComment(cmt({ noface: true }), false)).toBe('默认头像非会员');
    expect(matchComment(cmt({ noface: false }), false)).toBe(null);
  });

  it('AI 机器人本人发的评论 / 召唤 AI 的评论', () => {
    CONFIG.comment.hideBot = true;
    CONFIG.comment.hideCallBot = true;
    expect(matchComment(cmt({ uname: 'AI视频小助理' }), false)).toBe('AI机器人');
    expect(matchComment(cmt({ uname: '路人', message: '@AI视频小助理 总结一下', members: [{ uname: 'AI视频小助理' }] }), false)).toBe('召唤AI');
    expect(matchComment(cmt({ uname: '路人', message: '@某人 你看', members: [{ uname: '某人' }] }), false)).toBe(null);
  });

  it('带货/导流评论', () => {
    CONFIG.comment.hideAd = true;
    expect(matchComment(cmt({ message: '戳 https://b23.tv/mall-abc 有优惠' }), false)).toBe('带货评论');
    expect(matchComment(cmt({ message: '快去领券' }), false)).toBe('带货评论');
    expect(matchComment(cmt({ message: '这个视频不错' }), false)).toBe(null);
  });

  it('纯 @ 评论 / 纯表情评论', () => {
    CONFIG.comment.hideCallOnly = true;
    CONFIG.comment.hideEmojiOnly = true;
    expect(matchComment(cmt({ message: '@张三 @李四' }), false)).toBe('纯@评论');
    expect(matchComment(cmt({ message: '😂😂😂' }), false)).toBe('纯表情评论');
    expect(matchComment(cmt({ message: '[doge]' }), false)).toBe('纯表情评论'); // 表情占位被剥掉后为空
    expect(matchComment(cmt({ message: '@张三 说得对' }), false)).toBe(null);
  });

  it('全部开关默认关闭时，普通评论一条都不拦', () => {
    expect(matchComment(cmt({ uname: '路人', message: '这个视频不错 😂' }), false)).toBe(null);
  });
});

describe('asCommentHost：Element → 评论宿主的唯一收窄点', () => {
  it('一级评论与楼中楼的自定义标签都认（tagName 大写）', () => {
    expect(asCommentHost(h('bili-comment-thread-renderer') as unknown as Element)).toBeTruthy();
    expect(asCommentHost(h('bili-comment-reply-renderer') as unknown as Element)).toBeTruthy();
  });

  it('普通元素 / 空值 → null', () => {
    expect(asCommentHost(h('div') as unknown as Element)).toBe(null);
    expect(asCommentHost(null)).toBe(null);
    expect(asCommentHost(undefined)).toBe(null);
    expect(asCommentHost(new El('bili-comment-renderer') as unknown as Element)).toBe(null); // 名字相近但不是登记过的标签
  });
});
