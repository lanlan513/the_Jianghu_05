/**
 * 组件树冒烟：用 react-dom/server 渲染 ChroniclePage（MemoryRouter 包裹），
 * 验证真实数据 / 压测数据 / 搜索焦点 URL 三种情形下 renderToString 均不抛异常。
 * 运行：npx tsx scripts/ssr-smoke.ts
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ChroniclePage from '../src/pages/ChroniclePage';

const cases = ['/chronicle', '/chronicle?g=century&y=-500', '/chronicle?g=item&t=1&q=%E6%B9%9B%E5%8D%A2'];

for (const url of cases) {
  try {
    const html = renderToString(
      React.createElement(MemoryRouter, { initialEntries: [url] },
        React.createElement(ChroniclePage)),
    );
    if (!html.includes('正在展卷')) throw new Error('未渲染加载态');
    console.log(`✓ ${url} → ${html.length} 字节（加载态正常；数据到达后由客户端水合）`);
  } catch (err) {
    console.error(`✗ ${url} 渲染失败`, err);
    process.exit(1);
  }
}
console.log('SSR 冒烟通过');
