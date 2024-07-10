import pyautogui
import time
import json
import logging
import os
import cv2
import numpy as np
from PIL import ImageGrab
import win32gui
import win32con
import win32clipboard

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()
logger.handlers[0].setFormatter(logging.Formatter('%(asctime)s - %(message)s'))

# 不可点击区域
# 此部分请执行fuck_down_test.py获取并覆盖下面的部分
avoid_area = [(1248, 589), (1299, 589), (1249, 611), (1299, 613)]

# 设置消息颜色
my_message_color = (0, 153, 255)
other_message_color = (241, 252, 247)

# 定义滚动延迟
scroll_delay = 1

# 聊天数据保存文件
training_data_file = 'training_data.json'


def get_qq_window_position():
    """获取QQ窗口位置"""
    hwnd = win32gui.FindWindow(None, "QQ")
    if hwnd:
        rect = win32gui.GetWindowRect(hwnd)
        logger.info(f"找到QQ窗口，位置：{rect}")
        return hwnd
    logger.warning("未找到QQ窗口")
    return None


def capture_screen():
    """捕获全屏截图"""
    screenshot = ImageGrab.grab()
    screenshot.save("full_screen.png")
    logger.info("已保存全屏截图")
    return screenshot


def find_message_areas(screenshot):
    """查找消息区域"""
    pixels = screenshot.load()
    message_areas = []
    current_area = None
    for y in range(screenshot.height):
        found_color = False
        for x in range(screenshot.width):
            if pixels[x, y][:3] in (my_message_color, other_message_color):
                found_color = True
                if current_area is None or y - current_area[3] > 5:  # 新消息区域
                    if current_area:
                        message_areas.append(current_area)
                    current_area = [x, y, x, y]
                else:
                    current_area[2] = max(current_area[2], x)
                    current_area[3] = y
                break
        if not found_color and current_area:
            message_areas.append(current_area)
            current_area = None
    if current_area:
        message_areas.append(current_area)
    logger.info(f"找到 {len(message_areas)} 个消息区域")
    return message_areas


def copy_message(area, message_color):
    """复制消息内容并返回消息及其类型"""
    x, y, _, _ = area

    if is_click_safe((x + 5, y + 5)):
        try:
            # 再次检查
            if is_click_safe((x + 5, y + 5)):
                # 点击消息区域
                logger.info(f"点击消息区域: ({x + 5}, {y + 5})")

            pyautogui.click(x + 5, y + 5)
            time.sleep(0.5)
            pyautogui.hotkey('ctrl', 'a')
            time.sleep(0.5)
            pyautogui.hotkey('ctrl', 'c')
            time.sleep(0.5)

            win32clipboard.OpenClipboard()
            try:
                message = win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
            except TypeError:
                logger.warning("剪贴板中没有文本数据")
                message = ""
            finally:
                win32clipboard.CloseClipboard()

            # 根据颜色判断消息来源
            message_type = "my_message" if message_color == my_message_color else "other_message"
            return {"text": message, "type": message_type}
        except Exception as e:
            logger.error(f"复制消息时发生错误: {str(e)}")
            return {"text": "", "type": ""}
    else:
        logger.info("取消操作以避免点击危险区域")
        return {"text": "", "type": ""}


def process_visible_messages():
    """处理当前可见的所有消息并加入类型标识"""
    screenshot = capture_screen()
    message_areas = find_message_areas(screenshot)
    processed_messages = []

    for area in message_areas:
        x, y, _, _ = area
        pixel_color = screenshot.getpixel((x, y))  # 获取消息颜色
        message_data = copy_message(area, pixel_color[:3])  # 传递消息颜色
        if message_data["text"] and message_data not in processed_messages:
            save_to_json(message_data)
            processed_messages.append(message_data)
            logger.info(f"已处理消息: {message_data['text'][:30]}...")
        else:
            logger.info("跳过重复或空消息")

    return len(processed_messages), message_areas[-1] if message_areas else None

def save_to_json(message_data):
    """保存消息到JSON文件，按格式区分消息类型"""
    data = []
    try:
        if os.path.exists(training_data_file):
            with open(training_data_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
    except json.JSONDecodeError:
        logger.warning("JSON文件解码错误，创建新的数据列表")

    data.append(message_data)

    with open(training_data_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def locate_avoid_button():
    """定位需要避免点击的按钮"""
    screenshot_pil = capture_screen()
    screenshot = cv2.cvtColor(np.array(screenshot_pil), cv2.COLOR_RGB2BGR)
    template = cv2.imread('dist/fuck_down.png', cv2.IMREAD_GRAYSCALE)
    if screenshot is None or template is None:
        logger.error("未能加载截图或模板")
        return None
    screenshot_gray = cv2.cvtColor(screenshot, cv2.COLOR_BGR2GRAY)
    res = cv2.matchTemplate(screenshot_gray, template, cv2.TM_CCOEFF_NORMED)
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)
    if max_val > 0.5:  # 匹配阈值0.5
        button_x, button_y = max_loc
        button_width, button_height = template.shape[::-1]
        return (button_x, button_y, button_x + button_width, button_y + button_height)
    return None

def is_click_safe(click_position):
    """检查点击位置是否安全"""
    ax1, ay1 = avoid_area[0]
    ax2, ay2 = avoid_area[3]
    px, py = click_position
    if ax1 <= px <= ax2 and ay1 <= py <= ay2:
        return False
    return True

def scroll_chat_window():
    """滚动聊天窗口并处理消息"""
    total_processed = 0
    no_new_message_count = 0
    last_message_area = None

    while no_new_message_count < 10:  # 连续10次没有新消息时退出
        processed_count, last_area = process_visible_messages()
        total_processed += processed_count

        if processed_count == 0:
            no_new_message_count += 1
            logger.info(f"未找到新消息，继续滚动 (尝试 {no_new_message_count}/10)")
        else:
            no_new_message_count = 0
            logger.info(f"本次处理了 {processed_count} 条消息")

        if last_area:
            last_message_area = last_area

        if last_message_area:
            print("移动 - 位置:", last_message_area)
            # 移动到屏幕中央偏上的位置进行滚动
            pyautogui.moveTo(pyautogui.size()[0] // 2, pyautogui.size()[1] // 4)
        else:
            # 如果没有找到消息区域,移动到屏幕的中间位置
            pyautogui.moveTo(pyautogui.size()[0] // 2, pyautogui.size()[1] // 2)

        pyautogui.scroll(-450)  # 向下滚动
        time.sleep(scroll_delay)

    logger.info(f"总共处理了 {total_processed} 条消息")


def main():
    hwnd = get_qq_window_position()
    if hwnd:
        win32gui.SetForegroundWindow(hwnd)  # 将QQ窗口置于前端
        time.sleep(1)
        scroll_chat_window()
    else:
        logger.error("无法找到QQ窗口，请确保QQ正在运行。")


if __name__ == "__main__":
    main()
