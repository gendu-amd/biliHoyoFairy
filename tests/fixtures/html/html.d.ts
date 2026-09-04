// HTML 样本以纯文本导入（vite/vitest 的 ?raw）。这样不必为读文件引入 @types/node——
// 仓库的依赖刻意只有 esbuild + vitest + eslint + typescript 四个。
declare module '*.html?raw' {
  const content: string;
  export default content;
}
