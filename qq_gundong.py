import pyautogui
import time
import win32gui
from tqdm import tqdm


def get_qq_window_position():
    """获取QQ窗口位置并置于前台"""
    hwnd = win32gui.FindWindow(None, "QQ")
    if hwnd:
        win32gui.SetForegroundWindow(hwnd)
        rect = win32gui.GetWindowRect(hwnd)
        return rect
    else:
        print("未找到QQ窗口")
        return None


def scroll_chat():
    """自动持续滚动QQ聊天记录"""
    rect = get_qq_window_position()
    if rect:
        # 定位到QQ聊天窗口中间
        center_x = (rect[0] + rect[2]) // 2
        center_y = (rect[1] + rect[3]) // 2
        pyautogui.moveTo(center_x, center_y)

        total_time = 360  # 6分钟
        start_time = time.monotonic()
        end_time = start_time + total_time

        # 创建进度条
        with tqdm(total=total_time, desc="Scrolling QQ chat",
                  bar_format="{l_bar}{bar}| {n:.1f}/{total:.1f}s [{elapsed}<{remaining}, {rate_fmt}{postfix}]") as pbar:
            last_update = start_time
            while time.monotonic() < end_time:
                pyautogui.scroll(1000)  # 正数表示向上滚动
                time.sleep(0.05)  # 短暂休息以避免CPU占用过高

                current_time = time.monotonic()
                elapsed = current_time - last_update
                if elapsed >= 0.1:  # 每0.1秒更新一次进度条
                    pbar.update(elapsed)
                    last_update = current_time

                # 更新预计完成时间
                remaining = end_time - current_time
                eta = time.strftime("%H:%M:%S", time.localtime(time.time() + remaining))
                pbar.set_postfix(ETA=eta)


if __name__ == "__main__":
    scroll_chat()