// 全局状态
let chatData = null;
let allResources = [];
let currentResourceFilter = 'all';
let currentView = 'grid';

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    const chatId = params.get('id');

    if (!type || !chatId) {
        showError('缺少必要参数');
        return;
    }

    initTheme();
    loadChatData(type, chatId);
});

// 主题管理
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    
    // 获取保存的主题或使用系统主题
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);
    }
    
    // 主题切换
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });
}

function updateThemeIcon(theme) {
    const themeIcon = document.getElementById('themeIcon');
    const iconName = theme === 'dark' ? 'sun' : 'moon';
    themeIcon.setAttribute('data-lucide', iconName);
    
    // 重新初始化图标
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({
            attrs: {
                'stroke-width': 2
            }
        });
    }
}

// 加载聊天数据
async function loadChatData(type, chatId) {
    showLoading();

    try {
        const response = await fetch(`/api/chats/${type}/${encodeURIComponent(chatId)}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        chatData = result.data;
        document.getElementById('chatName').textContent = chatData.chatName;
        document.title = `${chatData.chatName} - QQ Chat Exporter`;

        renderChatStats();
        renderExports();
        
        // 加载资源
        await loadResources(type, chatId);

        showContent();
        
        // 初始化图标
        setTimeout(() => {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons({
                    attrs: {
                        'stroke-width': 2
                    }
                });
            }
        }, 100);
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// 渲染统计信息
function renderChatStats() {
    const hero = document.getElementById('chatHero');
    const typeLabel = chatData.type === 'group' ? '群聊' : '私聊';

    hero.innerHTML = `
        <h2 class="hero-title">${formatNumber(chatData.messageCount)} 条消息</h2>
        <p class="hero-subtitle">
            ${typeLabel} · 
            ${chatData.exportCount} 次导出 · 
            ${formatNumber(chatData.totalResources)} 个资源
        </p>
    `;
}

// 渲染导出列表
function renderExports() {
    const list = document.getElementById('exportsList');
    list.innerHTML = '';

    chatData.exports.forEach((exp, index) => {
        const container = document.createElement('div');
        container.className = 'export-container';
        
        const item = document.createElement('div');
        item.className = 'export-item';
        item.onclick = () => toggleExport(index);

        const formatLabel = getFormatLabel(exp.format);
        const messageInfo = exp.metadata?.messageCount ? `${formatNumber(exp.metadata.messageCount)} 条消息` : '';
        const resourceInfo = exp.resourceCount > 0 ? `${exp.resourceCount} 个资源` : '';
        
        let metaInfo = [messageInfo, resourceInfo, exp.fileSize].filter(Boolean).join(' · ');
        
        // 语义化时间
        const timeText = getSemanticTime(exp.exportDate, exp.exportTime);

        item.innerHTML = `
            <div class="export-info">
                <div class="export-format">${formatLabel}</div>
                <div class="export-time">${timeText}</div>
            </div>
            <div class="export-meta">${metaInfo}</div>
            <i data-lucide="chevron-down" class="export-chevron" data-lucide-options='{"size":20,"strokeWidth":2}'></i>
        `;

        // 预览区域
        const preview = document.createElement('div');
        preview.className = 'export-preview';
        preview.id = `preview-${index}`;
        
        if (exp.format === 'HTML') {
            // 检查文件大小，超过 5MB 不预览
            const fileSizeBytes = exp.fileSizeBytes || 0;
            const maxPreviewSize = 5 * 1024 * 1024; // 5MB
            const shouldPreview = fileSizeBytes < maxPreviewSize;
            
            if (shouldPreview) {
                preview.innerHTML = `
                    <div class="preview-actions">
                        <button onclick="toggleFullscreen('preview-${index}')" class="btn btn-secondary">
                            <i data-lucide="maximize-2" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                            全屏预览
                        </button>
                        <a href="/exports/${exp.filename}" target="_blank" class="btn btn-secondary">
                            <i data-lucide="external-link" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                            新窗口打开
                        </a>
                        <a href="/exports/${exp.filename}" download class="btn btn-secondary">
                            <i data-lucide="download" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                            下载
                        </a>
                    </div>
                    <iframe src="/exports/${exp.filename}" class="preview-iframe" id="iframe-${index}"></iframe>
                `;
            } else {
                preview.innerHTML = `
                    <div class="preview-actions">
                        <a href="/exports/${exp.filename}" target="_blank" class="btn btn-secondary">
                            <i data-lucide="external-link" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                            新窗口打开
                        </a>
                        <a href="/exports/${exp.filename}" download class="btn btn-secondary">
                            <i data-lucide="download" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                            下载
                        </a>
                    </div>
                    <div class="preview-warning">
                        <i data-lucide="alert-circle" data-lucide-options='{"size":20,"strokeWidth":2}'></i>
                        <p>文件过大 (${exp.fileSize})，为避免页面卡顿，请使用「新窗口打开」查看完整内容</p>
                    </div>
                `;
            }
        } else if (exp.format === 'JSON') {
            preview.innerHTML = `
                <div class="preview-actions">
                    <a href="/exports/${exp.filename}" target="_blank" class="btn btn-secondary">
                        <i data-lucide="external-link" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                        新窗口打开
                    </a>
                    <a href="/exports/${exp.filename}" download class="btn btn-secondary">
                        <i data-lucide="download" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                        下载
                    </a>
                </div>
                <div class="preview-text">点击"新窗口打开"查看完整 JSON 数据</div>
            `;
        } else {
            preview.innerHTML = `
                <div class="preview-actions">
                    <a href="/exports/${exp.filename}" target="_blank" class="btn btn-secondary">
                        <i data-lucide="external-link" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                        新窗口打开
                    </a>
                    <a href="/exports/${exp.filename}" download class="btn btn-secondary">
                        <i data-lucide="download" data-lucide-options='{"size":16,"strokeWidth":2}'></i>
                        下载
                    </a>
                </div>
            `;
        }

        container.appendChild(item);
        container.appendChild(preview);
        list.appendChild(container);
    });

    // 初始化图标
    setTimeout(() => {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({
                attrs: {
                    'stroke-width': 2
                }
            });
        }
    }, 50);
}

// 切换导出预览
function toggleExport(index) {
    const preview = document.getElementById(`preview-${index}`);
    const container = preview.parentElement;
    const chevron = container.querySelector('.export-chevron');
    
    const isOpen = container.classList.contains('open');
    
    // 关闭所有其他的
    document.querySelectorAll('.export-container.open').forEach(c => {
        if (c !== container) {
            c.classList.remove('open');
        }
    });
    
    // 切换当前
    if (isOpen) {
        container.classList.remove('open');
    } else {
        container.classList.add('open');
    }
    
    // 重新初始化图标
    setTimeout(() => {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({
                attrs: {
                    'stroke-width': 2
                }
            });
        }
    }, 50);
}

// 切换全屏
function toggleFullscreen(previewId) {
    const preview = document.getElementById(previewId);
    const iframe = preview.querySelector('.preview-iframe');
    
    if (!document.fullscreenElement) {
        // 进入全屏
        if (iframe.requestFullscreen) {
            iframe.requestFullscreen();
        } else if (iframe.webkitRequestFullscreen) {
            iframe.webkitRequestFullscreen();
        } else if (iframe.msRequestFullscreen) {
            iframe.msRequestFullscreen();
        }
    } else {
        // 退出全屏
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// 加载资源
async function loadResources(type, chatId) {
    try {
        const response = await fetch(`/api/chats/${type}/${encodeURIComponent(chatId)}/resources`);
        const result = await response.json();

        if (result.success) {
            allResources = result.data;
            renderResources();
        }
    } catch (error) {
        console.error('加载资源失败:', error);
    }
}

// 渲染资源
function renderResources() {
    const grid = document.getElementById('resourceGrid');
    const empty = document.getElementById('emptyResources');
    
    // 过滤资源
    let filtered = allResources;
    if (currentResourceFilter !== 'all') {
        filtered = allResources.filter(r => r.type === currentResourceFilter);
    }

    if (filtered.length === 0) {
        grid.style.display = 'none';
        empty.style.display = 'block';
        return;
    }

    grid.style.display = 'grid';
    empty.style.display = 'none';
    grid.innerHTML = '';

    filtered.forEach(resource => {
        const item = createResourceItem(resource);
        grid.appendChild(item);
    });
}

// 创建资源项
function createResourceItem(resource) {
    const item = document.createElement('div');
    item.className = 'resource-item';

    if (resource.type === 'image') {
        // 图片类型
        const img = document.createElement('img');
        img.className = 'resource-image';
        const filename = resource.actualFilename || resource.filename;
        img.src = `/resources/images/${filename}`;
        img.alt = resource.filename;
        img.onerror = () => {
            img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="%23f5f5f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2386868b" font-family="sans-serif">图片加载失败</text></svg>';
        };

        item.appendChild(img);
        item.onclick = () => openImageModal(`/resources/images/${filename}`);
    } else {
        // 其他类型显示文件信息
        item.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 16px;">
                <div style="font-size: 13px; color: var(--text-secondary); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;">
                    ${resource.filename}
                </div>
                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                    ${formatFileSize(resource.size)}
                </div>
            </div>
        `;
    }

    // 添加悬浮信息
    const info = document.createElement('div');
    info.className = 'resource-info';
    info.innerHTML = `
        <div style="font-weight: 500;">${escapeHtml(resource.sender?.name || '未知')}</div>
        <div style="font-size: 11px; opacity: 0.8;">${resource.time || ''}</div>
    `;
    item.appendChild(info);

    return item;
}

// 切换标签
function switchTab(tab) {
    // 更新标签按钮
    document.querySelectorAll('.tab').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // 切换内容
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tab}Tab`).classList.add('active');
}

// 筛选资源
function filterResources(type) {
    currentResourceFilter = type;

    // 更新按钮状态
    const buttons = event.target.parentElement.querySelectorAll('.filter-tab');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    renderResources();
}

// 切换视图
function toggleView(view) {
    currentView = view;
    const grid = document.getElementById('resourceGrid');
    
    if (view === 'list') {
        grid.style.gridTemplateColumns = '1fr';
    } else {
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
    }
}

// 打开图片模态框
function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    const downloadBtn = document.getElementById('modalDownload');
    
    img.src = src;
    modal.classList.add('active');
    
    // 设置下载功能
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        const link = document.createElement('a');
        link.href = src;
        link.download = src.split('/').pop();
        link.click();
    };
    
    // 重新初始化图标
    setTimeout(() => {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({
                attrs: {
                    'stroke-width': 2
                }
            });
        }
    }, 50);
}

// 关闭模态框
function closeModal() {
    const modal = document.getElementById('imageModal');
    modal.classList.remove('active');
}

// ESC键关闭模态框
document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('imageModal');
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
        closeModal();
    }
});

// UI 状态
function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('chatContent').style.display = 'none';
}

function hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
}

function showContent() {
    document.getElementById('chatContent').style.display = 'block';
}

function showError(message) {
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorMessage').textContent = message;
    hideLoading();
}

// 工具函数
function getFormatLabel(format) {
    const labels = {
        'HTML': 'HTML',
        'JSON': 'JSON',
        'TXT': 'TXT',
        'XLSX': 'XLSX'
    };
    return labels[format] || format;
}


function formatFileSize(bytes) {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatNumber(num) {
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + 'w';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 获取语义化时间
function getSemanticTime(dateStr, timeStr) {
    const exportDate = new Date(`${dateStr} ${timeStr}`);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const exportDay = new Date(exportDate.getFullYear(), exportDate.getMonth(), exportDate.getDate());
    
    const diffMs = now - exportDate;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    let semantic = '';
    
    if (diffMins < 1) {
        semantic = '刚刚';
    } else if (diffMins < 60) {
        semantic = `${diffMins} 分钟前`;
    } else if (exportDay.getTime() === today.getTime()) {
        semantic = '今天';
    } else if (exportDay.getTime() === yesterday.getTime()) {
        semantic = '昨天';
    } else if (diffDays < 7) {
        semantic = `${diffDays} 天前`;
    } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        semantic = `${weeks} 周前`;
    } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        semantic = `${months} 个月前`;
    } else {
        const years = Math.floor(diffDays / 365);
        semantic = `${years} 年前`;
    }
    
    return `${semantic} (${dateStr} ${timeStr})`;
}

