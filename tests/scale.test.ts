// 大名单（从账号黑名单导回几千个 UID 是常态）下的规模行为。
// 这里锁的不是性能数字，而是**截断必须是显式的**：少显示可以，少导入/悄悄少算不行。
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DEFAULT_CONFIG, countRules, saveConfig } from '../src/config';
import { rebuildRules, matchRule } from '../src/match/engine';
import { ruleHealth } from '../src/rulehealth';
import type { CardInfo } from '../src/cardinfo';

const gmClear = (globalThis as any).__gmClear as () => void;
const card = (uid: string): CardInfo =>
  ({ title: '', up: '', uid, partition: '', bvid: '', duration: null, views: null, likes: null, isLive: false, isAd: false }) as CardInfo;

beforeEach(() => {
  gmClear();
  Object.assign(CONFIG, structuredClone(DEFAULT_CONFIG));
});

describe('几千条 UID 规模', () => {
  const many = Array.from({ length: 3000 }, (_, i) => String(100000 + i));

  it('匹配仍然命中（UID 走 Set，不随名单长度退化）', () => {
    CONFIG.block.uids.push(...many);
    rebuildRules();
    expect(matchRule(card('100000'))).toBe('UID:100000');
    expect(matchRule(card('102999'))).toBe('UID:102999');
    expect(matchRule(card('999999'))).toBeNull();
  });

  it('存盘 → 读回不丢条数（三方合并对大数组同样成立）', () => {
    CONFIG.block.uids.push(...many);
    saveConfig();
    CONFIG.block.uids.push('999999');
    saveConfig();
    const stored = JSON.parse((globalThis as any).__gmStore['bfb_config_v2']);
    expect(stored.block.uids.length).toBe(3001);
  });

  it('countRules 如实计数（骤降熔断的判据不能因为名单大就失准）', () => {
    CONFIG.block.uids.push(...many);
    expect(countRules(CONFIG)).toBe(3000);
  });

  it('规则体检把它们都算出来了（面板只负责少显示，数据层不许少算）', () => {
    CONFIG.block.uids.push(...many);
    CONFIG.ruleStatsSince = Date.now() - 30 * 86400000;
    rebuildRules();
    expect(ruleHealth().dead.length).toBe(3000);
  });
});
