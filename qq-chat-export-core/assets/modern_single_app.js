
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
                this.spacer.style.height = this.totalHeight + 'px';
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
                    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    targetMsg.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
                    
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

            function activateReplyJump(target) {
                if (!target || target.closest('a, button')) return false;
                var reply = target.closest('.reply-content[data-reply-to]');
                if (!reply) return false;
                var msgId = reply.getAttribute('data-reply-to');
                if (!msgId) return false;
                window.scrollToMessage(msgId);
                return true;
            }

            document.addEventListener('click', function(e) {
                activateReplyJump(e.target);
            });
            document.addEventListener('keydown', function(e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (activateReplyJump(e.target)) e.preventDefault();
            });
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
            // issue #467：导出时可通过 window.__QCE_ENABLE_VIRTUAL_SCROLL=false 关闭，
            // 让所有消息留在 DOM 中，便于打印 / 导出 PDF（默认仍启用）。
            var virtualScroller = null;
            if (window.__QCE_ENABLE_VIRTUAL_SCROLL !== false && messageBlocks.length > 100) {
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
                return string.replace(/[.*+?^$\{\}()|\[\]\\]/g, '\\$&');
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
