// 「命中的是哪条规则」——误伤可自愈的前提。
// 关键词是规则最多、最易误伤的维度，过去只报一个光秃秃的「关键词」，
// 用户拿到一条误杀记录也无从知道该改哪一条规则。这里锁住解释的**准确性**：
// 报出来的必须是真正生效的那条，否则用户会去改一条根本没生效的规则。
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_CONFIG } from '../src/config';
import { matchRule, matchApi, rebuildRules, locateRule } from '../src/match/engine';
import { compileLines, whichHit } from '../src/match/normalize';
import type { CardInfo } from '../src/cardinfo';

function reset() {
  Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
  rebuildRules();
}
beforeEach(reset);

const card = (over: Partial<CardInfo> = {}): CardInfo => ({
  title: '', up: '', uid: '', partition: '', bvid: '', link: '',
  duration: null, views: null, likes: null, isLive: false, isAd: false,
  ...over,
});

describe('whichHit：回查命中的原始规则行', () => {
  it('多条普通词里报出真正命中的那条，而不是第一条', () => {
    const m = compileLines(['原神', '崩铁', '绝区零']);
    expect(whichHit('今天玩崩铁', m)).toBe('崩铁');
  });

  it('报的是**原始规则行**，不是归一后的形态', () => {
    // 规则写成全角 + 大写，归一后是 "abc"；用户在面板里看到的应当是自己写的那一行。
    const m = compileLines(['ＡＢＣ']);
    expect(whichHit('xxabcxx', m)).toBe('ＡＢＣ');
  });

  it('正则规则报出正则本身', () => {
    const m = compileLines(['/第\\d+集/']);
    expect(whichHit('番剧 第12集', m)).toBe('/第\\d+集/');
  });

  it('判定顺序与 textHit 一致：普通词优先于正则', () => {
    const m = compileLines(['/.*/', '原神']);
    // textHit 先查合并的普通词、再查正则；解释必须走同一顺序，否则报出的不是生效的那条。
    expect(whichHit('原神', m)).toBe('原神');
  });

  it('没命中返回 null（不瞎猜一条）', () => {
    expect(whichHit('无关标题', compileLines(['原神']))).toBeNull();
  });

  it('非法/被 ReDoS 防护丢弃的正则不会让下标错位', () => {
    // 中间那条是灾难性回溯形态，编译时被整条忽略；regexSrc 必须与 regexes 同步跳过，
    // 否则回查会报出一条**不存在的**规则。
    const m = compileLines(['/^a/', '/(a+)+$/', '/^b/']);
    expect(whichHit('bcd', m)).toBe('/^b/');
  });
});

