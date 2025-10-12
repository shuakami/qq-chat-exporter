/**
 * 修复所有TypeScript import问题
 * 1. 添加.js扩展名
 * 2. 修正type-only imports
 * 3. 处理路径别名
 */

const fs = require('fs');
const path = require('path');

const LIB_DIR = path.resolve(__dirname, '../lib');

function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // 1. 修正相对路径import，添加.js扩展名
    content = content.replace(
      /from\s+['"](\.[^'"]+?)['"]/g,
      (match, importPath) => {
        // 跳过已有扩展名
        if (/\.(js|mjs|ts|json)$/.test(importPath)) return match;
        // 跳过node_modules
        if (importPath.startsWith('.') && !importPath.includes('/node_modules/')) {
          modified = true;
          return `from '${importPath}.js'`;
        }
        return match;
      }
    );
    
    // 2. type-only imports (Express类型)
    content = content.replace(
      /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]express['"]/g,
      (match, imports) => {
        // 检查是否只用于类型
        if (/\b(Request|Response|Application|NextFunction)\b/.test(imports)) {
          modified = true;
          return `import type { ${imports} } from 'express'`;
        }
        return match;
      }
    );
    
    // 3. 混合import/type import分离
    content = content.replace(
      /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]express['"]/g,
      (match, imports) => {
        const parts = imports.split(',').map(s => s.trim());
        const types = parts.filter(p => /^(Request|Response|Application|NextFunction)$/.test(p));
        const values = parts.filter(p => !/^(Request|Response|Application|NextFunction)$/.test(p));
        
        if (types.length > 0 && values.length > 0) {
          modified = true;
          return `import type { ${types.join(', ')} } from 'express';\nimport { ${values.join(', ')} } from 'express'`;
        }
        return match;
      }
    );
    
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
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
    } else if (entry.isFile() && /\.ts$/.test(entry.name)) {
      const result = processFile(fullPath);
      if (result > 0) {
        console.log(`✓ ${path.relative(LIB_DIR, fullPath)}`);
        count += result;
      }
    }
  }
  
  return count;
}

console.log('修复TypeScript import问题...\n');
const count = walkDir(LIB_DIR);
console.log(`\n✅ 共修复 ${count} 个文件`);

