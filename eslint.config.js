import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const GM_GLOBALS = {
  GM_setValue: 'readonly',
  GM_getValue: 'readonly',
  GM_addStyle: 'readonly',
  GM_xmlhttpRequest: 'readonly',
  GM_registerMenuCommand: 'readonly',
  GM_info: 'readonly',
  unsafeWindow: 'readonly',
};

export default tseslint.config(
  // 构建产物与构建脚本不参与 lint。
  { ignores: ['biliHoyoFairy.user.js', 'scripts/**', 'src/meta.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021, ...GM_GLOBALS },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // src/ 与 tests/ 已全量类型化，@ts-nocheck 的迁移期豁免就此收回：
      // 再想整文件关掉类型检查得先过这条规则，防止「加个 nocheck 先跑起来」重新变成常态。
      '@typescript-eslint/ban-ts-comment': 'error',
      // src/ 已全量类型化：同一类错误（用了未定义的名字）由 tsc 覆盖，而 no-undef 不区分类型位置与值位置，
      // 会把 ParentNode / HTMLElementTagNameMap / Tampermonkey 这些「只存在于类型世界」的名字误报成未定义。
      'no-undef': 'off',
      // 迁移期遗留代码的风格性规则关掉（非正确性问题：空 catch、arguments、x&&x()、正则字符类、全角空格等）；
      // 待逐模块类型化后再逐步收紧。
      'no-empty': 'off',
      'no-cond-assign': 'off',
      'no-misleading-character-class': 'off',
      'no-irregular-whitespace': 'off',
      'prefer-rest-params': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
);
