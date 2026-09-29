// 一次性脚本：styles.css 颜色变量化（函数式替换，无 $1 陷阱）
// 原则：只动「背景 / 边框 / 灰阶文字」；保护彩底白字（color:#fff）、签名纸白底、品牌色
import fs from 'node:fs';

const p = new URL('../src/styles.css', import.meta.url);
let s = fs.readFileSync(p, 'utf8');
const bytesBefore = s.length;

/* ---------- 1) :root 扩展调色板 + html.dark 暗色值 + Vant 暗色桥接 ---------- */
const ROOT_OLD = `:root {
  --van-primary-color: #4f6ef2;
  --eduhub-bg: #f5f6fa;
  --eduhub-card: #ffffff;
  --eduhub-text: #2b3245;
  --eduhub-muted: #8a93a6;
  --eduhub-line: #e8ebf3;
}`;

const ROOT_NEW = `:root {
  --van-primary-color: #4f6ef2;
  /* 亮色调色板 */
  --eduhub-bg: #eef0f6;
  --eduhub-card: #ffffff;
  --eduhub-card-2: #fbfcff;
  --eduhub-tint: #f4f6fd;
  --eduhub-tint-2: #eef2ff;
  --eduhub-seg: #eef1f8;
  --eduhub-text: #2b3245;
  --eduhub-text-2: #47506a;
  --eduhub-muted: #8a93a6;
  --eduhub-line: #e8ebf3;
  --eduhub-line-2: #f1f3f9;
  --eduhub-input-border: #d9dfec;
  --eduhub-line-strong: #b9c4e0;
}

/* 暗色主题：html.dark 由 composables/theme.js 挂载 */
html.dark {
  --eduhub-bg: #12141c;
  --eduhub-card: #1b1f2b;
  --eduhub-card-2: #20242f;
  --eduhub-tint: #232838;
  --eduhub-tint-2: #253252;
  --eduhub-seg: #232633;
  --eduhub-text: #e4e7f0;
  --eduhub-text-2: #b6bdcc;
  --eduhub-muted: #7d8598;
  --eduhub-line: #2a2f3d;
  --eduhub-line-2: #232633;
  --eduhub-input-border: #363c4d;
  --eduhub-line-strong: #3d4457;

  /* Vant 组件桥接（van-theme-dark 类同样挂在 html 上） */
  --van-background: var(--eduhub-bg);
  --van-background-2: var(--eduhub-card);
  --van-text-color: var(--eduhub-text);
  --van-text-color-2: var(--eduhub-text-2);
  --van-text-color-3: var(--eduhub-muted);
  --van-border-color: var(--eduhub-line);
  --van-cell-background: var(--eduhub-card);
  --van-nav-bar-background: var(--eduhub-card);
  --van-nav-bar-title-text-color: var(--eduhub-text);
  --van-tabbar-background: var(--eduhub-card);
  --van-popup-background: var(--eduhub-card);
  --van-calendar-background: var(--eduhub-card);
  --van-picker-background: var(--eduhub-card);
  --van-field-label-color: var(--eduhub-text-2);
  --van-field-input-text-color: var(--eduhub-text);
  --van-button-default-background: var(--eduhub-seg);
  --van-button-default-border-color: var(--eduhub-line);
  --van-button-plain-background: transparent;
  --van-dialog-background: var(--eduhub-card);
  --van-toast-background: rgba(44, 50, 68, 0.94);
}`;

if (!s.includes(ROOT_OLD)) {
  console.error(':root 块与预期不符，中止（不做半截修改）');
  process.exit(1);
}
s = s.replace(ROOT_OLD, ROOT_NEW);

/* ---------- 2) 函数式替换：背景 / 边框 / 灰阶文字 ---------- */
// 白色表面：仅 background 语境（color:#fff 彩底白字、签名纸渐变不受影响）
s = s.replace(/background:\s*#fff(?:fff)?\b/gi, 'background: var(--eduhub-card)');

// 页面背景
s = s.replace(/background:\s*#(?:e9ebf2|eef0f6|f5f6fa)\b/gi, 'background: var(--eduhub-bg)');

// 提亮 / 选中 / 分段 / 卡片二级底
s = s.replace(/background:\s*#(?:f2f4fa|fafbff|f7f9ff|f8faff|f4f6fd|f3f5fb|f6f8fd)\b/gi, 'background: var(--eduhub-tint)');
s = s.replace(/background:\s*#(?:fbfcff|fafbfe)\b/gi, 'background: var(--eduhub-card-2)');
s = s.replace(/background:\s*#(?:eef2ff|f2f5ff)\b/gi, 'background: var(--eduhub-tint-2)');
s = s.replace(/background:\s*#eef1f8\b/gi, 'background: var(--eduhub-seg)');

// 边框（带方向的用函数拼回）
s = s.replace(/border(-bottom|-top|-left|-right)?:\s*1px solid #e8ebf3\b/gi,
  (m, side) => `border${side || ''}: 1px solid var(--eduhub-line)`);
s = s.replace(/border(-bottom|-top|-left|-right)?:\s*1px solid #f1f3f9\b/gi,
  (m, side) => `border${side || ''}: 1px solid var(--eduhub-line-2)`);
s = s.replace(/border(-bottom|-top|-left|-right)?:\s*1px solid #f2f4fa\b/gi,
  (m, side) => `border${side || ''}: 1px solid var(--eduhub-line-2)`);
s = s.replace(/border(-bottom|-top|-left|-right)?:\s*1px solid #f1f3f8\b/gi,
  (m, side) => `border${side || ''}: 1px solid var(--eduhub-line-2)`);
s = s.replace(/border(-bottom|-top|-left|-right)?:\s*1px solid #f0f2f8\b/gi,
  (m, side) => `border${side || ''}: 1px solid var(--eduhub-line-2)`);
s = s.replace(/border:\s*1px solid #e2e6f0\b/gi, 'border: 1px solid var(--eduhub-line-2)');
s = s.replace(/border:\s*1.5px solid #e2e6f0\b/gi, 'border: 1.5px solid var(--eduhub-line-2)');
s = s.replace(/border:\s*1px solid #d9dfec\b/gi, 'border: 1px solid var(--eduhub-input-border)');
s = s.replace(/border:\s*1px dashed #c9d1e4\b/gi, 'border: 1px dashed var(--eduhub-input-border)');
s = s.replace(/border:\s*1px dashed #c3cbe0\b/gi, 'border: 1px dashed var(--eduhub-input-border)');
s = s.replace(/border-color:\s*#b9c4e0\b/gi, 'border-color: var(--eduhub-line-strong)');

// 灰阶文字
s = s.replace(/color:\s*#(?:5a6684|47506a|4a5470|667)\b/gi, 'color: var(--eduhub-text-2)');
s = s.replace(/color:\s*#(?:8a93a6|7b86a1|a3abbd|98a1b5|c3c9d6|b8c0d4|b6bdcc)\b/gi, 'color: var(--eduhub-muted)');

fs.writeFileSync(p, s);
console.log(`styles.css 变量化完成: ${bytesBefore} -> ${s.length} 字节`);
console.log('剩余未变量化的 #fff 出现次数（应只剩 color:#fff 与签名纸）:',
  (s.match(/#fff\b/gi) || []).length);
