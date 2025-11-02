// 全局状态
let allChats = [];
let currentFilter = 'all';

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupSearch();
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

// 加载数据
async function loadData() {
    showLoading();
    hideError();
    hideEmpty();

    try {
        const response = await fetch('/api/scan');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        allChats = result.data.chats;
        updateStats(result.data);
        renderChats(allChats);

        if (allChats.length === 0) {
            showEmpty();
        }
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// 刷新数据
async function refreshData() {
    showLoading();
    
    try {
        const response = await fetch('/api/scan/refresh', {
            method: 'POST'
        });
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        allChats = result.data.chats;
        updateStats(result.data);
        renderChats(allChats);

        if (allChats.length === 0) {
            showEmpty();
        }
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// 更新统计信息
function updateStats(data) {
    const count = data.totalChats || 0;
    document.getElementById('totalChats').textContent = `${count} 个聊天`;
    document.getElementById('totalExports').textContent = data.totalExports || 0;
    document.getElementById('totalResources').textContent = data.totalResources || 0;
    
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
}

// 渲染聊天列表
function renderChats(chats) {
    const grid = document.getElementById('chatGrid');
    grid.innerHTML = '';

    // 根据当前筛选条件过滤
    const filtered = chats.filter(chat => {
        if (currentFilter === 'all') return true;
        return chat.type === currentFilter;
    });

    filtered.forEach(chat => {
        const card = createChatCard(chat);
        grid.appendChild(card);
    });

    // 显示/隐藏空状态
    if (filtered.length === 0) {
        showEmpty();
    } else {
        hideEmpty();
    }
}

// 创建聊天卡片
function createChatCard(chat) {
    const card = document.createElement('a');
    card.className = 'chat-card';
    card.href = `/chat.html?type=${chat.type}&id=${encodeURIComponent(chat.chatId)}`;

    const typeLabel = chat.type === 'group' ? '群聊' : '私聊';

    card.innerHTML = `
        <div class="chat-header">
            <h3 class="chat-name">${escapeHtml(chat.chatName)}</h3>
            <span class="chat-type">${typeLabel}</span>
        </div>
        <div class="chat-stats">
            <div class="chat-stat">
                <span class="chat-stat-label">消息</span>
                <span class="chat-stat-value">${formatNumber(chat.messageCount)}</span>
            </div>
            <div class="chat-stat">
                <span class="chat-stat-label">资源</span>
                <span class="chat-stat-value">${formatNumber(chat.totalResources)}</span>
            </div>
        </div>
    `;

    return card;
}

// 筛选聊天
function filterChats(type) {
    currentFilter = type;

    // 更新按钮状态
    document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // 重新渲染
    renderChats(allChats);
}

// 设置搜索
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchChats(e.target.value);
        }, 300);
    });
}

// 搜索聊天
async function searchChats(query) {
    if (!query.trim()) {
        renderChats(allChats);
        return;
    }

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const result = await response.json();

        if (result.success) {
            renderChats(result.data);
        }
    } catch (error) {
        console.error('搜索失败:', error);
    }
}

// UI 状态管理
function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('chatGrid').style.display = 'none';
}

function hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('chatGrid').style.display = 'grid';
}

function showError(message) {
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('chatGrid').style.display = 'none';
    const hero = document.querySelector('.hero');
    if (hero) hero.style.display = 'none';
}

function hideError() {
    document.getElementById('errorState').style.display = 'none';
}

function showEmpty() {
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('chatGrid').style.display = 'none';
}

function hideEmpty() {
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('chatGrid').style.display = 'grid';
}

// 工具函数
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

