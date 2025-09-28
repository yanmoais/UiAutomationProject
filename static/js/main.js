// 主应用程序入口

class SparkTestPlatform {
    constructor() {
        this.currentPage = 'dashboard';
        this.userInfo = null;
        this.init();
    }

    init() {
        // 等待所有脚本加载完成后再初始化
        this.waitForDependencies().then(() => {
            this.checkAuth();
            this.bindEvents();
            this.initNavigation();
        }).catch(error => {
            console.error('初始化失败:', error);
            this.showInitializationError();
        });
    }

    // 等待依赖项加载完成
    async waitForDependencies() {
        const maxAttempts = 50; // 最多等待5秒
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            // 检查必要的函数是否存在
            if (typeof initProductManagement === 'function' && 
                typeof initAutomationManagement === 'function') {
                console.log('所有依赖项已加载完成');
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        throw new Error('依赖项加载超时');
    }

    // 显示初始化错误
    showInitializationError() {
        const contentArea = document.getElementById('content-area');
        if (contentArea) {
            contentArea.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #666;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #f39c12; margin-bottom: 1rem;"></i>
                    <h3>系统初始化失败</h3>
                    <p>页面模块加载失败，请刷新页面重试。</p>
                    <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        <i class="fas fa-redo"></i> 刷新页面
                    </button>
                </div>
            `;
        }
    }

    // 检查用户认证状态
    async checkAuth() {
        try {
            const response = await fetch('/api/auth/check-auth');
            const data = await response.json();
            
            if (data.success && data.authenticated) {
                this.userInfo = data.user;
                this.updateUserInfo();
                this.loadDefaultPage();
            } else {
                // 未登录，跳转到登录页
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            // 网络错误时也跳转到登录页
            window.location.href = '/login';
        }
    }

    // 更新用户信息显示
    updateUserInfo() {
        const userInfoEl = document.querySelector('.user-info span');
        if (userInfoEl && this.userInfo) {
            userInfoEl.textContent = this.userInfo.username;
        }
        
        // 添加登出按钮
        this.addLogoutButton();
    }

    // 添加登出按钮
    addLogoutButton() {
        const userInfoContainer = document.querySelector('.user-info');
        if (userInfoContainer && !document.getElementById('logoutBtn')) {
            const logoutBtn = document.createElement('button');
            logoutBtn.id = 'logoutBtn';
            logoutBtn.className = 'logout-btn';
            logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 登出';
            logoutBtn.onclick = this.logout.bind(this);
            
            userInfoContainer.appendChild(logoutBtn);
        }
    }

    // 登出功能
    async logout() {
        try {
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // 跳转到登录页
                window.location.href = '/login';
            } else {
                console.error('Logout failed:', data.message);
            }
        } catch (error) {
            console.error('Logout error:', error);
            // 即使网络错误也跳转到登录页
            window.location.href = '/login';
        }
    }

    // 绑定事件
    bindEvents() {
        // 键盘事件
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        
        // 窗口大小变化事件
        window.addEventListener('resize', debounce(this.handleResize.bind(this), 250));
        
        // 页面可见性变化事件
        document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    }

    // 初始化导航
    initNavigation() {
        // 默认展开游戏自动化测试平台
        const gameAutomation = document.getElementById('gameAutomation');
        if (gameAutomation) {
            gameAutomation.classList.add('expanded');
        }
    }

    // 加载默认页面
    loadDefaultPage() {
        this.loadDashboard();
    }
    
    // 加载仪表盘
    loadDashboard() {
        this.currentPage = 'dashboard';
        this.updateActiveNavItem('dashboard');
        
        console.log('开始加载仪表盘页面...');
        
        // 初始化仪表盘
        if (typeof initDashboard === 'function') {
            try {
                initDashboard();
                console.log('仪表盘初始化成功');
            } catch (error) {
                console.error('仪表盘初始化失败:', error);
                this.showErrorPage('仪表盘模块初始化失败: ' + error.message);
            }
        } else {
            console.error('initDashboard function not found');
            this.showErrorPage('仪表盘模块未找到，请刷新页面重试');
        }
    }

    // 处理键盘事件
    handleKeyDown(event) {
        // ESC键关闭模态框
        if (event.key === 'Escape') {
            const modal = document.getElementById('projectModal');
            if (modal && modal.classList.contains('show')) {
                productManagement.closeModal();
            }
        }

        // Ctrl+N 快速添加项目
        if (event.ctrlKey && event.key === 'n') {
            event.preventDefault();
            if (this.currentPage === 'productManagement') {
                productManagement.openAddProjectModal();
            }
        }
    }

    // 处理窗口大小变化
    handleResize() {
        // 在移动设备上可以实现响应式调整
        if (isMobile()) {
            this.adjustForMobile();
        }
    }

    // 处理页面可见性变化
    handleVisibilityChange() {
        if (!document.hidden) {
            // 页面重新可见时，刷新当前页面数据
            this.refreshCurrentPage();
        }
    }

    // 移动设备适配
    adjustForMobile() {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && window.innerWidth <= 768) {
            // 在小屏幕上可以实现侧边栏折叠功能
            console.log('调整移动设备布局');
        }
    }

    // 刷新当前页面
    refreshCurrentPage() {
        if (this.currentPage === 'productManagement') {
            productManagement.loadProjects();
        } else if (this.currentPage === 'dashboard') {
            dashboardManager.refreshData();
        }
    }

    // 切换导航项
    toggleNavItem(itemId) {
        const navItem = document.getElementById(itemId);
        if (navItem) {
            navItem.classList.toggle('expanded');
        }
    }

    // 加载产品管理页面
    loadProductManagement() {
        this.currentPage = 'productManagement';
        this.updateActiveNavItem('productManagement');
        
        console.log('开始加载产品管理页面...');
        console.log('initProductManagement 类型:', typeof initProductManagement);
        
        // 初始化产品管理
        if (typeof initProductManagement === 'function') {
            try {
                initProductManagement();
                console.log('产品管理初始化成功');
            } catch (error) {
                console.error('产品管理初始化失败:', error);
                this.showErrorPage('产品管理模块初始化失败: ' + error.message);
            }
        } else {
            console.error('initProductManagement function not found');
            this.showErrorPage('产品管理模块未找到，请刷新页面重试');
        }
    }

    // 加载自动化管理页面
    loadAutomationManagement() {
        this.currentPage = 'automationManagement';
        this.updateActiveNavItem('automationManagement');
        
        // 初始化自动化管理
        if (typeof initAutomationManagement === 'function') {
            initAutomationManagement();
        } else {
            console.error('initAutomationManagement function not found');
            // 显示错误信息
            const contentArea = document.getElementById('content-area');
            if (contentArea) {
                contentArea.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #666;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #f39c12; margin-bottom: 1rem;"></i>
                        <h3>页面加载失败</h3>
                        <p>自动化管理模块初始化失败，请刷新页面重试。</p>
                        <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                            <i class="fas fa-redo"></i> 刷新页面
                        </button>
                    </div>
                `;
            }
        }
    }

