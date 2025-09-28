 
/**
 * 自定义确认对话框
 * @param {Object} options - 配置选项
 * @param {string} options.title - 对话框标题
 * @param {string} options.message - 主要消息
 * @param {Array} options.details - 详细信息列表
 * @param {string} options.warningText - 警告文本
 * @param {string} options.type - 对话框类型 ('danger', 'warning', 'info')
 * @param {string} options.confirmText - 确认按钮文本
 * @param {string} options.cancelText - 取消按钮文本
 * @param {Function} options.onConfirm - 确认回调
 * @param {Function} options.onCancel - 取消回调
 */
function showCustomConfirm(options) {
    const {
        title = '确认操作',
        message = '您确定要执行此操作吗？',
        details = [],
        warningText = '',
        type = 'danger',
        confirmText = '确定',
        cancelText = '取消',
        onConfirm = () => {},
        onCancel = () => {}
    } = options;

    // 创建对话框HTML
    const dialogHTML = `
        <div class="custom-confirm-overlay" id="customConfirmOverlay">
            <div class="custom-confirm-dialog">
                <div class="custom-confirm-header ${type}">
                    <div class="custom-confirm-icon">
                        <i class="fas ${type === 'danger' ? 'fa-exclamation-triangle' : 
                                      type === 'warning' ? 'fa-exclamation-circle' : 
                                      'fa-info-circle'}"></i>
                    </div>
                    <h3 class="custom-confirm-title">${title}</h3>
                </div>
                <div class="custom-confirm-body">
                    <div class="custom-confirm-message">${message}</div>
                    ${details.length > 0 ? `
                        <div class="custom-confirm-details">
                            <ul>
                                ${details.map(detail => `<li>${detail}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                    ${warningText ? `
                        <div class="custom-confirm-warning-text">
                            <i class="fas fa-exclamation-triangle"></i>
                            ${warningText}
                        </div>
                    ` : ''}
                </div>
                <div class="custom-confirm-actions">
                    <button class="custom-confirm-btn custom-confirm-btn-cancel" id="customConfirmCancel">
                        ${cancelText}
                    </button>
                    <button class="custom-confirm-btn custom-confirm-btn-confirm" id="customConfirmConfirm">
                        ${confirmText}
                    </button>
                </div>
            </div>
        </div>
    `;

    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', dialogHTML);
    
    const overlay = document.getElementById('customConfirmOverlay');
    const confirmBtn = document.getElementById('customConfirmConfirm');
    const cancelBtn = document.getElementById('customConfirmCancel');

    // 显示对话框
    setTimeout(() => {
        overlay.classList.add('show');
    }, 10);

    // 移除对话框
    function removeDialog() {
        overlay.classList.remove('show');
        setTimeout(() => {
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
    }

    // 事件处理
    confirmBtn.addEventListener('click', () => {
        removeDialog();
        onConfirm();
    });

    cancelBtn.addEventListener('click', () => {
        removeDialog();
        onCancel();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            removeDialog();
            onCancel();
        }
    });

    // ESC键关闭
    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            removeDialog();
            onCancel();
            document.removeEventListener('keydown', handleKeyDown);
        }
    }
    document.addEventListener('keydown', handleKeyDown);
} 