describe('拦截原因带上具体规则', () => {
  it('关键词命中 → 关键词:<规则>', () => {
    CONFIG.block.keywords = ['原神', '恰饭'];
    rebuildRules();
    expect(matchRule(card({ title: '今天恰饭视频' }))).toBe('关键词:恰饭');
  });

  it('带作用域前缀的关键词，报出的是剥前缀后的词', () => {
    // compileScopedKeywords 分桶时已把 `up:` 前缀剥掉，故解释里是「营销号」而非「up:营销号」。
    // 已知小瑕疵：同时存在 `up:营销号` 与无前缀的 `营销号` 时，两者报出的字样一样、无法区分。
    // 不为此保留前缀——前缀是内部作用域语法，展示给用户反而更费解；真要区分应在 UI 侧定位到具体行。
    CONFIG.block.keywords = ['up:营销号'];
    rebuildRules();
    expect(matchRule(card({ title: '正常标题', up: '某某营销号' }))).toBe('关键词:营销号');
  });

  it('fuzzy 归一命中时，报出的仍是用户写的原词', () => {
    CONFIG.fuzzyMatch = true;
    CONFIG.block.keywords = ['原神'];
    rebuildRules();
    // 标题用分隔符绕过，归一后才命中；解释不能报归一形态。
    expect(matchRule(card({ title: '原·神 攻略' }))).toBe('关键词:原神');
  });

  it('UP 简介 → UP简介:<规则>', () => {
    CONFIG.block.upBio = ['商务合作'];
    rebuildRules();
    expect(matchApi(card(), null, null, { card: { sign: '商务合作请私信' } })).toBe('UP简介:商务合作');
  });

  it('标签报的是规则本身，不是视频的标签值', () => {
    // 原因串必须是干净的 `维度:规则`——UI 要据此 locateRule 定位到规则行去删，
    // 掺进标签值（如「标签:/游戏.*/（游戏杂谈）」）会让解析拿到一条不存在的规则。
    CONFIG.block.tags = ['/游戏.*/'];
    rebuildRules();
    expect(matchApi(card(), null, ['游戏杂谈'], null)).toBe('标签:/游戏.*/');
  });

  it('标签规则就是标签值本身时不重复啰嗦', () => {
    CONFIG.block.tags = ['鬼畜'];
    rebuildRules();
    expect(matchApi(card(), null, ['鬼畜'], null)).toBe('标签:鬼畜');
  });

  it('闭环：每个带规则的维度，原因串都能反查回用户名单里的那一行', () => {
    // 这是「误伤自愈」的命脉——UI 靠 locateRule 从记录定位到规则去删。
    // 维度产出的原因串与 REASON_RULE_FIELD 一旦漂移，按钮会静默消失（或指向错的字段），
    // 而这种失效没有任何报错。逐维度走一遍真实的 matchRule/matchApi，不手写原因串。
    const cases: { setup: () => void; hit: () => string | null; field: string; line: string }[] = [
      { setup: () => (CONFIG.block.keywords = ['原神']), hit: () => matchRule(card({ title: '玩原神' })), field: 'keywords', line: '原神' },
      { setup: () => (CONFIG.block.partitions = ['游戏']), hit: () => matchRule(card({ partition: '游戏' })), field: 'partitions', line: '游戏' },
      { setup: () => (CONFIG.block.upNames = ['某某']), hit: () => matchRule(card({ up: '某某' })), field: 'upNames', line: '某某' },
      { setup: () => (CONFIG.block.uids = ['123']), hit: () => matchRule(card({ uid: '123' })), field: 'uids', line: '123' },
      { setup: () => (CONFIG.block.bvids = ['BV1x']), hit: () => matchRule(card({ bvid: 'BV1x' })), field: 'bvids', line: 'BV1x' },
      { setup: () => (CONFIG.block.tags = ['鬼畜']), hit: () => matchApi(card(), null, ['鬼畜'], null), field: 'tags', line: '鬼畜' },
      { setup: () => (CONFIG.block.upBio = ['恰饭']), hit: () => matchApi(card(), null, null, { card: { sign: '恰饭' } }), field: 'upBio', line: '恰饭' },
    ];
    for (const c of cases) {
      reset();
      c.setup();
      rebuildRules();
      const reason = c.hit();
      expect(reason, `维度 ${c.field} 应命中`).toBeTruthy();
      expect(locateRule(reason as string), `原因「${reason}」应能反查到 block.${c.field}`).toEqual({ field: c.field, line: c.line });
    }
  });

  it('带作用域前缀的规则也能反查回原行（否则会被误判成来自订阅）', () => {
    CONFIG.block.keywords = ['up:营销号'];
    rebuildRules();
    const reason = matchRule(card({ up: '某某营销号' })) as string;
    expect(locateRule(reason)).toEqual({ field: 'keywords', line: 'up:营销号' });
  });

  it('规则不在用户名单里（来自订阅）时反查返回 null，不谎报可删', () => {
    expect(locateRule('关键词:某订阅词')).toBeNull();
  });

  it('阈值/开关类维度没有可删的规则行', () => {
    CONFIG.hideAd = true;
    rebuildRules();
    expect(matchRule(card({ isAd: true }))).toBe('广告卡');
    expect(locateRule('广告卡')).toBeNull();
  });

  it('白名单优先：不产生任何解释', () => {
    CONFIG.block.keywords = ['原神'];
    CONFIG.allow.keywords = ['攻略'];
    rebuildRules();
    expect(matchRule(card({ title: '原神 攻略' }))).toBeNull();
  });
});
