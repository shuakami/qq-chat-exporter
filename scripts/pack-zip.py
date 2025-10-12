#!/usr/bin/env python3
"""QCE 插件快速压缩工具"""
import os
import sys
import zipfile
from pathlib import Path

def create_zip(source_dir, output_file):
    """创建 ZIP 压缩包并显示进度"""
    source_path = Path(source_dir)
    if not source_path.exists():
        print(f"[错误] 目录不存在: {source_dir}")
        sys.exit(1)
    
    print(f"[->] 正在创建 ZIP: {output_file}")
    print(f"[->] 源目录: {source_dir}")
    
    file_count = 0
    total_size = 0
    
    with zipfile.ZipFile(output_file, 'w', zipfile.ZIP_DEFLATED, compresslevel=5) as zipf:
        for root, dirs, files in os.walk(source_path):
            for file in files:
                file_path = Path(root) / file
                arcname = file_path.relative_to(source_path.parent)
                
                zipf.write(file_path, arcname)
                file_count += 1
                total_size += file_path.stat().st_size
                
                if file_count % 100 == 0:
                    print(f"[->] 已压缩 {file_count} 个文件...", end='\r')
    
    output_size = Path(output_file).stat().st_size
    compression_ratio = (1 - output_size / total_size) * 100 if total_size > 0 else 0
    
    print(f"\n[x] 压缩完成！")
    print(f"    文件数: {file_count}")
    print(f"    原始大小: {total_size / 1024 / 1024:.2f} MB")
    print(f"    压缩后: {output_size / 1024 / 1024:.2f} MB")
    print(f"    压缩率: {compression_ratio:.1f}%")
    
    return output_file

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("用法: python pack-zip.py <源目录> <输出文件>")
        sys.exit(1)
    
    source = sys.argv[1]
    output = sys.argv[2]
    
    create_zip(source, output)

