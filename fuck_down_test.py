import os

import pyautogui
import time
import json
import logging
import win32api
import win32con

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()
logger.handlers[0].setFormatter(logging.Formatter('%(asctime)s - %(message)s'))

# 不可点击区域保存文件
avoid_area_file = 'avoid_area.json'

def record_avoid_area():
    """记录用户点击的不可点击区域"""
    avoid_area = []
    logger.info("请依次点击不可点击区域的左上、右上、左下、右下四个角")

    while len(avoid_area) < 4:
        x, y = pyautogui.position()
        if win32api.GetKeyState(win32con.VK_RBUTTON) < 0:  # 检查右键点击
            avoid_area.append((x, y))
            logger.info(f"记录坐标：({x}, {y})")
            time.sleep(1)  # 防止多次记录同一个点击

    logger.info(f"记录的不可点击区域坐标：{avoid_area}")

    # 保存不可点击区域
    with open(avoid_area_file, 'w', encoding='utf-8') as f:
        json.dump(avoid_area, f, ensure_ascii=False, indent=4)

    return avoid_area

def load_avoid_area():
    """加载保存的不可点击区域"""
    if not os.path.exists(avoid_area_file):
        logger.error("未找到不可点击区域文件，请先运行record_avoid_area函数记录区域")
        return None

    with open(avoid_area_file, 'r', encoding='utf-8') as f:
        avoid_area = json.load(f)

    return avoid_area

def is_click_safe(click_position, avoid_area):
    """检查点击位置是否安全"""
    if avoid_area:
        (ax1, ay1), (_, ay2), (ax3, _), (_, _) = avoid_area
        px, py = click_position
        if ax1 <= px <= ax3 and ay1 <= py <= ay2:
            return False
    return True

def main():
    logger.info("按右键以记录不可点击区域")
    avoid_area = record_avoid_area()
    if avoid_area:
        logger.info(f"不可点击区域已记录：{avoid_area}")
    else:
        logger.error("记录不可点击区域失败")

if __name__ == "__main__":
    main()
