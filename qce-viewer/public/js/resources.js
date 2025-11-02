// 全局状态
let allResources = [];
let currentFilter = 'all';

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadResources();
    setupModalHandlers();
    initTheme();
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

// 设置模态框事件处理器
function setupModalHandlers() {
    // ESC键关闭
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('imageModal');
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

// 加载资源
async function loadResources() {
    showLoading();

    try {
        const response = await fetch('/api/resources');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        allResources = result.data;
        updateStats();
        renderResources();
        
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
        console.error('加载失败:', error);
        showEmpty();
    } finally {
        hideLoading();
    }
}

// 更新统计
function updateStats() {
    const stats = {
        total: allResources.length,
        image: allResources.filter(r => r.type === 'image').length,
        video: allResources.filter(r => r.type === 'video').length,
        audio: allResources.filter(r => r.type === 'audio').length,
        file: allResources.filter(r => r.type === 'file').length
    };

    document.getElementById('totalResources').textContent = `${stats.total} 个资源`;
    document.getElementById('imageCount').textContent = stats.image;
    document.getElementById('videoCount').textContent = stats.video;
}

// 渲染资源
function renderResources() {
    const grid = document.getElementById('resourceGrid');
    const empty = document.getElementById('emptyState');
    
    let filtered = allResources;
    if (currentFilter !== 'all') {
        filtered = allResources.filter(r => r.type === currentFilter);
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

    // 添加信息
    const info = document.createElement('div');
    info.className = 'resource-info';
    info.innerHTML = `
        <div style="font-weight: 500;">${escapeHtml(resource.chatName || '未知聊天')}</div>
        <div style="font-size: 11px; opacity: 0.8;">${resource.time || ''}</div>
    `;
    item.appendChild(info);

    return item;
}

// 筛选资源
function filterResources(type) {
    currentFilter = type;

    const buttons = document.querySelectorAll('.filter-tab');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    renderResources();
}

// 打开图片模态框
function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    const downloadBtn = document.getElementById('modalDownload');
    
    img.src = src;
    
    // 设置下载功能
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        const link = document.createElement('a');
        link.href = src;
        link.download = src.split('/').pop();
        link.click();
    };
    
    // 移除可能存在的关闭动画类
    modal.classList.remove('closing');
    
    // 强制重绘以确保动画能够触发
    requestAnimationFrame(() => {
        modal.classList.add('active');
        
        // 初始化图标
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({
                attrs: {
                    'stroke-width': 2
                }
            });
        }
    });
}

// 关闭模态框
function closeModal() {
    const modal = document.getElementById('imageModal');
    
    // 添加关闭动画类
    modal.classList.add('closing');
    
    // 等待动画完成后移除类
    setTimeout(() => {
        modal.classList.remove('active');
        modal.classList.remove('closing');
    }, 300); // 与CSS中的关闭动画时间一致
}

// UI 状态
function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
}

function showEmpty() {
    document.getElementById('emptyState').style.display = 'block';
}

// 工具函数
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

