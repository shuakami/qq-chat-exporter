#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QCE JSON 到 Excel 转换工具
将 QQ Chat Exporter 导出的 JSON 文件转换为 Excel 格式
"""

import json
import pandas as pd
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import os
import sys
import argparse
import psutil
import gc
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
import logging


class QCEJsonToExcelConverter:
    """QCE JSON 到 Excel 转换器"""

    # Excel 单个 sheet 最大行数（保留安全余量）
    MAX_ROWS_PER_SHEET = 1_000_000

    def __init__(self, max_rows_per_sheet: int = MAX_ROWS_PER_SHEET, verbose: bool = False):
        self.max_rows_per_sheet = max_rows_per_sheet
        self.verbose = verbose
        self.setup_logging()
        self.batch_size = 5000  # 每批处理的消息数量
        self.process = psutil.Process()

    def setup_logging(self):
        """设置日志"""
        level = logging.DEBUG if self.verbose else logging.INFO
        logging.basicConfig(
            level=level,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('qce_converter.log', encoding='utf-8'),
                logging.StreamHandler(sys.stdout)
            ]
        )
        self.logger = logging.getLogger(__name__)

    def get_memory_usage(self) -> str:
        """获取当前内存使用情况"""
        mem_info = self.process.memory_info()
        mem_mb = mem_info.rss / (1024 * 1024)
        return f"{mem_mb:.1f} MB"

    def select_input_file(self) -> Optional[str]:
        """选择输入的JSON文件"""
        root = tk.Tk()
        root.withdraw()  # 隐藏主窗口

        file_path = filedialog.askopenfilename(
            title="选择QCE导出的JSON文件",
            filetypes=[
                ("JSON files", "*.json"),
                ("All files", "*.*")
            ]
        )

        root.destroy()
        return file_path if file_path else None

    def select_output_file(self, input_path: str) -> Optional[str]:
        """选择输出的Excel文件"""
        root = tk.Tk()
        root.withdraw()

        # 默认输出文件名
        base_name = os.path.splitext(os.path.basename(input_path))[0]
        default_name = f"{base_name}_converted.xlsx"

        file_path = filedialog.asksaveasfilename(
            title="保存Excel文件",
            defaultextension=".xlsx",
            initialfile=default_name,
            filetypes=[
                ("Excel files", "*.xlsx"),
                ("All files", "*.*")
            ]
        )

        root.destroy()
        return file_path if file_path else None

    def parse_message_elements(self, elements: List[Dict]) -> Dict[str, Any]:
        """解析消息元素，提取结构化信息"""
        element_info = {
            'has_text': False,
            'has_image': False,
            'has_file': False,
            'has_video': False,
            'has_audio': False,
            'has_face': False,
            'has_reply': False,
            'has_forward': False,
            'has_location': False,
            'has_json_card': False,
            'element_types': [],
            'image_count': 0,
            'file_count': 0,
            'video_count': 0,
            'audio_count': 0,
            'face_count': 0
        }

        for element in elements:
            element_type = element.get('type', '')
            element_info['element_types'].append(element_type)

            if element_type == 'text':
                element_info['has_text'] = True
            elif element_type == 'image':
                element_info['has_image'] = True
                element_info['image_count'] += 1
            elif element_type == 'file':
                element_info['has_file'] = True
                element_info['file_count'] += 1
            elif element_type == 'video':
                element_info['has_video'] = True
                element_info['video_count'] += 1
            elif element_type == 'audio':
                element_info['has_audio'] = True
                element_info['audio_count'] += 1
            elif element_type in ['face', 'market_face']:
                element_info['has_face'] = True
                element_info['face_count'] += 1
            elif element_type == 'reply':
                element_info['has_reply'] = True
            elif element_type == 'forward':
                element_info['has_forward'] = True
            elif element_type == 'location':
                element_info['has_location'] = True
            elif element_type == 'json':
                element_info['has_json_card'] = True

        element_info['element_types'] = '|'.join(element_info['element_types'])
        return element_info

    def parse_resources(self, resources: List[Dict]) -> Dict[str, Any]:
        """解析资源信息"""
        resource_info = {
            'resource_count': len(resources),
            'total_size': 0,
            'resource_types': [],
            'filenames': []
        }

        for resource in resources:
            resource_info['total_size'] += resource.get('size', 0)
            resource_type = resource.get('type', '')
            filename = resource.get('filename', '')

            if resource_type:
                resource_info['resource_types'].append(resource_type)
            if filename:
                resource_info['filenames'].append(filename)

        resource_info['resource_types'] = '|'.join(
            resource_info['resource_types'])
        resource_info['filenames'] = '|'.join(resource_info['filenames'])

        return resource_info

    def format_datetime(self, timestamp: int) -> str:
        """格式化时间戳为可读时间"""
        try:
            dt = datetime.fromtimestamp(timestamp / 1000)
            return dt.strftime('%Y-%m-%d %H:%M:%S')
        except (ValueError, TypeError, OSError):
            return str(timestamp)

    def convert_message_to_row(self, message: Dict) -> Optional[Dict[str, Any]]:
        """将单条消息转换为Excel行数据"""
        try:
            # 基础消息信息
            row_data = {
                '消息ID': message.get('id', ''),
                '消息序号': message.get('seq', ''),
                '时间戳': message.get('timestamp', 0),
                '发送时间': self.format_datetime(message.get('timestamp', 0)),
                'RFC3339时间': message.get('time', ''),
                '消息类型': message.get('type', ''),
                '是否撤回': message.get('recalled', False),
                '是否系统消息': message.get('system', False)
            }

            # 发送者信息
            sender = message.get('sender', {})
            row_data.update({
                '发送者UID': sender.get('uid', ''),
                '发送者QQ': sender.get('uin', ''),
                '发送者昵称': sender.get('name', ''),
                '发送者备注': sender.get('remark', '')
            })

            # 消息内容
            content = message.get('content', {})
            row_data.update({
                '文本内容': content.get('text', ''),
                'HTML内容': content.get('html', ''),
            })

            # 解析消息元素
            elements = content.get('elements', [])
            element_info = self.parse_message_elements(elements)
            row_data.update({
                '包含文本': element_info['has_text'],
                '包含图片': element_info['has_image'],
                '包含文件': element_info['has_file'],
                '包含视频': element_info['has_video'],
                '包含语音': element_info['has_audio'],
                '包含表情': element_info['has_face'],
                '包含回复': element_info['has_reply'],
                '包含转发': element_info['has_forward'],
                '包含位置': element_info['has_location'],
                '包含卡片': element_info['has_json_card'],
                '元素类型列表': element_info['element_types'],
                '图片数量': element_info['image_count'],
                '文件数量': element_info['file_count'],
                '视频数量': element_info['video_count'],
                '语音数量': element_info['audio_count'],
                '表情数量': element_info['face_count']
            })

            # 解析资源信息
            resources = content.get('resources', [])
            resource_info = self.parse_resources(resources)
            row_data.update({
                '资源总数': resource_info['resource_count'],
                '资源总大小': resource_info['total_size'],
                '资源类型列表': resource_info['resource_types'],
                '资源文件名列表': resource_info['filenames']
            })

            return row_data
        except Exception as e:
            msg_id = message.get('id', 'unknown')
            self.logger.warning(f"处理消息失败 {msg_id}: {e}")
            return None

    def load_json_with_streaming(self, file_path: str) -> Tuple[Dict, Dict]:
        """使用流式加载JSON文件，支持超大文件"""
        try:
            # 先读取文件大小
            file_size = os.path.getsize(file_path)
            size_mb = file_size / (1024*1024)
            self.logger.info(f"JSON文件大小: {size_mb:.2f} MB")

            # 如果文件很大，提醒用户
            if file_size > 100 * 1024 * 1024:  # 100MB
                size_mb = file_size / (1024*1024)
                msg = (f"文件大小为 {size_mb:.1f} MB，"
                       "处理可能需要较长时间。\n是否继续？")
                
                # 如果在命令行模式，自动继续
                if '--no-gui' in sys.argv:
                    self.logger.info(f"大文件模式：{size_mb:.1f} MB")
                else:
                    result = messagebox.askyesno("大文件警告", msg)
                    if not result:
                        raise Exception("用户取消了大文件处理")

            self.logger.info(f"开始加载 JSON 文件，当前内存: {self.get_memory_usage()}")
            
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            self.logger.info(f"JSON 加载完成，当前内存: {self.get_memory_usage()}")

            metadata = {
                'software_name': data.get('metadata', {}).get('name', ''),
                'software_version': data.get('metadata', {}).get('version', ''),
                'chat_name': data.get('chatInfo', {}).get('name', ''),
                'chat_type': data.get('chatInfo', {}).get('type', ''),
                'participant_count': data.get('chatInfo', {}).get(
                    'participantCount', 0),
                'total_messages': data.get('statistics', {}).get(
                    'totalMessages', 0),
                'time_range_start': data.get('statistics', {}).get(
                    'timeRange', {}).get('start', ''),
                'time_range_end': data.get('statistics', {}).get(
                    'timeRange', {}).get('end', ''),
                'duration_days': data.get('statistics', {}).get(
                    'timeRange', {}).get('durationDays', 0)
            }

            return data, metadata

        except Exception as e:
            self.logger.error(f"加载JSON文件失败: {e}")
            raise

    def process_and_write_streaming(
        self,
        messages: List[Dict],
        writer: pd.ExcelWriter,
        progress_window: Optional[tk.Toplevel] = None
    ) -> Tuple[int, int]:
        """流式处理并写入 Excel（真正的流式，不保存所有数据到内存）"""
        total_messages = len(messages)
        num_sheets = (total_messages + self.max_rows_per_sheet - 1) // self.max_rows_per_sheet
        
        self.logger.info(f"消息总数: {total_messages}, 需要 {num_sheets} 个 sheet")
        
        if num_sheets > 1:
            self.logger.warning(f"消息数量超过 {self.max_rows_per_sheet}，将分成 {num_sheets} 个 sheet")
        
        sheets_written = 0
        total_processed = 0
        total_failed = 0
        current_sheet_rows = []
        current_sheet_idx = 0
        
        for msg_idx, message in enumerate(messages):
            # 处理消息
            row_data = self.convert_message_to_row(message)
            if row_data:
                current_sheet_rows.append(row_data)
                total_processed += 1
            else:
                total_failed += 1
            
            # 更新进度（每1000条更新一次）
            if (msg_idx + 1) % 1000 == 0:
                progress = (msg_idx + 1) / total_messages * 80  # 80% 用于处理
                msg = f"已处理 {msg_idx + 1}/{total_messages} 条消息 [内存: {self.get_memory_usage()}]"
                if progress_window:
                    self.update_progress(progress_window, progress, msg)
                else:
                    self.logger.info(msg)
            
            # 当前 sheet 满了，写入并清空
            if len(current_sheet_rows) >= self.max_rows_per_sheet:
                sheet_name = f'聊天消息-{current_sheet_idx + 1}' if num_sheets > 1 else '聊天消息'
                self._write_single_sheet(writer, sheet_name, current_sheet_rows, progress_window)
                sheets_written += 1
                current_sheet_idx += 1
                
                # 清空当前批次
                current_sheet_rows = []
                gc.collect()
                self.logger.info(f"Sheet 写入完成，释放内存后: {self.get_memory_usage()}")
        
        # 写入剩余数据
        if current_sheet_rows:
            sheet_name = f'聊天消息-{current_sheet_idx + 1}' if num_sheets > 1 else '聊天消息'
            self._write_single_sheet(writer, sheet_name, current_sheet_rows, progress_window)
            sheets_written += 1
            current_sheet_rows = []
            gc.collect()
        
        return sheets_written, total_failed
    
    def _write_single_sheet(
        self,
        writer: pd.ExcelWriter,
        sheet_name: str,
        rows: List[Dict],
        progress_window: Optional[tk.Toplevel] = None
    ):
        """写入单个 sheet"""
        self.logger.info(f"写入 sheet '{sheet_name}': {len(rows)} 行")
        self.logger.info(f"写入前内存: {self.get_memory_usage()}")
        
        df = pd.DataFrame(rows)
        df.to_excel(writer, sheet_name=sheet_name, index=False)
        
        del df
        gc.collect()
        
        self.logger.info(f"Sheet '{sheet_name}' 写入完成")

    def convert_to_excel(self, input_path: str, output_path: str, progress_window: Optional[tk.Toplevel] = None):
        """执行转换"""
        self.logger.info(f"=" * 70)
        self.logger.info(f"开始转换: {input_path} -> {output_path}")
        self.logger.info(f"=" * 70)

        try:
            # 加载JSON数据
            data, metadata = self.load_json_with_streaming(input_path)
            messages = data.get('messages', [])

            self.logger.info(f"找到 {len(messages)} 条消息")

            # 如果没有传入进度窗口，创建一个
            should_destroy_progress = False
            if progress_window is None and '--no-gui' not in sys.argv:
                progress_window = self.create_progress_window(len(messages))
                should_destroy_progress = True

            try:
                # 提取统计信息（在删除 data 前）
                message_types = data.get('statistics', {}).get('messageTypes', {})
                senders = data.get('statistics', {}).get('senders', [])
                total_messages_count = len(messages)
                
                self.logger.info(f"开始流式处理 {total_messages_count} 条消息")
                self.logger.info(f"处理前内存: {self.get_memory_usage()}")
                
                # 开始写入 Excel（流式处理，不保存所有数据到内存）
                if progress_window:
                    self.update_progress(progress_window, 5, "开始流式处理...")
                
                self.logger.info(f"开始写入 Excel: {output_path}")
                
                with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
                    # 流式处理并写入消息数据
                    sheets_count, failed_count = self.process_and_write_streaming(
                        messages, writer, progress_window
                    )
                    
                    if failed_count > 0:
                        self.logger.warning(f"有 {failed_count} 条消息处理失败")
                    
                    total_processed = total_messages_count - failed_count
                    
                    # 释放消息数据
                    del messages
                    del data
                    gc.collect()
                    self.logger.info(f"释放原始数据后内存: {self.get_memory_usage()}")
                    
                    # 创建统计信息表
                    if progress_window:
                        self.update_progress(progress_window, 92, "写入统计信息...")
                    
                    stats_data = []
                    stats_data.append(['软件名称', metadata['software_name']])
                    stats_data.append(['软件版本', metadata['software_version']])
                    stats_data.append(['聊天名称', metadata['chat_name']])
                    stats_data.append(['聊天类型', metadata['chat_type']])
                    stats_data.append(['参与人数', metadata['participant_count']])
                    stats_data.append(['消息总数', total_messages_count])
                    stats_data.append(['成功处理', total_processed])
                    stats_data.append(['处理失败', failed_count])
                    stats_data.append(['Sheet 数量', sheets_count])
                    stats_data.append(['开始时间', metadata['time_range_start']])
                    stats_data.append(['结束时间', metadata['time_range_end']])
                    stats_data.append(['持续天数', metadata['duration_days']])

                    # 添加消息类型统计
                    for msg_type, count in message_types.items():
                        stats_data.append([f'消息类型-{msg_type}', count])

                    stats_df = pd.DataFrame(stats_data, columns=['项目', '值'])
                    stats_df.to_excel(writer, sheet_name='统计信息', index=False)

                    # 创建发送者统计表
                    if progress_window:
                        self.update_progress(progress_window, 96, "写入发送者统计...")
                    
                    if senders:
                        senders_df = pd.DataFrame(senders)
                        senders_df.to_excel(writer, sheet_name='发送者统计', index=False)

                if progress_window:
                    self.update_progress(progress_window, 100, "转换完成!")

                self.logger.info(f"=" * 70)
                self.logger.info(f"转换完成!")
                self.logger.info(f"输出文件: {output_path}")
                self.logger.info(f"处理了 {total_processed}/{total_messages_count} 条消息")
                self.logger.info(f"生成了 {sheets_count} 个消息 sheet")
                self.logger.info(f"最终内存: {self.get_memory_usage()}")
                self.logger.info(f"=" * 70)

                # 验证输出
                self.verify_output(output_path, total_processed)

                # 显示成功消息
                if '--no-gui' not in sys.argv:
                    success_msg = (
                        f"成功转换 {total_processed} 条消息到Excel文件:\n"
                        f"{output_path}\n\n"
                        f"生成了 {sheets_count} 个消息 sheet"
                    )
                    if sheets_count > 1:
                        success_msg += f"\n(每个 sheet 最多 {self.max_rows_per_sheet:,} 行)"
                    messagebox.showinfo("转换完成", success_msg)

            finally:
                if should_destroy_progress and progress_window:
                    progress_window.destroy()

        except Exception as e:
            self.logger.error(f"转换失败: {e}")
            if '--no-gui' not in sys.argv:
                messagebox.showerror("转换失败", f"转换过程中发生错误:\n{str(e)}")
            raise

    def verify_output(self, output_path: str, expected_rows: int):
        """验证输出的 Excel 文件"""
        try:
            self.logger.info("开始验证输出文件...")
            
            if not os.path.exists(output_path):
                raise Exception(f"输出文件不存在: {output_path}")
            
            file_size = os.path.getsize(output_path)
            if file_size == 0:
                raise Exception("输出文件为空")
            
            self.logger.info(f"输出文件大小: {file_size / (1024*1024):.2f} MB")
            
            # 读取并验证
            xl_file = pd.ExcelFile(output_path)
            sheet_names = xl_file.sheet_names
            
            self.logger.info(f"Excel 包含 {len(sheet_names)} 个 sheet: {sheet_names}")
            
            # 统计所有消息 sheet 的行数
            total_rows = 0
            for sheet_name in sheet_names:
                if sheet_name.startswith('聊天消息'):
                    df = pd.read_excel(output_path, sheet_name=sheet_name)
                    total_rows += len(df)
                    self.logger.info(f"  - {sheet_name}: {len(df)} 行")
            
            if total_rows != expected_rows:
                self.logger.warning(
                    f"行数不匹配！预期: {expected_rows}, 实际: {total_rows}, "
                    f"差异: {abs(total_rows - expected_rows)}"
                )
            else:
                self.logger.info(f"验证通过！总行数: {total_rows}")
            
        except Exception as e:
            self.logger.error(f"验证输出文件失败: {e}")
            # 验证失败不中断流程，只记录警告

    def create_progress_window(self, total_messages: int):
        """创建进度显示窗口"""
        progress_window = tk.Toplevel()
        progress_window.title("转换进度")
        progress_window.geometry("450x120")
        progress_window.resizable(False, False)

        # 居中显示窗口
        progress_window.transient()
        progress_window.grab_set()

        # 进度标签
        progress_label = tk.Label(
            progress_window, text=f"准备处理 {total_messages} 条消息...")
        progress_label.pack(pady=10)

        # 进度条
        progress_bar = ttk.Progressbar(
            progress_window, length=400, mode='determinate')
        progress_bar.pack(pady=10)

        # 百分比标签
        percent_label = tk.Label(progress_window, text="0%")
        percent_label.pack()

        # 存储组件引用
        progress_window.progress_label = progress_label
        progress_window.progress_bar = progress_bar
        progress_window.percent_label = percent_label

        progress_window.update()
        return progress_window

    def update_progress(self, window, progress, message):
        """更新进度"""
        if window and window.winfo_exists():
            window.progress_label.config(text=message)
            window.progress_bar['value'] = progress
            window.percent_label.config(text=f"{progress:.1f}%")
            window.update()

    def run_gui(self):
        """运行 GUI 模式"""
        print("QCE JSON to Excel Converter")
        print("=" * 50)

        # 选择输入文件
        input_file = self.select_input_file()
        if not input_file:
            print("未选择输入文件，退出...")
            return False

        print(f"输入文件: {input_file}")

        # 检查文件是否存在
        if not os.path.exists(input_file):
            messagebox.showerror("文件错误", "选择的文件不存在")
            return False

        # 选择输出文件
        output_file = self.select_output_file(input_file)
        if not output_file:
            print("未选择输出文件，退出...")
            return False

        print(f"输出文件: {output_file}")

        # 执行转换
        try:
            self.convert_to_excel(input_file, output_file)
            print("转换成功完成!")
            return True
        except Exception as e:
            print(f"转换失败: {e}")
            return False

    def run_cli(self, input_file: str, output_file: str):
        """运行命令行模式"""
        print("QCE JSON to Excel Converter (CLI Mode)")
        print("=" * 50)
        print(f"输入文件: {input_file}")
        print(f"输出文件: {output_file}")
        print(f"每个 Sheet 最大行数: {self.max_rows_per_sheet:,}")
        print("=" * 50)

        # 检查输入文件
        if not os.path.exists(input_file):
            print(f"错误: 输入文件不存在: {input_file}")
            return False

        # 执行转换
        try:
            self.convert_to_excel(input_file, output_file)
            print("\n转换成功完成!")
            return True
        except Exception as e:
            print(f"\n转换失败: {e}")
            import traceback
            traceback.print_exc()
            return False


def parse_arguments():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description='QCE JSON 到 Excel 转换工具 - 支持超大文件，自动分 sheet',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # GUI 模式（默认）
  python qce_json_to_excel.py
  
  # 命令行模式
  python qce_json_to_excel.py -i input.json -o output.xlsx
  
  # 自定义每个 sheet 最大行数
  python qce_json_to_excel.py -i input.json -o output.xlsx --max-rows-per-sheet 500000
  
  # 详细模式
  python qce_json_to_excel.py -i input.json -o output.xlsx --verbose
        """
    )
    
    parser.add_argument(
        '-i', '--input',
        type=str,
        help='输入的 JSON 文件路径'
    )
    
    parser.add_argument(
        '-o', '--output',
        type=str,
        help='输出的 Excel 文件路径'
    )
    
    parser.add_argument(
        '--max-rows-per-sheet',
        type=int,
        default=1_000_000,
        help='每个 sheet 的最大行数 (默认: 1,000,000)'
    )
    
    parser.add_argument(
        '--no-gui',
        action='store_true',
        help='禁用 GUI，纯命令行模式'
    )
    
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='详细日志输出'
    )
    
    return parser.parse_args()


def main():
    """主函数"""
    try:
        args = parse_arguments()
        
        # 创建转换器
        converter = QCEJsonToExcelConverter(
            max_rows_per_sheet=args.max_rows_per_sheet,
            verbose=args.verbose
        )
        
        # 判断运行模式
        if args.input and args.output:
            # CLI 模式
            success = converter.run_cli(args.input, args.output)
        else:
            # GUI 模式
            if args.no_gui:
                print("错误: --no-gui 模式需要同时指定 -i 和 -o 参数")
                print("使用 --help 查看帮助")
                return False
            success = converter.run_gui()
        
        return success
        
    except KeyboardInterrupt:
        print("\n程序被用户中断")
        return False
    except Exception as e:
        print(f"程序错误: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
