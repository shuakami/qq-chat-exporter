/**
 * ModernHtmlTemplates.ts html模板字符串
 */

/**
 * 模板渲染：替换 {{KEY}} 占位符
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? vars[k] : ''));
}

export const MODERN_CSS = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        /* CSS Variables for Theme */
        :root {
            --bg-primary: #ffffff;
            --bg-secondary: #f5f5f7;
            --text-primary: #1d1d1f;
            --text-secondary: #86868b;
            --border-color: rgba(0, 0, 0, 0.08);
            --shadow: rgba(0, 0, 0, 0.05);
            --bubble-other: #f2f2f7;
            --bubble-self: #d1e9ff;
            --bubble-self-text: #1d1d1f;
            --at-mention-bg: rgba(29, 29, 31, 0.1);
            --at-mention-text: #1d1d1f;
            --reply-bg: rgba(29, 29, 31, 0.05);
            --reply-border: rgba(29, 29, 31, 0.25);
            --footer-gradient: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.02) 100%);
            --chat-scale: 1;
            --message-font-size: calc(17px * var(--chat-scale));
            --message-sender-size: calc(14px * var(--chat-scale));
            --message-time-size: calc(12px * var(--chat-scale));
        }
        
        [data-theme="dark"] {
            --bg-primary: #000000;
            --bg-secondary: #1c1c1e;
            --text-primary: #f5f5f7;
            --text-secondary: #98989f;
            --border-color: rgba(255, 255, 255, 0.12);
            --shadow: rgba(0, 0, 0, 0.3);
            --bubble-other: #1c1c1e;
            --bubble-self: #2d5a7b;
            --bubble-self-text: #e3f2fd;
            --at-mention-bg: rgba(245, 245, 247, 0.15);
            --at-mention-text: #f5f5f7;
            --reply-bg: rgba(255, 255, 255, 0.08);
            --reply-border: rgba(255, 255, 255, 0.2);
            --footer-gradient: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.03) 100%);
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.5; 
            font-size: 17px;
            -webkit-font-smoothing: antialiased;
            transition: background 0.3s, color 0.3s;
        }
        
        /* Toolbar - 底部胶囊 */
        .toolbar {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(249, 249, 249, 0.78);
            backdrop-filter: saturate(180%) blur(20px);
            border-radius: 20px;
            padding: 8px;
            z-index: 1000;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08),
                        0 8px 32px rgba(0, 0, 0, 0.06),
                        inset 0 0 0 0.5px rgba(0, 0, 0, 0.04);
        }
        
        [data-theme="dark"] .toolbar {
            background: rgba(44, 44, 46, 0.78);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3),
                        0 8px 32px rgba(0, 0, 0, 0.25),
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
        }
        
        .toolbar-content {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        
        /* 时间范围选择胶囊 */
        .time-range-container {
            position: relative;
        }
        .time-range-btn {
            padding: 8px 12px;
            border: none;
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.04);
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            color: var(--text-primary);
            font-size: 13px;
            font-weight: 500;
        }
        [data-theme="dark"] .time-range-btn {
            background: rgba(255, 255, 255, 0.08);
        }
        .time-range-btn:hover {
            background: rgba(0, 0, 0, 0.08);
        }
        [data-theme="dark"] .time-range-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        .time-range-btn svg {
            width: 16px !important;
            height: 16px !important;
            stroke-width: 2 !important;
        }
        .time-range-dropdown {
            position: absolute;
            bottom: calc(100% + 12px);
            right: 0;
            min-width: 240px;
            padding: 12px;
            border-radius: 14px;
            background: rgba(249, 249, 249, 0.88);
            backdrop-filter: saturate(180%) blur(20px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12),
                        0 8px 40px rgba(0, 0, 0, 0.08),
                        inset 0 0 0 0.5px rgba(0, 0, 0, 0.04);
            opacity: 0;
            transform: translateY(8px);
            pointer-events: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1001;
        }
        [data-theme="dark"] .time-range-dropdown {
            background: rgba(44, 44, 46, 0.88);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4),
                        0 8px 40px rgba(0, 0, 0, 0.3),
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
        }
        .time-range-dropdown.active {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }
        .time-range-inputs {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .time-range-input-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .time-range-input-group label {
            font-size: 12px;
            color: var(--text-secondary);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .time-range-input-group input {
            padding: 6px 10px;
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 8px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 13px;
            transition: all 0.2s;
        }
        [data-theme="dark"] .time-range-input-group input {
            border-color: rgba(255, 255, 255, 0.12);
            color-scheme: dark;
        }
        .time-range-input-group input:focus {
            outline: none;
            border-color: #1d1d1f;
            box-shadow: 0 0 0 3px rgba(29, 29, 31, 0.1);
        }
        [data-theme="dark"] .time-range-input-group input:focus {
            border-color: #f5f5f7;
            box-shadow: 0 0 0 3px rgba(245, 245, 247, 0.1);
        }
        .time-range-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(0, 0, 0, 0.08);
        }
        [data-theme="dark"] .time-range-actions {
            border-top-color: rgba(255, 255, 255, 0.12);
        }
        .time-range-actions button {
            flex: 1;
            padding: 6px 10px;
            border: none;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .time-range-actions .apply-btn {
            background: #1d1d1f;
            color: #ffffff;
        }
        [data-theme="dark"] .time-range-actions .apply-btn {
            background: #f5f5f7;
            color: #000000;
        }
        .time-range-actions .apply-btn:hover {
            opacity: 0.8;
        }
        .time-range-actions .clear-btn {
            background: rgba(0, 0, 0, 0.06);
            color: var(--text-primary);
        }
        [data-theme="dark"] .time-range-actions .clear-btn {
            background: rgba(255, 255, 255, 0.12);
        }
        .time-range-actions .clear-btn:hover {
            background: rgba(0, 0, 0, 0.1);
        }
        [data-theme="dark"] .time-range-actions .clear-btn:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        /* 分隔线 */
        .toolbar-separator {
            width: 1px;
            height: 20px;
            background: rgba(0, 0, 0, 0.08);
            margin: 0 4px;
        }
        
        [data-theme="dark"] .toolbar-separator {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-container {
            display: flex;
            align-items: center;
        }
        
        .search-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .search-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .search-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .search-input-wrapper {
            position: relative;
            width: 0;
            overflow: hidden;
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .search-input-wrapper.active {
            width: 240px;
            margin-left: 4px;
        }
        
        .search-input {
            width: 100%;
            padding: 7px 32px 7px 12px;
            border: none;
            border-radius: 12px;
            background: rgba(0, 0, 0, 0.06);
            color: var(--text-primary);
            font-size: 14px;
            outline: none;
            transition: all 0.2s;
            font-family: inherit;
        }
        
        [data-theme="dark"] .search-input {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .search-input:focus {
            background: rgba(0, 0, 0, 0.1);
        }
        
        [data-theme="dark"] .search-input:focus {
            background: rgba(255, 255, 255, 0.18);
        }
        
        .search-input::placeholder {
            color: var(--text-secondary);
        }
        
        .clear-search {
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 4px;
            border-radius: 50%;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .clear-search:hover {
            background: rgba(0, 0, 0, 0.1);
            color: var(--text-primary);
        }
        
        [data-theme="dark"] .clear-search:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        
        .clear-search svg {
            width: 14px !important;
            height: 14px !important;
            stroke-width: 2.5 !important;
        }
        
        .toolbar-actions {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        
        .filter-container {
            position: relative;
        }
        
        .filter-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .filter-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .filter-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .filter-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .filter-dropdown {
            position: absolute;
            bottom: calc(100% + 12px);
            right: 0;
            min-width: 200px;
            max-width: 280px;
            padding: 6px;
            border-radius: 14px;
            background: rgba(249, 249, 249, 0.88);
            backdrop-filter: saturate(180%) blur(20px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12),
                        0 8px 40px rgba(0, 0, 0, 0.08),
                        inset 0 0 0 0.5px rgba(0, 0, 0, 0.04);
            opacity: 0;
            transform: translateY(8px);
            pointer-events: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1001;
        }
        
        [data-theme="dark"] .filter-dropdown {
            background: rgba(44, 44, 46, 0.88);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4),
                        0 8px 40px rgba(0, 0, 0, 0.3),
                        inset 0 0 0 0.5px rgba(255, 255, 255, 0.08);
        }
        
        .filter-dropdown.active {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }
        
        /* 筛选搜索框 */
        .filter-search-wrapper {
            padding: 4px 6px 8px;
            border-bottom: 1px solid rgba(0, 0, 0, 0.08);
            margin-bottom: 6px;
        }
        
        [data-theme="dark"] .filter-search-wrapper {
            border-bottom-color: rgba(255, 255, 255, 0.12);
        }
        
        .filter-search-input {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 8px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 13px;
            outline: none;
            transition: all 0.2s;
        }
        
        [data-theme="dark"] .filter-search-input {
            border-color: rgba(255, 255, 255, 0.12);
        }
        
        .filter-search-input:focus {
            border-color: #1d1d1f;
            box-shadow: 0 0 0 2px rgba(29, 29, 31, 0.1);
        }
        
        [data-theme="dark"] .filter-search-input:focus {
            border-color: #f5f5f7;
            box-shadow: 0 0 0 2px rgba(245, 245, 247, 0.1);
        }
        
        .filter-search-input::placeholder {
            color: var(--text-secondary);
        }
        
        /* 筛选选项列表容器 */
        .filter-options-list {
            max-height: 320px;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
            scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
        }
        
        .filter-options-list::-webkit-scrollbar {
            width: 6px;
        }
        
        .filter-options-list::-webkit-scrollbar-track {
            background: transparent;
        }
        
        .filter-options-list::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 3px;
        }
        
        [data-theme="dark"] .filter-options-list::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
        }
        
        .filter-option {
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.15s;
            font-size: 14px;
            color: var(--text-primary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .filter-option:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .filter-option:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .filter-option.active {
            background: rgba(0, 0, 0, 0.08);
            font-weight: 600;
        }
        
        [data-theme="dark"] .filter-option.active {
            background: rgba(255, 255, 255, 0.15);
        }
        
        .filter-option.hidden {
            display: none;
        }
        
        /* 无搜索结果提示 */
        .filter-no-result {
            padding: 12px;
            text-align: center;
            color: var(--text-secondary);
            font-size: 13px;
            display: none;
        }
        
        .filter-no-result.visible {
            display: block;
        }
        
        .github-btn {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            text-decoration: none;
        }
        
        .github-btn:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .github-btn:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .github-btn svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        .theme-toggle {
            padding: 8px;
            border: none;
            border-radius: 12px;
            background: transparent;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }
        
        .theme-toggle:hover {
            background: rgba(0, 0, 0, 0.06);
        }
        
        [data-theme="dark"] .theme-toggle:hover {
            background: rgba(255, 255, 255, 0.12);
        }
        
        .theme-toggle svg {
            width: 18px !important;
            height: 18px !important;
            stroke-width: 2 !important;
        }
        
        /* 搜索高亮 */
        mark.highlight {
            background: #00ffc860 !important;
            color: #000000 !important;
            font-weight: 600;
            padding: 2px 4px;
            border-radius: 4px;
        }
        
        [data-theme="dark"] mark.highlight {
            background: #00ffc860 !important;
            color: #000000 !important;
        }
        
        /* Hero Section - 左对齐 */
        .hero {
            padding: 80px 64px 48px;
            max-width: 980px;
            margin: 0 auto;
            border-bottom: 1px solid var(--border-color);
        }
        
        .hero-title {
            font-size: 64px;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 8px;
            letter-spacing: -0.03em;
            line-height: 1.05;
        }
        
        .hero-subtitle {
            font-size: 17px;
            color: var(--text-secondary);
            font-weight: 400;
            margin-bottom: 24px;
        }
        
        .hero-meta {
            display: flex;
            gap: 32px;
            flex-wrap: wrap;
        }
        .chat-layout {
            max-width: 1280px;
            margin: 0 auto;
            padding: 0 48px 120px;
        }
        .chat-main {
            min-width: 0;
        }
        
        .meta-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .meta-label {
            font-size: 13px;
            color: var(--text-secondary);
            font-weight: 400;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .meta-value {
            font-size: 17px;
            color: var(--text-primary);
            font-weight: 500;
        }
        
        /* Chat Content */
        .chat-content {
            padding: 64px 0 120px;
            position: relative;
            max-width: 980px;
            margin: 0 auto;
        }
        
        /* 虚拟滚动容器 */
        .virtual-scroll-container {
            position: relative;
            overflow: hidden;
        }
        
        .virtual-scroll-spacer {
            position: absolute;
            top: 0;
            left: 0;
            width: 1px;
            pointer-events: none;
        }
        
        .virtual-scroll-content {
            position: relative;
            will-change: transform;
        }
        
        /* 加载指示器 */
        .scroll-loader {
            text-align: center;
            padding: 20px;
            color: var(--text-secondary);
            font-size: 14px;
        }
        
        .message-block {
            margin-bottom: 32px;
        }
        .date-divider {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 32px 0 16px;
            text-transform: uppercase;
            font-size: 12px;
            letter-spacing: 0.1em;
            color: var(--text-secondary);
        }
        .date-divider::before,
        .date-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: var(--border-color);
        }
        .message {
            margin-bottom: 0;
            display: flex;
            gap: 16px;
            align-items: flex-start;
            contain: layout style paint;
            will-change: auto;
        }
        
        .message.self {
            flex-direction: row-reverse;
        }
        
        .avatar {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: var(--bg-secondary);
            flex-shrink: 0;
            overflow: hidden;
        }
        
        .avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        
        .message-wrapper {
            max-width: 65%;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .message-header {
            display: flex;
            align-items: baseline;
            gap: 10px;
            padding: 0 4px;
        }
        
        .message.self .message-header {
            flex-direction: row-reverse;
        }
        
        .sender {
            font-size: var(--message-sender-size);
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .time {
            font-size: var(--message-time-size);
            color: var(--text-secondary);
        }
        
        /* 消息气泡 - 带角 */
        .message-bubble {
            padding: 14px 18px;
            border-radius: 20px;
            position: relative;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        
        .message.other .message-bubble {
            background: var(--bubble-other);
            color: var(--text-primary);
        }
        
        .message.self .message-bubble {
            background: var(--bubble-self);
            color: var(--bubble-self-text);
        }
        
        /* 去掉消息角 - 直接用圆角矩形 */
        
        .content {
            font-size: var(--message-font-size);
            line-height: 1.47;
        }
        
        .text-content {
            display: inline;
        }
        
        /* 图片内容 */
        .image-content {
            margin: 10px 0 4px;
            border-radius: 16px;
            overflow: hidden;
            max-width: 320px;
        }
        
        .image-content img {
            width: 100%;
            height: auto;
            display: block;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        
        .image-content img:hover {
            opacity: 0.9;
        }
        
        /* @提及 */
        .at-mention {
            background: var(--at-mention-bg);
            color: var(--at-mention-text);
            padding: 3px 8px;
            border-radius: 8px;
            font-weight: 600;
            display: inline;
            transition: background 0.2s;
        }
        
        .message.other .at-mention:hover {
            opacity: 0.85;
        }
        
        .message.self .at-mention {
            background: rgba(0, 0, 0, 0.1);
            color: var(--bubble-self-text);
        }
        
        .message.self .at-mention:hover {
            background: rgba(0, 0, 0, 0.15);
        }
        
        /* 表情 */
        .face-emoji {
            display: inline;
            font-size: 20px;
            margin: 0 2px;
            vertical-align: baseline;
        }
        
        /* 引用消息 */
        .reply-content {
            background: var(--reply-bg);
            border-left: 3px solid var(--reply-border);
            padding: 10px 12px;
            border-radius: 8px;
            margin-bottom: 8px;
            font-size: 13px;
            line-height: 1.5;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .reply-content:hover {
            background: var(--reply-border);
            opacity: 1;
            transform: translateX(2px);
        }
        
        .reply-content-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
        }
        
        .reply-content strong {
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .reply-content-time {
            font-size: 11px;
            color: var(--text-tertiary);
            margin-left: 8px;
        }
        
        .reply-content-text {
            color: var(--text-secondary);
            margin-top: 4px;
            word-break: break-word;
        }
        
        .reply-content-image {
            margin-top: 6px;
            max-width: 80px;
            max-height: 80px;
            border-radius: 6px;
            object-fit: cover;
        }
        
        .message.self .reply-content {
            background: rgba(0, 0, 0, 0.08);
            border-left-color: rgba(0, 0, 0, 0.25);
        }
        
        .message.self .reply-content:hover {
            background: rgba(0, 0, 0, 0.12);
        }
        
        .message.self .reply-content strong {
            color: var(--bubble-self-text);
        }
        
        /* 音频包装器 */
        .audio-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .audio-download-link {
            display: inline-flex;
            align-items: center;
            padding: 4px 10px;
            background: rgba(0, 0, 0, 0.05);
            border-radius: 8px;
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 13px;
            transition: all 0.2s;
        }
        
        .audio-download-link:hover {
            background: rgba(0, 0, 0, 0.1);
            color: var(--text-primary);
        }
        
        [data-theme="dark"] .audio-download-link {
            background: rgba(255, 255, 255, 0.08);
        }
        
        [data-theme="dark"] .audio-download-link:hover {
            background: rgba(255, 255, 255, 0.15);
        }
        
        /* JSON 卡片 */
        .json-card {
            background: rgba(29, 29, 31, 0.06);
            border: 1px solid rgba(29, 29, 31, 0.1);
            border-radius: 12px;
            padding: 14px 16px;
            margin: 8px 0;
            transition: background 0.2s;
        }
        
        .json-card:hover {
            background: rgba(29, 29, 31, 0.08);
        }
        
        .message.self .json-card {
            background: rgba(0, 0, 0, 0.08);
            border-color: rgba(0, 0, 0, 0.15);
        }
        
        .message.self .json-card:hover {
            background: rgba(0, 0, 0, 0.12);
        }
        
        .json-title {
            font-weight: 600;
            font-size: 15px;
            margin-bottom: 6px;
            line-height: 1.3;
        }
        
        .json-description {
            font-size: 14px;
            opacity: 0.75;
            margin-bottom: 8px;
            line-height: 1.4;
        }
        
        .json-url {
            font-size: 12px;
            opacity: 0.6;
            text-decoration: none;
        }
        
        /* 市场表情 */
        .market-face {
            display: inline-block;
            width: 80px;
            height: 80px;
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
            vertical-align: middle;
            margin: 4px 0;
        }
        
        /* QQ表情 */
        .face-emoji {
            display: inline-block;
            padding: 2px 8px;
            background: rgba(0, 0, 0, 0.05);
            border-radius: 6px;
            font-size: 13px;
            color: var(--text-secondary);
            margin: 0 2px;
        }
        
        [data-theme="dark"] .face-emoji {
            background: rgba(255, 255, 255, 0.1);
        }
        
        /* 视频播放器 */
        .message-video {
            max-width: 100%;
            width: 400px;
            max-height: 300px;
            border-radius: 12px;
            margin: 8px 0;
            display: block;
            background: #000;
        }
        
        /* 音频播放器 */
        .message-audio {
            width: 280px;
            max-width: 100%;
            margin: 8px 0;
            display: block;
        }
        
        /* 合并转发卡片 */
        .forward-card {
            background: var(--bubble-other);
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 12px;
            padding: 12px 16px;
            margin: 4px 0;
            cursor: default;
            transition: all 0.2s;
        }
        
        [data-theme="dark"] .forward-card {
            border-color: rgba(255, 255, 255, 0.1);
        }
        
        .message.self .forward-card {
            background: rgba(0, 0, 0, 0.05);
        }
        
        .forward-card-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .forward-card-icon {
            width: 20px;
            height: 20px;
            opacity: 0.7;
        }
        
        .forward-card-content {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.6;
            max-height: 120px;
            overflow: hidden;
            position: relative;
        }
        
        .forward-card-content::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 30px;
            background: linear-gradient(to bottom, transparent, var(--bubble-other));
        }
        
        .message.self .forward-card-content::after {
            background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.05));
        }
        
        .forward-card-footer {
            margin-top: 8px;
            font-size: 12px;
            color: var(--text-tertiary);
            text-align: right;
        }
        
        /* 图片模态框 */
        .image-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            cursor: pointer;
        }
        
        .image-modal img {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: 90vw;
            max-height: 90vh;
            object-fit: contain;
            border-radius: 8px;
        }
        
        /* 滚动条 */
        ::-webkit-scrollbar {
            width: 8px;
        }
        
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        
        ::-webkit-scrollbar-thumb {
            background: #d1d1d6;
            border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: #c7c7cc;
        }
        
        /* 响应式 */
        @media (max-width: 768px) {
            .hero {
                padding: 48px 24px 32px;
            }
            
            .hero-title {
                font-size: 40px;
            }
            
            .hero-subtitle {
                font-size: 15px;
            }
            
            .hero-meta {
                gap: 24px;
            }
            
            .chat-content {
                padding: 48px 24px 80px;
            }
            
            .message {
                margin-bottom: 28px;
                gap: 12px;
            }
            
            .avatar {
                width: 38px;
                height: 38px;
            }
            
            .message-wrapper {
                max-width: 75%;
            }
        }
        
        /* Footer */
        .footer {
            margin-top: 100px;
            padding: 80px 0;
            background: var(--footer-gradient);
        }
        
        .footer-content {
            max-width: 800px;
            margin: 0 auto;
            text-align: center;
        }
        
        .footer-brand h3 {
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.5px;
            color: var(--text-primary);
            margin-bottom: 8px;
        }
        
        .footer-version {
            font-size: 13px;
            color: var(--text-secondary);
            font-weight: 500;
            margin-bottom: 32px;
        }
        
        .footer-info {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .footer-copyright {
            font-size: 15px;
            color: var(--text-primary);
            font-weight: 400;
        }
        
        .footer-copyright strong {
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .footer-links {
            font-size: 14px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .footer-links a,
        .footer-links > span:not(.separator) {
            color: var(--text-primary);
            text-decoration: none;
            font-weight: 500;
        }
        
        .footer-links a {
            transition: opacity 0.2s;
        }
        
        .footer-links a:hover {
            opacity: 0.7;
        }
        
        .footer-links .separator {
            color: var(--text-secondary);
            font-weight: 300;
        }
        
        .footer-notice {
            font-size: 13px;
            color: var(--text-secondary);
            margin-top: 8px;
            font-weight: 400;
        }
        
        /* 隐藏消息 (搜索/筛选) */
        .message.hidden {
            display: none !important;
        }
        @media (max-width: 1100px) {
            .chat-layout {
                padding: 0 24px 80px;
            }
            .chat-content {
                padding: 32px 0 80px;
            }
            .message-wrapper {
                max-width: 80%;
            }
        }
`;

/** ========== Toolbar HTML（从原 generateToolbar() 提取） ========== */
export const MODERN_TOOLBAR_HTML = `<div class="toolbar">
        <div class="toolbar-content">
            <div class="search-container">
                <button class="search-btn" id="searchBtn">
                    <i data-lucide="search"></i>
                </button>
                <div class="search-input-wrapper" id="searchWrapper">
                    <input type="text" id="searchInput" class="search-input" placeholder="搜索消息...">
                    <button class="clear-search" id="clearSearch" style="display: none;">
                        <i data-lucide="x"></i>
                    </button>
                </div>
            </div>
            <div class="toolbar-separator"></div>
            <div class="toolbar-actions">
                <div class="filter-container">
                    <button class="filter-btn" id="filterBtn">
                        <i data-lucide="user"></i>
                    </button>
                    <div class="filter-dropdown" id="filterDropdown">
                        <div class="filter-search-wrapper">
                            <input type="text" class="filter-search-input" id="filterSearchInput" placeholder="搜索成员...">
                        </div>
                        <div class="filter-options-list" id="filterOptionsList">
                            <div class="filter-option active" data-value="all">全部成员</div>
                        </div>
                        <div class="filter-no-result" id="filterNoResult">未找到匹配的成员</div>
                    </div>
                </div>
                <div class="toolbar-separator"></div>
                <div class="time-range-container">
                    <button class="time-range-btn" id="timeRangeBtn">
                        <i data-lucide="calendar"></i>
                        <span id="timeRangeLabel">全部时间</span>
                    </button>
                    <div class="time-range-dropdown" id="timeRangeDropdown">
                        <div class="time-range-inputs">
                            <div class="time-range-input-group">
                                <label for="startDate">开始日期</label>
                                <input type="date" id="startDate" class="time-range-input">
                            </div>
                            <div class="time-range-input-group">
                                <label for="endDate">结束日期</label>
                                <input type="date" id="endDate" class="time-range-input">
                            </div>
                        </div>
                        <div class="time-range-actions">
                            <button class="apply-btn" id="applyTimeRange">应用</button>
                            <button class="clear-btn" id="clearTimeRange">清除</button>
                        </div>
                    </div>
                </div>
                <div class="toolbar-separator"></div>
                <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank" class="github-btn" title="GitHub">
                    <i data-lucide="github"></i>
                </a>
                <div class="toolbar-separator"></div>
                <button class="theme-toggle" id="themeToggle" title="切换主题">
                    <i data-lucide="sun" id="themeIcon"></i>
                </button>
            </div>
        </div>
    </div>`;

/** ========== Footer HTML（从原 generateFooter() 提取） ========== */
export const MODERN_FOOTER_HTML = `    <!-- Footer -->
    <footer class="footer">
        <div class="footer-content">
            <div class="footer-brand">
                <h3>QQ Chat Exporter Pro</h3>
            </div>
            <div class="footer-info">
                <p class="footer-copyright">Made with ❤️ by <strong>shuakami</strong></p>
                <p class="footer-links">
                    <a href="https://github.com/shuakami/qq-chat-exporter" target="_blank">GitHub</a>
                    <span class="separator">·</span>
                    <span>GPL-3.0 License</span>
                </p>
                <p class="footer-notice">本软件完全免费开源 · 如果有帮助到您，欢迎给个 Star 喵，谢谢喵</p>
            </div>
        </div>
    </footer>`;

/** ========== 单文件 HTML 方案：JS（从原 generateScripts() 提取，去掉外层 <script> 包裹） ========== */
export const MODERN_SINGLE_APP_JS = `
        function showImageModal(imgSrc) {
            var modal = document.getElementById('imageModal');
            var modalImg = document.getElementById('modalImage');
            modal.style.display = 'block';
            modalImg.src = imgSrc;
        }
        function hideImageModal() {
            document.getElementById('imageModal').style.display = 'none';
        }
        // ========== 虚拟滚动管理器 ==========
        class VirtualScroller {
            constructor(container, items, options = {}) {
                this.container = container;
                this.allItems = items;
                this.options = {
                    itemHeight: options.itemHeight || 100,
                    bufferSize: options.bufferSize || 10,
                    ...options
                };
                
                this.visibleItems = [];
                this.startIndex = 0;
                this.endIndex = 0;
                this.scrollTop = 0;
                this.containerHeight = 0;
                this.totalHeight = 0;
                this.isUpdating = false;
                
                this.init();
            }
            
            init() {
                // 创建虚拟滚动结构
                this.spacer = document.createElement('div');
                this.spacer.className = 'virtual-scroll-spacer';
                
                this.content = document.createElement('div');
                this.content.className = 'virtual-scroll-content';
                
                this.container.appendChild(this.spacer);
                this.container.appendChild(this.content);
                
                // 初始化总高度
                this.totalHeight = this.allItems.length * this.options.itemHeight;
                this.spacer.style.height = this.totalHeight + 'px';
                
                // 监听滚动
                this.handleScroll = this.handleScroll.bind(this);
                window.addEventListener('scroll', this.handleScroll, { passive: true });
                window.addEventListener('resize', () => this.update());
                
                this.update();
            }
            
            handleScroll() {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                // 降低阈值，提高响应性
                if (Math.abs(scrollTop - this.scrollTop) > 30 && !this.isUpdating) {
                    this.scrollTop = scrollTop;
                    requestAnimationFrame(() => this.update());
                }
            }
            
            update() {
                if (!this.allItems || this.allItems.length === 0 || this.isUpdating) return;
                
                this.isUpdating = true;
                
                this.containerHeight = window.innerHeight;
                this.totalHeight = this.allItems.length * this.options.itemHeight;
                
                // 获取容器在文档中的位置
                const containerRect = this.container.getBoundingClientRect();
                const containerTop = this.scrollTop + containerRect.top;
                
                // 计算当前视口相对于容器的位置
                const viewportTop = this.scrollTop;
                const viewportBottom = viewportTop + this.containerHeight;
                
                // 计算可见区域在容器内的偏移
                const visibleStart = Math.max(0, viewportTop - containerTop);
                const visibleEnd = Math.max(0, viewportBottom - containerTop);
                
                // 计算应该渲染的项目范围（使用更大的缓冲区）
                const startIndex = Math.max(0, Math.floor(visibleStart / this.options.itemHeight) - this.options.bufferSize);
                const endIndex = Math.min(
                    this.allItems.length,
                    Math.ceil(visibleEnd / this.options.itemHeight) + this.options.bufferSize
                );
                
                // 只在范围变化时才重新渲染
                if (startIndex !== this.startIndex || endIndex !== this.endIndex) {
                    this.startIndex = startIndex;
                    this.endIndex = endIndex;
                    this.render();
                }
                
                this.isUpdating = false;
            }
            
            render() {
                const fragment = document.createDocumentFragment();
                const offset = this.startIndex * this.options.itemHeight;
                
                // 批量渲染可见项
                for (let i = this.startIndex; i < this.endIndex; i++) {
                    if (this.allItems[i]) {
                        fragment.appendChild(this.allItems[i].cloneNode(true));
                    }
                }
                
                // 一次性更新DOM
                this.content.innerHTML = '';
                this.content.appendChild(fragment);
                this.content.style.transform = 'translateY(' + offset + 'px)';
                
                // 重新初始化图标
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons({
                        attrs: { 'stroke-width': 2 }
                    });
                }
            }
            
            updateItems(items) {
                this.allItems = items;
                this.totalHeight = items.length * this.options.itemHeight;
                // 更新后重新计算滚动位置
                this.scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                // 强制完整更新
                this.startIndex = -1;
                this.endIndex = -1;
                this.update();
            }
            
            destroy() {
                window.removeEventListener('scroll', this.handleScroll);
            }
            scrollToIndex(index) {
                if (typeof index !== 'number' || index < 0) return;
                var targetOffset = index * (this.options.itemHeight || 100);
                window.scrollTo({
                    top: targetOffset,
                    behavior: 'smooth'
                });
            }
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            var modal = document.getElementById('imageModal');
            if (modal) modal.addEventListener('click', hideImageModal);
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') hideImageModal();
            });
            
            // 回复消息跳转功能
            window.scrollToMessage = function(msgId) {
                var targetMsg = document.getElementById(msgId);
                if (targetMsg) {
                    // 平滑滚动到目标消息
                    targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    
                    // 高亮动画
                    targetMsg.style.transition = 'background 0.3s';
                    var originalBg = window.getComputedStyle(targetMsg).backgroundColor;
                    targetMsg.style.background = 'rgba(0, 122, 255, 0.1)';
                    
                    setTimeout(function() {
                        targetMsg.style.background = originalBg;
                        setTimeout(function() {
                            targetMsg.style.transition = '';
                        }, 300);
                    }, 1000);
                } else {
                    console.warn('[Reply Jump] 未找到目标消息:', msgId);
                }
            };
            // ========== 时间范围选择 ==========
            var timeRangeBtn = document.getElementById('timeRangeBtn');
            var timeRangeDropdown = document.getElementById('timeRangeDropdown');
            var timeRangeLabel = document.getElementById('timeRangeLabel');
            var startDateInput = document.getElementById('startDate');
            var endDateInput = document.getElementById('endDate');
            var applyTimeRangeBtn = document.getElementById('applyTimeRange');
            var clearTimeRangeBtn = document.getElementById('clearTimeRange');
            var minDateKey = null;
            var maxDateKey = null;
            
            function clampDateValue(value) {
                if (!value) return '';
                var normalized = value.slice(0, 10);
                if (minDateKey && normalized < minDateKey) return minDateKey;
                if (maxDateKey && normalized > maxDateKey) return maxDateKey;
                return normalized;
            }
            
            function applyDateRangeLimits() {
                if (!startDateInput || !endDateInput) return;
                startDateInput.min = minDateKey || '';
                endDateInput.min = minDateKey || '';
                startDateInput.max = maxDateKey || '';
                endDateInput.max = maxDateKey || '';
            }
            
            function enforceInputRange() {
                if (startDateInput) {
                    startDateInput.value = clampDateValue(startDateInput.value);
                }
                if (endDateInput) {
                    endDateInput.value = clampDateValue(endDateInput.value);
                }
                if (startDateInput && endDateInput && startDateInput.value && endDateInput.value && startDateInput.value > endDateInput.value) {
                    endDateInput.value = startDateInput.value;
                }
            }
            
            // 从localStorage恢复时间范围
            var savedTimeRange = localStorage.getItem('timeRange');
            if (savedTimeRange) {
                try {
                    var timeRange = JSON.parse(savedTimeRange);
                    startDateInput.value = timeRange.start || '';
                    endDateInput.value = timeRange.end || '';
                    updateTimeRangeLabel();
                } catch (e) {
                    // 忽略解析错误
                }
            }
            
            function updateTimeRangeLabel() {
                var start = startDateInput.value;
                var end = endDateInput.value;
                if (start || end) {
                    timeRangeLabel.textContent = (start || '开始') + ' ~ ' + (end || '结束');
                } else {
                    timeRangeLabel.textContent = '全部时间';
                }
            }
            
            if (startDateInput) {
                startDateInput.addEventListener('change', function() {
                    enforceInputRange();
                    updateTimeRangeLabel();
                });
            }
            
            if (endDateInput) {
                endDateInput.addEventListener('change', function() {
                    enforceInputRange();
                    updateTimeRangeLabel();
                });
            }
            
            // 切换下拉菜单
            timeRangeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                timeRangeDropdown.classList.toggle('active');
            });
            
            // 应用时间范围
            applyTimeRangeBtn.addEventListener('click', function() {
                enforceInputRange();
                var start = startDateInput.value;
                var end = endDateInput.value;
                
                // 保存到localStorage
                localStorage.setItem('timeRange', JSON.stringify({
                    start: start,
                    end: end
                }));
                
                updateTimeRangeLabel();
                timeRangeDropdown.classList.remove('active');
                
                // 应用过滤逻辑
                filterMessages();
            });
            
            // 清除时间范围
            clearTimeRangeBtn.addEventListener('click', function() {
                startDateInput.value = '';
                endDateInput.value = '';
                localStorage.removeItem('timeRange');
                updateTimeRangeLabel();
                timeRangeDropdown.classList.remove('active');
                
                // 重新过滤消息（显示所有消息）
                filterMessages();
            });
            
            // 点击外部关闭下拉菜单
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.time-range-container')) {
                    timeRangeDropdown.classList.remove('active');
                }
            });
            
            // 收集所有消息DOM
            var messages = Array.from(document.querySelectorAll('.message'));
            var messageBlocks = Array.from(document.querySelectorAll('.message-block'));
            var dateKeySet = new Set();
            messageBlocks.forEach(function(block) {
                var dateValue = block.getAttribute('data-date');
                if (dateValue) {
                    dateKeySet.add(dateValue);
                }
            });
            var dateKeys = Array.from(dateKeySet).sort();
            minDateKey = dateKeys.length > 0 ? dateKeys[0] : null;
            maxDateKey = dateKeys.length > 0 ? dateKeys[dateKeys.length - 1] : null;
            applyDateRangeLimits();
            enforceInputRange();
            updateTimeRangeLabel();
            var total = messages.length;
            document.getElementById('info-total').textContent = total;
            
            if (messages.length > 0) {
                var firstTime = messages[0].querySelector('.time').textContent;
                var lastTime = messages[messages.length - 1].querySelector('.time').textContent;
                document.getElementById('info-range').textContent = firstTime + ' ~ ' + lastTime;
            }
            // 初始化虚拟滚动（消息超过100条时启用）
            var virtualScroller = null;
            if (messageBlocks.length > 100) {
                var chatContent = document.querySelector('.chat-content');
                var originalBlocks = messageBlocks.map(function(block) { return block.cloneNode(true); });
                chatContent.innerHTML = '';
                virtualScroller = new VirtualScroller(chatContent, originalBlocks, {
                    itemHeight: 120,
                    bufferSize: 30
                });
                console.log('启用虚拟滚动，共', messageBlocks.length, '条消息');
            }
            // ========== 初始化 Lucide 图标 ==========
            lucide.createIcons({
                attrs: {
                    'stroke-width': 2
                }
            });
            
            // ========== 主题切换 ==========
            var themeToggle = document.getElementById('themeToggle');
            var themeIconElement = document.getElementById('themeIcon');
            var currentTheme = localStorage.getItem('theme') || 'light';
            
            function setTheme(theme) {
                if (theme === 'dark') {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    themeIconElement.setAttribute('data-lucide', 'moon');
                    localStorage.setItem('theme', 'dark');
                } else {
                    document.documentElement.removeAttribute('data-theme');
                    themeIconElement.setAttribute('data-lucide', 'sun');
                    localStorage.setItem('theme', 'light');
                }
                lucide.createIcons({
                    attrs: {
                        'stroke-width': 2
                    }
                });
            }
            
            setTheme(currentTheme);
            
            themeToggle.addEventListener('click', function() {
                currentTheme = localStorage.getItem('theme') || 'light';
                setTheme(currentTheme === 'dark' ? 'light' : 'dark');
            });
            
            // ========== 发送者筛选 ==========
            var filterBtn = document.getElementById('filterBtn');
            var filterDropdown = document.getElementById('filterDropdown');
            var filterOptionsList = document.getElementById('filterOptionsList');
            var filterSearchInput = document.getElementById('filterSearchInput');
            var filterNoResult = document.getElementById('filterNoResult');
            var currentFilter = 'all';
            var currentFilterUid = null;
            
            // 使用 Map 按 UID 整合发送者（同一用户可能有不同群名片）
            // key: uid, value: { names: Set<string>, displayName: string }
            var sendersByUid = new Map();
            var senderNameToUid = new Map(); // 用于反向查找
            
            // 收集所有发送者，按 UID 整合
            // 使用 messageBlocks 而不是 messages，因为 filterMessages 使用的是 originalMessages（从 messageBlocks 克隆）
            messageBlocks.forEach(function(block) {
                var messageEl = block.querySelector('.message');
                var sender = block.querySelector('.sender');
                var uid = messageEl ? (messageEl.getAttribute('data-sender-uid') || messageEl.getAttribute('data-uid')) : null;
                if (sender) {
                    var senderName = sender.textContent;
                    if (uid) {
                        // 有 UID，按 UID 整合
                        if (!sendersByUid.has(uid)) {
                            sendersByUid.set(uid, { names: new Set(), displayName: senderName });
                        }
                        sendersByUid.get(uid).names.add(senderName);
                        senderNameToUid.set(senderName, uid);
                    } else {
                        // 无 UID，按名称作为唯一标识
                        if (!sendersByUid.has(senderName)) {
                            sendersByUid.set(senderName, { names: new Set([senderName]), displayName: senderName });
                        }
                        senderNameToUid.set(senderName, senderName);
                    }
                }
            });
            
            // 生成筛选选项
            sendersByUid.forEach(function(info, uid) {
                var option = document.createElement('div');
                option.className = 'filter-option';
                option.setAttribute('data-value', uid);
                // 如果同一用户有多个名片，显示所有名片
                var names = Array.from(info.names);
                if (names.length > 1) {
                    option.textContent = names[0] + ' (' + (names.length - 1) + '个别名)';
                    option.setAttribute('title', names.join(', '));
                } else {
                    option.textContent = info.displayName;
                }
                // 存储所有名称用于搜索
                option.setAttribute('data-names', names.join('|').toLowerCase());
                filterOptionsList.appendChild(option);
            });
            
            // 筛选搜索功能
            filterSearchInput.addEventListener('input', function(e) {
                var keyword = e.target.value.toLowerCase().trim();
                var options = filterOptionsList.querySelectorAll('.filter-option');
                var hasVisible = false;
                
                options.forEach(function(opt) {
                    var value = opt.getAttribute('data-value');
                    var names = opt.getAttribute('data-names') || opt.textContent.toLowerCase();
                    
                    if (value === 'all' || names.includes(keyword) || opt.textContent.toLowerCase().includes(keyword)) {
                        opt.classList.remove('hidden');
                        hasVisible = true;
                    } else {
                        opt.classList.add('hidden');
                    }
                });
                
                // 显示/隐藏无结果提示
                if (hasVisible) {
                    filterNoResult.classList.remove('visible');
                } else {
                    filterNoResult.classList.add('visible');
                }
            });
            
            // 切换下拉菜单
            filterBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                filterDropdown.classList.toggle('active');
                if (filterDropdown.classList.contains('active')) {
                    // 打开时聚焦搜索框
                    setTimeout(function() {
                        filterSearchInput.focus();
                    }, 100);
                }
            });
            
            // 选择选项
            filterOptionsList.addEventListener('click', function(e) {
                if (e.target.classList.contains('filter-option')) {
                    // 移除所有active
                    filterOptionsList.querySelectorAll('.filter-option').forEach(function(opt) {
                        opt.classList.remove('active');
                    });
                    // 添加当前active
                    e.target.classList.add('active');
                    var selectedValue = e.target.getAttribute('data-value');
                    if (selectedValue === 'all') {
                        currentFilter = 'all';
                        currentFilterUid = null;
                    } else {
                        currentFilter = selectedValue;
                        currentFilterUid = selectedValue;
                    }
                    filterDropdown.classList.remove('active');
                    // 清空搜索
                    filterSearchInput.value = '';
                    filterOptionsList.querySelectorAll('.filter-option').forEach(function(opt) {
                        opt.classList.remove('hidden');
                    });
                    filterNoResult.classList.remove('visible');
                    filterMessages();
                }
            });
            
            // 点击外部关闭
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.filter-container')) {
                    filterDropdown.classList.remove('active');
                }
            });
            
            // ========== 搜索框展开/收起 ==========
            var searchBtn = document.getElementById('searchBtn');
            var searchWrapper = document.getElementById('searchWrapper');
            var searchInput = document.getElementById('searchInput');
            var searchActive = false;
            
            searchBtn.addEventListener('click', function() {
                searchActive = !searchActive;
                if (searchActive) {
                    searchWrapper.classList.add('active');
                    searchInput.focus();
                } else {
                    searchWrapper.classList.remove('active');
                    searchInput.value = '';
                    filterMessages();
                }
            });
            
            // 点击外部关闭搜索框
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.search-container') && searchActive) {
                    searchActive = false;
                    searchWrapper.classList.remove('active');
                    if (!searchInput.value) {
                        searchInput.value = '';
                        filterMessages();
                    }
                }
            });
            
            // ========== 防抖函数 ==========
            function debounce(func, wait) {
                let timeout;
                return function(...args) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func.apply(this, args), wait);
                };
            }
            
            // ========== 搜索功能 + 高亮 ==========
            var clearSearch = document.getElementById('clearSearch');
            var originalContents = new Map();
            var originalMessages = messageBlocks.map(block => block.cloneNode(true));
            
            // 保存原始内容
            originalMessages.forEach(function(msg) {
                var content = msg.querySelector('.content');
                if (content) {
                    originalContents.set(msg, content.innerHTML);
                }
            });
            
            function escapeRegExp(string) {
                return string.replace(/[.*+?^$\\{\\}()|\\[\\]\\\\]/g, '\\\\$&');
            }
            
            function highlightText(text, searchTerm) {
                if (!searchTerm) return text;
                var escapedTerm = escapeRegExp(searchTerm);
                var regex = new RegExp('(' + escapedTerm + ')', 'gi');
                return text.replace(regex, '<mark class="highlight">$1</mark>');
            }
            
            function filterMessages() {
                var searchTerm = searchInput.value.trim();
                var selectedSender = currentFilter;
                var selectedUid = currentFilterUid;
                var startDate = startDateInput ? startDateInput.value : '';
                var endDate = endDateInput ? endDateInput.value : '';
                var filteredMessages = [];
                var visibleCount = 0;
                
                // 使用DocumentFragment优化DOM操作
                originalMessages.forEach(function(msg) {
                    // msg 是 .message-block，需要找到内部的 .message 元素
                    var messageEl = msg.querySelector('.message');
                    var sender = msg.querySelector('.sender');
                    var senderName = sender ? sender.textContent : '';
                    // 从 .message 元素获取 data-sender-uid
                    var msgUid = messageEl ? (messageEl.getAttribute('data-sender-uid') || messageEl.getAttribute('data-uid')) : null;
                    var content = msg.querySelector('.content');
                    var originalContent = originalContents.get(msg);
                    
                    if (!content || !originalContent) return;
                    
                    // 克隆消息用于过滤
                    var msgClone = msg.cloneNode(true);
                    var contentClone = msgClone.querySelector('.content');
                    
                    // 恢复原始内容
                    contentClone.innerHTML = originalContent;
                    
                    var contentText = contentClone.textContent.toLowerCase();
                    var searchLower = searchTerm.toLowerCase();
                    
                    // 获取消息日期进行时间范围筛选
                    var messageDate = msgClone.getAttribute('data-date');
                    var matchTimeRange = true;
                    if (startDate || endDate) {
                        if (messageDate) {
                            if (startDate && messageDate < startDate) {
                                matchTimeRange = false;
                            }
                            if (endDate && messageDate > endDate) {
                                matchTimeRange = false;
                            }
                        }
                    }
                    
                    var matchSearch = searchTerm === '' || contentText.includes(searchLower) || senderName.toLowerCase().includes(searchLower);
                    
                    // 发送者筛选：优先使用 UID 匹配，支持同一用户不同群名片
                    var matchSender = false;
                    if (selectedSender === 'all') {
                        matchSender = true;
                    } else if (selectedUid && msgUid) {
                        // 基于 UID 匹配（整合同一用户不同群名片）
                        matchSender = msgUid === selectedUid;
                    } else {
                        // 回退到名称匹配（兼容无 UID 的情况）
                        matchSender = senderName === selectedSender;
                    }
                    
                    if (matchSearch && matchSender && matchTimeRange) {
                        visibleCount++;
                        
                        // 高亮匹配文本
                        if (searchTerm && contentText.includes(searchLower)) {
                            var textContent = contentClone.querySelector('.text-content');
                            if (textContent) {
                                var originalText = textContent.textContent;
                                textContent.innerHTML = highlightText(originalText, searchTerm);
                            }
                        }
                        
                        filteredMessages.push(msgClone);
                    }
                });
                
                // 更新虚拟滚动器
                if (virtualScroller) {
                    virtualScroller.updateItems(filteredMessages);
                    // 延迟滚动到顶部，确保虚拟滚动器已更新
                    setTimeout(function() {
                        window.scrollTo({ top: 0, behavior: 'auto' });
                    }, 50);
                } else {
                    // 非虚拟滚动模式：直接更新DOM
                    var chatContent = document.querySelector('.chat-content');
                    var fragment = document.createDocumentFragment();
                    filteredMessages.forEach(msg => fragment.appendChild(msg));
                    chatContent.innerHTML = '';
                    chatContent.appendChild(fragment);
                }
                
                // 显示/隐藏清除按钮
                clearSearch.style.display = searchTerm ? 'block' : 'none';
                
                // 更新统计
                document.getElementById('info-total').textContent = visibleCount + ' / ' + total;
                
                // 更新图标
                lucide.createIcons({
                    attrs: {
                        'stroke-width': 2
                    }
                });
            }
            
            // 使用防抖优化搜索
            var debouncedFilter = debounce(filterMessages, 300);
            searchInput.addEventListener('input', debouncedFilter);
            
            clearSearch.addEventListener('click', function() {
                searchInput.value = '';
                filterMessages();
                searchInput.focus();
            });
            
            // 页面加载完成后应用已保存的过滤条件（包括时间范围）
            setTimeout(function() {
                filterMessages();
            }, 100);
        });
