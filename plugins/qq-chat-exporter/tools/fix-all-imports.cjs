/**
 * 完整修复所有import问题
 */

const fs = require('fs');
const path = require('path');

const LIB_DIR = path.resolve(__dirname, '../lib');

// 需要替换的规则
const rules = [
  // 1. ../../core/types/msg.js -> NapCatQQ
  { from: /from ['"]\.\.\/\.\.\/core\/types\/msg\.js['"]/g, to: `from 'NapCatQQ/src/core/types.js'` },
  { from: /from ['"]\.\.\/\.\.\/\.\.\/core\/types\/msg\.js['"]/g, to: `from 'NapCatQQ/src/core/types.js'` },
  
  // 2. ../../core/types.js -> NapCatQQ
  { from: /from ['"]\.\.\/\.\.\/\.\.\/core\/types\.js['"]/g, to: `from 'NapCatQQ/src/core/types.js'` },
  
  //3. ../types.js -> ./types/index.js (相对路径)
  { from: /from ['"]\.\.\/types\.js['"]/g, to: `from '../types/index.js'` },
  { from: /from ['"]\.\.\/\.\.\/types\.js['"]/g, to: `from '../../types/index.js'` },
  
  // 4. ../../types.js -> ./types/index.js
  { from: /from ['"]\.\.\/\.\.\/types\.js['"]/g, to: `from '../types/index.js'` },
];

function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    for (const { from, to } of rules) {
      if (from.test(content)) {
        content = content.replace(from, to);
        modified = true;
      }
    }
    
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(`✗ ${filePath}:`, error.message);
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
    } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
      const result = processFile(fullPath);
      if (result > 0) {
        console.log(`✓ ${path.relative(LIB_DIR, fullPath)}`);
        count += result;
      }
    }
  }
  
  return count;
}

console.log('修复所有import路径...\n');
const count = walkDir(LIB_DIR);
console.log(`\n✅ 共修复 ${count} 个文件`);