    // 更新活动导航项
    updateActiveNavItem(activePage) {
        // 移除所有活动状态
        const navItems = document.querySelectorAll('.nav-subitem');
        navItems.forEach(item => item.classList.remove('active'));
        
        const dashboardNav = document.getElementById('dashboardNav');
        if (dashboardNav) {
            dashboardNav.classList.remove('active');
        }
        
        // 添加活动状态到当前页面
        if (activePage === 'dashboard') {
            if (dashboardNav) {
                dashboardNav.classList.add('active');
            }
        } else if (activePage === 'productManagement') {
            const productManagementItem = document.querySelector('.nav-subitem[onclick*="loadProductManagement"]');
            if (productManagementItem) {
                productManagementItem.classList.add('active');
            }
        } else if (activePage === 'automationManagement') {
            const automationManagementItem = document.querySelector('.nav-subitem[onclick*="loadAutomationManagement"]');
            if (automationManagementItem) {
                automationManagementItem.classList.add('active');
            }
        }
    }

    // 显示页面加载动画
    showPageLoading() {
        const contentArea = document.getElementById('content-area');
        showLoading(contentArea);
    }

    // 隐藏页面加载动画
    hidePageLoading() {
        // 加载动画会在内容渲染时自动隐藏
    }

    // 显示错误页面
    showErrorPage(message) {
        const contentArea = document.getElementById('content-area');
        if (contentArea) {
            contentArea.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #666;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #f39c12; margin-bottom: 1rem;"></i>
                    <h3>页面加载失败</h3>
                    <p>${message}</p>
                    <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        <i class="fas fa-redo"></i> 刷新页面
                    </button>
                </div>
            `;
        }
    }

    // 获取应用状态
    getAppState() {
        return {
            currentPage: this.currentPage,
            timestamp: new Date().toISOString()
        };
    }

    // 应用初始化完成回调
    onAppReady() {
        console.log('星火自动化测试平台初始化完成');
        
        // 可以在这里添加一些初始化完成后的逻辑
        // 比如检查更新、加载用户设置等
        
        // 显示欢迎消息
        setTimeout(() => {
            showToast('欢迎使用星火自动化测试平台！', 'success');
        }, 1000);
    }
}

// 全局函数，供HTML调用
function toggleNavItem(itemId) {
    if (window.sparkPlatform) {
        window.sparkPlatform.toggleNavItem(itemId);
    }
}

function loadProductManagement() {
    if (window.sparkPlatform) {
        window.sparkPlatform.loadProductManagement();
    }
}

function loadAutomationManagement() {
    if (window.sparkPlatform) {
        window.sparkPlatform.loadAutomationManagement();
    }
}

function initSidebarCollapse() {
    const appContainer = document.querySelector('.app-container');
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const expandBtn = document.getElementById('sidebarExpandBtn');

    if (!appContainer) return;

    const applyState = (collapsed) => {
        if (collapsed) {
            appContainer.classList.add('sidebar-collapsed');
        } else {
            appContainer.classList.remove('sidebar-collapsed');
        }
        try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch (_) {}
    };

    let initial = false;
    try { initial = localStorage.getItem('sidebarCollapsed') === '1'; } catch (_) {}
    applyState(initial);

    if (collapseBtn) {
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyState(true);
        });
    }

    if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyState(false);
        });
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM加载完成，开始初始化应用...');
    
    // 延迟一点时间确保所有脚本都加载完成
    setTimeout(() => {
        try {
            window.sparkPlatform = new SparkTestPlatform();
            // 初始化侧边栏收起/展开
            initSidebarCollapse();
        } catch (error) {
            console.error('应用初始化失败:', error);
            
            // 显示错误信息
            const contentArea = document.getElementById('content-area');
            if (contentArea) {
                contentArea.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #666;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #f39c12; margin-bottom: 1rem;"></i>
                        <h3>应用初始化失败</h3>
                        <p>错误信息: ${error.message}</p>
                        <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
                            <i class="fas fa-redo"></i> 刷新页面
                        </button>
                    </div>
                `;
            }
        }
    }, 500);
});

// 全局函数，供HTML调用
 