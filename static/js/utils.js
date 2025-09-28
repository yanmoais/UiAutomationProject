// 工具函数集合

// 显示消息提示
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    
    // 检查是否有批量执行进度面板正在显示
    const batchPanel = document.querySelector('.batch-execution-panel');
    const isBatchExecuting = batchPanel && !batchPanel.classList.contains('hidden');
    
    if (isBatchExecuting) {
        // 如果进度面板显示，根据屏幕宽度决定toast位置
        if (window.innerWidth > 500) {
            // 大屏幕：显示在左侧
            toast.style.top = '20px';
            toast.style.right = '440px'; // 面板宽度400px + 间距40px
            toast.style.left = 'auto';
        } else {
            // 小屏幕：显示在面板下方
            toast.style.top = '100px';
            toast.style.right = '20px';
            toast.style.left = 'auto';
        }
    } else {
        // 正常位置
        toast.style.top = '20px';
        toast.style.right = '20px';
        toast.style.left = 'auto';
    }
    
    toast.classList.add('show');
    
    // 批量执行期间显示时间更短，避免消息堆积
    const displayTime = isBatchExecuting ? 1500 : 3000;
    
    setTimeout(() => {
        toast.classList.remove('show');
        // 重置位置
        toast.style.top = '20px';
        toast.style.right = '20px';
        toast.style.left = 'auto';
    }, displayTime);
}

// 格式化日期（固定中国时区）
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Shanghai'
    });
}

// 格式化日期时间（别名函数）
function formatDateTime(dateString) {
    return formatDate(dateString);
}

// 使用 UTC/GMT 原样显示的日期时间格式化（YYYY/MM/DD HH:mm:ss）
function formatDateTimeUTC(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'UTC'
    });
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 显示加载状态
function showLoading(container) {
    if (container) {
        const loadingHtml = `
            <div class="loading">
                <div class="spinner"></div>
            </div>
        `;
        container.innerHTML = loadingHtml;
    } else {
        // 全局加载
        document.body.classList.add('loading-global');
    }
}

// 隐藏加载状态
function hideLoading() {
    document.body.classList.remove('loading-global');
}

// 显示空状态
function showEmptyState(container, message = '暂无数据') {
    const emptyHtml = `
        <div class="empty-state">
            <i class="fas fa-inbox"></i>
            <h3>${message}</h3>
            <p>点击上方"添加项目"按钮创建第一个项目</p>
        </div>
    `;
    container.innerHTML = emptyHtml;
}

// 验证表单
function validateForm(formData) {
    const errors = [];
    
    if (!formData.product_package_name || formData.product_package_name.trim() === '') {
        errors.push('产品包名不能为空');
    }
    
    if (!formData.product_address || formData.product_address.trim() === '') {
        errors.push('产品地址不能为空');
    } else {
        // 简单的URL验证
        const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
        if (!urlPattern.test(formData.product_address)) {
            errors.push('请输入有效的产品地址');
        }
    }
    
    if (!formData.is_automated) {
        errors.push('请选择是否自动化');
    }
    
    return errors;
}

// 文件大小格式化
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 生成唯一ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 安全的HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 深度克隆对象
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const clonedObj = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                clonedObj[key] = deepClone(obj[key]);
            }
        }
        return clonedObj;
    }
}

// 检查是否为移动设备
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// 平滑滚动到元素
function scrollToElement(element, offset = 0) {
    const elementPosition = element.offsetTop - offset;
    window.scrollTo({
        top: elementPosition,
        behavior: 'smooth'
    });
} 