`;

/** 单文件 HTML 中的 scripts（保持原结构：lucide CDN + 内联脚本） */
export const MODERN_SINGLE_SCRIPTS_HTML = `<script src="https://unpkg.com/lucide@latest"></script>
    <script>
${MODERN_SINGLE_APP_JS}
    </script>`;

/** 单文件 HTML 方案：顶部壳（chat-content 打开） */
export const MODERN_SINGLE_HTML_TOP_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<!-- QCE_METADATA: {{METADATA_JSON}} -->
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>聊天记录 - {{CHAT_NAME_ESC}}</title>
{{STYLES}}
{{SCRIPTS}}
</head>
<body>
    <!-- Toolbar -->
    {{TOOLBAR}}
    <div class="chat-layout">
        <div class="chat-main">
            <!-- Hero Section -->
{{HEADER}}
            <!-- Chat Messages -->
            <div class="chat-content">
`;

/** 单文件 HTML 方案：底部壳（chat-content 关闭 + footer + modal + 占位回填脚本） */
export const MODERN_SINGLE_HTML_BOTTOM_TEMPLATE = `            </div>
{{FOOTER}}
        </div>
    </div>

    <!-- Image Modal -->
    <div class="image-modal" id="imageModal">
        <img src="" alt="" id="modalImage">
</div>

<!-- 统计占位回填 -->
<script>
(function(){
  try {
    var totalEl = document.getElementById('info-total');
    if (totalEl) totalEl.textContent = {{TOTAL_MESSAGES}};
    var rangeEl = document.getElementById('info-range');
    if (rangeEl) rangeEl.textContent = {{TIME_RANGE_JS}};
  } catch (e) { /* noop */ }
})();
</script>

</body>

</html>`;

