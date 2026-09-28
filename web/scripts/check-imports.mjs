// 扫描未使用的导入（一次性脚本）
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const exts = ['.vue', '.js'];

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (exts.includes(path.extname(f))) out.push(p);
  }
  return out;
}

let issues = 0;
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  const scriptMatch = src.match(/<script setup>([\s\S]*?)<\/script>/);
  const code = scriptMatch ? scriptMatch[1] : src;
  const rest = src.slice(code.length);

  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.split(' as ').pop().trim();
      if (!name) continue;
      const used =
        new RegExp(`\\b${name}\\b`).test(code.slice(m.index + m[0].length)) ||
        new RegExp(`\\b${name}\\b`).test(rest);
      if (!used) {
        console.log('未使用导入:', path.relative(root, file), '->', name);
        issues++;
      }
    }
  }

  for (const m of code.matchAll(/(?<![{}\w])import\s+(\w+)\s+from/g)) {
    const name = m[1];
    const used =
      new RegExp(`\\b${name}\\b`).test(code.slice(m.index + m[0].length)) ||
      new RegExp(`\\b${name}\\b`).test(rest);
    if (!used) {
      console.log('未使用默认导入:', path.relative(root, file), '->', name);
      issues++;
    }
  }
}
console.log(issues ? `共 ${issues} 处` : '无未使用导入');
