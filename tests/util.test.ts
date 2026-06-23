import { describe, expect, it } from 'vitest';
import { escapeHtml, parseCount, parseDuration } from '../src/util';

describe('parseDuration', () => {
  it('mm:ss → 秒', () => {
    expect(parseDuration('03:20')).toBe(200);
    expect(parseDuration('00:45')).toBe(45);
  });
  it('hh:mm:ss → 秒', () => {
    expect(parseDuration('1:02:03')).toBe(3723);
  });
  it('非法 / 空 → null', () => {
    expect(parseDuration('')).toBe(null);
    expect(parseDuration(null)).toBe(null);
    expect(parseDuration('abc')).toBe(null);
    expect(parseDuration('12')).toBe(null); // 无冒号不算时长
  });
});

describe('parseCount', () => {
  it('纯数字 / 含逗号空格', () => {
    expect(parseCount('1234')).toBe(1234);
    expect(parseCount('1,234')).toBe(1234);
    expect(parseCount('12 345')).toBe(12345);
  });
  it('万 / 亿 单位', () => {
    expect(parseCount('1.5万')).toBe(15000);
    expect(parseCount('2亿')).toBe(200000000);
  });
  it('非法 / 空 → null', () => {
    expect(parseCount('')).toBe(null);
    expect(parseCount(null)).toBe(null);
    expect(parseCount('abc')).toBe(null);
  });
});

describe('escapeHtml', () => {
  it('转义 & < > " \'', () => {
    expect(escapeHtml('<b>"x"&\'y\'</b>')).toBe('&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  });
  it('空值安全', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
