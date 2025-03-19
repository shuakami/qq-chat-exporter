// 延迟函数
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 直接激活焦点并发送键盘事件
export function activateFocusAndPressKey(container, key) {
  document.activeElement.blur();
  container.focus();
  const keyCode = key === 'PageUp' ? 33 : 34;
  const kdEvent = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: key,
    code: key === 'PageUp' ? 'PageUp' : 'PageDown',
    keyCode: keyCode,
    which: keyCode,
    composed: true,
    view: window
  });
  try {
    Object.defineProperties(kdEvent, {
      keyCode: { value: keyCode },
      which: { value: keyCode },
      key: { value: key }
    });
  } catch (e) { }
  container.dispatchEvent(kdEvent);
  setTimeout(() => {
    const kuEvent = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key: key,
      code: key === 'PageUp' ? 'PageUp' : 'PageDown',
      keyCode: keyCode,
      which: keyCode,
      composed: true,
      view: window
    });
    try {
      Object.defineProperties(kuEvent, {
        keyCode: { value: keyCode },
        which: { value: keyCode },
        key: { value: key }
      });
    } catch (e) { }
    container.dispatchEvent(kuEvent);
  }, 100);
}

// 模拟输入流
export function simulateInputFlow(container, key, scrollDuration) {
  const keyCode = key === 'PageUp' ? 33 : 34;
  container.focus();
  const beforeInputEvent = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: key
  });
  container.dispatchEvent(beforeInputEvent);
  const keydownEvent = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: key,
    code: key === 'PageUp' ? 'PageUp' : 'PageDown',
    keyCode: keyCode,
    which: keyCode
  });
  container.dispatchEvent(keydownEvent);
  let pressTime = 0;
  const totalTime = scrollDuration;
  const pressInterval = setInterval(() => {
    pressTime += 100;
    if (pressTime >= totalTime) {
      clearInterval(pressInterval);
      const keyupEvent = new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: key,
        code: key === 'PageUp' ? 'PageUp' : 'PageDown',
        keyCode: keyCode,
        which: keyCode
      });
      container.dispatchEvent(keyupEvent);
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: key
      });
      container.dispatchEvent(inputEvent);
    }
  }, 100);
}

// 模拟滚轮事件
export function simulateWheelEvent(element, deltaY, scrollDuration) {
  const duration = scrollDuration;
  const steps = Math.floor(duration / 50);
  const stepDelta = deltaY / steps;
  let currentStep = 0;
  const wheelInterval = setInterval(() => {
    if (currentStep >= steps) {
      clearInterval(wheelInterval);
      return;
    }
    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: stepDelta,
      deltaMode: 0,
    });
    element.dispatchEvent(wheelEvent);
    currentStep++;
  }, 50);
}

// 多种不同的滚动方法
export async function scrollWithMethod(container, direction, method, scrollDuration) {
  const pageSize = container.clientHeight;
  switch (method) {
    case 0:
      container.focus();
      activateFocusAndPressKey(container, direction === 'up' ? 'PageUp' : 'PageDown');
      break;
    case 1:
      container.focus();
      simulateInputFlow(container, direction === 'up' ? 'PageUp' : 'PageDown', scrollDuration);
      break;
    case 2:
      if (typeof container.scroll === 'function') {
        if (direction === 'up') {
          container.scroll(0, container.scrollTop - pageSize);
        } else {
          container.scroll(0, container.scrollTop + pageSize * 0.3);
        }
      } else {
        if (direction === 'up') {
          container.scrollTop -= pageSize;
        } else {
          container.scrollTop += pageSize * 0.3;
        }
      }
      break;
    case 3:
      simulateWheelEvent(container, direction === 'up' ? -pageSize : pageSize * 0.3, scrollDuration);
      break;
    case 4:
      container.scrollTo({
        top: direction === 'up' ? container.scrollTop - pageSize : container.scrollTop + pageSize * 0.3,
        behavior: 'smooth'
      });
      break;
  }
  container.dispatchEvent(new Event('scroll', { bubbles: true }));
} 