/** ========== Chunked Viewer：index.html 模板（引用 assets/app.js + assets/style.css + data/manifest.js） ========== */
export const MODERN_CHUNKED_INDEX_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<!-- QCE_METADATA: {{METADATA_JSON}} -->
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>聊天记录 - {{CHAT_NAME_ESC}}</title>
<link rel="stylesheet" href="assets/style.css">
<script src="https://unpkg.com/lucide@latest"></script>
<script src="assets/app.js" defer></script>
<script src="data/manifest.js" defer></script>
</head>
<body>
    <!-- Toolbar -->
    {{TOOLBAR}}
    <div class="chat-layout">
        <div class="chat-main">
            <!-- Hero Section -->
{{HEADER}}
            <!-- Chat Messages -->
            <div class="chat-content" id="chatContent"></div>
{{FOOTER}}
        </div>
    </div>

    <!-- Image Modal -->
    <div class="image-modal" id="imageModal">
        <img src="" alt="" id="modalImage">
    </div>
</body>
</html>`;

/** ========== Chunked Viewer：app.js（新的分块加载 + 窗口化渲染 + 索引/跳转接口） ========== */
export const MODERN_CHUNKED_APP_JS = `/*!
 * QQ Chat Exporter Pro - Modern Chunked Viewer
 * - Streaming + Chunking + Indexing + Windowed rendering (no-OOM)
 * - 保持原 UI（toolbar/主题/时间范围/成员筛选/搜索）一致
 *
 * 数据协议（由导出器生成）：
 * - data/manifest.js: window.__QCE_MANIFEST__(manifest)
 * - data/chunks/c000001.js: window.__QCE_CHUNK__(chunk)
 * - data/index/msgid_bXX.js: window.__QCE_MSGID_INDEX__(bucket, pairs)
 */
