/**
 * 批量修正import路径
 * 将相对路径的NapCat导入改为Overlay路径
 */

const fs = require('fs');
const path = require('path');

const LIB_DIR = path.resolve(__dirname, '../lib');

// 需要替换的import模式
const REPLACEMENTS = [
  // 从相对路径导入core
  { from: /from ['"]\.\.\/\.\.\/core['"]/g, to: `from 'NapCatQQ/src/core/index.js'` },
  { from: /from ['"]\.\.\/\.\.\/\.\.\/core['"]/g, to: `from 'NapCatQQ/src/core/index.js'` },
  
  // @/core 别名
  { from: /from ['"]@\/core['"]/g, to: `from 'NapCatQQ/src/core/index.js'` },
  { from: /from ['"]@\/core\/types['"]/g, to: `from 'NapCatQQ/src/core/types.js'` },
  { from: /from ['"]@\/core\/types\/msg['"]/g, to: `from 'NapCatQQ/src/core/types.js'` },
  
  // import具体类型
  { from: /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]@\/core['"]/g, 
    to: `import { $1 } from 'NapCatQQ/src/core/index.js'` },
  
  // OneBot API
  { from: /from ['"]\.\.\/\.\.\/\.\.\/onebot\/api\/msg['"]/g, to: `from 'NapCatQQ/src/onebot/api/msg.js'` },
  { from: /from ['"]\.\.\/\.\.\/onebot\/api\/msg['"]/g, to: `from 'NapCatQQ/src/onebot/api/msg.js'` },
  
  // NapCatCore导入
  { from: /import\s*\{\s*NapCatCore\s*\}\s*from\s*['"]\.\.\/\.\.\/core['"]/g, 
    to: `import { NapCatCore } from 'NapCatQQ/src/core/index.js'` },
  { from: /import\s*\{\s*NapCatCore\s*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/core['"]/g, 
    to: `import { NapCatCore } from 'NapCatQQ/src/core/index.js'` },
];

function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    let changes = [];
    
    for (const { from, to } of REPLACEMENTS) {
      const matches = content.match(from);
      if (matches) {
        content = content.replace(from, to);
        modified = true;
        changes.push(`  ${from.toString()} -> ${to}`);
      }
    }
    
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✓ ${path.relative(LIB_DIR, filePath)}`);
      changes.forEach(c => console.log(c));
      return 1;
    }
    
    return 0;
  } catch (error) {
    console.error(`✗ ${filePath}: ${error.message}`);
    return 0;
  }
}

function walkDir(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      count += walkDir(fullPath);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      count += processFile(fullPath);
    }
  }
  
  return count;
}

console.log('========================================');
console.log('批量修正import路径');
console.log('========================================');
console.log(`目标目录: ${LIB_DIR}\n`);

const modifiedCount = walkDir(LIB_DIR);

console.log('\n========================================');
console.log(`✓ 完成！共修改 ${modifiedCount} 个文件`);
console.log('========================================');