(function () {
  'use strict';

  var manifest = null;
  var domReady = false;
  var initialized = false;

  // caches
  var chunkCache = new Map(); // chunkId -> chunkData
  var pendingChunk = new Map(); // chunkId -> { promise, resolve, reject }

  var msgIdToChunkId = new Map(); // domMsgId -> chunkId
  var loadedMsgIndexBuckets = new Set();
  var pendingMsgIndexBuckets = new Map(); // bucket -> { promise, resolve, reject }

  // active chunk list after applying chunk-level filters
  var activeChunks = [];
  var activePosByChunkId = new Map(); // chunkId -> activePos

  // rendered window state
  var rendered = []; // { pos:number, chunkId:string, el:HTMLElement|null, visibleCount:number }
  var loadedStartPos = 0;
  var loadedEndPos = -1;

  var isLoadingNext = false;
  var isLoadingPrev = false;

  // filter state
  var filterState = {
    searchTerm: '',
    searchLower: '',
    senderUid: null, // string | null
    startDate: '',
    endDate: ''
  };

  // UI refs
  var ui = {
    chatContent: null,
    topSentinel: null,
    bottomSentinel: null,

    infoTotal: null,
    infoRange: null,

    // search
    searchBtn: null,
    searchWrapper: null,
    searchInput: null,
    clearSearch: null,
    searchActive: false,

    // filter
    filterBtn: null,
    filterDropdown: null,
    filterOptionsList: null,
    filterSearchInput: null,
    filterNoResult: null,
    currentFilterUid: null,

    // time range
    timeRangeBtn: null,
    timeRangeDropdown: null,
    timeRangeLabel: null,
    startDateInput: null,
    endDateInput: null,
    applyTimeRangeBtn: null,
    clearTimeRangeBtn: null,
    minDateKey: null,
    maxDateKey: null,

    // theme
    themeToggle: null,
    themeIcon: null
  };

  function log() {
    try { console.log.apply(console, ['[QCE-Chunked]'].concat([].slice.call(arguments))); } catch (e) {}
  }
  function warn() {
    try { console.warn.apply(console, ['[QCE-Chunked]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ---------- JSONP callbacks ----------
  window.__QCE_MANIFEST__ = function (m) {
    manifest = m;
    tryInit();
  };

  window.__QCE_CHUNK__ = function (chunk) {
    chunkCache.set(chunk.id, chunk);
    var p = pendingChunk.get(chunk.id);
    if (p) {
      p.resolve(chunk);
      pendingChunk.delete(chunk.id);
    }
  };

  window.__QCE_MSGID_INDEX__ = function (bucket, pairs) {
    try {
      if (Array.isArray(pairs)) {
        for (var i = 0; i < pairs.length; i++) {
          var pair = pairs[i];
          if (pair && pair.length >= 2) {
            msgIdToChunkId.set(pair[0], pair[1]);
          }
        }
      }
    } finally {
      loadedMsgIndexBuckets.add(bucket);
      var p = pendingMsgIndexBuckets.get(bucket);
      if (p) {
        p.resolve();
        pendingMsgIndexBuckets.delete(bucket);
      }
    }
  };

  // ---------- image modal (保持原函数名) ----------
  window.showImageModal = function (imgSrc) {
    var modal = document.getElementById('imageModal');
    var modalImg = document.getElementById('modalImage');
    if (!modal || !modalImg) return;
    modal.style.display = 'block';
    modalImg.src = imgSrc;
  };
  window.hideImageModal = function () {
    var modal = document.getElementById('imageModal');
    if (modal) modal.style.display = 'none';
  };

  // ---------- DOM ready ----------
  document.addEventListener('DOMContentLoaded', function () {
    domReady = true;
    tryInit();
  });

  function tryInit() {
    if (initialized) return;
    if (!domReady || !manifest) return;
    initialized = true;
    init();
  }

  // ---------- helpers ----------
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^$\\{\\}()|\\[\\]\\\\]/g, '\\\\$&');
  }

  function highlightIn(root, searchTerm) {
    if (!root || !searchTerm) return;
    var escaped = escapeRegExp(searchTerm);
    if (!escaped) return;
    var regex = new RegExp('(' + escaped + ')', 'gi');
    var nodes = root.querySelectorAll('.text-content');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = el.textContent || '';
      if (!text) continue;
      // 只对纯文本 span 做高亮：保持与原逻辑一致
      el.innerHTML = text.replace(regex, '<mark class="highlight">$1</mark>');
    }
  }

  function setLucideIcons() {
    if (typeof lucide === 'undefined') return;
    lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }

  // ---------- Bloom filter (chunk-level indexing) ----------
  function base64ToBytes(b64) {
    if (!b64) return null;
    try {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      return bytes;
    } catch (e) {
      return null;
    }
  }

  function fnv1a32(str, seed) {
    var h = (seed >>> 0) || 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0);
  }

  function bloomMightContain(bytes, bits, hashes, token) {
    if (!bytes || !bits || !hashes) return true;
    var h1 = fnv1a32(token, 0x811c9dc5);
    var h2 = fnv1a32(token, 0x811c9dc5 ^ 0x5bd1e995);
    for (var i = 0; i < hashes; i++) {
      var idx = (h1 + (i * h2)) % bits;
      var byteIndex = idx >>> 3;
      var mask = 1 << (idx & 7);
      if ((bytes[byteIndex] & mask) === 0) return false;
    }
    return true;
  }

  function getNgramSizeForTerm(termLower) {
    if (!termLower) return 0;
    if (termLower.length >= 3) return 3;
    if (termLower.length >= 2) return 2;
    return 0;
  }

  function ngramsOf(termLower, n) {
    var out = [];
    if (!termLower || termLower.length < n) return out;
    for (var i = 0; i <= termLower.length - n; i++) {
      out.push(termLower.slice(i, i + n));
    }
    return out;
  }

  function ensureChunkBloomDecoded(meta) {
    if (!meta) return meta;
    if (meta.textBloom && !meta._textBloomBytes) meta._textBloomBytes = base64ToBytes(meta.textBloom);
    if (meta.senderBloom && !meta._senderBloomBytes) meta._senderBloomBytes = base64ToBytes(meta.senderBloom);
    return meta;
  }

  function chunkPassesFilters(meta) {
    if (!meta) return false;

    // date range (chunk-level intersection)
    if (filterState.startDate && meta.endDate && meta.endDate < filterState.startDate) return false;
    if (filterState.endDate && meta.startDate && meta.startDate > filterState.endDate) return false;

    // sender (chunk-level bloom)
    if (filterState.senderUid && meta.senderBloom) {
      ensureChunkBloomDecoded(meta);
      var bcfg = manifest && manifest.bloom ? manifest.bloom : null;
      var bits = bcfg ? bcfg.senderBits : 0;
      var hashes = bcfg ? bcfg.senderHashes : 0;
      if (!bloomMightContain(meta._senderBloomBytes, bits, hashes, filterState.senderUid)) return false;
    }

    // search (chunk-level bloom)
    if (filterState.searchLower) {
      var n = getNgramSizeForTerm(filterState.searchLower);
      if (n > 0) {
        // 如果导出时标记该 chunk bloom 不完整，为了不漏结果，这里不做排除
        if (meta.textBloomIncomplete) return true;
        if (meta.textBloom) {
          ensureChunkBloomDecoded(meta);
          var bcfg2 = manifest && manifest.bloom ? manifest.bloom : null;
          var bits2 = bcfg2 ? bcfg2.textBits : 0;
          var hashes2 = bcfg2 ? bcfg2.textHashes : 0;
          var grams = ngramsOf(filterState.searchLower, n);
          for (var i = 0; i < grams.length; i++) {
            if (!bloomMightContain(meta._textBloomBytes, bits2, hashes2, grams[i])) return false;
          }
        }
      }
    }

    return true;
  }

  function messagePassesFilters(msg) {
    if (!msg) return false;

    // message-level date range
    if (filterState.startDate && msg.date && msg.date < filterState.startDate) return false;
    if (filterState.endDate && msg.date && msg.date > filterState.endDate) return false;

    // sender
    if (filterState.senderUid && msg.uid && msg.uid !== filterState.senderUid) return false;

    // search (exact contains)
    if (filterState.searchLower) {
      var term = filterState.searchLower;
      var hit = false;
      try {
        if (msg.text && String(msg.text).indexOf(term) >= 0) hit = true;
        else if (msg.nameLower && String(msg.nameLower).indexOf(term) >= 0) hit = true;
        else if (msg.textTruncated && msg.html) {
          // 兜底：如果 text 是截断的，避免漏结果，用 html 做全文 contains
          hit = (String(msg.html).toLowerCase().indexOf(term) >= 0);
        }
      } catch (e) {
        hit = false;
      }
      if (!hit) return false;
    }

    return true;
  }

  function computeTimeRangeText() {
    try {
      if (manifest && manifest.stats && manifest.stats.timeRangeText) return String(manifest.stats.timeRangeText);
      if (manifest && manifest.stats && manifest.stats.firstTime && manifest.stats.lastTime) {
        var a = new Date(manifest.stats.firstTime);
        var b = new Date(manifest.stats.lastTime);
        if (!isNaN(a.getTime()) && !isNaN(b.getTime())) {
          return a.toLocaleDateString('zh-CN') + ' 至 ' + b.toLocaleDateString('zh-CN');
        }
      }
    } catch (e) {}
    return '--';
  }

  function updateHeaderStats(renderedVisibleCount) {
    // total scope estimation:
    var totalScope = null;
    if (!manifest || !manifest.stats) totalScope = null;
    else totalScope = manifest.stats.totalMessages;

    // sender-only exact total
    if (filterState.senderUid && manifest && Array.isArray(manifest.senders)) {
      for (var i = 0; i < manifest.senders.length; i++) {
        if (String(manifest.senders[i].uid) === String(filterState.senderUid)) {
          totalScope = manifest.senders[i].count;
          break;
        }
      }
    } else if (filterState.startDate || filterState.endDate || filterState.searchLower) {
      // fallback: sum chunk counts (upper bound / estimate)
      var s = 0;
      for (var j = 0; j < activeChunks.length; j++) {
        s += (activeChunks[j].count || 0);
      }
      totalScope = s;
    }

    if (ui.infoTotal) {
      if (totalScope != null) ui.infoTotal.textContent = String(renderedVisibleCount) + ' / ' + String(totalScope);
      else ui.infoTotal.textContent = String(renderedVisibleCount);
    }
  }

  function init() {
    ui.chatContent = document.getElementById('chatContent') || document.querySelector('.chat-content');
    if (!ui.chatContent) {
      warn('chatContent not found');
      return;
    }

    // create sentinels (always keep)
    ui.chatContent.innerHTML = '';
    ui.topSentinel = document.createElement('div');
    ui.topSentinel.id = 'qce-top-sentinel';
    ui.bottomSentinel = document.createElement('div');
    ui.bottomSentinel.id = 'qce-bottom-sentinel';
    ui.chatContent.appendChild(ui.topSentinel);
    ui.chatContent.appendChild(ui.bottomSentinel);

    ui.infoTotal = document.getElementById('info-total');
    ui.infoRange = document.getElementById('info-range');

    // modal close
    var modal = document.getElementById('imageModal');
    if (modal) modal.addEventListener('click', window.hideImageModal);
    document.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') window.hideImageModal();
    });

    // icons
    setLucideIcons();

    // theme
    initThemeToggle();

    // time range
    initTimeRange();

    // sender filter
    initSenderFilter();

    // search
    initSearchUI();

    // header stats init
    if (ui.infoRange) ui.infoRange.textContent = computeTimeRangeText();
    if (ui.infoTotal && manifest && manifest.stats) ui.infoTotal.textContent = String(manifest.stats.totalMessages || '--');

    // build active chunk list
    rebuildActiveChunks();

    // initial load
    resetAndLoadAround(0);

    // observers
    setupObservers();
  }

  // ---------- Theme ----------
  function initThemeToggle() {
    ui.themeToggle = document.getElementById('themeToggle');
    ui.themeIcon = document.getElementById('themeIcon');
    if (!ui.themeToggle || !ui.themeIcon) return;

    var currentTheme = localStorage.getItem('theme') || 'light';

    function setTheme(theme) {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        ui.themeIcon.setAttribute('data-lucide', 'moon');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
        ui.themeIcon.setAttribute('data-lucide', 'sun');
        localStorage.setItem('theme', 'light');
      }
      setLucideIcons();
    }

    setTheme(currentTheme);

    ui.themeToggle.addEventListener('click', function () {
      currentTheme = localStorage.getItem('theme') || 'light';
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  // ---------- Time Range ----------
  function initTimeRange() {
    ui.timeRangeBtn = document.getElementById('timeRangeBtn');
    ui.timeRangeDropdown = document.getElementById('timeRangeDropdown');
    ui.timeRangeLabel = document.getElementById('timeRangeLabel');
    ui.startDateInput = document.getElementById('startDate');
    ui.endDateInput = document.getElementById('endDate');
    ui.applyTimeRangeBtn = document.getElementById('applyTimeRange');
    ui.clearTimeRangeBtn = document.getElementById('clearTimeRange');

    if (manifest && manifest.stats) {
      ui.minDateKey = manifest.stats.minDateKey || null;
      ui.maxDateKey = manifest.stats.maxDateKey || null;
    }

    function clampDateValue(value) {
      if (!value) return '';
      var normalized = value.slice(0, 10);
      if (ui.minDateKey && normalized < ui.minDateKey) return ui.minDateKey;
      if (ui.maxDateKey && normalized > ui.maxDateKey) return ui.maxDateKey;
      return normalized;
    }

    function applyDateRangeLimits() {
      if (!ui.startDateInput || !ui.endDateInput) return;
      ui.startDateInput.min = ui.minDateKey || '';
      ui.endDateInput.min = ui.minDateKey || '';
      ui.startDateInput.max = ui.maxDateKey || '';
      ui.endDateInput.max = ui.maxDateKey || '';
    }

    function enforceInputRange() {
      if (ui.startDateInput) ui.startDateInput.value = clampDateValue(ui.startDateInput.value);
      if (ui.endDateInput) ui.endDateInput.value = clampDateValue(ui.endDateInput.value);
      if (ui.startDateInput && ui.endDateInput && ui.startDateInput.value && ui.endDateInput.value && ui.startDateInput.value > ui.endDateInput.value) {
        ui.endDateInput.value = ui.startDateInput.value;
      }
    }

    function updateTimeRangeLabel() {
      if (!ui.timeRangeLabel || !ui.startDateInput || !ui.endDateInput) return;
      var start = ui.startDateInput.value;
      var end = ui.endDateInput.value;
      if (start || end) ui.timeRangeLabel.textContent = (start || '开始') + ' ~ ' + (end || '结束');
      else ui.timeRangeLabel.textContent = '全部时间';
    }

    // restore from storage
    var saved = localStorage.getItem('timeRange');
    if (saved && ui.startDateInput && ui.endDateInput) {
      try {
        var r = JSON.parse(saved);
        ui.startDateInput.value = r.start || '';
        ui.endDateInput.value = r.end || '';
      } catch (e) {}
    }

    applyDateRangeLimits();
    enforceInputRange();
    updateTimeRangeLabel();

    if (ui.startDateInput) ui.startDateInput.addEventListener('change', function () { enforceInputRange(); updateTimeRangeLabel(); });
    if (ui.endDateInput) ui.endDateInput.addEventListener('change', function () { enforceInputRange(); updateTimeRangeLabel(); });

    if (ui.timeRangeBtn && ui.timeRangeDropdown) {
      ui.timeRangeBtn.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
        ui.timeRangeDropdown.classList.toggle('active');
      });
    }

    if (ui.applyTimeRangeBtn) {
      ui.applyTimeRangeBtn.addEventListener('click', function () {
        enforceInputRange();
        var start = ui.startDateInput ? ui.startDateInput.value : '';
        var end = ui.endDateInput ? ui.endDateInput.value : '';
        localStorage.setItem('timeRange', JSON.stringify({ start: start, end: end }));
        updateTimeRangeLabel();
        if (ui.timeRangeDropdown) ui.timeRangeDropdown.classList.remove('active');

        // apply
        applyFiltersAndReload();
      });
    }

    if (ui.clearTimeRangeBtn) {
      ui.clearTimeRangeBtn.addEventListener('click', function () {
        if (ui.startDateInput) ui.startDateInput.value = '';
        if (ui.endDateInput) ui.endDateInput.value = '';
        localStorage.removeItem('timeRange');
        updateTimeRangeLabel();
        if (ui.timeRangeDropdown) ui.timeRangeDropdown.classList.remove('active');

        // apply
        applyFiltersAndReload();
      });
    }

    document.addEventListener('click', function (e) {
      if (!e || !ui.timeRangeDropdown) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.time-range-container')) {
        ui.timeRangeDropdown.classList.remove('active');
      }
    });
  }

  // ---------- Sender Filter ----------
  function initSenderFilter() {
    ui.filterBtn = document.getElementById('filterBtn');
    ui.filterDropdown = document.getElementById('filterDropdown');
    ui.filterOptionsList = document.getElementById('filterOptionsList');
    ui.filterSearchInput = document.getElementById('filterSearchInput');
    ui.filterNoResult = document.getElementById('filterNoResult');

    if (!ui.filterOptionsList) return;

    // populate from manifest.senders
    if (manifest && Array.isArray(manifest.senders)) {
      // sort: keep stable but prefer by count desc
      var list = manifest.senders.slice().sort(function (a, b) {
        return (b.count || 0) - (a.count || 0);
      });

      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s) continue;
        var uid = String(s.uid || '');
        if (!uid) continue;

        var option = document.createElement('div');
        option.className = 'filter-option';
        option.setAttribute('data-value', uid);

        var aliases = Array.isArray(s.aliases) ? s.aliases.filter(Boolean) : [];
        var displayName = String(s.displayName || (aliases[0] || uid));

        if (aliases.length > 1) {
          option.textContent = displayName + ' (' + String(aliases.length - 1) + '个别名)';
          option.setAttribute('title', aliases.join(', '));
        } else {
          option.textContent = displayName;
        }

        option.setAttribute('data-names', (aliases.join('|') + '|' + displayName).toLowerCase());
        ui.filterOptionsList.appendChild(option);
      }
    }

    if (ui.filterSearchInput) {
      ui.filterSearchInput.addEventListener('input', function (e) {
        var keyword = (e && e.target && e.target.value ? e.target.value : '').toLowerCase().trim();
        var options = ui.filterOptionsList.querySelectorAll('.filter-option');
        var hasVisible = false;

        for (var i = 0; i < options.length; i++) {
          var opt = options[i];
          var value = opt.getAttribute('data-value');
          var names = opt.getAttribute('data-names') || (opt.textContent || '').toLowerCase();
          if (value === 'all' || names.indexOf(keyword) >= 0 || (opt.textContent || '').toLowerCase().indexOf(keyword) >= 0) {
            opt.classList.remove('hidden');
            hasVisible = true;
          } else {
            opt.classList.add('hidden');
          }
        }

        if (ui.filterNoResult) {
          if (hasVisible) ui.filterNoResult.classList.remove('visible');
          else ui.filterNoResult.classList.add('visible');
        }
      });
    }

    if (ui.filterBtn && ui.filterDropdown) {
      ui.filterBtn.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
        ui.filterDropdown.classList.toggle('active');
        if (ui.filterDropdown.classList.contains('active') && ui.filterSearchInput) {
          setTimeout(function () { ui.filterSearchInput.focus(); }, 100);
        }
      });
    }

    ui.filterOptionsList.addEventListener('click', function (e) {
      var t = e ? e.target : null;
      if (!t || !t.classList || !t.classList.contains('filter-option')) return;

      // clear active
      var opts = ui.filterOptionsList.querySelectorAll('.filter-option');
      for (var i = 0; i < opts.length; i++) opts[i].classList.remove('active');
      t.classList.add('active');

      var selected = t.getAttribute('data-value');
      if (selected === 'all') {
        ui.currentFilterUid = null;
      } else {
        ui.currentFilterUid = selected;
      }

      if (ui.filterDropdown) ui.filterDropdown.classList.remove('active');

      // clear filter search UI
      if (ui.filterSearchInput) ui.filterSearchInput.value = '';
      for (var j = 0; j < opts.length; j++) opts[j].classList.remove('hidden');
      if (ui.filterNoResult) ui.filterNoResult.classList.remove('visible');

      // apply
      applyFiltersAndReload();
    });

    document.addEventListener('click', function (e) {
      if (!e || !ui.filterDropdown) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.filter-container')) {
        ui.filterDropdown.classList.remove('active');
      }
    });
  }

  // ---------- Search UI ----------
  function initSearchUI() {
    ui.searchBtn = document.getElementById('searchBtn');
    ui.searchWrapper = document.getElementById('searchWrapper');
    ui.searchInput = document.getElementById('searchInput');
    ui.clearSearch = document.getElementById('clearSearch');

    if (!ui.searchBtn || !ui.searchWrapper || !ui.searchInput) return;

    function updateClearButton() {
      if (!ui.clearSearch) return;
      ui.clearSearch.style.display = ui.searchInput.value ? 'block' : 'none';
    }

    ui.searchBtn.addEventListener('click', function () {
      ui.searchActive = !ui.searchActive;
      if (ui.searchActive) {
        ui.searchWrapper.classList.add('active');
        ui.searchInput.focus();
      } else {
        ui.searchWrapper.classList.remove('active');
        ui.searchInput.value = '';
        updateClearButton();
        applyFiltersAndReload();
      }
    });

    document.addEventListener('click', function (e) {
      if (!e || !ui.searchActive) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.search-container')) {
        ui.searchActive = false;
        ui.searchWrapper.classList.remove('active');
        if (!ui.searchInput.value) {
          ui.searchInput.value = '';
          updateClearButton();
          applyFiltersAndReload();
        }
      }
    });

    var onSearchInput = debounce(function () {
      updateClearButton();
      applyFiltersAndReload();
    }, 300);

    ui.searchInput.addEventListener('input', onSearchInput);

    if (ui.clearSearch) {
      ui.clearSearch.addEventListener('click', function () {
        ui.searchInput.value = '';
        updateClearButton();
        applyFiltersAndReload();
        ui.searchInput.focus();
      });
    }

    updateClearButton();
  }

  // ---------- Apply filters and reload ----------
  function applyFiltersFromUI() {
    // time range
    var start = ui.startDateInput ? ui.startDateInput.value : '';
    var end = ui.endDateInput ? ui.endDateInput.value : '';
    filterState.startDate = start || '';
    filterState.endDate = end || '';

    // sender
    filterState.senderUid = ui.currentFilterUid ? String(ui.currentFilterUid) : null;

    // search
    var term = ui.searchInput ? String(ui.searchInput.value || '').trim() : '';
    filterState.searchTerm = term;
    filterState.searchLower = term ? term.toLowerCase() : '';
  }

  function applyFiltersAndReload() {
    applyFiltersFromUI();
    rebuildActiveChunks();
    resetAndLoadAround(0);
  }

  // ---------- Active chunk rebuild ----------
  function rebuildActiveChunks() {
    activeChunks = [];
    activePosByChunkId = new Map();

    var chunks = (manifest && Array.isArray(manifest.chunks)) ? manifest.chunks : [];
    for (var i = 0; i < chunks.length; i++) {
      var meta = chunks[i];
      if (chunkPassesFilters(meta)) {
        activePosByChunkId.set(meta.id, activeChunks.length);
        activeChunks.push(meta);
      }
    }
  }

  // ---------- Chunk loader ----------
  function loadChunk(meta) {
    if (!meta || !meta.id || !meta.file) return Promise.reject(new Error('bad chunk meta'));
    if (chunkCache.has(meta.id)) return Promise.resolve(chunkCache.get(meta.id));
    if (pendingChunk.has(meta.id)) return pendingChunk.get(meta.id).promise;

    var resolveFn, rejectFn;
    var p = new Promise(function (resolve, reject) {
      resolveFn = resolve;
      rejectFn = reject;
    });
    pendingChunk.set(meta.id, { promise: p, resolve: resolveFn, reject: rejectFn });

    var s = document.createElement('script');
    s.src = meta.file;
    s.async = true;
    s.onerror = function () {
      pendingChunk.delete(meta.id);
      rejectFn(new Error('failed to load chunk script: ' + meta.file));
    };
    // onload: actual data arrives via __QCE_CHUNK__
    document.head.appendChild(s);

    // 尽量减小 DOM 负担：加载后移除 script 标签（不影响执行）
    s.onload = function () {
      try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
    };

    return p;
  }

  // ---------- MessageId index loader ----------
  function hashToBucket(str, bucketCount) {
    var h = fnv1a32(str, 0x811c9dc5);
    return (h % bucketCount) >>> 0;
  }

  function bucketHex2(bucket) {
    var hex = bucket.toString(16);
    if (hex.length < 2) hex = '0' + hex;
    return hex;
  }

  function loadMsgIndexBucket(bucket) {
    if (!manifest || !manifest.msgidIndex) return Promise.reject(new Error('msgid index not available'));
    var bucketCount = manifest.msgidIndex.bucketCount || 0;
    var dir = manifest.msgidIndex.dir || 'data/index';
    var prefix = manifest.msgidIndex.filePrefix || 'msgid_b';
    var ext = manifest.msgidIndex.fileExt || '.js';
    if (!bucketCount) return Promise.reject(new Error('msgid index bucketCount invalid'));

    if (loadedMsgIndexBuckets.has(bucket)) return Promise.resolve();
    if (pendingMsgIndexBuckets.has(bucket)) return pendingMsgIndexBuckets.get(bucket).promise;

    var resolveFn, rejectFn;
    var p = new Promise(function (resolve, reject) {
      resolveFn = resolve;
      rejectFn = reject;
    });
    pendingMsgIndexBuckets.set(bucket, { promise: p, resolve: resolveFn, reject: rejectFn });

    var s = document.createElement('script');
    s.src = dir + '/' + prefix + bucketHex2(bucket) + ext;
    s.async = true;
    s.onerror = function () {
      pendingMsgIndexBuckets.delete(bucket);
      rejectFn(new Error('failed to load msgid index bucket: ' + s.src));
    };
    document.head.appendChild(s);

    s.onload = function () {
      try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
    };

    return p;
  }

  // ---------- Render window ----------
  function clearRenderedDOM() {
    // keep sentinels
    if (!ui.chatContent || !ui.topSentinel || !ui.bottomSentinel) return;
    // remove everything between sentinels
    while (ui.chatContent.children.length > 2) {
      ui.chatContent.removeChild(ui.chatContent.children[1]);
    }
  }

  function resetWindowState() {
    rendered = [];
    loadedStartPos = 0;
    loadedEndPos = -1;
    isLoadingNext = false;
    isLoadingPrev = false;
  }

  function getMaxWindowChunks() {
    // 你可以在导出 manifest 里扩展设置；这里先固定 3
    return 3;
  }

  function renderChunkAtEnd(pos, chunk, meta) {
    var container = document.createElement('div');
    container.className = 'qce-chunk';
    container.setAttribute('data-chunk-id', chunk.id);
    container.setAttribute('data-chunk-pos', String(pos));

    var html = '';
    var visible = 0;
    var msgs = Array.isArray(chunk.messages) ? chunk.messages : [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (messagePassesFilters(m)) {
        visible++;
        html += m.html || '';
      }
    }

    if (visible === 0) {
      // 不插入空 chunk（避免空白占位影响滚动），但仍记录到 rendered
      return { el: null, visibleCount: 0 };
    }

    container.innerHTML = html;
    ui.chatContent.insertBefore(container, ui.bottomSentinel);

    if (filterState.searchTerm) highlightIn(container, filterState.searchTerm);

    return { el: container, visibleCount: visible };
  }

  function renderChunkAtStart(pos, chunk, meta) {
    var container = document.createElement('div');
    container.className = 'qce-chunk';
    container.setAttribute('data-chunk-id', chunk.id);
    container.setAttribute('data-chunk-pos', String(pos));

    var html = '';
    var visible = 0;
    var msgs = Array.isArray(chunk.messages) ? chunk.messages : [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (messagePassesFilters(m)) {
        visible++;
        html += m.html || '';
      }
    }

    if (visible === 0) {
      return { el: null, visibleCount: 0 };
    }

    container.innerHTML = html;
    ui.chatContent.insertBefore(container, ui.topSentinel.nextSibling);

    if (filterState.searchTerm) highlightIn(container, filterState.searchTerm);

    return { el: container, visibleCount: visible };
  }

  function sumRenderedVisibleCount() {
    var s = 0;
    for (var i = 0; i < rendered.length; i++) s += (rendered[i].visibleCount || 0);
    return s;
  }

  function trimTopIfNeeded() {
    var maxChunks = getMaxWindowChunks();
    var loadedCount = loadedEndPos - loadedStartPos + 1;
    if (loadedCount <= maxChunks) return;

    // remove first rendered entry (loadedStartPos)
    var first = rendered.shift();
    loadedStartPos++;

    if (first && first.el) {
      var h = first.el.getBoundingClientRect().height || 0;
      try { first.el.parentNode && first.el.parentNode.removeChild(first.el); } catch (e) {}
      // 删除上方内容会导致视图跳动：向上补偿
      if (h) window.scrollBy(0, -h);
    }

    // memory: allow GC
    if (first && first.chunkId) chunkCache.delete(first.chunkId);
  }

  function trimBottomIfNeeded() {
    var maxChunks = getMaxWindowChunks();
    var loadedCount = loadedEndPos - loadedStartPos + 1;
    if (loadedCount <= maxChunks) return;

    // remove last rendered entry (loadedEndPos)
    var last = rendered.pop();
    loadedEndPos--;

    if (last && last.el) {
      try { last.el.parentNode && last.el.parentNode.removeChild(last.el); } catch (e) {}
    }
    if (last && last.chunkId) chunkCache.delete(last.chunkId);
  }

  function resetAndLoadAround(pos) {
    // pos: active chunk position
    clearRenderedDOM();
    resetWindowState();

    // clear chunk cache aggressively to keep memory bounded
    chunkCache.clear();
    pendingChunk.clear();

    if (!activeChunks || activeChunks.length === 0) {
      // show hint
      var hint = document.createElement('div');
      hint.className = 'scroll-loader';
      hint.textContent = '没有匹配的消息';
      ui.chatContent.insertBefore(hint, ui.bottomSentinel);
      if (ui.infoTotal) ui.infoTotal.textContent = '0';
      return;
    }

    // clamp pos
    if (pos < 0) pos = 0;
    if (pos > activeChunks.length - 1) pos = activeChunks.length - 1;

    // compute window [start..end]
    var maxChunks = getMaxWindowChunks();
    var half = Math.floor(maxChunks / 2);
    var start = pos - half;
    if (start < 0) start = 0;
    var end = start + maxChunks - 1;
    if (end > activeChunks.length - 1) {
      end = activeChunks.length - 1;
      start = Math.max(0, end - maxChunks + 1);
    }

    loadedStartPos = start;
    loadedEndPos = start - 1;

    // scroll to top when filter changes
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }

    // load sequentially
    (async function () {
      for (var p = start; p <= end; p++) {
        await loadNextInternal();
      }
      updateHeaderStats(sumRenderedVisibleCount());
    })().catch(function (e) {
      warn('initial load error', e);
    });
  }

  async function loadNextInternal() {
    var nextPos = loadedEndPos + 1;
    if (nextPos < loadedStartPos) nextPos = loadedStartPos;
    if (nextPos >= activeChunks.length) return;

    var meta = activeChunks[nextPos];
    var chunk = await loadChunk(meta);
    var renderedChunk = renderChunkAtEnd(nextPos, chunk, meta);

    rendered.push({ pos: nextPos, chunkId: meta.id, el: renderedChunk.el, visibleCount: renderedChunk.visibleCount });
    loadedEndPos = nextPos;

    // trim
    trimTopIfNeeded();
  }

  async function loadPrevInternal() {
    var prevPos = loadedStartPos - 1;
    if (prevPos < 0) return;

    var meta = activeChunks[prevPos];
    var beforeHeight = 0;

    // we will render first, then scroll compensation by added height
    var chunk = await loadChunk(meta);
    var renderedChunk = renderChunkAtStart(prevPos, chunk, meta);

    // measure added height
    if (renderedChunk.el) beforeHeight = renderedChunk.el.getBoundingClientRect().height || 0;

    rendered.unshift({ pos: prevPos, chunkId: meta.id, el: renderedChunk.el, visibleCount: renderedChunk.visibleCount });
    loadedStartPos = prevPos;

    // compensate scroll because we inserted content above viewport
    if (beforeHeight) window.scrollBy(0, beforeHeight);

    // trim bottom
    trimBottomIfNeeded();
  }

  // ---------- Infinite scroll observers ----------
  function setupObservers() {
    // IntersectionObserver preferred
    if ('IntersectionObserver' in window && ui.topSentinel && ui.bottomSentinel) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e.isIntersecting) continue;
          if (e.target === ui.bottomSentinel) {
            if (!isLoadingNext) {
              isLoadingNext = true;
              (async function () {
                try {
                  await loadNextInternal();
                  updateHeaderStats(sumRenderedVisibleCount());
                } finally {
                  isLoadingNext = false;
                }
              })();
            }
          } else if (e.target === ui.topSentinel) {
            if (!isLoadingPrev) {
              isLoadingPrev = true;
              (async function () {
                try {
                  await loadPrevInternal();
                  updateHeaderStats(sumRenderedVisibleCount());
                } finally {
                  isLoadingPrev = false;
                }
              })();
            }
          }
        }
      }, { root: null, rootMargin: '1200px 0px 1200px 0px', threshold: 0.01 });

      io.observe(ui.bottomSentinel);
      io.observe(ui.topSentinel);
      return;
    }

    // fallback scroll listener
    window.addEventListener('scroll', debounce(function () {
      var st = window.pageYOffset || document.documentElement.scrollTop || 0;
      var docH = document.documentElement.scrollHeight || 0;
      var winH = window.innerHeight || 0;

      if (!isLoadingNext && (docH - (st + winH) < 1200)) {
        isLoadingNext = true;
        (async function () {
          try { await loadNextInternal(); updateHeaderStats(sumRenderedVisibleCount()); }
          finally { isLoadingNext = false; }
        })();
      }

      if (!isLoadingPrev && (st < 600)) {
        isLoadingPrev = true;
        (async function () {
          try { await loadPrevInternal(); updateHeaderStats(sumRenderedVisibleCount()); }
          finally { isLoadingPrev = false; }
        })();
      }
    }, 80), { passive: true });
  }

  // ---------- Reply jump: scrollToMessage (跨 chunk 定位能力：msgid index buckets) ----------
  window.scrollToMessage = function (msgId) {
    if (!msgId) return;

    // 1) if already in DOM
    var el = document.getElementById(msgId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try {
        el.style.transition = 'background 0.3s';
        var originalBg = window.getComputedStyle(el).backgroundColor;
        el.style.background = 'rgba(0, 122, 255, 0.1)';
        setTimeout(function () {
          el.style.background = originalBg;
          setTimeout(function () { el.style.transition = ''; }, 300);
        }, 1000);
      } catch (e) {}
      return;
    }

    // 2) locate by msgid index bucket (on-demand)
    if (!manifest || !manifest.msgidIndex) {
      warn('msgid index not available');
      return;
    }

    var bucketCount = manifest.msgidIndex.bucketCount || 0;
    if (!bucketCount) {
      warn('msgid index bucketCount invalid');
      return;
    }

    var bucket = hashToBucket(String(msgId), bucketCount);

    loadMsgIndexBucket(bucket).then(function () {
      var chunkId = msgIdToChunkId.get(String(msgId));
      if (!chunkId) {
        warn('msgId not found in index:', msgId);
        return;
      }

      // chunk must be in activeChunks (filtered scope), otherwise we should not change filters automatically
      var targetPos = activePosByChunkId.get(chunkId);
      if (typeof targetPos !== 'number') {
        warn('target chunk not in current filtered scope:', chunkId);
        return;
      }

      // jump window to that pos
      resetAndLoadAround(targetPos);

      // wait a bit for DOM insertion, then scroll
      setTimeout(function () {
        var e2 = document.getElementById(msgId);
        if (e2) {
          e2.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try {
            e2.style.transition = 'background 0.3s';
            var originalBg = window.getComputedStyle(e2).backgroundColor;
            e2.style.background = 'rgba(0, 122, 255, 0.1)';
            setTimeout(function () {
              e2.style.background = originalBg;
              setTimeout(function () { e2.style.transition = ''; }, 300);
            }, 1000);
          } catch (e) {}
        } else {
          warn('message still not found after jump:', msgId);
        }
      }, 400);
    }).catch(function (e) {
      warn('load msgid index bucket failed:', e);
    });
  };

  // done
  log('viewer initialized');
})();
`;
