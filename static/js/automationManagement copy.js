// 自动化管理模块
class AutomationManagement {
    constructor() {
        // 确保 projects 始终是数组
        this.projects = [];
        this.currentProject = null;
        this.currentEditingProject = null;
        this.testSteps = [];
        this.editingTestSteps = null; // 编辑中的测试步骤副本
        this.uploadedImages = new Map();
        this.editingUploadedImages = new Map(); // 编辑中的图片缓存副本
        this.selectedProducts = [];
        this.products = [];
        this.isProcessing = false;
        this.isEditing = false;
        
        // 初始化其他必要的 Map 对象
        this.runningProjects = new Set();
        this.expandedProjects = new Set();
        
        // 初始化枚举值对象
        this.enumValues = {
            system_type: [],
            product_type: [],
            environment: []
        };
        
        // 初始化其他属性
        this.currentPage = 1;
        this.pageSize = 10;
        this.totalPages = 0;
        this.totalItems = 0;
        this.statusPollingInterval = null;
        this.lastEditTime = 0;
        this.stepCounter = 1;
        
        // 新增：分组展示相关属性
        this.groupedProjects = [];
        this.expandedGroups = new Set();
        this.showGroupedView = true; // 默认显示分组视图
        
        // 新增：分组方式相关属性
        this.groupingMethod = 'product_package_name'; // 默认按产品包名分组
        this.availableGroupingMethods = [
            { value: 'product_id', label: '产品ID' },
            { value: 'product_package_name', label: '产品包名' },
            { value: 'product_address', label: '产品地址' },
            { value: 'system', label: '系统' },
            { value: 'product_type', label: '产品类型' },
            { value: 'environment', label: '环境' },
            { value: 'version_number', label: '版本号' }
        ];
        
        // 批量执行进度面板相关状态
        this.batchExecution = {
            isActive: false,
            projects: [],
            currentIndex: -1,
            successCount: 0,
            errorCount: 0,
            isMinimized: false,
            isListExpanded: true,  // 默认展开项目列表
            isWaiting: false,      // 是否在等待间隔
            waitTime: 3            // 等待时间（秒）
        };
        
        // 初始化事件处理器
        this.handleFormSubmit = null;
        this.multiselectClickHandler = null;
        this.documentClickHandler = null;
        
        // 导入测试步骤相关属性
        this.selectedImportProduct = null;
        this.selectedImportProject = null;
        this.selectedImportSteps = [];
        this.currentProjectSteps = [];
        this.productGroupsData = [];
    }

    // 页面销毁时的清理
    destroy() {
        // 停止状态轮询
        this.stopStatusPolling();
        
        // 清理事件监听器
        const automationForm = document.getElementById('automationForm');
        if (automationForm && this.handleFormSubmit) {
            automationForm.removeEventListener('submit', this.handleFormSubmit);
        }
        
        // 清理多选框事件监听器
        const input = document.getElementById('productIdsInput');
        if (input && this.multiselectClickHandler) {
            input.removeEventListener('click', this.multiselectClickHandler);
        }
        
        if (this.documentClickHandler) {
            document.removeEventListener('click', this.documentClickHandler);
        }
        
        // 清理图片缓存
        this.clearImageCache();
        
        // 重置状态
        this.projects = []; // 确保是数组
        this.products = [];
        this.expandedProjects.clear();
        this.currentEditingProject = null;
        this.testSteps = [];
        this.selectedProducts = [];
        this.uploadedImages.clear();
        this.runningProjects.clear();
        this.isProcessing = false;
        this.lastEditTime = 0;
        this.stepCounter = 1;
        
        // 重置枚举值
        this.enumValues = {
            system_type: [],
            product_type: [],
            environment: []
        };
        
        console.log('自动化管理页面已销毁，状态轮询已停止');
    }

    // 渲染自动化管理页面
    async render() {
        const contentArea = document.getElementById('content-area');
        
        const automationHtml = `
            <div class="automation-management">
                <div class="page-header">
                    <h1 class="page-title">
                        <i class="fas fa-robot"></i>
                        自动化管理
                    </h1>
                    <div class="header-actions">
                        <div class="view-toggle">
                            <button class="btn btn-outline-secondary ${this.showGroupedView ? 'active' : ''}" 
                                    onclick="automationManagement.toggleView('grouped')" 
                                    title="分组视图">
                                <i class="fas fa-layer-group"></i>
                                分组视图
                            </button>
                            <button class="btn btn-outline-secondary ${!this.showGroupedView ? 'active' : ''}" 
                                    onclick="automationManagement.toggleView('list')" 
                                    title="列表视图">
                                <i class="fas fa-list"></i>
                                列表视图
                            </button>
                        </div>
                        <div class="grouping-method-selector" id="grouping-method-container" 
                             style="display: ${this.showGroupedView ? 'flex' : 'none'};">
                            <label for="grouping-method-select" class="grouping-label">
                                <i class="fas fa-layer-group"></i>
                                分组方式：
                            </label>
                            <select id="grouping-method-select" class="grouping-select" 
                                    onchange="automationManagement.changeGroupingMethod(this.value)">
                                ${this.availableGroupingMethods.map(method => 
                                    `<option value="${method.value}" ${method.value === this.groupingMethod ? 'selected' : ''}>
                                        ${method.label}
                                    </option>`
                                ).join('')}
                            </select>
                        </div>
                        <button class="btn btn-primary" onclick="automationManagement.openAddProjectModal()" 
                                id="header-add-project-btn">
                            <i class="fas fa-plus"></i>
                            添加自动化项目
                        </button>
                    </div>
                </div>
                
                <div class="automation-list" id="automation-list">
                    <!-- 自动化项目列表 -->
                </div>
                <div class="pagination-container" id="pagination-container">
                    <!-- 分页控件 -->
                </div>
            </div>
        `;
        
        contentArea.innerHTML = automationHtml;
        
        // 设置头部添加按钮和分组方式选择器的初始显示状态
        const headerAddBtn = document.getElementById('header-add-project-btn');
        const groupingMethodContainer = document.getElementById('grouping-method-container');
        
        if (headerAddBtn) {
            if (this.showGroupedView) {
                headerAddBtn.style.display = 'none';
            } else {
                headerAddBtn.style.display = 'flex';
            }
        }
        
        if (groupingMethodContainer) {
            groupingMethodContainer.style.display = this.showGroupedView ? 'flex' : 'none';
        }
        
        // 添加页面加载动画
        this.addPageLoadAnimations();
        
        // 加载分组项目列表（默认视图）
        await this.loadGroupedProjectsByMethod();
        this.renderGroupedProjects();
        
        // 设置事件监听器
        this.setupEventListeners();
    }

    // 添加页面加载动画
    addPageLoadAnimations() {
        const elements = [
            { selector: '.page-header', delay: 0 },
            { selector: '.automation-list', delay: 200 },
            { selector: '.pagination-container', delay: 400 }
        ];

        elements.forEach(({ selector, delay }) => {
            const element = document.querySelector(selector);
            if (element) {
                element.style.opacity = '0';
                element.style.transform = 'translateY(20px)';
                
                setTimeout(() => {
                    element.style.transition = 'all 0.6s ease-out';
                    element.style.opacity = '1';
                    element.style.transform = 'translateY(0)';
                }, delay);
            }
        });
    }

    // 绑定事件
    bindEvents() {
        // 产品ID多选事件 - 使用多选容器
        this.initProductMultiSelect();
        
        // 自动化表单提交事件 - 先移除之前的事件监听器，再添加新的
        const automationForm = document.getElementById('automationForm');
        if (automationForm) {
            // 移除之前的事件监听器
            if (this.handleFormSubmit) {
                automationForm.removeEventListener('submit', this.handleFormSubmit);
            }
            
            this.handleFormSubmit = (e) => {
                e.preventDefault();
                this.saveProject();
            };
            automationForm.addEventListener('submit', this.handleFormSubmit);
        }
    }

    // 绑定展开按钮事件
    bindExpandButtonEvents() {
        const expandButtons = document.querySelectorAll('.expand-btn');
        console.log('找到展开按钮数量:', expandButtons.length);
        
        expandButtons.forEach((button, index) => {
            // 移除之前的事件监听器（如果有的话）
            if (button._clickHandler) {
                button.removeEventListener('click', button._clickHandler);
                delete button._clickHandler;
            }
            
            // 创建新的事件处理函数
            button._clickHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                const projectId = parseInt(event.currentTarget.getAttribute('data-project-id'));
                console.log('展开按钮被点击，项目ID:', projectId);
                
                if (projectId) {
                    this.toggleExpand(projectId);
                } else {
                    console.error('无法获取项目ID，按钮:', event.currentTarget);
                }
            };
            
            // 添加新的事件监听器
            button.addEventListener('click', button._clickHandler);
        });
    }

    // 绑定项目展开按钮事件（分组视图下）
    bindProjectExpandButtonEvents() {
        const expandButtons = document.querySelectorAll('.automation-card .expand-btn');
        console.log('找到项目展开按钮数量:', expandButtons.length);
        
        expandButtons.forEach((button, index) => {
            this.bindSingleExpandButtonEvents(button, index);
        });
    }
            
    // 为单个展开按钮绑定事件
    bindSingleExpandButtonEvents(button, index = 0) {
            // 移除之前的事件监听器（如果有的话）
            if (button._clickHandler) {
                button.removeEventListener('click', button._clickHandler);
                delete button._clickHandler;
            }
            
            // 创建新的事件处理函数
            button._clickHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                const projectId = parseInt(event.currentTarget.getAttribute('data-project-id'));
            console.log('项目展开按钮被点击，项目ID:', projectId);
                
                if (projectId) {
                    this.toggleExpand(projectId);
                }
            };
            
            // 添加新的事件监听器
            button.addEventListener('click', button._clickHandler);
    }

    // 产品选择变化事件
    onProductSelectionChange() {
        if (this.selectedProducts.length === 0) {
            this.resetProductAddressDisplay();
            return;
        }

        // 获取选中产品的信息
        const selectedProducts = this.selectedProducts.map(uniqueId => {
            const index = uniqueId.split('_')[1];
            return this.products[index];
        }).filter(Boolean);
        
        if (selectedProducts.length === 0) {
            this.resetProductAddressDisplay();
            return;
        }

        // 检查是否来自同一系统
        const systems = [...new Set(selectedProducts.map(p => p.system_type))];
        if (systems.length > 1) {
            showToast('选择的产品必须来自同一系统', 'error');
            // 重置选择
            this.selectedProducts = [];
            this.updateSelectedProducts();
            this.resetProductAddressDisplay();
            return;
        }

        // 统一显示详细的产品地址信息（无论选择几个产品）
        if (selectedProducts.length > 0) {
            this.showMultiProductAddresses(selectedProducts);
        }

        // 自动填充其他字段
        if (selectedProducts.length > 0) {
            const firstProduct = selectedProducts[0];
            const systemField = document.getElementById('automationSystem');
            const productTypeField = document.getElementById('automationProductType');
            const environmentField = document.getElementById('automationEnvironment');
            
            if (systemField) systemField.value = firstProduct.system_type || '';
            if (productTypeField) productTypeField.value = firstProduct.product_type || '';
            if (environmentField) environmentField.value = firstProduct.environment || '';
        }
    }

    // 重置产品地址显示
    resetProductAddressDisplay() {
        const singleInput = document.getElementById('automationProductAddress');
        const multiContainer = document.getElementById('multiProductAddresses');
        const addressListContainer = document.getElementById('addressListContainer');
        
        singleInput.style.display = 'none';
        singleInput.value = '';
        // 移除required属性，避免隐藏字段的表单验证问题
        singleInput.removeAttribute('required');
        multiContainer.style.display = 'none';
        addressListContainer.style.display = 'none';
        addressListContainer.classList.remove('show');
    }

    // 显示单个产品地址
    showSingleProductAddress(product) {
        const singleInput = document.getElementById('automationProductAddress');
        const multiContainer = document.getElementById('multiProductAddresses');
        
        singleInput.style.display = 'block';
        singleInput.value = product.product_address || '';
        multiContainer.style.display = 'none';
        
        // 添加地址输入框的事件监听器，当用户修改时更新本地产品数据
        singleInput.onchange = (e) => {
            if (this.selectedProducts.length === 1) {
                const firstUniqueId = this.selectedProducts[0];
                const index = parseInt(firstUniqueId.split('_')[1]);
                const selectedProduct = this.products[index];
                if (selectedProduct) {
                    selectedProduct.product_address = e.target.value;
                }
            }
        };
    }

    // 显示多个产品地址
    showMultiProductAddresses(products) {
        const singleInput = document.getElementById('automationProductAddress');
        const multiContainer = document.getElementById('multiProductAddresses');
        const addressListContainer = document.getElementById('addressListContainer');
        const selectedProductCount = document.getElementById('selectedProductCount');
        
        singleInput.style.display = 'none';
        multiContainer.style.display = 'block';
        addressListContainer.style.display = 'block';
        addressListContainer.classList.add('show');
        
        // 去重处理：如果产品有display_name（表示是多地址情况），则不去重；否则按产品ID去重
        const uniqueProducts = [];
        const seenProductIds = new Set();
        
        for (const product of products) {
            // 如果产品有display_name，说明是多地址情况，每个地址都应该单独显示
            if (product.display_name) {
                uniqueProducts.push(product);
            } else {
                // 正常的去重逻辑
                const productKey = `${product.product_id}_${product.product_name}_${product.environment}`;
                if (!seenProductIds.has(productKey)) {
                    seenProductIds.add(productKey);
                    uniqueProducts.push(product);
                }
            }
        }
        
        selectedProductCount.textContent = uniqueProducts.length;
        
        // 生成地址列表HTML - 展开所有地址
        const addressListHtml = uniqueProducts.map((product, index) => {
            // 通过产品ID和索引找到对应的uniqueId
            const uniqueId = this.selectedProducts.find(id => {
                const productIndex = parseInt(id.split('_')[1]);
                return this.products[productIndex] && this.products[productIndex].product_id === product.product_id;
            });
            
            // 解析产品地址（可能是JSON字符串数组或单个字符串）
            let productAddresses = [];
            
            // 如果产品有display_name，说明已经是处理过的单个地址
            if (product.display_name) {
                productAddresses = [product.product_address || ''];
            } else {
                try {
                    if (product.product_address) {
                        if (typeof product.product_address === 'string' && product.product_address.startsWith('[')) {
                            // 如果是JSON数组字符串，解析为数组
                            const addresses = JSON.parse(product.product_address);
                            productAddresses = Array.isArray(addresses) ? addresses : [product.product_address];
                        } else {
                            // 如果是普通字符串，作为单个地址
                            productAddresses = [product.product_address];
                        }
                    }
                } catch (e) {
                    console.warn('解析产品地址失败:', product.product_address, e);
                    productAddresses = product.product_address ? [product.product_address] : [''];
                }
                
                // 确保至少有一个地址项
                if (productAddresses.length === 0) {
                    productAddresses = [''];
                }
            }
            
            console.log('处理产品:', product.product_id);
            console.log('解析后的地址数组:', productAddresses);
            
            // 构建产品详细信息
            const productName = product.display_name || product.product_name || '未命名产品';
            const productType = product.product_type || '未知类型';
            const environment = product.environment || '未知环境';
            
            // 为每个地址生成一个地址项
            return productAddresses.map((address, addressIndex) => {
                const addressUniqueId = `${uniqueId}_addr_${addressIndex}`;
                
                const addressStatus = this.validateAddress(address);
                const statusClass = addressStatus.valid ? 'valid' : addressStatus.warning ? 'warning' : 'invalid';
                const statusText = addressStatus.valid ? '有效' : addressStatus.warning ? '警告' : '无效';
                const statusIcon = addressStatus.valid ? 'fa-check' : addressStatus.warning ? 'fa-exclamation-triangle' : 'fa-times';
            
            return `
                    <div class="product-address-item" data-product-id="${addressUniqueId}">
                    <div class="product-info">
                        <div class="product-id">${product.product_id}</div>
                        <div class="product-name">${productName}</div>
                        <div class="product-details">
                            <span class="product-system">${product.system_type}</span>
                            <span class="product-type">${productType}</span>
                            <span class="product-env">${environment}</span>
                        </div>
                    </div>
                    <div class="address-input-group">
                        <div class="address-label">产品地址</div>
                        <input type="url" 
                               class="address-input" 
                                   value="${address.replace(/"/g, '&quot;')}" 
                               placeholder="请输入产品地址"
                                   onchange="automationManagement.updateProductAddress('${addressUniqueId}', this.value)">
                        <div class="address-status ${statusClass}">
                            <i class="fas ${statusIcon}"></i>
                            <span>${statusText}</span>
                        </div>
                    </div>
                    <div class="address-actions">
                            <button type="button" class="address-action-btn primary" onclick="automationManagement.testAddress('${addressUniqueId}')">
                            <i class="fas fa-external-link-alt"></i>
                            测试
                        </button>
                            <button type="button" class="address-action-btn" onclick="automationManagement.copyAddress('${addressUniqueId}')">
                            <i class="fas fa-copy"></i>
                            复制
                        </button>
                    </div>
                </div>
            `;
            }).join('');
        }).join('');
        
        addressListContainer.innerHTML = addressListHtml;
        
        // 为每个产品项添加延迟动画
        const productItems = addressListContainer.querySelectorAll('.product-address-item');
        productItems.forEach((item, index) => {
            item.style.animationDelay = `${index * 0.1}s`;
        });

        // 设置实时地址验证（使用setTimeout确保DOM已更新）
        setTimeout(() => {
        this.setupRealTimeValidation();
        }, 0);
    }

    // 验证地址
    validateAddress(address) {
        if (!address || address.trim() === '') {
            return { valid: false, warning: false, message: '地址为空' };
        }
        
        // 简单的URL验证
        const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
        if (!urlPattern.test(address)) {
            return { valid: false, warning: false, message: '地址格式无效' };
        }
        
        // 检查是否是本地地址
        if (address.includes('localhost') || address.includes('127.0.0.1')) {
            return { valid: true, warning: true, message: '本地地址' };
        }
        
        return { valid: true, warning: false, message: '地址有效' };
    }

    // 更新产品地址
    updateProductAddress(uniqueId, newAddress) {
        // 重新验证地址
        const addressItem = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (addressItem) {
            const addressStatus = this.validateAddress(newAddress);
            const statusElement = addressItem.querySelector('.address-status');
            const statusIcon = statusElement.querySelector('i');
            const statusText = statusElement.querySelector('span');
            
            // 添加验证动画
            if (addressStatus.valid && !addressStatus.warning) {
                this.showValidationSuccess(uniqueId);
            } else if (!addressStatus.valid) {
                this.showValidationError(uniqueId);
            }
            
            statusElement.className = `address-status ${addressStatus.valid ? 'valid' : addressStatus.warning ? 'warning' : 'invalid'}`;
            statusIcon.className = `fas ${addressStatus.valid ? 'fa-check' : addressStatus.warning ? 'fa-exclamation-triangle' : 'fa-times'}`;
            statusText.textContent = addressStatus.valid ? '有效' : addressStatus.warning ? '警告' : '无效';
        }
    }

    // 显示验证成功动画
    showValidationSuccess(uniqueId) {
        const item = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (item) {
            item.style.animation = 'validationSuccess 0.6s ease-out';
            setTimeout(() => {
                item.style.animation = '';
            }, 600);
        }
    }

    // 显示验证错误动画
    showValidationError(uniqueId) {
        const item = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (item) {
            item.style.animation = 'validationError 0.6s ease-out';
            setTimeout(() => {
                item.style.animation = '';
            }, 600);
        }
    }

    // 显示成功状态动画
    showSuccessAnimation(element) {
        if (element) {
            element.classList.add('success-animation');
            setTimeout(() => {
                element.classList.remove('success-animation');
            }, 600);
        }
    }

    // 显示错误状态动画
    showErrorAnimation(element) {
        if (element) {
            element.classList.add('error-animation');
            setTimeout(() => {
                element.classList.remove('error-animation');
            }, 600);
        }
    }

    // 添加加载状态
    addLoadingState(element) {
        if (element) {
            element.classList.add('loading');
        }
    }

    // 移除加载状态
    removeLoadingState(element) {
        if (element) {
            element.classList.remove('loading');
        }
    }

    // 防抖函数
    debounce(func, wait) {
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

    // 实时地址验证（带防抖）
    setupRealTimeValidation() {
        // 只查找addressListContainer内的地址输入框，避免干扰其他区域的输入框
        const addressListContainer = document.getElementById('addressListContainer');
        if (!addressListContainer) {
            console.warn('setupRealTimeValidation: 找不到addressListContainer');
            return;
        }
        const addressInputs = addressListContainer.querySelectorAll('.address-input');
        console.log('setupRealTimeValidation: 找到地址输入框数量:', addressInputs.length);
        addressInputs.forEach((input, idx) => {
            const productItem = input.closest('.product-address-item');
            console.log(`输入框 ${idx}:`, {
                input: input,
                productItem: productItem,
                dataset: productItem?.dataset,
                productId: productItem?.dataset?.productId
            });
            if (!productItem || !productItem.dataset || !productItem.dataset.productId) {
                console.warn('无法找到产品ID，跳过该输入框');
                return;
            }
            const uniqueId = productItem.dataset.productId; // 这里实际存储的是uniqueId
            
            // 验证uniqueId格式
            if (!uniqueId || !uniqueId.includes('_')) {
                console.warn('uniqueId格式无效，跳过该输入框', { uniqueId });
                return;
            }
            
            const index = parseInt(uniqueId.split('_')[1]);
            if (isNaN(index)) {
                console.warn('无法解析索引，跳过该输入框', { uniqueId, index });
                return;
            }
            
            const debouncedValidation = this.debounce((value) => {
                this.updateProductAddress(uniqueId, value);
            }, 500);

            input.addEventListener('input', (e) => {
                debouncedValidation(e.target.value);
            });

            input.addEventListener('blur', (e) => {
                this.updateProductAddress(uniqueId, e.target.value);
            });
        });
    }

    // 解析产品地址（处理JSON数组格式和普通字符串）
    parseProductAddress(addressData) {
        if (!addressData) return '';
        
        try {
            if (typeof addressData === 'string' && addressData.startsWith('[')) {
                // 如果是JSON数组字符串，解析并取第一个地址
                const addresses = JSON.parse(addressData);
                return Array.isArray(addresses) && addresses.length > 0 ? addresses[0] : '';
            } else {
                // 如果是普通字符串，直接使用
                return addressData;
            }
        } catch (e) {
            console.warn('解析产品地址失败:', addressData, e);
            return addressData || '';
        }
    }

    // 测试地址
    testAddress(uniqueId) {
        // 从地址输入框直接获取地址
        const addressItem = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (!addressItem) {
            showToast('找不到对应的地址项', 'warning');
            return;
        }
        
        const addressInput = addressItem.querySelector('.address-input');
        const address = addressInput ? addressInput.value.trim() : '';
        
        if (!address) {
            showToast('请先输入有效的产品地址', 'warning');
            return;
        }
        
        // 在新窗口打开地址
        window.open(address, '_blank');
        showToast(`正在测试地址: ${address}`, 'info');
    }

    // 复制地址
    copyAddress(uniqueId) {
        // 从地址输入框直接获取地址
        const addressItem = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (!addressItem) {
            showToast('找不到对应的地址项', 'warning');
            return;
        }
        
        const addressInput = addressItem.querySelector('.address-input');
        const address = addressInput ? addressInput.value.trim() : '';
        
        if (!address) {
            showToast('没有可复制的地址', 'warning');
            return;
        }
        
        navigator.clipboard.writeText(address).then(() => {
            showToast('地址已复制到剪贴板', 'success');
        }).catch(() => {
            showToast('复制失败，请手动复制', 'error');
        });
    }

    // 切换地址列表显示
    toggleAddressList() {
        const container = document.getElementById('addressListContainer');
        const button = document.querySelector('#multiProductAddresses .btn');
        const icon = button.querySelector('i');
        
        // 防止动画过程中重复点击
        if (container.dataset.animating === 'true') {
            return;
        }
        
        // 添加按钮点击动画效果
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = 'scale(1)';
        }, 150);
        
        if (!container.classList.contains('show')) {
            // 展开动画
            container.dataset.animating = 'true';
            container.style.display = 'block';
            
            // 强制重绘
            container.offsetHeight;
            
            // 添加展开动画类
            container.classList.add('show');
            
            // 图标旋转动画
            icon.style.transition = 'transform 0.3s ease';
            icon.style.transform = 'rotate(180deg)';
            icon.className = 'fas fa-chevron-up';
            button.innerHTML = '<i class="fas fa-chevron-up"></i> 收起地址详情';
            
            // 动画完成后重置状态
            const handleExpandEnd = () => {
                container.dataset.animating = 'false';
                icon.style.transition = '';
                icon.style.transform = '';
                container.removeEventListener('transitionend', handleExpandEnd);
            };
            container.addEventListener('transitionend', handleExpandEnd);
        } else {
            // 收起动画
            container.dataset.animating = 'true';
            
            // 图标旋转动画
            icon.style.transition = 'transform 0.3s ease';
            icon.style.transform = 'rotate(0deg)';
            
            const handleAnimationEnd = () => {
                if (!container.classList.contains('show')) {
                    container.style.display = 'none';
                }
                container.dataset.animating = 'false';
                icon.style.transition = '';
                icon.style.transform = '';
                container.removeEventListener('transitionend', handleAnimationEnd);
            };
            
            container.addEventListener('transitionend', handleAnimationEnd);
            container.classList.remove('show');
            icon.className = 'fas fa-chevron-down';
            button.innerHTML = '<i class="fas fa-chevron-down"></i> 查看地址详情';
        }
    }

    // 加载自动化项目列表
    async loadProjects(page = 1, pageSize = null) {
        try {
            showLoading(document.getElementById('automation-list'));
            
            // 使用传入的pageSize或当前设置的pageSize
            const size = pageSize || this.pageSize;
            
            // 添加时间戳避免缓存
            const timestamp = new Date().getTime();
            const response = await fetch(`/api/automation/projects?page=${page}&page_size=${size}&_t=${timestamp}`);
            const result = await response.json();
            
            if (result.success) {
                // 确保 projects 始终是数组
                const projectsData = result.data.projects || result.data;
                this.projects = Array.isArray(projectsData) ? projectsData : [];
                
                console.log('加载项目数据完成，项目数量:', this.projects.length);
                console.log('projects 类型:', typeof this.projects);
                console.log('projects 是否为数组:', Array.isArray(this.projects));
                
                // 更新分页信息
                if (result.data.pagination) {
                    this.currentPage = result.data.pagination.page;
                    this.pageSize = result.data.pagination.page_size;
                    this.totalPages = result.data.pagination.total_pages;
                    this.totalItems = result.data.pagination.total_count;
                } else {
                    // 如果没有分页信息，计算基本分页
                    this.currentPage = page;
                    this.pageSize = size;
                    this.totalItems = this.projects.length;
                    this.totalPages = Math.ceil(this.totalItems / this.pageSize);
                }
                
                // 更新运行中的项目集合
                this.runningProjects.clear();
                this.projects.forEach(project => {
                    if (project.status === 'running') {
                        this.runningProjects.add(project.id);

                    }
                });
                
                // 如果有运行中的项目，启动状态轮询
                if (this.runningProjects.size > 0) {
                    this.startStatusPolling();
                    console.log('页面加载时启动状态轮询，运行中项目数量:', this.runningProjects.size);
                } else {
                    this.stopStatusPolling();
                }
                
                // 根据当前视图模式渲染对应的视图
                if (this.showGroupedView) {
                    console.log('loadProjects: 渲染分组视图');
                    await this.renderGroupedProjects();
                } else {
                    console.log('loadProjects: 渲染列表视图');
                this.renderProjectsList();
                }
                this.renderPagination();
            } else {
                showToast(result.message || '加载项目失败', 'error');
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
            }
        } catch (error) {
            console.error('加载项目失败:', error);
            showToast('网络错误，请重试', 'error');
            // 设置totalItems为0并隐藏分页控制条
            this.totalItems = 0;
            this.renderPagination();
        }
    }

    // 加载产品列表
    async loadProducts() {
        try {
            const response = await fetch('/api/automation/products');
            const result = await response.json();
            
            if (result.success) {
                this.products = result.data;
                console.log('loadProducts: this.products:', this.products);
                this.updateProductOptions();
            }
        } catch (error) {
            console.error('加载产品列表失败:', error);
        }
    }

    // 加载分组自动化项目列表（原方法，保持兼容性）
    async loadGroupedProjects() {
        return await this.loadGroupedProjectsByMethod();
    }

    // 根据分组方式加载分组自动化项目列表
    async loadGroupedProjectsByMethod() {
        try {
            // 如果是按产品包名分组，使用原来的API
            if (this.groupingMethod === 'product_package_name' || this.groupingMethod === 'version_number') {
            // 添加时间戳避免缓存
            const timestamp = new Date().getTime();
            const response = await fetch(`/api/automation/projects/grouped?group_by=${this.groupingMethod}&_t=${timestamp}`);
            const result = await response.json();
            
            if (result.success) {
                this.groupedProjects = result.data || [];
                console.log('加载分组项目数据完成，分组数量:', this.groupedProjects.length);
                console.log('分组数据:', this.groupedProjects);
                
                // 验证分组数据
                let totalProjects = 0;
                this.groupedProjects.forEach(group => {
                    totalProjects += group.projects.length;
                    console.log(`分组 ${group.product_name}: ${group.projects.length} 个项目`);
                });
                console.log('总项目数量:', totalProjects);
            } else {
                console.error('加载分组项目失败:', result.message);
                // 失败时也尝试构造空分组
                this.groupedProjects = await this.createEmptyGroupsFromProducts();
                }
            } else {
                // 对于其他分组方式，先加载所有项目然后在前端分组
                await this.loadAllProjectsAndGroup();
            }
        } catch (error) {
            console.error('加载分组项目失败:', error);
            this.groupedProjects = [];
        }
    }

    // 加载所有项目并按指定方式分组
    async loadAllProjectsAndGroup() {
        try {
            // 加载所有项目（不分页）
            const timestamp = new Date().getTime();
            const response = await fetch(`/api/automation/projects?page=1&page_size=1000&_t=${timestamp}`);
            const result = await response.json();
            
            if (result.success) {
                const allProjects = result.data.projects || result.data || [];
                console.log('加载所有项目完成，项目数量:', allProjects.length);
                
                // 缓存全部项目用于兜底匹配
                this.allProjectsCache = allProjects;
                
                // 根据当前分组方式进行分组
                this.groupedProjects = this.groupProjectsByMethod(allProjects, this.groupingMethod);
                console.log(`按${this.groupingMethod}分组完成，分组数量:`, this.groupedProjects.length);
            } else {
                console.error('加载项目失败:', result.message);
                this.groupedProjects = [];
            }
        } catch (error) {
            console.error('加载项目失败:', error);
            this.groupedProjects = [];
        }
    }

    // 根据指定方式对项目进行分组
    groupProjectsByMethod(projects, method) {
        const groups = {};
        
        projects.forEach(project => {
            let groupKey = '';
            let groupName = '';
            
            switch (method) {
                case 'product_id':
                    // 处理产品ID列表（可能是数组）
                    const productIds = Array.isArray(project.product_ids) ? project.product_ids : 
                                     (typeof project.product_ids === 'string' ? (project.product_ids ? JSON.parse(project.product_ids) : []) : (project.product_ids || []));
                    groupKey = productIds.length > 0 ? productIds.join(',') : '未设置产品ID';
                    groupName = groupKey;
                    break;
                    
                case 'product_address':
                    groupKey = project.product_address || '未设置地址';
                    groupName = groupKey;
                    break;
                    
                case 'system':
                    groupKey = project.system || '未设置系统';
                    groupName = groupKey;
                    break;
                    
                case 'product_type':
                    groupKey = project.product_type || '未设置类型';
                    groupName = groupKey;
                    break;
                    
                case 'environment':
                    groupKey = project.environment || '未设置环境';
                    groupName = groupKey;
                    break;
                    
                case 'version_number':
                    groupKey = project.version_number || '未设置版本号';
                    groupName = groupKey;
                    break;
                    
                default:
                    // 默认按产品包名分组
                    const packageNames = Array.isArray(project.product_package_names) ? project.product_package_names :
                                       (typeof project.product_package_names === 'string' ? (project.product_package_names ? JSON.parse(project.product_package_names) : []) : (project.product_package_names || []));
                    groupKey = packageNames.length > 0 ? packageNames.join(',') : '未设置包名';
                    groupName = groupKey;
                    break;
            }
            
            if (!groups[groupKey]) {
                // 获取原始产品名称
                let originalProductName = '';
                if (method === 'product_id' || method === 'product_address' || method === 'system' || method === 'product_type' || method === 'environment' || method === 'version_number') {
                    // 对于非包名分组，从项目的product_package_names中获取第一个作为原始产品名称
                    const packageNames = Array.isArray(project.product_package_names) ? project.product_package_names :
                                       (typeof project.product_package_names === 'string' ? (project.product_package_names ? JSON.parse(project.product_package_names) : []) : (project.product_package_names || []));
                    originalProductName = packageNames.length > 0 ? packageNames[0] : '';
                }
                
                groups[groupKey] = {
                    product_id: (method === 'product_id') ? groupKey : (project.product_id || ''),
                    product_name: groupName,
                    original_product_name: originalProductName, // 保存原始产品名称
                    system_type: project.system || '未知',
                    product_type: project.product_type || '未知',
                    environment: project.environment || '未知',
                    version_number: project.version_number || '未知',
                    product_address: (method === 'product_address') ? groupKey : (project.product_address || ''),
                    projects: []
                };
            }
            
            groups[groupKey].projects.push(project);
        });
        
        // 转换为数组格式
        return Object.values(groups).sort((a, b) => a.product_name.localeCompare(b.product_name));
    }

    // 改变分组方式
    async changeGroupingMethod(newMethod) {
        console.log('改变分组方式:', this.groupingMethod, '->', newMethod);
        
        if (this.groupingMethod === newMethod) {
            return; // 没有变化，直接返回
        }
        
        this.groupingMethod = newMethod;
        
        // 如果当前是分组视图，重新加载和渲染数据
        if (this.showGroupedView) {
            // 显示加载状态
            const container = document.getElementById('automation-list');
            if (container) {
                container.innerHTML = `
                    <div class="loading-state">
                        <i class="fas fa-spinner fa-spin"></i>
                        <p>正在按${this.availableGroupingMethods.find(m => m.value === newMethod)?.label}重新分组...</p>
                    </div>
                `;
            }
            
            try {
                await this.loadGroupedProjectsByMethod();
                this.renderGroupedProjects();
                this.renderPagination();
            } catch (error) {
                console.error('重新分组失败:', error);
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h3>分组失败</h3>
                            <p>重新分组时发生错误，请刷新页面重试</p>
                        </div>
                    `;
                }
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
            }
        }
    }

    // 切换视图模式
    async toggleView(viewType) {
        this.showGroupedView = viewType === 'grouped';
        
        // 更新按钮状态
        const groupedBtn = document.querySelector('.view-toggle .btn:nth-child(1)');
        const listBtn = document.querySelector('.view-toggle .btn:nth-child(2)');
        
        if (groupedBtn && listBtn) {
            groupedBtn.classList.toggle('active', this.showGroupedView);
            listBtn.classList.toggle('active', !this.showGroupedView);
        }
        
        // 控制分组方式选择器的显示
        const groupingMethodContainer = document.getElementById('grouping-method-container');
        if (groupingMethodContainer) {
            groupingMethodContainer.style.display = this.showGroupedView ? 'flex' : 'none';
        }
        
        // 控制头部添加按钮的显示
        const headerAddBtn = document.getElementById('header-add-project-btn');
        if (headerAddBtn) {
            if (this.showGroupedView) {
                headerAddBtn.style.display = 'none';
            } else {
                headerAddBtn.style.display = 'flex';
            }
        }
        
        // 根据视图类型加载数据和渲染
        if (this.showGroupedView) {
            await this.loadGroupedProjectsByMethod();
            this.renderGroupedProjects();
            this.renderPagination(); // 为分组视图添加分页控件
        } else {
            await this.loadProjects();
            this.renderProjectsList();
            this.renderPagination();
        }
    }

    // 渲染分组项目列表
    async renderGroupedProjects() {
        try {
            const container = document.getElementById('automation-list');
            if (!container) {
                console.error('找不到自动化列表容器');
                return;
            }

            // 显示加载状态
            container.innerHTML = `
                <div class="loading-state">
                    <i class="fas fa-spinner"></i>
                    <p>正在加载分组数据...</p>
                </div>
            `;

            // 重新加载分组数据
            await this.loadGroupedProjects();

            // 检查数据
            if (!Array.isArray(this.groupedProjects)) {
                console.error('renderGroupedProjects: this.groupedProjects 不是数组，当前类型:', typeof this.groupedProjects);
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>数据加载错误</h3>
                        <p>分组数据格式错误，请刷新页面重试</p>
                    </div>
                `;
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
                return;
            }
            
            if (this.groupedProjects.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-robot"></i>
                        <h3>暂无自动化项目</h3>
                        <p>点击"添加自动化项目"按钮创建您的第一个自动化项目</p>
                    </div>
                `;
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
                return;
            }

            // 计算分页数据
            this.calculatePaginationData();
            
            // 应用分页逻辑 - 只显示当前页的分组
            const startIndex = (this.currentPage - 1) * this.pageSize;
            const endIndex = Math.min(startIndex + this.pageSize, this.groupedProjects.length);
            const currentPageGroups = this.groupedProjects.slice(startIndex, endIndex);
            
            console.log(`分组视图分页: 显示第 ${startIndex + 1}-${endIndex} 个分组，共 ${this.groupedProjects.length} 个分组`);

            let html = '';
            currentPageGroups.forEach(group => {
                try {
                    // 生成唯一的分组ID来检查展开状态
                    const uniqueGroupId = `${group.product_id}_${group.product_name}_${group.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const isExpanded = this.expandedGroups.has(uniqueGroupId);
                    console.log(`渲染分组 ${group.product_id} (${uniqueGroupId}), 展开状态: ${isExpanded}`);
                    html += this.renderProductGroup(group, isExpanded);
                } catch (groupError) {
                    console.error(`渲染分组 ${group.product_id} 失败:`, groupError);
                    html += `
                        <div class="product-group error" data-product-id="${group.product_id}">
                            <div class="group-header">
                                <div class="group-info">
                                    <div class="group-title">
                                        <i class="fas fa-exclamation-triangle"></i>
                                        <span>${group.product_name || '未知产品'}</span>
                                    </div>
                                    <div class="group-meta">
                                        <span class="meta-item error">渲染失败</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            });

            // 使用requestAnimationFrame确保DOM更新稳定
            return new Promise((resolve, reject) => {
                requestAnimationFrame(() => {
                    try {
                        container.innerHTML = html;
                        
                        // 绑定分组展开按钮事件
                        this.bindGroupExpandButtonEvents();
                        
                        // 绑定分组添加项目按钮事件
                        this.bindGroupAddProjectButtonEvents();
                        
                        // 绑定分组批量执行按钮事件
                        console.log('🚀 准备绑定分组批量执行按钮事件...');
                        this.bindGroupBatchExecuteButtonEvents();
                        console.log('✅ 分组批量执行按钮事件绑定调用完成');
                        
                        // 绑定项目展开按钮事件（分组视图下）
                        this.bindProjectExpandButtonEvents();
                        
                        // 为已展开的分组重新加载执行记录
                        for (const groupId of this.expandedGroups) {
                            // groupId here is uniqueGroupId; resolve to productId
                            const group = this.groupedProjects.find(g => `${g.product_id}_${g.product_name}_${g.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_') === groupId);
                            if (group) {
                                this.loadRecentExecutionsForGroup(group.product_id, groupId);
                            }
                        }
                        
                        // 渲染分页控件
                        this.renderPagination();
                        
                        resolve();
                    } catch (renderError) {
                        console.error('DOM更新失败:', renderError);
                        reject(renderError);
                    }
                });
            });
        } catch (error) {
            console.error('renderGroupedProjects error:', error);
            this.showErrorMessage('渲染分组项目失败，请重试');
            throw error;
        }
    }

    // 渲染产品分组
    renderProductGroup(group, isExpanded = false) {
        try {
            // 验证分组数据
            if (!group || !group.product_id) {
                console.error('无效的分组数据:', group);
                throw new Error('无效的分组数据');
            }
            
            if (!Array.isArray(group.projects)) {
                console.error('分组项目数据无效:', group.projects);
                group.projects = [];
            }
            
            const projectCount = group.projects.length;
            const expandedClass = isExpanded ? 'expanded' : '';
            
            // 安全地获取分组信息
            const productName = group.product_name || '未知产品';
            const systemType = group.system_type || '未知系统';
            const productType = group.product_type || '未知类型';
            const environment = group.environment || '未知环境';
            const product_id = group.product_id || '未知产品ID';
            const version_number = group.version_number || '未知版本号';
            
            // 创建唯一的分组标识符
            const uniqueGroupId = `${group.product_id}_${productName}_${environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            
            let projectsHtml = '';
            if (isExpanded && group.projects.length > 0) {
                try {
                    projectsHtml = group.projects.map(project => {
                        try {
                            return this.renderProjectCard(project, this.expandedProjects.has(project.id));
                        } catch (projectError) {
                            console.error(`渲染项目 ${project.id} 失败:`, projectError);
                            return `
                                <div class="automation-card error">
                                    <div class="card-content">
                                        <h3>项目渲染失败</h3>
                                        <p>项目ID: ${project.id || '未知'}</p>
                                    </div>
                                </div>
                            `;
                        }
                    }).join('');
                } catch (mapError) {
                    console.error('渲染项目列表失败:', mapError);
                    projectsHtml = '<div class="automation-card error"><p>项目列表渲染失败</p></div>';
                }
            }
            
            return `
                <div class="product-group ${expandedClass}" data-product-id="${group.product_id}" data-unique-group-id="${uniqueGroupId}">
                    <div class="group-header-container ${expandedClass}">
                        <div class="group-header" data-product-id="${group.product_id}" data-unique-group-id="${uniqueGroupId}">
                        <div class="group-info">
                            <div class="group-title">
                                <i class="fas fa-box"></i>
                                <span>${productName}</span>
                            </div>
                            <div class="group-meta">
                                <span class="meta-item">
                                    <i class="fas fa-list"></i>
                                    ${projectCount}个项目
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-desktop"></i>
                                    ${systemType}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-tag"></i>
                                    ${productType}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-globe"></i>
                                    ${environment}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-tag"></i>
                                    ${product_id}
                                </span>
                            </div>
                            </div>
                        </div>
                        <div class="group-header-actions">
                            <button class="btn btn-sm btn-success group-batch-execute-btn" 
                                    data-product-id="${group.product_id}"
                                    data-unique-group-id="${uniqueGroupId}"
                                    title="一键执行${productName}下所有项目测试">
                                <i class="fas fa-play-circle"></i>
                                <span>一键执行测试</span>
                            </button>
                            <button class="btn btn-sm btn-primary group-add-project-btn" 
                                    data-product-id="${group.product_id}"
                                    data-product-name="${group.original_product_name || productName}"
                                    data-system-type="${systemType}"
                                    data-product-type="${productType}"
                                    data-environment="${environment}"
                                    data-product-address="${group.product_address || ''}"
                                    data-version-number="${version_number}"
                                    title="添加${productName}项目">
                                <i class="fas fa-plus"></i>
                                <span>添加项目</span>
                            </button>
                        </div>
                    </div>
                    <div class="group-projects ${expandedClass}">
                        ${projectsHtml}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('renderProductGroup error:', error);
            // 返回错误状态的分组
            return `
                <div class="product-group error" data-product-id="${group?.product_id || 'unknown'}">
                    <div class="group-header">
                        <div class="group-info">
                            <div class="group-title">
                                <i class="fas fa-exclamation-triangle"></i>
                                <span>渲染失败</span>
                            </div>
                            <div class="group-meta">
                                <span class="meta-item error">数据错误</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // 更新产品选项
    updateProductOptions() {
        const dropdown = document.getElementById('productIdsDropdown');
        if (dropdown) {
            this.populateDropdownOptions(dropdown);
            this.updateCheckboxes();
        }

        // 兼容旧版<select id="product_ids">（若存在）
        const productSelect = document.getElementById('product_ids');
        if (productSelect) {
            productSelect.innerHTML = '';
            this.products.forEach(product => {
                const option = document.createElement('option');
                option.value = product.product_id;
                option.textContent = `${product.product_id} - ${product.product_name} (${product.system_type || ''})`;
                productSelect.appendChild(option);
            });
        }
    }

    // 渲染项目列表
    renderProjectsList() {
        try {
            const container = document.getElementById('automation-list');
            if (!container) {
                console.error('找不到自动化列表容器');
                return;
            }
            
            // 显示加载状态
            container.innerHTML = `
                <div class="loading-state">
                    <i class="fas fa-spinner"></i>
                    <p>正在加载项目数据...</p>
                </div>
            `;
            
            // 确保 projects 是数组
            if (!Array.isArray(this.projects)) {
                console.error('renderProjectsList: this.projects 不是数组，当前类型:', typeof this.projects);
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>数据加载错误</h3>
                        <p>项目数据格式错误，请刷新页面重试</p>
                    </div>
                `;
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
                return;
            }
            
            if (this.projects.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-robot"></i>
                        <h3>暂无自动化项目</h3>
                        <p>点击"添加自动化项目"按钮创建您的第一个自动化项目</p>
                    </div>
                `;
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
                return;
            }

            let html = '';
            this.projects.forEach(project => {
                const isExpanded = this.expandedProjects.has(project.id);
                html += this.renderProjectCard(project, isExpanded);
            });

            // 使用requestAnimationFrame确保DOM更新稳定
            requestAnimationFrame(() => {
                container.innerHTML = html;
                
                // 绑定展开按钮事件
                this.bindExpandButtonEvents();
                
                // 为已展开的项目重新加载执行记录
                for (const projectId of this.expandedProjects) {
                    this.loadRecentExecutions(projectId);
                }
            });
        } catch (error) {
            console.error('renderProjectsList error:', error);
            this.showErrorMessage('渲染项目列表失败，请重试');
        }
    }

    // 渲染单个项目卡片
    renderProjectCard(project, isExpanded = false) {
        const isRunning = project.last_status === 'running';
        // 如果项目正在运行，显示running状态，否则显示最后执行状态
        const displayStatus = isRunning ? 'running' : (project.last_status || 'pending');
        const statusClass = this.getStatusClass(displayStatus);
        const statusText = this.getStatusText(displayStatus, null);

        return `
            <div class="automation-card" data-project-id="${project.id}">
                <div class="automation-header">
                    <div class="automation-info">
                        <button class="expand-btn ${isExpanded ? 'expanded' : ''}" 
                                data-project-id="${project.id}">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                        <div class="automation-details">
                            <h3 class="automation-name">${project.process_name}</h3>
                            <div class="automation-meta">
                                <span class="meta-item">
                                    <i class="fas fa-cube"></i>
                                    ${(Array.isArray(project.product_ids) ? project.product_ids : []).join(', ')}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-desktop"></i>
                                    ${project.system}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-tag"></i>
                                    ${project.product_type}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-globe"></i>
                                    ${project.environment}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="automation-actions">
                        <button class="btn btn-info btn-sm" onclick="automationManagement.testConnection(${project.id})" 
                                title="测试连接">
                            <i class="fas fa-plug"></i>
                            测试连接
                        </button>
                        <button class="btn ${isRunning ? 'btn-warning btn-cancel-test spinning' : 'btn-success btn-execute-test'} btn-sm" 
                                onclick="automationManagement.${isRunning ? 'cancelTest' : 'executeTest'}(${project.id})"
                                title="${isRunning ? '取消测试' : '执行测试'}"
                                id="test-btn-${project.id}">
                            <i class="fas ${isRunning ? 'fa-spinner fa-spin' : 'fa-play'}"></i>
                            <span class="btn-text">${isRunning ? '取消测试' : '执行测试'}</span>
                        </button>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                        <button class="btn btn-secondary btn-sm" onclick="console.log('编辑按钮被点击，项目ID:', ${project.id}); console.log('automationManagement 对象:', automationManagement); automationManagement.editProject(${project.id})"
                                title="编辑">
                            <i class="fas fa-edit"></i>
                            编辑
                        </button>
                        <button class="btn btn-info btn-sm" onclick="automationManagement.openCodeManagement(${project.id})"
                                title="代码管理">
                            <i class="fas fa-code"></i>
                            代码管理
                        </button>
                        <button class="btn btn-info btn-sm" onclick="automationManagement.showExecutionHistory(${project.id})"
                                title="测试日志">
                            <i class="fas fa-history"></i>
                            测试日志
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="automationManagement.deleteProject(${project.id})"
                                title="删除项目" style="background: #e53e3e; color: white;">
                            <i class="fas fa-trash"></i>
                            删除
                        </button>
                    </div>
                </div>
                ${isExpanded ? this.renderExpandedContent(project) : ''}
            </div>
        `;
    }

    // 渲染展开的内容
    renderExpandedContent(project) {
        // 这里可以展示执行记录
        return `
            <div class="automation-expanded">
                <div class="execution-records">
                    <h4>最近执行记录</h4>
                    <div id="recent-executions-${project.id}">
                        <div class="loading-text">加载中...</div>
                    </div>
                </div>
            </div>
        `;
    }

    // 获取状态样式类
    getStatusClass(status) {
        const statusMap = {
            'pending': 'status-pending',
            'running': 'status-running',
            'passed': 'status-success',
            'failed': 'status-error',
            'cancelled': 'status-warning'
        };
        return statusMap[status] || 'status-pending';
    }
    	// 获取状态文本
	getStatusText(status, cancelType = null) {
		// 优先根据取消类型显示更精确的文案
		if (cancelType === 'errors') {
			return '测试运行异常';
		}
		if (status === 'cancelled') {
			return '人工取消';
		}
		
		const statusMap = {
			'pending': '待执行',
			'running': '执行中',
			'passed': '测试通过',
			'failed': '测试不通过'
		};
		return statusMap[status] || '未知状态';
	}

    // 切换展开状态
    async toggleExpand(projectId) {
        try {
            console.log('toggleExpand called with projectId:', projectId);
            console.log('Current expandedProjects:', Array.from(this.expandedProjects));
            console.log('Current view mode - showGroupedView:', this.showGroupedView);
            
            // 防止重复操作
            if (this.isProcessing) {
                console.log('操作正在进行中，请稍候...');
                return;
            }
            
            this.isProcessing = true;
            
            // 在展开项目前，先获取最新的项目状态以确保状态同步
            if (!this.expandedProjects.has(projectId)) {
                console.log('展开项目前刷新状态，确保显示最新状态');
                await this.refreshSingleProjectStatus(projectId);
            }
            
            // 根据当前视图模式检查数据
            if (this.showGroupedView) {
                // 分组视图下，检查 groupedProjects
                console.log('In grouped view, checking groupedProjects...');
                console.log('groupedProjects type:', typeof this.groupedProjects);
                console.log('groupedProjects isArray:', Array.isArray(this.groupedProjects));
                console.log('groupedProjects length:', this.groupedProjects?.length);
                
                if (!Array.isArray(this.groupedProjects)) {
                    console.error('this.groupedProjects 不是数组，当前类型:', typeof this.groupedProjects);
                    console.log('尝试重新加载分组项目数据...');
                    await this.loadGroupedProjects();
                    
                    // 重新检查
                    if (!Array.isArray(this.groupedProjects)) {
                        console.error('无法加载分组项目数据，groupedProjects 仍然不是数组');
                        this.isProcessing = false;
                        return;
                    }
                }
            } else {
                // 列表视图下，检查 projects
                console.log('In list view, checking projects...');
                if (!Array.isArray(this.projects)) {
                    console.error('this.projects 不是数组，当前类型:', typeof this.projects);
                    console.log('尝试重新加载项目数据...');
                    await this.loadProjects();
                    
                    // 重新检查
                    if (!Array.isArray(this.projects)) {
                        console.error('无法加载项目数据，projects 仍然不是数组');
                        this.isProcessing = false;
                        return;
                    }
                }
            }
            
            if (this.expandedProjects.has(projectId)) {
                console.log('Collapsing project:', projectId);
                this.expandedProjects.delete(projectId);
                
                // 根据当前视图模式选择渲染函数
                console.log('About to render after collapsing...');
                if (this.showGroupedView) {
                    console.log('Calling renderGroupedProjects...');
                    await this.renderGroupedProjects();
                } else {
                    console.log('Calling renderProjectsList...');
                    this.renderProjectsList();
                }
            } else {
                console.log('Expanding project:', projectId);
                this.expandedProjects.add(projectId);
                
                // 根据当前视图模式选择渲染函数
                console.log('About to render after expanding...');
                if (this.showGroupedView) {
                    console.log('In grouped view, updating specific project...');
                    this.updateProjectInGroupedView(projectId);
                } else {
                    console.log('Calling renderProjectsList...');
                    this.renderProjectsList();
                }
                
                // 然后加载执行记录
                await this.loadRecentExecutions(projectId);
                
                // 加载执行记录后，立即检查状态一致性并同步
                await this.syncProjectStatusAfterExpand(projectId);
            }
            
            console.log('toggleExpand completed');
        } catch (error) {
            console.error('toggleExpand error:', error);
            // 显示错误提示
            this.showErrorMessage('展开/收起操作失败，请重试');
        } finally {
            this.isProcessing = false;
        }
    }

    // 在分组视图中更新特定项目的展开状态
    updateProjectInGroupedView(projectId) {
        try {
            console.log('更新分组视图中的项目:', projectId);
            
            // 查找包含此项目的分组
            let targetGroup = null;
            for (const group of this.groupedProjects) {
                if (group.projects && group.projects.some(p => p.id == projectId)) {
                    targetGroup = group;
                    break;
                }
            }
            
            if (!targetGroup) {
                console.error('找不到包含项目的分组:', projectId);
                return;
            }
            
            console.log('找到目标分组:', targetGroup.product_name);
            
            // 生成唯一的分组ID
            const uniqueGroupId = `${targetGroup.product_id}_${targetGroup.product_name}_${targetGroup.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const isGroupExpanded = this.expandedGroups.has(uniqueGroupId);
            
            console.log('分组展开状态:', isGroupExpanded);
            
            if (!isGroupExpanded) {
                console.log('分组未展开，无需更新项目');
                return;
            }
            
            // 查找分组DOM元素
            const groupElement = document.querySelector(`.product-group[data-unique-group-id="${uniqueGroupId}"]`);
            if (!groupElement) {
                console.error('找不到分组DOM元素:', uniqueGroupId);
                return;
            }
            
            // 重新渲染这个分组
            const newGroupHtml = this.renderProductGroup(targetGroup, true);
            
            // 创建临时容器来解析新HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newGroupHtml;
            const newGroupElement = tempDiv.firstElementChild;
            
            // 替换旧元素
            groupElement.parentNode.replaceChild(newGroupElement, groupElement);
            
            // 重新绑定事件
            this.bindSingleGroupEvents(newGroupElement);
            
            console.log('分组中项目更新完成');
            
        } catch (error) {
            console.error('更新分组视图中的项目失败:', error);
            // 如果出错，回退到重新渲染整个列表
            console.log('回退到重新渲染整个分组列表');
            this.renderGroupedProjects();
        }
    }

    // 绑定单个分组的事件
    bindSingleGroupEvents(groupElement) {
        try {
            // 绑定分组头部点击事件
            const groupHeader = groupElement.querySelector('.group-header');
            if (groupHeader) {
                groupHeader.addEventListener('click', (e) => {
                    e.preventDefault();
                    const uniqueGroupId = e.target.closest('.group-header').dataset.uniqueGroupId;
                    if (uniqueGroupId) {
                        console.log('分组头部点击事件触发');
                        this.toggleGroupExpansion(uniqueGroupId);
                    }
                });
            }

            // 绑定项目展开按钮事件
            const expandBtns = groupElement.querySelectorAll('.expand-btn');
            expandBtns.forEach((btn, index) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const projectId = parseInt(btn.dataset.projectId);
                    console.log(`分组视图下项目展开按钮被点击，项目ID: ${projectId}`);
                    this.toggleExpand(projectId);
                });
            });

            // 绑定分组内的批量执行按钮事件
            const batchExecuteBtn = groupElement.querySelector('.group-batch-execute-btn');
            if (batchExecuteBtn) {
                console.log('🔧 为单个分组绑定批量执行按钮事件...');
                
                // 移除之前的事件监听器，避免重复绑定
                if (batchExecuteBtn._batchExecuteHandler) {
                    batchExecuteBtn.removeEventListener('click', batchExecuteBtn._batchExecuteHandler);
                    delete batchExecuteBtn._batchExecuteHandler;
                }
                
                // 创建新的事件处理函数，保存this上下文
                const self = this;
                batchExecuteBtn._batchExecuteHandler = function(event) {
                    console.log('🚀 单个分组批量执行按钮点击事件触发!');
                    console.log('📍 点击的按钮:', event.currentTarget);
                    
                    event.preventDefault();
                    event.stopPropagation();
                    
                    const productId = batchExecuteBtn.getAttribute('data-product-id');
                    const uniqueGroupId = batchExecuteBtn.getAttribute('data-unique-group-id');
                    
                    console.log('🆔 单个分组批量执行，产品ID:', productId);
                    console.log('🏷️ 单个分组批量执行，唯一分组ID:', uniqueGroupId);
                    
                    if (productId && uniqueGroupId) {
                        console.log('✅ 单个分组数据属性检查通过，开始执行批量测试');
                        self.batchExecuteGroupTests(productId, uniqueGroupId);
                    } else {
                        console.error('❌ 单个分组批量执行按钮缺少必要的数据属性');
                        showToast('按钮配置错误，请刷新页面重试', 'error');
                    }
                };
                
                // 绑定事件
                batchExecuteBtn.addEventListener('click', batchExecuteBtn._batchExecuteHandler);
                console.log('✅ 单个分组批量执行按钮事件绑定完成');
            }

            // 绑定分组内的添加项目按钮事件
            const addProjectBtn = groupElement.querySelector('.group-add-project-btn');
            if (addProjectBtn) {
                // 这里可以添加添加项目按钮的事件绑定，如果需要的话
                // 当前可能已经在其他地方绑定了
            }

            console.log('单个分组事件绑定完成');
        } catch (error) {
            console.error('绑定单个分组事件失败:', error);
        }
    }

    // 加载最近执行记录
    async loadRecentExecutions(projectId, page = 1, pageSize = 5) {
        try {
            const response = await fetch(`/api/automation/projects/${projectId}/executions?page=${page}&page_size=${pageSize}`);
            const result = await response.json();
            
            if (result.success) {
                const container = document.getElementById(`recent-executions-${projectId}`);
                if (container) {
                    if (result.data.length === 0) {
                        container.innerHTML = '<div class="no-data">暂无执行记录</div>';
                    } else {
                        // 生成执行记录HTML
                        const executionsHtml = result.data.map(execution => {
                            const duration = execution.start_time && execution.end_time 
                                ? this.calculateDuration(execution.start_time, execution.end_time)
                                : '计算中...';
                            
                            return `
                            <div class="execution-record" 
                                 data-execution-id="${execution.id}"
                                 onclick="automationManagement.showExecutionLog(${execution.id})"
                                 style="cursor: pointer;">
                                <div class="execution-main-info">
                                    <div class="execution-header">
                                        <span class="execution-process-name">${execution.process_name}</span>
                                        <span class="execution-status ${this.getStatusClass(execution.status)}">${this.getStatusText(execution.status, execution.cancel_type)}</span>
                                    </div>
                                    <div class="execution-details">
                                        <span class="execution-system">${execution.system}</span>
                                        <span class="execution-type">${execution.product_type}</span>
                                        <span class="execution-env">${execution.environment}</span>
                                    </div>
                                </div>
                                <div class="execution-time-info">
                                    <div class="execution-time">开始: ${formatDateTimeUTC(execution.start_time)}</div>
                                    ${execution.end_time ? `<div class="execution-end-time">结束: ${formatDateTimeUTC(execution.end_time)}</div>` : ''}
                                    <div class="execution-duration">耗时: ${duration}</div>
                                </div>
                                <div class="execution-operator">
                                    <span class="user-info">${execution.executed_by || '未知用户'}</span>
                                </div>
                            </div>`;
                        }).join('');
                        
                        // 生成分页控件HTML - 始终显示分页控件
                        const pagination = result.pagination;
                        const startItem = (pagination.page - 1) * pagination.page_size + 1;
                        const endItem = Math.min(pagination.page * pagination.page_size, pagination.total_count);
                        
                        const paginationHtml = `
                            <div class="execution-pagination">
                                <div class="pagination-info">
                                    <span>显示第 ${startItem}-${endItem} 条，共 ${pagination.total_count} 条记录</span>
                                </div>
                                <div class="pagination-controls">
                                    <div class="pagination-size-selector">
                                        <label>每页显示：</label>
                                        <select id="pageSizeSelect-${projectId}" class="form-control" onchange="automationManagement.changePageSize(${projectId}, this.value)">
                                            <option value="5" ${pagination.page_size === 5 ? 'selected' : ''}>5</option>
                                            <option value="10" ${pagination.page_size === 10 ? 'selected' : ''}>10</option>
                                            <option value="20" ${pagination.page_size === 20 ? 'selected' : ''}>20</option>
                                            <option value="50" ${pagination.page_size === 50 ? 'selected' : ''}>50</option>
                                        </select>
                                    </div>
                                    <div class="pagination-buttons">
                                        <button class="btn btn-secondary" onclick="automationManagement.loadRecentExecutions(${projectId}, 1, ${pagination.page_size})" ${pagination.page === 1 ? 'disabled' : ''}>
                                            <i class="fas fa-angle-double-left"></i>
                                        </button>
                                        <button class="btn btn-secondary" onclick="automationManagement.loadRecentExecutions(${projectId}, ${pagination.page - 1}, ${pagination.page_size})" ${!pagination.has_prev ? 'disabled' : ''}>
                                            <i class="fas fa-angle-left"></i>
                                        </button>
                                        <div class="page-numbers">
                                            ${this.generatePageNumbers(projectId, pagination)}
                                        </div>
                                        <button class="btn btn-secondary" onclick="automationManagement.loadRecentExecutions(${projectId}, ${pagination.page + 1}, ${pagination.page_size})" ${!pagination.has_next ? 'disabled' : ''}>
                                            <i class="fas fa-angle-right"></i>
                                        </button>
                                        <button class="btn btn-secondary" onclick="automationManagement.loadRecentExecutions(${projectId}, ${pagination.total_pages}, ${pagination.page_size})" ${pagination.page === pagination.total_pages ? 'disabled' : ''}>
                                            <i class="fas fa-angle-double-right"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                        
                        container.innerHTML = executionsHtml + paginationHtml;
                    }
                }
            }
        } catch (error) {
            console.error('加载执行记录失败:', error);
        }
    }
    
    // 生成页码数字
    generatePageNumbers(projectId, pagination) {
        const { page, total_pages, page_size } = pagination;
        const maxVisiblePages = 5;
        let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(total_pages, startPage + maxVisiblePages - 1);

        // 调整起始页，确保显示足够的页码
        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        let pageNumbersHtml = '';

        // 第一页
        if (startPage > 1) {
            pageNumbersHtml += `<button class="btn btn-secondary page-number" onclick="automationManagement.loadRecentExecutions(${projectId}, 1, ${page_size})">1</button>`;
            if (startPage > 2) {
                pageNumbersHtml += `<span class="page-ellipsis">...</span>`;
            }
        }

        // 中间页码
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === page;
            pageNumbersHtml += `
                <button class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} page-number" onclick="automationManagement.loadRecentExecutions(${projectId}, ${i}, ${page_size})">
                    ${i}
                </button>
            `;
        }

        // 最后一页
        if (endPage < total_pages) {
            if (endPage < total_pages - 1) {
                pageNumbersHtml += `<span class="page-ellipsis">...</span>`;
            }
            pageNumbersHtml += `<button class="btn btn-secondary page-number" onclick="automationManagement.loadRecentExecutions(${projectId}, ${total_pages}, ${page_size})">${total_pages}</button>`;
        }

        return pageNumbersHtml;
    }

    // 计算执行持续时间
    calculateDuration(startTime, endTime) {
        if (!startTime || !endTime) return '未知';
        
        try {
            const start = new Date(startTime);
            const end = new Date(endTime);
            const diffMs = end - start;
            
            if (diffMs < 0) return '未知';
            
            const diffSec = Math.floor(diffMs / 1000);
            const minutes = Math.floor(diffSec / 60);
            const seconds = diffSec % 60;
            
            if (minutes > 0) {
                return `${minutes}分${seconds}秒`;
            } else {
                return `${seconds}秒`;
            }
        } catch (error) {
            return '未知';
        }
    }

    // 打开添加项目弹窗
    async openAddProjectModal() {
        this.currentEditingProject = null;
        this.isEditing = false;
        this.editingTestSteps = null;
        this.editingUploadedImages.clear();
        this.uploadedImages.clear();
        this.testSteps = [];
        this.selectedProducts = [];
        await this.resetForm();
        this.renderTestSteps();
        this.showModal();
    }

    // 为特定分组打开添加项目弹窗
    async openAddProjectModalForGroup(buttonElement) {
        try {
            console.log('为分组打开添加项目弹窗');
            
            // 获取分组信息
            const groupInfo = {
                productId: buttonElement.dataset.productId,
                productName: buttonElement.dataset.productName,
                systemType: buttonElement.dataset.systemType,
                productType: buttonElement.dataset.productType,
                environment: buttonElement.dataset.environment,
                productAddress: buttonElement.dataset.productAddress
            };
            
            console.log('分组信息:', groupInfo);
            
            // 先执行常规的打开弹窗操作
            this.currentEditingProject = null;
            this.isEditing = false;
            this.editingTestSteps = null;
            this.editingUploadedImages.clear();
            this.uploadedImages.clear();
            this.testSteps = [];
            this.selectedProducts = [];
            await this.resetForm();
            this.renderTestSteps();
            
            // 在弹窗显示后预填充分组信息
            this.showModal();
            
            // 等待DOM更新后再预填充
            setTimeout(() => {
                this.prefillGroupInfo(groupInfo);
            }, 100);
            
        } catch (error) {
            console.error('为分组打开添加项目弹窗失败:', error);
            // 如果出错，回退到普通的添加项目弹窗
            this.openAddProjectModal();
        }
    }

    // 预填充分组信息到表单
    prefillGroupInfo(groupInfo) {
        try {
            console.log('开始预填充分组信息:', groupInfo);
            
            // 首先找到对应的产品并设置为选中状态
            const matchingProducts = this.products.filter(product => 
                product.product_id === groupInfo.productId &&
                product.product_name === groupInfo.productName &&
                product.system_type === groupInfo.systemType &&
                product.product_type === groupInfo.productType &&
                product.environment === groupInfo.environment
            );
            
            console.log('找到匹配的产品:', matchingProducts);
            
            if (matchingProducts.length > 0) {
                // 只选择第一个匹配的产品，避免重复
                const firstMatchingProduct = matchingProducts[0];
                const productIndex = this.products.findIndex(p => 
                    p.product_id === firstMatchingProduct.product_id &&
                    p.product_name === firstMatchingProduct.product_name &&
                    p.system_type === firstMatchingProduct.system_type &&
                    p.product_type === firstMatchingProduct.product_type &&
                    p.environment === firstMatchingProduct.environment
                );
                
                if (productIndex !== -1) {
                    const selectedId = `${firstMatchingProduct.product_id}_${productIndex}`;
                    console.log('生成的产品ID:', selectedId);
                    console.log('匹配的产品:', firstMatchingProduct);
                    console.log('产品索引:', productIndex);
                    console.log('数组中该索引的产品:', this.products[productIndex]);
                    
                    // 设置选中的产品ID
                    this.selectedProducts = [selectedId];
                    
                    // 更新复选框状态
                    this.updateCheckboxes();
                    
                    // 更新产品选择显示
                    this.updateSelectedProducts();
                    
                    // 自动填充其他字段
                    this.autoFillFields();
                    
                    console.log('分组信息预填充完成');
                } else {
                    console.warn('未找到产品索引');
                }
            } else {
                console.warn('未找到匹配的产品');
            }
            
        } catch (error) {
            console.error('预填充分组信息失败:', error);
        }
    }

    // 编辑项目
    async editProject(projectId) {
        try {
            const currentTime = Date.now();
            console.log('编辑项目被调用，项目ID:', projectId);
            console.log('当前处理状态:', this.isProcessing);
            console.log('距离上次编辑时间:', currentTime - this.lastEditTime);
            
            // 防抖：如果正在处理中或距离上次点击时间太短，则忽略
            if (this.isProcessing) {
                console.log('正在处理中，忽略此次点击');
                return;
            }
            
            if (currentTime - this.lastEditTime < 1000) {
                console.log('点击间隔太短，忽略此次点击');
                return;
            }
            
            this.isProcessing = true;
            this.lastEditTime = currentTime;
            
            console.log('所有项目:', this.projects);
            console.log('projects 类型:', typeof this.projects);
            console.log('projects 是否为数组:', Array.isArray(this.projects));
            
            // 确保 projects 是数组
            if (!Array.isArray(this.projects)) {
                console.error('this.projects 不是数组，当前类型:', typeof this.projects);
                console.log('尝试重新加载项目数据...');
                await this.loadProjects();
                
                // 重新检查
                if (!Array.isArray(this.projects)) {
                    throw new Error('无法加载项目数据，projects 仍然不是数组');
                }
            }
            
        const project = this.projects.find(p => p.id === projectId);
            if (!project) {
                console.error('未找到项目:', projectId);
                return;
            }

            console.log('找到项目:', project);
            console.log('项目的product_ids:', project.product_ids);
            console.log('当前所有产品:', this.products);
        this.currentEditingProject = project;
        this.testSteps = Array.isArray(project.test_steps) ? project.test_steps : [];
            
            // 将旧的产品ID转换为新的唯一标识符格式
            if (Array.isArray(project.product_ids)) {
                this.selectedProducts = [];
                
                // 使用 "product_id + product_package_name" 作为复合键，避免同一产品ID的不同包被合并
                const usedIndexes = new Set();
                const hasPackageNames = Array.isArray(project.product_package_names) && project.product_package_names.length === project.product_ids.length;
                const seenCompositeKeys = new Set();
                
                project.product_ids.forEach((productId, idx) => {
                    const targetPackageName = hasPackageNames ? project.product_package_names[idx] : null;
                    const compositeKey = `${productId}__${targetPackageName || ''}`;
                    if (seenCompositeKeys.has(compositeKey)) return; // 跳过完全重复的一对
                    
                    // 候选列表：按 product_id（和可选的包名）过滤
                    let candidates = this.products
                        .map((p, index) => ({ p, index }))
                        .filter(({ p }) => p.product_id === productId);
                    if (targetPackageName) {
                        const nameMatches = candidates.filter(({ p }) => p.product_name === targetPackageName);
                        if (nameMatches.length > 0) {
                            candidates = nameMatches;
                        }
                    }
                    
                    // 次优先：按系统 + 环境筛选
                    if (project.system || project.environment) {
                        const strictMatches = candidates.filter(({ p }) =>
                            (!project.system || p.system_type === project.system) &&
                            (!project.environment || p.environment === project.environment)
                        );
                        if (strictMatches.length > 0) {
                            candidates = strictMatches;
                        }
                    }
                    
                    // 选择一个未使用的候选
                    let chosen = candidates.find(({ index }) => !usedIndexes.has(index));
                    if (!chosen && candidates.length > 0) {
                        chosen = candidates[0];
                    }
                    
                    if (chosen) {
                        usedIndexes.add(chosen.index);
                        seenCompositeKeys.add(compositeKey);
                        const uniqueId = `${chosen.p.product_id}_${chosen.index}`;
                        this.selectedProducts.push(uniqueId);
                        console.log('添加选中产品(按product_id+product_name):', uniqueId);
                    }
                });
            } else {
                this.selectedProducts = [];
            }
            
        this.uploadedImages.clear();

        // 更新标题
        document.getElementById('automation-modal-title').textContent = '编辑自动化项目';
        
        // 填充表单
        document.getElementById('processName').value = project.process_name;
        document.getElementById('automationSystem').value = project.system || '';
        document.getElementById('automationProductType').value = project.product_type || '';
        document.getElementById('automationEnvironment').value = project.environment || '';
        
        // 处理产品地址 - 支持多产品地址
        this.handleProductAddressForEdit(project);
        
        // 加载枚举值并初始化自定义选择框
            console.log('开始加载枚举值...');
        await this.loadEnumValues();
            console.log('枚举值加载完成，初始化选择框...');
        this.initCustomSelects();
        
        // 设置多选产品ID
            console.log('初始化多选框...');
        await this.initProductMultiSelect();
            console.log('更新选中的产品...');
        this.updateSelectedProducts();

        // 渲染测试步骤
            console.log('渲染测试步骤...');
        this.renderTestSteps();
        
            console.log('显示模态框...');
        this.showModal();
            console.log('editProject 方法执行完成');
            
            // 设置一个延迟来重置处理状态
            setTimeout(() => {
                this.isProcessing = false;
                console.log('处理状态已重置');
            }, 2000);
            
        } catch (error) {
            console.error('editProject 方法出错:', error);
            console.error('错误堆栈:', error.stack);
            showToast('编辑项目时出现错误: ' + error.message, 'error');
            this.isProcessing = false;
        }
    }

    // 显示弹窗
    showModal() {
        try {
            console.log('showModal 开始执行...');
        const modal = document.getElementById('automationModal');
            if (!modal) {
                console.error('找不到模态框元素 #automationModal');
                return;
            }
            
            console.log('模态框元素找到，添加 show 类...');
        modal.classList.add('show');
            
            // 强制设置显示样式
            modal.style.display = 'flex';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            
        document.body.style.overflow = 'hidden';
            
            // 表单提交事件已在构造函数中绑定，这里不需要重复绑定
            console.log('模态框显示，表单事件已绑定');
            
            // 确保模态框确实显示了
            setTimeout(() => {
                const isVisible = modal.classList.contains('show');
                const computedStyle = window.getComputedStyle(modal);
                console.log('模态框显示状态检查:', {
                    hasShowClass: isVisible,
                    display: computedStyle.display,
                    opacity: computedStyle.opacity,
                    visibility: computedStyle.visibility,
                    zIndex: computedStyle.zIndex,
                    position: computedStyle.position,
                    inlineDisplay: modal.style.display,
                    classList: Array.from(modal.classList)
                });
                
                // 如果模态框仍然不可见，强制显示
                if (computedStyle.display === 'none') {
                    console.log('模态框仍然隐藏，强制显示...');
                    modal.style.display = 'flex !important';
                    modal.style.visibility = 'visible !important';
                    modal.style.opacity = '1 !important';
                }
            }, 100);
            
            console.log('showModal 执行完成');
        } catch (error) {
            console.error('showModal 出错:', error);
        }
    }

    // 关闭弹窗
    closeModal() {
        console.log('关闭模态框');
        
        // 清理图片缓存
        this.clearImageCache();
        
        const modal = document.getElementById('automationModal');
        if (modal) {
        modal.classList.remove('show');
            modal.style.display = 'none';
        }
        document.body.style.overflow = '';
        
        // 清理编辑状态
        this.clearEditingState();
        
        // 重置表单数据
        const form = document.getElementById('automationForm');
        if (form) {
            form.reset();
        }
        this.testSteps = [];
        this.selectedProducts = [];
        this.resetMultiselect();
        
        // 清理事件监听器
        this.cleanupEventListeners();
        
        // 重置处理状态
        this.isProcessing = false;
        this.lastEditTime = 0;
        
        // 强制刷新当前页面，确保数据是最新的
        this.refreshCurrentPage();
        
        console.log('模态框已关闭，状态已重置，页面已刷新');
    }
    
    // 刷新当前页面
    refreshCurrentPage() {
        console.log('刷新自动化管理页面...');
        console.log('当前视图模式:', this.showGroupedView ? '分组视图' : '列表视图');
        
        // 清除缓存的数据
        this.projects = [];
        this.groupedProjects = [];
        this.totalItems = 0;
        this.totalPages = 0;
        
        // 重新加载项目数据
        this.loadProjects();
        
        // 如果当前有展开的项目，重新加载执行记录
        if (this.expandedProjects.size > 0) {
            this.expandedProjects.forEach(projectId => {
                this.loadRecentExecutions(projectId, 1, 5);
            });
        }
        
        console.log('自动化管理页面刷新完成');
    }

    // ==================== 导入测试步骤功能 ====================
    
    // 打开导入测试步骤弹窗
    async openImportTestStepsModal() {
        try {
            // 显示弹窗
            const modal = document.getElementById('importTestStepsModal');
            if (modal) {
                modal.style.display = 'block';
                modal.classList.add('show');
                document.body.style.overflow = 'hidden';
            }
            
            // 加载产品分组
            await this.loadProductGroupsForImport();
            
            // 初始化搜索功能
            this.initImportSearch();
            
        } catch (error) {
            console.error('打开导入弹窗失败:', error);
            showToast('打开导入弹窗失败', 'error');
        }
    }
    
    // 关闭导入测试步骤弹窗
    closeImportTestStepsModal() {
        const modal = document.getElementById('importTestStepsModal');
        if (modal) {
            modal.classList.remove('show');
            modal.style.display = 'none';
        }
        document.body.style.overflow = '';
        
        // 清理状态
        this.selectedImportProduct = null;
        this.selectedImportProject = null;
        this.selectedImportSteps = [];
        
        // 重置UI
        const productsList = document.getElementById('productsList');
        const projectsList = document.getElementById('projectsList');
        const stepsPreview = document.getElementById('stepsPreviewContainer');
        const importBtn = document.getElementById('importStepsBtn');
        const selectedCount = document.getElementById('selectedStepsCount');
        const selectAllBtn = document.getElementById('selectAllStepsBtn');
        const deselectAllBtn = document.getElementById('deselectAllStepsBtn');
        
        if (productsList) productsList.innerHTML = '';
        if (projectsList) {
            projectsList.innerHTML = `
                <div class="no-selection">
                    <i class="fas fa-cube" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                    <p>请先选择一个产品包名</p>
                </div>
            `;
        }
        if (stepsPreview) {
            stepsPreview.innerHTML = `
                <div class="no-selection">
                    <i class="fas fa-list-ol" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                    <p>请先选择一个测试案例</p>
                </div>
            `;
        }
        if (importBtn) importBtn.disabled = true;
        if (selectedCount) selectedCount.textContent = '已选择 0 个步骤';
        if (selectAllBtn) selectAllBtn.disabled = true;
        if (deselectAllBtn) deselectAllBtn.disabled = true;
    }
    
    // 加载产品分组用于导入
    async loadProductGroupsForImport() {
        try {
            const productsList = document.getElementById('productsList');
            if (!productsList) return;
            
            // 显示加载状态
            productsList.innerHTML = `
                <div class="loading-placeholder">
                    <i class="fas fa-spinner"></i>
                    <p>正在加载产品列表...</p>
                </div>
            `;
            
            // 获取产品分组数据
            const response = await fetch('/api/automation/projects/grouped');
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || '获取产品分组失败');
            }
            
            const productGroups = result.data || [];
            
            if (productGroups.length === 0) {
                productsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-folder-open" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                        <p>暂无可用的产品</p>
                    </div>
                `;
                return;
            }
            
            // 渲染产品分组列表
            this.renderProductGroupsList(productGroups);
            
        } catch (error) {
            console.error('加载产品分组失败:', error);
            const productsList = document.getElementById('productsList');
            if (productsList) {
                productsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem; color: #e53e3e;"></i>
                        <p>加载产品列表失败</p>
                    </div>
                `;
            }
            showToast('加载产品列表失败', 'error');
        }
    }
    
    // 渲染产品分组列表
    renderProductGroupsList(productGroups) {
        const productsList = document.getElementById('productsList');
        if (!productsList) return;
        
        const html = productGroups.map(group => {
            const projectsCount = group.projects ? group.projects.length : 0;
            return `
                <div class="product-group">
                    <div class="product-group-header" data-product-id="${group.product_id}" data-product-name="${this.escapeHtml(group.product_name)}" 
                         onclick="automationManagement.selectImportProduct('${this.escapeJsString(group.product_name)}', '${this.escapeJsString(group.product_id)}')">
                        <div class="product-group-info">
                            <div class="product-name">${this.escapeHtml(group.product_name)}</div>
                            <div class="product-meta">
                                <span><i class="fas fa-cube"></i> ${this.escapeHtml(group.system_type || '未知系统')}</span>
                                <span><i class="fas fa-tag"></i> ${this.escapeHtml(group.product_type || '未知类型')}</span>
                                <span><i class="fas fa-project-diagram"></i> ${projectsCount} 个项目</span>
                            </div>
                        </div>
                        <i class="fas fa-chevron-right expand-icon"></i>
                    </div>
                </div>
            `;
        }).join('');
        
        productsList.innerHTML = html;
        
        // 保存产品分组数据以便后续使用
        this.productGroupsData = productGroups;
    }
    
    // 选择导入产品
    selectImportProduct(productName, productId) {
        try {
            // 更新选中状态
            const productsContainer = document.getElementById('productsList');
            if (productsContainer) {
                productsContainer.querySelectorAll('.product-group-header').forEach(item => {
                    item.classList.remove('selected');
                });
                
                const candidateItems = productsContainer.querySelectorAll(`.product-group-header[data-product-id="${productId}"]`);
                let selectedItem = null;
                if (candidateItems && candidateItems.length > 0) {
                    selectedItem = Array.from(candidateItems).find(el => el.getAttribute('data-product-name') === productName) || candidateItems[0];
                }
                if (selectedItem) {
                    selectedItem.classList.add('selected');
                }
            }
            
            // 保存选中的产品信息
            this.selectedImportProduct = { name: productName, id: productId };
            
            // 加载该产品下的项目列表
            this.loadProjectsForProduct(productName);
            
            // 清空测试步骤区域
            this.clearStepsPreview();
            
        } catch (error) {
            console.error('选择产品失败:', error);
            showToast('选择产品失败', 'error');
        }
    }
    
    // 为选中产品加载项目列表
    loadProjectsForProduct(productName) {
        try {
            const projectsList = document.getElementById('projectsList');
            if (!projectsList) return;
            
            // 从缓存的数据中查找对应产品的项目
            const productGroup = this.productGroupsData.find(group => group.product_name === productName);
            
            if (!productGroup || !productGroup.projects) {
                projectsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-cube" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                        <p>该产品下暂无测试案例</p>
                    </div>
                `;
                return;
            }
            
            // 过滤掉当前正在编辑的项目
            let filteredProjects = productGroup.projects.filter(project => {
                return this.currentEditingProject ? project.id !== this.currentEditingProject.id : true;
            });
            
            // 如果当前有搜索词，应用搜索过滤
            const searchInput = document.getElementById('importSearchInput');
            if (searchInput && searchInput.value.trim()) {
                const searchTerm = searchInput.value.trim().toLowerCase();
                filteredProjects = filteredProjects.filter(project => {
                    const projectName = project.process_name.toLowerCase();
                    const projectMeta = (project.system || '').toLowerCase() + ' ' + (project.product_type || '').toLowerCase();
                    return this.fuzzyMatch(projectName, searchTerm) || this.fuzzyMatch(projectMeta, searchTerm);
                });
            }
            
            if (filteredProjects.length === 0) {
                const isSearching = searchInput && searchInput.value.trim();
                projectsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-cube" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                        <p>${isSearching ? '没有匹配的测试案例' : '该产品下暂无可导入的测试案例'}</p>
                    </div>
                `;
                return;
            }
            
            // 渲染项目列表
            this.renderImportProjectsList(filteredProjects);
            
            // 如果搜索结果只有一个项目，自动选择它
            const isSearching = searchInput && searchInput.value.trim();
            if (isSearching && filteredProjects.length === 1) {
                setTimeout(() => {
                    this.selectImportProject(filteredProjects[0].id);
                }, 100);
            }
            
        } catch (error) {
            console.error('加载项目列表失败:', error);
            const projectsList = document.getElementById('projectsList');
            if (projectsList) {
                projectsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem; color: #e53e3e;"></i>
                        <p>加载项目列表失败</p>
                    </div>
                `;
            }
        }
    }
    
    // 渲染导入项目列表
    renderImportProjectsList(projects) {
        const projectsList = document.getElementById('projectsList');
        if (!projectsList) return;
        
        const html = projects.map(project => {
            const steps = Array.isArray(project.test_steps) ? project.test_steps : (project.test_steps ? JSON.parse(project.test_steps) : []);
            const testStepsCount = steps.length;
            return `
                <div class="project-item" data-project-id="${project.id}" onclick="automationManagement.selectImportProject(${project.id})">
                    <div class="project-item-name">${this.escapeHtml(project.process_name)}</div>
                    <div class="project-item-meta">
                        <span><i class="fas fa-cogs"></i> ${this.escapeHtml(project.system || '未知系统')}</span>
                        <span><i class="fas fa-tag"></i> ${this.escapeHtml(project.product_type || '未知类型')}</span>
                        <span><i class="fas fa-list-ol"></i> ${testStepsCount} 个步骤</span>
                    </div>
                </div>
            `;
        }).join('');
        
        projectsList.innerHTML = html;
    }
    
    // 选择导入项目
    async selectImportProject(projectId) {
        try {
            // 更新选中状态
            const projectsContainer = document.getElementById('projectsList');
            if (projectsContainer) {
                projectsContainer.querySelectorAll('.project-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                const selectedItem = projectsContainer.querySelector(`[data-project-id="${projectId}"]`);
                if (selectedItem) {
                    selectedItem.classList.add('selected');
                }
            }
            
            // 加载项目详情和测试步骤
            await this.loadProjectStepsPreview(projectId);
            
        } catch (error) {
            console.error('选择项目失败:', error);
            showToast('选择项目失败', 'error');
        }
    }
    
    // 加载项目测试步骤预览
    async loadProjectStepsPreview(projectId) {
        try {
            const stepsPreview = document.getElementById('stepsPreviewContainer');
            if (!stepsPreview) return;
            
            // 显示加载状态
            stepsPreview.innerHTML = `
                <div class="loading-placeholder">
                    <i class="fas fa-spinner"></i>
                    <p>正在加载测试步骤...</p>
                </div>
            `;
            
            // 获取项目详情
            const response = await fetch(`/api/automation/projects/${projectId}`);
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || '获取项目详情失败');
            }
            
            const project = result.data;
            const testSteps = project.test_steps || [];
            
            // 保存选中的项目和步骤
            this.selectedImportProject = project;
            this.currentProjectSteps = testSteps;
            this.selectedImportSteps = [];
            
            if (testSteps.length === 0) {
                stepsPreview.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-clipboard-list" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                        <p>该项目暂无测试步骤</p>
                    </div>
                `;
                
                // 禁用导入按钮
                const importBtn = document.getElementById('importStepsBtn');
                if (importBtn) importBtn.disabled = true;
                
                return;
            }
            
            // 渲染测试步骤预览
            this.renderStepsPreview(testSteps);
            
            // 启用导入按钮
            const importBtn = document.getElementById('importStepsBtn');
            if (importBtn) importBtn.disabled = false;
            
        } catch (error) {
            console.error('加载测试步骤预览失败:', error);
            const stepsPreview = document.getElementById('stepsPreviewContainer');
            if (stepsPreview) {
                stepsPreview.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem; color: #e53e3e;"></i>
                        <p>加载测试步骤失败</p>
                    </div>
                `;
            }
            showToast('加载测试步骤失败', 'error');
        }
    }
    
    // 渲染测试步骤预览（支持选择）
    renderStepsPreview(testSteps) {
        const stepsPreview = document.getElementById('stepsPreviewContainer');
        if (!stepsPreview) return;
        
        const html = testSteps.map((step, index) => {
            const isSelected = this.selectedImportSteps.includes(index);
            return `
                <div class="step-item ${isSelected ? 'selected' : ''}" data-step-index="${index}">
                    <div class="step-item-header" onclick="automationManagement.toggleStepSelection(${index})">
                        <input type="checkbox" class="step-checkbox" ${isSelected ? 'checked' : ''} 
                               onchange="automationManagement.toggleStepSelection(${index})">
                        <div class="step-number">${index + 1}</div>
                        <div class="step-name">${this.escapeHtml(step.step_name || `步骤 ${index + 1}`)}</div>
                        <div class="step-expand-btn" onclick="event.stopPropagation(); automationManagement.toggleStepDetails(${index})">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </div>
                    <div class="step-details">
                        <div class="step-detail-item">
                            <span class="step-detail-label">操作类型</span>
                            <span class="step-detail-value">${this.getOperationTypeText(step.operation_type)}</span>
                        </div>
                        <div class="step-detail-item">
                            <span class="step-detail-label">操作事件</span>
                            <span class="step-detail-value">${this.getOperationEventText(step.operation_event)}</span>
                        </div>
                        <div class="step-detail-item">
                            <span class="step-detail-label">操作参数</span>
                            <span class="step-detail-value">${this.escapeHtml(step.operation_params || '无')}</span>
                        </div>
                        <div class="step-detail-item">
                            <span class="step-detail-label">执行次数</span>
                            <span class="step-detail-value">${step.operation_count || 1} 次</span>
                        </div>
                        <div class="step-detail-item">
                            <span class="step-detail-label">暂停时间</span>
                            <span class="step-detail-value">${step.pause_time || 1} 秒</span>
                        </div>
                        ${step.assertion_enabled === 'yes' ? `
                        <div class="step-detail-item">
                            <span class="step-detail-label">断言设置</span>
                            <span class="step-detail-value">已启用 (${step.assertion_type || 'ui'})</span>
                        </div>
                        ` : ''}
                        ${step.screenshot_enabled === 'yes' ? `
                        <div class="step-detail-item">
                            <span class="step-detail-label">截图设置</span>
                            <span class="step-detail-value">已启用 (${step.screenshot_config?.timing || 'after'})</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        stepsPreview.innerHTML = html;
        
        // 启用控制按钮
        const selectAllBtn = document.getElementById('selectAllStepsBtn');
        const deselectAllBtn = document.getElementById('deselectAllStepsBtn');
        if (selectAllBtn) selectAllBtn.disabled = false;
        if (deselectAllBtn) deselectAllBtn.disabled = false;
        
        // 更新选择计数
        this.updateSelectedStepsCount();
    }
    
    // 初始化导入搜索功能
    initImportSearch() {
        const searchInput = document.getElementById('projectSearchInput');
        if (!searchInput) return;
        
        // 添加输入事件监听（实时搜索）
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            this.filterImportProjects(searchTerm);
        });
        
        // 添加Enter键支持
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.performSearch();
            }
        });
    }
    
    // 执行搜索
    performSearch() {
        const searchInput = document.getElementById('projectSearchInput');
        if (!searchInput) return;
        
        const searchTerm = searchInput.value.toLowerCase().trim();
        this.filterImportProjects(searchTerm);
    }
    
    // 过滤导入项目 - 层级关联的智能搜索
    filterImportProjects(searchTerm) {
        if (!searchTerm) {
            // 如果搜索词为空，显示所有内容
            this.showAllImportContent();
            return;
        }
        
        // 执行层级关联搜索
        this.performHierarchicalSearch(searchTerm);
    }
    
    // 显示所有导入内容
    showAllImportContent() {
        const productGroups = document.querySelectorAll('.product-group');
        const projectItems = document.querySelectorAll('.project-item');
        const stepItems = document.querySelectorAll('.step-item');
        
        productGroups.forEach(item => item.style.display = 'block');
        projectItems.forEach(item => item.style.display = 'flex');
        stepItems.forEach(item => item.style.display = 'block');
        
        // 隐藏无结果提示
        this.hideNoResultsMessage();
    }
    
    // 执行层级关联搜索
    performHierarchicalSearch(searchTerm) {
        const searchTermLower = searchTerm.toLowerCase();
        
        // 收集所有匹配的元素
        const matchedProducts = new Set();
        const matchedProjects = new Set();
        const matchedSteps = new Set();
        
        // 1. 首先搜索项目案例（中间层级）- 这是最重要的匹配
        const projectItems = document.querySelectorAll('.project-item');
        projectItems.forEach(item => {
            const projectName = item.querySelector('.project-item-name')?.textContent.toLowerCase() || '';
            const projectMeta = item.querySelector('.project-item-meta')?.textContent.toLowerCase() || '';
            
            if (this.fuzzyMatch(projectName, searchTermLower) || this.fuzzyMatch(projectMeta, searchTermLower)) {
                matchedProjects.add(item);
                // 找到对应的产品组
                const productGroup = this.findParentProductGroup();
                if (productGroup) {
                    matchedProducts.add(productGroup);
                }
            }
        });
        
        // 2. 搜索测试步骤（最下层级）
        const stepItems = document.querySelectorAll('.step-item');
        stepItems.forEach(item => {
            const stepName = item.querySelector('.step-name')?.textContent.toLowerCase() || '';
            const stepType = item.querySelector('.step-type')?.textContent.toLowerCase() || '';
            const stepEvent = item.querySelector('.step-event')?.textContent.toLowerCase() || '';
            const stepDetails = item.querySelector('.step-details')?.textContent.toLowerCase() || '';
            
            if (this.fuzzyMatch(stepName, searchTermLower) || 
                this.fuzzyMatch(stepType, searchTermLower) || 
                this.fuzzyMatch(stepEvent, searchTermLower) || 
                this.fuzzyMatch(stepDetails, searchTermLower)) {
                matchedSteps.add(item);
                // 找到对应的项目案例和产品组
                const parentInfo = this.findCurrentSelection();
                if (parentInfo.project) {
                    matchedProjects.add(parentInfo.project);
                }
                if (parentInfo.product) {
                    matchedProducts.add(parentInfo.product);
                }
            }
        });
        
        // 3. 搜索产品组（最上层级）
        const productGroups = document.querySelectorAll('.product-group-header');
        productGroups.forEach(item => {
            const productName = item.querySelector('.product-name')?.textContent.toLowerCase() || '';
            const productMeta = item.querySelector('.product-meta')?.textContent.toLowerCase() || '';
            
            if (this.fuzzyMatch(productName, searchTermLower) || this.fuzzyMatch(productMeta, searchTermLower)) {
                const productGroup = item.closest('.product-group');
                if (productGroup) {
                    matchedProducts.add(productGroup);
                }
                
                // 如果匹配的是产品组，需要检查该组下是否有匹配的项目
                // 但不自动显示所有项目，而是等用户选择产品组后再显示
            }
        });
        
        // 4. 应用过滤结果
        this.applyHierarchicalSearchResults(matchedProducts, matchedProjects, matchedSteps);
    }
    
    // 查找当前选中的产品组
    findParentProductGroup() {
        const selectedProductHeader = document.querySelector('.product-group-header.selected');
        if (selectedProductHeader) {
            return selectedProductHeader.closest('.product-group');
        }
        return null;
    }
    
    // 查找当前选中状态
    findCurrentSelection() {
        const selectedProject = document.querySelector('.project-item.selected');
        const selectedProductGroup = this.findParentProductGroup();
        
        return {
            project: selectedProject,
            product: selectedProductGroup
        };
    }
    
    // 应用层级搜索结果
    applyHierarchicalSearchResults(matchedProducts, matchedProjects, matchedSteps) {
        // 过滤产品组
        const allProductGroups = document.querySelectorAll('.product-group');
        allProductGroups.forEach(item => {
            if (matchedProducts.has(item)) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
        
        // 过滤项目案例
        const allProjects = document.querySelectorAll('.project-item');
        allProjects.forEach(item => {
            if (matchedProjects.has(item)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
        
        // 过滤测试步骤
        const allSteps = document.querySelectorAll('.step-item');
        allSteps.forEach(item => {
            if (matchedSteps.has(item)) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
        
        // 智能自动选择逻辑
        if (matchedProducts.size === 1 && matchedProjects.size > 0) {
            // 如果只匹配到一个产品且有项目匹配，自动选择该产品
            const matchedProduct = Array.from(matchedProducts)[0];
            const productHeader = matchedProduct.querySelector('.product-group-header');
            if (productHeader) {
                const productId = productHeader.getAttribute('data-product-id');
                const productName = productHeader.querySelector('.product-name')?.textContent;
                if (productId && productName) {
                    // 延迟执行选择，确保DOM更新完成
                    setTimeout(() => {
                        this.selectImportProduct(productName, productId);
                    }, 100);
                }
            }
        }
        
        // 如果没有匹配结果，显示提示
        if (matchedProducts.size === 0 && matchedProjects.size === 0 && matchedSteps.size === 0) {
            this.showNoResultsMessage();
        } else {
            this.hideNoResultsMessage();
        }
    }
    
    // 显示无结果提示
    showNoResultsMessage() {
        let noResultsDiv = document.querySelector('.no-search-results');
        if (!noResultsDiv) {
            noResultsDiv = document.createElement('div');
            noResultsDiv.className = 'no-search-results';
            noResultsDiv.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #666;">
                    <i class="fas fa-search" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
                    <div style="font-size: 16px;">没有找到匹配的结果</div>
                    <div style="font-size: 14px; margin-top: 8px;">请尝试其他搜索关键词</div>
                </div>
            `;
            
            const importContent = document.querySelector('.import-steps-content');
            if (importContent) {
                importContent.appendChild(noResultsDiv);
            }
        }
        noResultsDiv.style.display = 'block';
    }
    
    // 隐藏无结果提示
    hideNoResultsMessage() {
        const noResultsDiv = document.querySelector('.no-search-results');
        if (noResultsDiv) {
            noResultsDiv.style.display = 'none';
        }
    }
    
    // 模糊匹配函数
    // 注意：构造函数已在类开头定义。这里应该添加与模糊匹配相关的方法实现，而不是再次定义 constructor。

    // 页面销毁时的清理
    destroy() {
        // 停止状态轮询
        this.stopStatusPolling();
        
        // 清理事件监听器
        const automationForm = document.getElementById('automationForm');
        if (automationForm && this.handleFormSubmit) {
            automationForm.removeEventListener('submit', this.handleFormSubmit);
        }
        
        // 清理多选框事件监听器
        const input = document.getElementById('productIdsInput');
        if (input && this.multiselectClickHandler) {
            input.removeEventListener('click', this.multiselectClickHandler);
        }
        
        if (this.documentClickHandler) {
            document.removeEventListener('click', this.documentClickHandler);
        }
        
        // 清理图片缓存
        this.clearImageCache();
        
        // 重置状态
        this.projects = []; // 确保是数组
        this.products = [];
        this.expandedProjects.clear();
        this.currentEditingProject = null;
        this.testSteps = [];
        this.selectedProducts = [];
        this.uploadedImages.clear();
        this.runningProjects.clear();
        this.isProcessing = false;
        this.lastEditTime = 0;
        this.stepCounter = 1;
        
        // 重置枚举值
        this.enumValues = {
            system_type: [],
            product_type: [],
            environment: []
        };
        
        console.log('自动化管理页面已销毁，状态轮询已停止');
    }

    // 渲染自动化管理页面
    async render() {
        const contentArea = document.getElementById('content-area');
        
        const automationHtml = `
            <div class="automation-management">
                <div class="page-header">
                    <h1 class="page-title">
                        <i class="fas fa-robot"></i>
                        自动化管理
                    </h1>
                    <div class="header-actions">
                        <div class="view-toggle">
                            <button class="btn btn-outline-secondary ${this.showGroupedView ? 'active' : ''}" 
                                    onclick="automationManagement.toggleView('grouped')" 
                                    title="分组视图">
                                <i class="fas fa-layer-group"></i>
                                分组视图
                            </button>
                            <button class="btn btn-outline-secondary ${!this.showGroupedView ? 'active' : ''}" 
                                    onclick="automationManagement.toggleView('list')" 
                                    title="列表视图">
                                <i class="fas fa-list"></i>
                                列表视图
                            </button>
                        </div>
                        <div class="grouping-method-selector" id="grouping-method-container" 
                             style="display: ${this.showGroupedView ? 'flex' : 'none'};">
                            <label for="grouping-method-select" class="grouping-label">
                                <i class="fas fa-layer-group"></i>
                                分组方式：
                            </label>
                            <select id="grouping-method-select" class="grouping-select" 
                                    onchange="automationManagement.changeGroupingMethod(this.value)">
                                ${this.availableGroupingMethods.map(method => 
                                    `<option value="${method.value}" ${method.value === this.groupingMethod ? 'selected' : ''}>
                                        ${method.label}
                                    </option>`
                                ).join('')}
                            </select>
                        </div>
                        <button class="btn btn-primary" onclick="automationManagement.openAddProjectModal()" 
                                id="header-add-project-btn">
                            <i class="fas fa-plus"></i>
                            添加自动化项目
                        </button>
                    </div>
                </div>
                
                <div class="automation-list" id="automation-list">
                    <!-- 自动化项目列表 -->
                </div>
                <div class="pagination-container" id="pagination-container">
                    <!-- 分页控件 -->
                </div>
            </div>
        `;
        
        contentArea.innerHTML = automationHtml;
        
        // 设置头部添加按钮和分组方式选择器的初始显示状态
        const headerAddBtn = document.getElementById('header-add-project-btn');
        const groupingMethodContainer = document.getElementById('grouping-method-container');
        
        if (headerAddBtn) {
            if (this.showGroupedView) {
                headerAddBtn.style.display = 'none';
            } else {
                headerAddBtn.style.display = 'flex';
            }
        }
        
        if (groupingMethodContainer) {
            groupingMethodContainer.style.display = this.showGroupedView ? 'flex' : 'none';
        }
        
        // 添加页面加载动画
        this.addPageLoadAnimations();
        
        // 加载分组项目列表（默认视图）
        await this.loadGroupedProjectsByMethod();
        this.renderGroupedProjects();
        
        // 设置事件监听器
        this.setupEventListeners();
    }

    // 添加页面加载动画
    addPageLoadAnimations() {
        const elements = [
            { selector: '.page-header', delay: 0 },
            { selector: '.automation-list', delay: 200 },
            { selector: '.pagination-container', delay: 400 }
        ];

        elements.forEach(({ selector, delay }) => {
            const element = document.querySelector(selector);
            if (element) {
                element.style.opacity = '0';
                element.style.transform = 'translateY(20px)';
                
                setTimeout(() => {
                    element.style.transition = 'all 0.6s ease-out';
                    element.style.opacity = '1';
                    element.style.transform = 'translateY(0)';
                }, delay);
            }
        });
    }

    // 绑定事件
    bindEvents() {
        // 产品ID多选事件 - 使用多选容器
        this.initProductMultiSelect();
        
        // 自动化表单提交事件 - 先移除之前的事件监听器，再添加新的
        const automationForm = document.getElementById('automationForm');
        if (automationForm) {
            // 移除之前的事件监听器
            if (this.handleFormSubmit) {
                automationForm.removeEventListener('submit', this.handleFormSubmit);
            }
            
            this.handleFormSubmit = (e) => {
                e.preventDefault();
                this.saveProject();
            };
            automationForm.addEventListener('submit', this.handleFormSubmit);
        }
    }

    // 绑定展开按钮事件
    bindExpandButtonEvents() {
        const expandButtons = document.querySelectorAll('.expand-btn');
        console.log('找到展开按钮数量:', expandButtons.length);
        
        expandButtons.forEach((button, index) => {
            // 移除之前的事件监听器（如果有的话）
            if (button._clickHandler) {
                button.removeEventListener('click', button._clickHandler);
                delete button._clickHandler;
            }
            
            // 创建新的事件处理函数
            button._clickHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                const projectId = parseInt(event.currentTarget.getAttribute('data-project-id'));
                console.log('展开按钮被点击，项目ID:', projectId);
                
                if (projectId) {
                    this.toggleExpand(projectId);
                } else {
                    console.error('无法获取项目ID，按钮:', event.currentTarget);
                }
            };
            
            // 添加新的事件监听器
            button.addEventListener('click', button._clickHandler);
        });
    }

    // 绑定项目展开按钮事件（分组视图下）
    bindProjectExpandButtonEvents() {
        const expandButtons = document.querySelectorAll('.automation-card .expand-btn');
        console.log('找到项目展开按钮数量:', expandButtons.length);
        
        expandButtons.forEach((button, index) => {
            this.bindSingleExpandButtonEvents(button, index);
        });
    }
            
    // 为单个展开按钮绑定事件
    bindSingleExpandButtonEvents(button, index = 0) {
            // 移除之前的事件监听器（如果有的话）
            if (button._clickHandler) {
                button.removeEventListener('click', button._clickHandler);
                delete button._clickHandler;
            }
            
            // 创建新的事件处理函数
            button._clickHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                const projectId = parseInt(event.currentTarget.getAttribute('data-project-id'));
            console.log('项目展开按钮被点击，项目ID:', projectId);
                
                if (projectId) {
                    this.toggleExpand(projectId);
                }
            };
            
            // 添加新的事件监听器
            button.addEventListener('click', button._clickHandler);
    }

    // 产品选择变化事件
    onProductSelectionChange() {
        if (this.selectedProducts.length === 0) {
            this.resetProductAddressDisplay();
            return;
        }

        // 获取选中产品的信息
        const selectedProducts = this.selectedProducts.map(uniqueId => {
            const index = uniqueId.split('_')[1];
            return this.products[index];
        }).filter(Boolean);
        
        if (selectedProducts.length === 0) {
            this.resetProductAddressDisplay();
            return;
        }

        // 检查是否来自同一系统
        const systems = [...new Set(selectedProducts.map(p => p.system_type))];
        if (systems.length > 1) {
            showToast('选择的产品必须来自同一系统', 'error');
            // 重置选择
            this.selectedProducts = [];
            this.updateSelectedProducts();
            this.resetProductAddressDisplay();
            return;
        }

        // 统一显示详细的产品地址信息（无论选择几个产品）
        if (selectedProducts.length > 0) {
            this.showMultiProductAddresses(selectedProducts);
        }

        // 自动填充其他字段
        if (selectedProducts.length > 0) {
            const firstProduct = selectedProducts[0];
            const systemField = document.getElementById('automationSystem');
            const productTypeField = document.getElementById('automationProductType');
            const environmentField = document.getElementById('automationEnvironment');
            
            if (systemField) systemField.value = firstProduct.system_type || '';
            if (productTypeField) productTypeField.value = firstProduct.product_type || '';
            if (environmentField) environmentField.value = firstProduct.environment || '';
        }
    }

    // 重置产品地址显示
    resetProductAddressDisplay() {
        const singleInput = document.getElementById('automationProductAddress');
        const multiContainer = document.getElementById('multiProductAddresses');
        const addressListContainer = document.getElementById('addressListContainer');
        
        singleInput.style.display = 'none';
        singleInput.value = '';
        // 移除required属性，避免隐藏字段的表单验证问题
        singleInput.removeAttribute('required');
        multiContainer.style.display = 'none';
        addressListContainer.style.display = 'none';
        addressListContainer.classList.remove('show');
    }

    // 显示单个产品地址
    showSingleProductAddress(product) {
        const singleInput = document.getElementById('automationProductAddress');
        const multiContainer = document.getElementById('multiProductAddresses');
        
        singleInput.style.display = 'block';
        singleInput.value = product.product_address || '';
        multiContainer.style.display = 'none';
        
        // 添加地址输入框的事件监听器，当用户修改时更新本地产品数据
        singleInput.onchange = (e) => {
            if (this.selectedProducts.length === 1) {
                const firstUniqueId = this.selectedProducts[0];
                const index = parseInt(firstUniqueId.split('_')[1]);
                const selectedProduct = this.products[index];
                if (selectedProduct) {
                    selectedProduct.product_address = e.target.value;
                }
            }
        };
    }

    // 显示多个产品地址
    showMultiProductAddresses(products) {
        const singleInput = document.getElementById('automationProductAddress');
        const multiContainer = document.getElementById('multiProductAddresses');
        const addressListContainer = document.getElementById('addressListContainer');
        const selectedProductCount = document.getElementById('selectedProductCount');
        
        singleInput.style.display = 'none';
        multiContainer.style.display = 'block';
        addressListContainer.style.display = 'block';
        addressListContainer.classList.add('show');
        
        // 去重处理：如果产品有display_name（表示是多地址情况），则不去重；否则按产品ID去重
        const uniqueProducts = [];
        const seenProductIds = new Set();
        
        for (const product of products) {
            // 如果产品有display_name，说明是多地址情况，每个地址都应该单独显示
            if (product.display_name) {
                uniqueProducts.push(product);
            } else {
                // 正常的去重逻辑
                const productKey = `${product.product_id}_${product.product_name}_${product.environment}`;
                if (!seenProductIds.has(productKey)) {
                    seenProductIds.add(productKey);
                    uniqueProducts.push(product);
                }
            }
        }
        
        selectedProductCount.textContent = uniqueProducts.length;
        
        // 生成地址列表HTML - 展开所有地址
        const addressListHtml = uniqueProducts.map((product, index) => {
            // 通过产品ID和索引找到对应的uniqueId
            const uniqueId = this.selectedProducts.find(id => {
                const productIndex = parseInt(id.split('_')[1]);
                return this.products[productIndex] && this.products[productIndex].product_id === product.product_id;
            });
            
            // 解析产品地址（可能是JSON字符串数组或单个字符串）
            let productAddresses = [];
            
            // 如果产品有display_name，说明已经是处理过的单个地址
            if (product.display_name) {
                productAddresses = [product.product_address || ''];
            } else {
                try {
                    if (product.product_address) {
                        if (typeof product.product_address === 'string' && product.product_address.startsWith('[')) {
                            // 如果是JSON数组字符串，解析为数组
                            const addresses = JSON.parse(product.product_address);
                            productAddresses = Array.isArray(addresses) ? addresses : [product.product_address];
                        } else {
                            // 如果是普通字符串，作为单个地址
                            productAddresses = [product.product_address];
                        }
                    }
                } catch (e) {
                    console.warn('解析产品地址失败:', product.product_address, e);
                    productAddresses = product.product_address ? [product.product_address] : [''];
                }
                
                // 确保至少有一个地址项
                if (productAddresses.length === 0) {
                    productAddresses = [''];
                }
            }
            
            console.log('处理产品:', product.product_id);
            console.log('解析后的地址数组:', productAddresses);
            
            // 构建产品详细信息
            const productName = product.display_name || product.product_name || '未命名产品';
            const productType = product.product_type || '未知类型';
            const environment = product.environment || '未知环境';
            
            // 为每个地址生成一个地址项
            return productAddresses.map((address, addressIndex) => {
                const addressUniqueId = `${uniqueId}_addr_${addressIndex}`;
                
                const addressStatus = this.validateAddress(address);
                const statusClass = addressStatus.valid ? 'valid' : addressStatus.warning ? 'warning' : 'invalid';
                const statusText = addressStatus.valid ? '有效' : addressStatus.warning ? '警告' : '无效';
                const statusIcon = addressStatus.valid ? 'fa-check' : addressStatus.warning ? 'fa-exclamation-triangle' : 'fa-times';
            
            return `
                    <div class="product-address-item" data-product-id="${addressUniqueId}">
                    <div class="product-info">
                        <div class="product-id">${product.product_id}</div>
                        <div class="product-name">${productName}</div>
                        <div class="product-details">
                            <span class="product-system">${product.system_type}</span>
                            <span class="product-type">${productType}</span>
                            <span class="product-env">${environment}</span>
                        </div>
                    </div>
                    <div class="address-input-group">
                        <div class="address-label">产品地址</div>
                        <input type="url" 
                               class="address-input" 
                                   value="${address.replace(/"/g, '&quot;')}" 
                               placeholder="请输入产品地址"
                                   onchange="automationManagement.updateProductAddress('${addressUniqueId}', this.value)">
                        <div class="address-status ${statusClass}">
                            <i class="fas ${statusIcon}"></i>
                            <span>${statusText}</span>
                        </div>
                    </div>
                    <div class="address-actions">
                            <button type="button" class="address-action-btn primary" onclick="automationManagement.testAddress('${addressUniqueId}')">
                            <i class="fas fa-external-link-alt"></i>
                            测试
                        </button>
                            <button type="button" class="address-action-btn" onclick="automationManagement.copyAddress('${addressUniqueId}')">
                            <i class="fas fa-copy"></i>
                            复制
                        </button>
                    </div>
                </div>
            `;
            }).join('');
        }).join('');
        
        addressListContainer.innerHTML = addressListHtml;
        
        // 为每个产品项添加延迟动画
        const productItems = addressListContainer.querySelectorAll('.product-address-item');
        productItems.forEach((item, index) => {
            item.style.animationDelay = `${index * 0.1}s`;
        });

        // 设置实时地址验证（使用setTimeout确保DOM已更新）
        setTimeout(() => {
        this.setupRealTimeValidation();
        }, 0);
    }

    // 验证地址
    validateAddress(address) {
        if (!address || address.trim() === '') {
            return { valid: false, warning: false, message: '地址为空' };
        }
        
        // 简单的URL验证
        const urlPattern = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
        if (!urlPattern.test(address)) {
            return { valid: false, warning: false, message: '地址格式无效' };
        }
        
        // 检查是否是本地地址
        if (address.includes('localhost') || address.includes('127.0.0.1')) {
            return { valid: true, warning: true, message: '本地地址' };
        }
        
        return { valid: true, warning: false, message: '地址有效' };
    }

    // 更新产品地址
    updateProductAddress(uniqueId, newAddress) {
        // 重新验证地址
        const addressItem = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (addressItem) {
            const addressStatus = this.validateAddress(newAddress);
            const statusElement = addressItem.querySelector('.address-status');
            const statusIcon = statusElement.querySelector('i');
            const statusText = statusElement.querySelector('span');
            
            // 添加验证动画
            if (addressStatus.valid && !addressStatus.warning) {
                this.showValidationSuccess(uniqueId);
            } else if (!addressStatus.valid) {
                this.showValidationError(uniqueId);
            }
            
            statusElement.className = `address-status ${addressStatus.valid ? 'valid' : addressStatus.warning ? 'warning' : 'invalid'}`;
            statusIcon.className = `fas ${addressStatus.valid ? 'fa-check' : addressStatus.warning ? 'fa-exclamation-triangle' : 'fa-times'}`;
            statusText.textContent = addressStatus.valid ? '有效' : addressStatus.warning ? '警告' : '无效';
        }
    }

    // 显示验证成功动画
    showValidationSuccess(uniqueId) {
        const item = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (item) {
            item.style.animation = 'validationSuccess 0.6s ease-out';
            setTimeout(() => {
                item.style.animation = '';
            }, 600);
        }
    }

    // 显示验证错误动画
    showValidationError(uniqueId) {
        const item = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (item) {
            item.style.animation = 'validationError 0.6s ease-out';
            setTimeout(() => {
                item.style.animation = '';
            }, 600);
        }
    }

    // 显示成功状态动画
    showSuccessAnimation(element) {
        if (element) {
            element.classList.add('success-animation');
            setTimeout(() => {
                element.classList.remove('success-animation');
            }, 600);
        }
    }

    // 显示错误状态动画
    showErrorAnimation(element) {
        if (element) {
            element.classList.add('error-animation');
            setTimeout(() => {
                element.classList.remove('error-animation');
            }, 600);
        }
    }

    // 添加加载状态
    addLoadingState(element) {
        if (element) {
            element.classList.add('loading');
        }
    }

    // 移除加载状态
    removeLoadingState(element) {
        if (element) {
            element.classList.remove('loading');
        }
    }

    // 防抖函数
    debounce(func, wait) {
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

    // 实时地址验证（带防抖）
    setupRealTimeValidation() {
        // 只查找addressListContainer内的地址输入框，避免干扰其他区域的输入框
        const addressListContainer = document.getElementById('addressListContainer');
        if (!addressListContainer) {
            console.warn('setupRealTimeValidation: 找不到addressListContainer');
            return;
        }
        const addressInputs = addressListContainer.querySelectorAll('.address-input');
        console.log('setupRealTimeValidation: 找到地址输入框数量:', addressInputs.length);
        addressInputs.forEach((input, idx) => {
            const productItem = input.closest('.product-address-item');
            console.log(`输入框 ${idx}:`, {
                input: input,
                productItem: productItem,
                dataset: productItem?.dataset,
                productId: productItem?.dataset?.productId
            });
            if (!productItem || !productItem.dataset || !productItem.dataset.productId) {
                console.warn('无法找到产品ID，跳过该输入框');
                return;
            }
            const uniqueId = productItem.dataset.productId; // 这里实际存储的是uniqueId
            
            // 验证uniqueId格式
            if (!uniqueId || !uniqueId.includes('_')) {
                console.warn('uniqueId格式无效，跳过该输入框', { uniqueId });
                return;
            }
            
            const index = parseInt(uniqueId.split('_')[1]);
            if (isNaN(index)) {
                console.warn('无法解析索引，跳过该输入框', { uniqueId, index });
                return;
            }
            
            const debouncedValidation = this.debounce((value) => {
                this.updateProductAddress(uniqueId, value);
            }, 500);

            input.addEventListener('input', (e) => {
                debouncedValidation(e.target.value);
            });

            input.addEventListener('blur', (e) => {
                this.updateProductAddress(uniqueId, e.target.value);
            });
        });
    }

    // 解析产品地址（处理JSON数组格式和普通字符串）
    parseProductAddress(addressData) {
        if (!addressData) return '';
        
        try {
            if (typeof addressData === 'string' && addressData.startsWith('[')) {
                // 如果是JSON数组字符串，解析并取第一个地址
                const addresses = JSON.parse(addressData);
                return Array.isArray(addresses) && addresses.length > 0 ? addresses[0] : '';
            } else {
                // 如果是普通字符串，直接使用
                return addressData;
            }
        } catch (e) {
            console.warn('解析产品地址失败:', addressData, e);
            return addressData || '';
        }
    }

    // 测试地址
    testAddress(uniqueId) {
        // 从地址输入框直接获取地址
        const addressItem = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (!addressItem) {
            showToast('找不到对应的地址项', 'warning');
            return;
        }
        
        const addressInput = addressItem.querySelector('.address-input');
        const address = addressInput ? addressInput.value.trim() : '';
        
        if (!address) {
            showToast('请先输入有效的产品地址', 'warning');
            return;
        }
        
        // 在新窗口打开地址
        window.open(address, '_blank');
        showToast(`正在测试地址: ${address}`, 'info');
    }

    // 复制地址
    copyAddress(uniqueId) {
        // 从地址输入框直接获取地址
        const addressItem = document.querySelector(`[data-product-id="${uniqueId}"]`);
        if (!addressItem) {
            showToast('找不到对应的地址项', 'warning');
            return;
        }
        
        const addressInput = addressItem.querySelector('.address-input');
        const address = addressInput ? addressInput.value.trim() : '';
        
        if (!address) {
            showToast('没有可复制的地址', 'warning');
            return;
        }
        
        navigator.clipboard.writeText(address).then(() => {
            showToast('地址已复制到剪贴板', 'success');
        }).catch(() => {
            showToast('复制失败，请手动复制', 'error');
        });
    }

    // 切换地址列表显示
    toggleAddressList() {
        const container = document.getElementById('addressListContainer');
        const button = document.querySelector('#multiProductAddresses .btn');
        const icon = button.querySelector('i');
        
        // 防止动画过程中重复点击
        if (container.dataset.animating === 'true') {
            return;
        }
        
        // 添加按钮点击动画效果
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = 'scale(1)';
        }, 150);
        
        if (!container.classList.contains('show')) {
            // 展开动画
            container.dataset.animating = 'true';
            container.style.display = 'block';
            
            // 强制重绘
            container.offsetHeight;
            
            // 添加展开动画类
            container.classList.add('show');
            
            // 图标旋转动画
            icon.style.transition = 'transform 0.3s ease';
            icon.style.transform = 'rotate(180deg)';
            icon.className = 'fas fa-chevron-up';
            button.innerHTML = '<i class="fas fa-chevron-up"></i> 收起地址详情';
            
            // 动画完成后重置状态
            const handleExpandEnd = () => {
                container.dataset.animating = 'false';
                icon.style.transition = '';
                icon.style.transform = '';
                container.removeEventListener('transitionend', handleExpandEnd);
            };
            container.addEventListener('transitionend', handleExpandEnd);
        } else {
            // 收起动画
            container.dataset.animating = 'true';
            
            // 图标旋转动画
            icon.style.transition = 'transform 0.3s ease';
            icon.style.transform = 'rotate(0deg)';
            
            const handleAnimationEnd = () => {
                if (!container.classList.contains('show')) {
                    container.style.display = 'none';
                }
                container.dataset.animating = 'false';
                icon.style.transition = '';
                icon.style.transform = '';
                container.removeEventListener('transitionend', handleAnimationEnd);
            };
            
            container.addEventListener('transitionend', handleAnimationEnd);
            container.classList.remove('show');
            icon.className = 'fas fa-chevron-down';
            button.innerHTML = '<i class="fas fa-chevron-down"></i> 查看地址详情';
        }
    }

    // 加载自动化项目列表
    async loadProjects(page = 1, pageSize = null) {
        try {
            showLoading(document.getElementById('automation-list'));
            
            // 使用传入的pageSize或当前设置的pageSize
            const size = pageSize || this.pageSize;
            
            // 添加时间戳避免缓存
            const timestamp = new Date().getTime();
            const response = await fetch(`/api/automation/projects?page=${page}&page_size=${size}&_t=${timestamp}`);
            const result = await response.json();
            
            if (result.success) {
                // 确保 projects 始终是数组
                const projectsData = result.data.projects || result.data;
                this.projects = Array.isArray(projectsData) ? projectsData : [];
                
                console.log('加载项目数据完成，项目数量:', this.projects.length);
                console.log('projects 类型:', typeof this.projects);
                console.log('projects 是否为数组:', Array.isArray(this.projects));
                
                // 更新分页信息
                if (result.data.pagination) {
                    this.currentPage = result.data.pagination.page;
                    this.pageSize = result.data.pagination.page_size;
                    this.totalPages = result.data.pagination.total_pages;
                    this.totalItems = result.data.pagination.total_count;
                } else {
                    // 如果没有分页信息，计算基本分页
                    this.currentPage = page;
                    this.pageSize = size;
                    this.totalItems = this.projects.length;
                    this.totalPages = Math.ceil(this.totalItems / this.pageSize);
                }
                
                // 更新运行中的项目集合
                this.runningProjects.clear();
                this.projects.forEach(project => {
                    if (project.status === 'running') {
                        this.runningProjects.add(project.id);

                    }
                });
                
                // 如果有运行中的项目，启动状态轮询
                if (this.runningProjects.size > 0) {
                    this.startStatusPolling();
                    console.log('页面加载时启动状态轮询，运行中项目数量:', this.runningProjects.size);
                } else {
                    this.stopStatusPolling();
                }
                
                // 根据当前视图模式渲染对应的视图
                if (this.showGroupedView) {
                    console.log('loadProjects: 渲染分组视图');
                    await this.renderGroupedProjects();
                } else {
                    console.log('loadProjects: 渲染列表视图');
                this.renderProjectsList();
                }
                this.renderPagination();
            } else {
                showToast(result.message || '加载项目失败', 'error');
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
            }
        } catch (error) {
            console.error('加载项目失败:', error);
            showToast('网络错误，请重试', 'error');
            // 设置totalItems为0并隐藏分页控制条
            this.totalItems = 0;
            this.renderPagination();
        }
    }

    // 加载产品列表
    async loadProducts() {
        try {
            const response = await fetch('/api/automation/products');
            const result = await response.json();
            
            if (result.success) {
                this.products = result.data;
                this.updateProductOptions();
            }
        } catch (error) {
            console.error('加载产品列表失败:', error);
        }
    }

    // 加载分组自动化项目列表（原方法，保持兼容性）
    async loadGroupedProjects() {
        return await this.loadGroupedProjectsByMethod();
    }

    // 根据分组方式加载分组自动化项目列表
    async loadGroupedProjectsByMethod() {
        try {
            // 如果是按产品包名分组，使用原来的API
            if (this.groupingMethod === 'product_package_name' || this.groupingMethod === 'version_number') {
            // 添加时间戳避免缓存
            const timestamp = new Date().getTime();
            const response = await fetch(`/api/automation/projects/grouped?group_by=${this.groupingMethod}&_t=${timestamp}`);
            const result = await response.json();
            
            if (result.success) {
                this.groupedProjects = result.data || [];
                console.log('加载分组项目数据完成，分组数量:', this.groupedProjects.length);
                console.log('分组数据:', this.groupedProjects);
                
                // 验证分组数据
                let totalProjects = 0;
                this.groupedProjects.forEach(group => {
                    totalProjects += group.projects.length;
                    console.log(`分组 ${group.product_name}: ${group.projects.length} 个项目`);
                });
                console.log('总项目数量:', totalProjects);
                
                // 如果总项目数为0，也尝试构造空分组作为兜底
                if (totalProjects === 0 && this.groupedProjects.length === 0) {
                    console.log('产品包名分组返回空结果，使用产品表构造空分组');
                    this.groupedProjects = await this.createEmptyGroupsFromProducts();
                }
            } else {
                console.error('加载分组项目失败:', result.message);
                // 失败时也尝试构造空分组
                this.groupedProjects = await this.createEmptyGroupsFromProducts();
                }
            } else {
                // 对于其他分组方式，先加载所有项目然后在前端分组
                await this.loadAllProjectsAndGroup();
            }
        } catch (error) {
            console.error('加载分组项目失败:', error);
            // 异常时也尝试构造空分组
            this.groupedProjects = await this.createEmptyGroupsFromProducts();
        }
    }

    // 加载所有项目并按指定方式分组
    async loadAllProjectsAndGroup() {
        try {
            // 加载所有项目（不分页）
            const timestamp = new Date().getTime();
            const response = await fetch(`/api/automation/projects?page=1&page_size=1000&_t=${timestamp}`);
            const result = await response.json();
            
            if (result.success) {
                const allProjects = result.data.projects || result.data || [];
                console.log('allProjects的值是: allProjects:', allProjects);
                console.log('加载所有项目完成，项目数量:', allProjects.length);
                
                // 始终基于产品表创建完整分组，然后将项目分配到对应分组中
                console.log('基于产品表创建完整分组，然后分配项目');
                this.groupedProjects = await this.createEmptyGroupsFromProducts();
                console.log(`从产品表创建完整分组，分组数量:`, this.groupedProjects.length);
                
                // 将项目分配到对应的分组中
                if (allProjects.length > 0) {
                    this.assignProjectsToGroups(allProjects, this.groupingMethod);
                    console.log(`项目分配完成，实际有项目的分组数量:`, this.groupedProjects.filter(g => g.projects.length > 0).length);
                }
            } else {
                console.error('加载项目失败:', result.message);
                // 失败时也尝试构造空分组
                this.groupedProjects = await this.createEmptyGroupsFromProducts();
            }
        } catch (error) {
            console.error('加载项目失败:', error);
            // 异常时也尝试构造空分组
            this.groupedProjects = await this.createEmptyGroupsFromProducts();
        }
    }

    // 将项目分配到已创建的分组中
    assignProjectsToGroups(projects, method) {
        // 特殊处理：按地址分组时，支持字符串/数组/对象三种形式，并做URL归一化
        if (method === 'product_address') {
            const extractAddresses = (value) => {
                if (!value) return [];
                let list = [];
                if (typeof value === 'string') {
                    const trimmed = value.trim();
                    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (Array.isArray(parsed)) {
                                list = parsed;
                            } else if (parsed && typeof parsed === 'object') {
                                list = Object.values(parsed);
                            } else {
                                list = [value];
                            }
                        } catch (e) {
                            list = [value];
                        }
                    } else {
                        list = [value];
                    }
                } else if (Array.isArray(value)) {
                    list = value;
                } else if (value && typeof value === 'object') {
                    try {
                        list = Object.values(value);
                    } catch (e) {
                        list = [];
                    }
                }
                return list.filter(Boolean);
            };
            const normalize = (u) => (typeof u === 'string' ? u.replace(/\/+$/, '').toLowerCase() : '');
            projects.forEach(project => {
                const targetAddresses = extractAddresses(project.product_address);
                const normalizedTargets = new Set(targetAddresses.map(normalize));
                const toHost = (u) => {
                    if (!u || typeof u !== 'string') return '';
                    try {
                        return new URL(u).hostname.replace(/^www\./i, '');
                    } catch (e) {
                        return u.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
                    }
                };
                const targetHosts = new Set(Array.from(normalizedTargets).map(toHost).filter(Boolean));
                let matched = false;
                // 第一轮：完整URL归一化精确匹配
                for (const group of this.groupedProjects) {
                    const groupCandidates = [
                        ...extractAddresses(group.product_address || group.product_name || ''),
                        ...(Array.isArray(group.address_aliases) ? group.address_aliases : [])
                    ];
                    for (const ga of groupCandidates) {
                        if (normalizedTargets.has(normalize(ga))) {
                            group.projects.push(project);
                            matched = true;
                            break;
                        }
                    }
                    if (matched) break;
                }
                // 第二轮：按域名匹配（忽略协议、www等差异）
                if (!matched && targetHosts.size > 0) {
                    for (const group of this.groupedProjects) {
                        const groupCandidates = [
                            ...extractAddresses(group.product_address || group.product_name || ''),
                            ...(Array.isArray(group.address_aliases) ? group.address_aliases : [])
                        ];
                        for (const ga of groupCandidates) {
                            if (targetHosts.has(toHost(ga))) {
                                group.projects.push(project);
                                matched = true;
                                break;
                            }
                        }
                        if (matched) break;
                    }
                }
                if (!matched) {
                    console.warn(`未找到项目 ${project.process_name} 的匹配分组，分组方式: ${method}, 目标地址: ${JSON.stringify(targetAddresses)}`);
                }
            });
            return;
        }
        projects.forEach(project => {
            // 根据分组方式确定项目应该属于哪个分组
            let targetGroupKey = '';
            
            switch (method) {
                case 'product_id':
                    // 处理产品ID列表（可能是数组）
                    const productIds = Array.isArray(project.product_ids) ? project.product_ids : 
                                     (typeof project.product_ids === 'string' ? (project.product_ids ? JSON.parse(project.product_ids) : []) : (project.product_ids || []));
                    targetGroupKey = productIds.length > 0 ? productIds[0] : ''; // 取第一个产品ID
                    break;
                    
                case 'product_address':
                    targetGroupKey = project.product_address || '';
                    break;
                    
                case 'system':
                    targetGroupKey = project.system || '';
                    break;
                    
                case 'product_type':
                    targetGroupKey = project.product_type || '';
                    break;
                    
                case 'environment':
                    targetGroupKey = project.environment || '';
                    break;
                    
                case 'version_number':
                    targetGroupKey = project.version_number || '';
                    break;
                    
                case 'product_package_name':
                default:
                    // 按产品包名分组
                    const packageNames = Array.isArray(project.product_package_names) ? project.product_package_names :
                                       (typeof project.product_package_names === 'string' ? (project.product_package_names ? JSON.parse(project.product_package_names) : []) : (project.product_package_names || []));
                    targetGroupKey = packageNames.length > 0 ? packageNames[0] : ''; // 取第一个包名
                    break;
            }
            
            // 查找匹配的分组
            let targetGroup = null;
            for (const group of this.groupedProjects) {
                let groupMatches = false;
                
                switch (method) {
                    case 'product_id':
                        groupMatches = group.product_id === targetGroupKey;
                        break;
                    case 'product_address':
                        groupMatches = group.product_address === targetGroupKey;
                        break;
                    case 'system':
                        groupMatches = group.system_type === targetGroupKey;
                        break;
                    case 'product_type':
                        groupMatches = group.product_type === targetGroupKey;
                        break;
                    case 'environment':
                        groupMatches = group.environment === targetGroupKey;
                        break;
                    case 'version_number':
                        groupMatches = group.version_number === targetGroupKey;
                        break;
                    case 'product_package_name':
                    default:
                        // 对于产品包名分组，检查group.product_name是否包含目标包名
                        groupMatches = group.product_name && group.product_name.includes(targetGroupKey);
                        break;
                }
                
                if (groupMatches) {
                    targetGroup = group;
                    break;
                }
            }
            
            // 如果找到匹配的分组，将项目添加到该分组
            if (targetGroup) {
                targetGroup.projects.push(project);
            } else {
                console.warn(`未找到项目 ${project.process_name} 的匹配分组，分组方式: ${method}, 目标键: ${targetGroupKey}`);
            }
        });
    }

    // 基于产品表创建空分组（当自动化项目列表为空时的兜底方案）
    async createEmptyGroupsFromProducts() {
        try {
            // 如果产品列表还没有加载，先加载
            if (!this.products || this.products.length === 0) {
                await this.loadProducts();
            }
            console.log('createEmptyGroupsFromProducts: this.products:', this.products);
            const groups = {};
            const extractAddresses = (value) => {
                if (!value) return [];
                let list = [];
                if (typeof value === 'string') {
                    const trimmed = value.trim();
                    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                        try {
                            const parsed = JSON.parse(trimmed);
                            if (Array.isArray(parsed)) {
                                list = parsed;
                            } else if (parsed && typeof parsed === 'object') {
                                list = Object.values(parsed);
                            } else {
                                list = [value];
                            }
                        } catch (e) {
                            list = [value];
                        }
                    } else {
                        list = [value];
                    }
                } else if (Array.isArray(value)) {
                    list = value;
                } else if (value && typeof value === 'object') {
                    try {
                        list = Object.values(value);
                    } catch (e) {
                        list = [];
                    }
                }
                return list.filter(Boolean);
            };
            const normalize = (u) => (typeof u === 'string' ? u.replace(/\/+$/, '').toLowerCase() : '');
            
            // 根据当前分组方式从产品表创建空分组
            this.products.forEach(product => {
                let groupKey = '';
                let groupName = '';
                console.log('product的值是: product:', product);
                switch (this.groupingMethod) {
                    case 'product_id':
                        groupKey = product.product_id || '未设置产品ID';
                        groupName = groupKey;
                        break;
                        
                    case 'product_address':
                        {
                            const addresses = extractAddresses(product.product_address);
                            const canonical = addresses.length > 0 ? addresses[0] : '未设置地址';
                            const normalizedKey = normalize(canonical) || '未设置地址';
                            groupKey = normalizedKey;
                            groupName = canonical;
                        }
                        break;
                        
                    case 'system':
                        groupKey = product.system_type || '未设置系统';
                        groupName = groupKey;
                        break;
                        
                    case 'product_type':
                        groupKey = product.product_type || '未设置类型';
                        groupName = groupKey;
                        break;
                        
                    case 'environment':
                        groupKey = product.environment || '未设置环境';
                        groupName = groupKey;
                        break;
                        
                    case 'version_number':
                        groupKey = product.version_number || '未设置版本号';
                        groupName = groupKey;
                        break;
                        
                    case 'product_package_name':
                        groupKey = `${product.product_package_name || '未设置包名'}#${product.product_id || ''}`;
                        groupName = `${product.product_package_name || '未设置包名'} (产品ID: ${product.product_id || '未设置'})`;
                        break;
                        
                    default:
                        // 默认按产品包名分组
                        groupKey = `${product.product_package_name || '未设置包名'}#${product.product_id || ''}`;
                        groupName = `${product.product_package_name || '未设置包名'} (产品ID: ${product.product_id || '未设置'})`;
                        break;
                }
                
                if (!groups[groupKey]) {
                    groups[groupKey] = {
                        product_id: product.product_id || '',
                        product_name: groupName,
                        original_product_name: product.product_name || '', // 保存原始产品名称
                        system_type: product.system_type || '未知',
                        product_type: product.product_type || '未知',
                        environment: product.environment || '未知',
                        version_number: product.version_number || '未知',
                        product_address: (this.groupingMethod === 'product_address' ? groupName : (product.product_address || '')), // 规范化后的主地址
                        address_aliases: (this.groupingMethod === 'product_address' ? Array.from(new Set(extractAddresses(product.product_address))) : undefined),
                        projects: [], // 空项目列表
                        // 为按地址分组保存所有相关产品信息
                        all_products: [product] // 保存该分组下的所有产品
                    };
                } else {
                    // 如果分组已存在，添加产品到all_products数组中
                    if (!groups[groupKey].all_products) {
                        groups[groupKey].all_products = [];
                    }
                    groups[groupKey].all_products.push(product);
                    // 在地址分组下，合并地址别名
                    if (this.groupingMethod === 'product_address') {
                        const aliases = extractAddresses(product.product_address);
                        const existing = Array.isArray(groups[groupKey].address_aliases) ? groups[groupKey].address_aliases : [];
                        const merged = Array.from(new Set([...existing, ...aliases]));
                        groups[groupKey].address_aliases = merged;
                    }
                }
            });
            
            // 转换为数组格式并排序
            const result = Object.values(groups).sort((a, b) => a.product_name.localeCompare(b.product_name));
            console.log(`从产品表创建了 ${result.length} 个空分组:`, result.map(g => g.product_name));
            console.log('当前的result数据为: result:', result);
            return result;
            
        } catch (error) {
            console.error('创建空分组失败:', error);
            return [];
        }
    }

    // 改变分组方式
    async changeGroupingMethod(newMethod) {
        console.log('改变分组方式:', this.groupingMethod, '->', newMethod);
        
        if (this.groupingMethod === newMethod) {
            return; // 没有变化，直接返回
        }
        
        this.groupingMethod = newMethod;
        
        // 如果当前是分组视图，重新加载和渲染数据
        if (this.showGroupedView) {
            // 显示加载状态
            const container = document.getElementById('automation-list');
            if (container) {
                container.innerHTML = `
                    <div class="loading-state">
                        <i class="fas fa-spinner fa-spin"></i>
                        <p>正在按${this.availableGroupingMethods.find(m => m.value === newMethod)?.label}重新分组...</p>
                    </div>
                `;
            }
            
            try {
                await this.loadGroupedProjectsByMethod();
                this.renderGroupedProjects();
                this.renderPagination();
            } catch (error) {
                console.error('重新分组失败:', error);
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <i class="fas fa-exclamation-triangle"></i>
                            <h3>分组失败</h3>
                            <p>重新分组时发生错误，请刷新页面重试</p>
                        </div>
                    `;
                }
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
            }
        }
    }

    // 切换视图模式
    async toggleView(viewType) {
        this.showGroupedView = viewType === 'grouped';
        
        // 更新按钮状态
        const groupedBtn = document.querySelector('.view-toggle .btn:nth-child(1)');
        const listBtn = document.querySelector('.view-toggle .btn:nth-child(2)');
        
        if (groupedBtn && listBtn) {
            groupedBtn.classList.toggle('active', this.showGroupedView);
            listBtn.classList.toggle('active', !this.showGroupedView);
        }
        
        // 控制分组方式选择器的显示
        const groupingMethodContainer = document.getElementById('grouping-method-container');
        if (groupingMethodContainer) {
            groupingMethodContainer.style.display = this.showGroupedView ? 'flex' : 'none';
        }
        
        // 控制头部添加按钮的显示
        const headerAddBtn = document.getElementById('header-add-project-btn');
        if (headerAddBtn) {
            if (this.showGroupedView) {
                headerAddBtn.style.display = 'none';
            } else {
                headerAddBtn.style.display = 'flex';
            }
        }
        
        // 根据视图类型加载数据和渲染
        if (this.showGroupedView) {
            await this.loadGroupedProjectsByMethod();
            this.renderGroupedProjects();
            this.renderPagination(); // 为分组视图添加分页控件
        } else {
            await this.loadProjects();
            this.renderProjectsList();
            this.renderPagination();
        }
    }

    // 渲染分组项目列表
    async renderGroupedProjects() {
        try {
            const container = document.getElementById('automation-list');
            if (!container) {
                console.error('找不到自动化列表容器');
                return;
            }

            // 显示加载状态
            container.innerHTML = `
                <div class="loading-state">
                    <i class="fas fa-spinner"></i>
                    <p>正在加载分组数据...</p>
                </div>
            `;

            // 重新加载分组数据
            await this.loadGroupedProjects();

            // 检查数据
            if (!Array.isArray(this.groupedProjects)) {
                console.error('renderGroupedProjects: this.groupedProjects 不是数组，当前类型:', typeof this.groupedProjects);
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>数据加载错误</h3>
                        <p>分组数据格式错误，请刷新页面重试</p>
                    </div>
                `;
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
                return;
            }
            
            if (this.groupedProjects.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-robot"></i>
                        <h3>暂无自动化项目</h3>
                        <p>点击"添加自动化项目"按钮创建您的第一个自动化项目</p>
                    </div>
                `;
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
                return;
            }

            // 计算分页数据
            this.calculatePaginationData();
            
            // 应用分页逻辑 - 只显示当前页的分组
            const startIndex = (this.currentPage - 1) * this.pageSize;
            const endIndex = Math.min(startIndex + this.pageSize, this.groupedProjects.length);
            const currentPageGroups = this.groupedProjects.slice(startIndex, endIndex);
            
            console.log(`分组视图分页: 显示第 ${startIndex + 1}-${endIndex} 个分组，共 ${this.groupedProjects.length} 个分组`);

            let html = '';
            currentPageGroups.forEach(group => {
                try {
                    // 生成唯一的分组ID来检查展开状态
                    const uniqueGroupId = `${group.product_id}_${group.product_name}_${group.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const isExpanded = this.expandedGroups.has(uniqueGroupId);
                    console.log(`渲染分组 ${group.product_id} (${uniqueGroupId}), 展开状态: ${isExpanded}`);
                    html += this.renderProductGroup(group, isExpanded);
                } catch (groupError) {
                    console.error(`渲染分组 ${group.product_id} 失败:`, groupError);
                    html += `
                        <div class="product-group error" data-product-id="${group.product_id}">
                            <div class="group-header">
                                <div class="group-info">
                                    <div class="group-title">
                                        <i class="fas fa-exclamation-triangle"></i>
                                        <span>${group.product_name || '未知产品'}</span>
                                    </div>
                                    <div class="group-meta">
                                        <span class="meta-item error">渲染失败</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            });

            // 使用requestAnimationFrame确保DOM更新稳定
            return new Promise((resolve, reject) => {
                requestAnimationFrame(() => {
                    try {
                        container.innerHTML = html;
                        
                        // 绑定分组展开按钮事件
                        this.bindGroupExpandButtonEvents();
                        
                        // 绑定分组添加项目按钮事件
                        this.bindGroupAddProjectButtonEvents();
                        
                        // 绑定分组批量执行按钮事件
                        console.log('🚀 准备绑定分组批量执行按钮事件...');
                        this.bindGroupBatchExecuteButtonEvents();
                        console.log('✅ 分组批量执行按钮事件绑定调用完成');
                        
                        // 绑定项目展开按钮事件（分组视图下）
                        this.bindProjectExpandButtonEvents();
                        
                        // 为已展开的分组重新加载执行记录
                        for (const groupId of this.expandedGroups) {
                            // groupId here is uniqueGroupId; resolve to productId
                            const group = this.groupedProjects.find(g => `${g.product_id}_${g.product_name}_${g.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_') === groupId);
                            if (group) {
                                this.loadRecentExecutionsForGroup(group.product_id, groupId);
                            }
                        }
                        
                        // 渲染分页控件
                        this.renderPagination();
                        
                        resolve();
                    } catch (renderError) {
                        console.error('DOM更新失败:', renderError);
                        reject(renderError);
                    }
                });
            });
        } catch (error) {
            console.error('renderGroupedProjects error:', error);
            this.showErrorMessage('渲染分组项目失败，请重试');
            throw error;
        }
    }

    // 渲染产品分组
    renderProductGroup(group, isExpanded = false) {
        try {
            // 验证分组数据
            if (!group || !group.product_id) {
                console.error('无效的分组数据:', group);
                throw new Error('无效的分组数据');
            }
            
            if (!Array.isArray(group.projects)) {
                console.error('分组项目数据无效:', group.projects);
                group.projects = [];
            }
            
            const projectCount = group.projects.length;
            const expandedClass = isExpanded ? 'expanded' : '';
            
            // 安全地获取分组信息
            const productName = group.product_name || '未知产品';
            const systemType = group.system_type || '未知系统';
            const productType = group.product_type || '未知类型';
            const environment = group.environment || '未知环境';
            const product_id = group.product_id || '未知产品ID';
            const version_number = group.version_number || '未知版本号';
            
            // 创建唯一的分组标识符
            const uniqueGroupId = `${group.product_id}_${productName}_${environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            
            let projectsHtml = '';
            if (isExpanded && group.projects.length > 0) {
                try {
                    projectsHtml = group.projects.map(project => {
                        try {
                            return this.renderProjectCard(project, this.expandedProjects.has(project.id));
                        } catch (projectError) {
                            console.error(`渲染项目 ${project.id} 失败:`, projectError);
                            return `
                                <div class="automation-card error">
                                    <div class="card-content">
                                        <h3>项目渲染失败</h3>
                                        <p>项目ID: ${project.id || '未知'}</p>
                                    </div>
                                </div>
                            `;
                        }
                    }).join('');
                } catch (mapError) {
                    console.error('渲染项目列表失败:', mapError);
                    projectsHtml = '<div class="automation-card error"><p>项目列表渲染失败</p></div>';
                }
            }
            
            return `
                <div class="product-group ${expandedClass}" data-product-id="${group.product_id}" data-unique-group-id="${uniqueGroupId}">
                    <div class="group-header-container ${expandedClass}">
                        <div class="group-header" data-product-id="${group.product_id}" data-unique-group-id="${uniqueGroupId}">
                        <div class="group-info">
                            <div class="group-title">
                                <i class="fas fa-box"></i>
                                <span>${productName}</span>
                            </div>
                            <div class="group-meta">
                                <span class="meta-item">
                                    <i class="fas fa-list"></i>
                                    ${projectCount}个项目
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-desktop"></i>
                                    ${systemType}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-tag"></i>
                                    ${productType}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-globe"></i>
                                    ${environment}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-tag"></i>
                                    ${product_id}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-code-branch"></i>
                                    ${version_number}
                                </span>
                            </div>
                            </div>
                        </div>
                        <div class="group-header-actions">
                            <button class="btn btn-sm btn-success group-batch-execute-btn" 
                                    data-product-id="${group.product_id}"
                                    data-unique-group-id="${uniqueGroupId}"
                                    title="一键执行${productName}下所有项目测试">
                                <i class="fas fa-play-circle"></i>
                                <span>一键执行测试</span>
                            </button>
                            <button class="btn btn-sm btn-primary group-add-project-btn" 
                                    data-product-id="${group.product_id}"
                                    data-product-name="${group.original_product_name || productName}"
                                    data-system-type="${systemType}"
                                    data-product-type="${productType}"
                                    data-environment="${environment}"
                                    data-product-address="${group.product_address || ''}"
                                    data-version-number="${version_number}"
                                    title="添加${productName}项目">
                                <i class="fas fa-plus"></i>
                                <span>添加项目</span>
                            </button>
                        </div>
                    </div>
                    <div class="group-projects ${expandedClass}">
                        ${projectsHtml}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('renderProductGroup error:', error);
            // 返回错误状态的分组
            return `
                <div class="product-group error" data-product-id="${group?.product_id || 'unknown'}">
                    <div class="group-header">
                        <div class="group-info">
                            <div class="group-title">
                                <i class="fas fa-exclamation-triangle"></i>
                                <span>渲染失败</span>
                            </div>
                            <div class="group-meta">
                                <span class="meta-item error">数据错误</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // 更新产品选项
    updateProductOptions() {
        const dropdown = document.getElementById('productIdsDropdown');
        if (dropdown) {
            this.populateDropdownOptions(dropdown);
            this.updateCheckboxes();
        }

        // 兼容旧版<select id="product_ids">（若存在）
        const productSelect = document.getElementById('product_ids');
        if (productSelect) {
            productSelect.innerHTML = '';
            this.products.forEach(product => {
                const option = document.createElement('option');
                option.value = product.product_id;
                option.textContent = `${product.product_id} - ${product.product_name} (${product.system_type || ''})`;
                productSelect.appendChild(option);
            });
        }
    }

    // 渲染项目列表
    renderProjectsList() {
        try {
            const container = document.getElementById('automation-list');
            if (!container) {
                console.error('找不到自动化列表容器');
                return;
            }
            
            // 显示加载状态
            container.innerHTML = `
                <div class="loading-state">
                    <i class="fas fa-spinner"></i>
                    <p>正在加载项目数据...</p>
                </div>
            `;
            
            // 确保 projects 是数组
            if (!Array.isArray(this.projects)) {
                console.error('renderProjectsList: this.projects 不是数组，当前类型:', typeof this.projects);
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>数据加载错误</h3>
                        <p>项目数据格式错误，请刷新页面重试</p>
                    </div>
                `;
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
                return;
            }
            
            if (this.projects.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-robot"></i>
                        <h3>暂无自动化项目</h3>
                        <p>点击"添加自动化项目"按钮创建您的第一个自动化项目</p>
                    </div>
                `;
                // 设置totalItems为0并隐藏分页控制条
                this.totalItems = 0;
                this.renderPagination();
                return;
            }

            let html = '';
            this.projects.forEach(project => {
                const isExpanded = this.expandedProjects.has(project.id);
                html += this.renderProjectCard(project, isExpanded);
            });

            // 使用requestAnimationFrame确保DOM更新稳定
            requestAnimationFrame(() => {
                container.innerHTML = html;
                
                // 绑定展开按钮事件
                this.bindExpandButtonEvents();
                
                // 为已展开的项目重新加载执行记录
                for (const projectId of this.expandedProjects) {
                    this.loadRecentExecutions(projectId);
                }
            });
        } catch (error) {
            console.error('renderProjectsList error:', error);
            this.showErrorMessage('渲染项目列表失败，请重试');
        }
    }

    // 渲染单个项目卡片
    renderProjectCard(project, isExpanded = false) {
        const isRunning = project.last_status === 'running';
        // 如果项目正在运行，显示running状态，否则显示最后执行状态
        const displayStatus = isRunning ? 'running' : (project.last_status || 'pending');
        const statusClass = this.getStatusClass(displayStatus);
        const statusText = this.getStatusText(displayStatus, null);

        return `
            <div class="automation-card" data-project-id="${project.id}">
                <div class="automation-header">
                    <div class="automation-info">
                        <button class="expand-btn ${isExpanded ? 'expanded' : ''}" 
                                data-project-id="${project.id}">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                        <div class="automation-details">
                            <h3 class="automation-name">${project.process_name}</h3>
                            <div class="automation-meta">
                                <span class="meta-item">
                                    <i class="fas fa-cube"></i>
                                    ${(Array.isArray(project.product_ids) ? project.product_ids : []).join(', ')}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-desktop"></i>
                                    ${project.system}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-tag"></i>
                                    ${project.product_type}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-globe"></i>
                                    ${project.environment}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-tag"></i>
                                    ${project.version_number}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="automation-actions">
                        <button class="btn btn-info btn-sm" onclick="automationManagement.testConnection(${project.id})" 
                                title="测试连接">
                            <i class="fas fa-plug"></i>
                            测试连接
                        </button>
                        <button class="btn ${isRunning ? 'btn-warning btn-cancel-test spinning' : 'btn-success btn-execute-test'} btn-sm" 
                                onclick="automationManagement.${isRunning ? 'cancelTest' : 'executeTest'}(${project.id})"
                                title="${isRunning ? '取消测试' : '执行测试'}"
                                id="test-btn-${project.id}">
                            <i class="fas ${isRunning ? 'fa-spinner fa-spin' : 'fa-play'}"></i>
                            <span class="btn-text">${isRunning ? '取消测试' : '执行测试'}</span>
                        </button>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                        <button class="btn btn-secondary btn-sm" onclick="console.log('编辑按钮被点击，项目ID:', ${project.id}); console.log('automationManagement 对象:', automationManagement); automationManagement.editProject(${project.id})"
                                title="编辑">
                            <i class="fas fa-edit"></i>
                            编辑
                        </button>
                        <button class="btn btn-info btn-sm" onclick="automationManagement.openCodeManagement(${project.id})"
                                title="代码管理">
                            <i class="fas fa-code"></i>
                            代码管理
                        </button>
                        <button class="btn btn-info btn-sm" onclick="automationManagement.showExecutionHistory(${project.id})"
                                title="测试日志">
                            <i class="fas fa-history"></i>
                            测试日志
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="automationManagement.deleteProject(${project.id})"
                                title="删除项目" style="background: #e53e3e; color: white;">
                            <i class="fas fa-trash"></i>
                            删除
                        </button>
                    </div>
                </div>
                ${isExpanded ? this.renderExpandedContent(project) : ''}
            </div>
        `;
    }

    // 渲染展开的内容
    renderExpandedContent(project) {
        // 这里可以展示执行记录
        return `
            <div class="automation-expanded">
                <div class="execution-records">
                    <h4>最近执行记录</h4>
                    <div id="recent-executions-${project.id}">
                        <div class="loading-text">加载中...</div>
                    </div>
                </div>
            </div>
        `;
    }

    // 获取状态样式类
    getStatusClass(status) {
        const statusMap = {
            'pending': 'status-pending',
            'running': 'status-running',
            'passed': 'status-success',
            'failed': 'status-error',
            'cancelled': 'status-warning'
        };
        return statusMap[status] || 'status-pending';
    }

    	// 获取状态文本
	getStatusText(status, cancelType = null) {
		// 优先根据取消类型显示更精确的文案
		if (cancelType === 'errors') {
			return '测试运行异常';
		}
		if (status === 'cancelled') {
			return '人工取消';
		}
		
		const statusMap = {
			'pending': '待执行',
			'running': '执行中',
			'passed': '测试通过',
			'failed': '测试不通过'
		};
		return statusMap[status] || '未知状态';
	}

    // 切换展开状态
    async toggleExpand(projectId) {
        try {
            console.log('toggleExpand called with projectId:', projectId);
            console.log('Current expandedProjects:', Array.from(this.expandedProjects));
            console.log('Current view mode - showGroupedView:', this.showGroupedView);
            
            // 防止重复操作
            if (this.isProcessing) {
                console.log('操作正在进行中，请稍候...');
                return;
            }
            
            this.isProcessing = true;
            
            // 在展开项目前，先获取最新的项目状态以确保状态同步
            if (!this.expandedProjects.has(projectId)) {
                console.log('展开项目前刷新状态，确保显示最新状态');
                await this.refreshSingleProjectStatus(projectId);
            }
            
            // 根据当前视图模式检查数据
            if (this.showGroupedView) {
                // 分组视图下，检查 groupedProjects
                console.log('In grouped view, checking groupedProjects...');
                console.log('groupedProjects type:', typeof this.groupedProjects);
                console.log('groupedProjects isArray:', Array.isArray(this.groupedProjects));
                console.log('groupedProjects length:', this.groupedProjects?.length);
                
                if (!Array.isArray(this.groupedProjects)) {
                    console.error('this.groupedProjects 不是数组，当前类型:', typeof this.groupedProjects);
                    console.log('尝试重新加载分组项目数据...');
                    await this.loadGroupedProjects();
                    
                    // 重新检查
                    if (!Array.isArray(this.groupedProjects)) {
                        console.error('无法加载分组项目数据，groupedProjects 仍然不是数组');
                        this.isProcessing = false;
                        return;
                    }
                }
            } else {
                // 列表视图下，检查 projects
                console.log('In list view, checking projects...');
                if (!Array.isArray(this.projects)) {
                    console.error('this.projects 不是数组，当前类型:', typeof this.projects);
                    console.log('尝试重新加载项目数据...');
                    await this.loadProjects();
                    
                    // 重新检查
                    if (!Array.isArray(this.projects)) {
                        console.error('无法加载项目数据，projects 仍然不是数组');
                        this.isProcessing = false;
                        return;
                    }
                }
            }
            
            if (this.expandedProjects.has(projectId)) {
                console.log('Collapsing project:', projectId);
                this.expandedProjects.delete(projectId);
                
                // 根据当前视图模式选择渲染函数
                console.log('About to render after collapsing...');
                if (this.showGroupedView) {
                    console.log('Calling renderGroupedProjects...');
                    await this.renderGroupedProjects();
                } else {
                    console.log('Calling renderProjectsList...');
                    this.renderProjectsList();
                }
            } else {
                console.log('Expanding project:', projectId);
                this.expandedProjects.add(projectId);
                
                // 根据当前视图模式选择渲染函数
                console.log('About to render after expanding...');
                if (this.showGroupedView) {
                    console.log('In grouped view, updating specific project...');
                    this.updateProjectInGroupedView(projectId);
                } else {
                    console.log('Calling renderProjectsList...');
                    this.renderProjectsList();
                }
                
                // 然后加载执行记录
                await this.loadRecentExecutions(projectId);
                
                // 加载执行记录后，立即检查状态一致性并同步
                await this.syncProjectStatusAfterExpand(projectId);
            }
            
            console.log('toggleExpand completed');
        } catch (error) {
            console.error('toggleExpand error:', error);
            // 显示错误提示
            this.showErrorMessage('展开/收起操作失败，请重试');
        } finally {
            this.isProcessing = false;
        }
    }

    // 在分组视图中更新特定项目的展开状态
    updateProjectInGroupedView(projectId) {
        try {
            console.log('更新分组视图中的项目:', projectId);
            
            // 查找包含此项目的分组
            let targetGroup = null;
            for (const group of this.groupedProjects) {
                if (group.projects && group.projects.some(p => p.id == projectId)) {
                    targetGroup = group;
                    break;
                }
            }
            
            if (!targetGroup) {
                console.error('找不到包含项目的分组:', projectId);
                return;
            }
            
            console.log('找到目标分组:', targetGroup.product_name);
            
            // 生成唯一的分组ID
            const uniqueGroupId = `${targetGroup.product_id}_${targetGroup.product_name}_${targetGroup.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const isGroupExpanded = this.expandedGroups.has(uniqueGroupId);
            
            console.log('分组展开状态:', isGroupExpanded);
            
            if (!isGroupExpanded) {
                console.log('分组未展开，无需更新项目');
                return;
            }
            
            // 查找分组DOM元素
            const groupElement = document.querySelector(`.product-group[data-unique-group-id="${uniqueGroupId}"]`);
            if (!groupElement) {
                console.error('找不到分组DOM元素:', uniqueGroupId);
                return;
            }
            
            // 重新渲染这个分组
            const newGroupHtml = this.renderProductGroup(targetGroup, true);
            
            // 创建临时容器来解析新HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newGroupHtml;
            const newGroupElement = tempDiv.firstElementChild;
            
            // 替换旧元素
            groupElement.parentNode.replaceChild(newGroupElement, groupElement);
            
            // 重新绑定事件
            this.bindSingleGroupEvents(newGroupElement);
            
            console.log('分组中项目更新完成');
            
        } catch (error) {
            console.error('更新分组视图中的项目失败:', error);
            // 如果出错，回退到重新渲染整个列表
            console.log('回退到重新渲染整个分组列表');
            this.renderGroupedProjects();
        }
    }

    // 绑定单个分组的事件
    bindSingleGroupEvents(groupElement) {
        try {
            // 绑定分组头部点击事件
            const groupHeader = groupElement.querySelector('.group-header');
            if (groupHeader) {
                groupHeader.addEventListener('click', (e) => {
                    e.preventDefault();
                    const uniqueGroupId = e.target.closest('.group-header').dataset.uniqueGroupId;
                    if (uniqueGroupId) {
                        console.log('分组头部点击事件触发');
                        this.toggleGroupExpansion(uniqueGroupId);
                    }
                });
            }

            // 绑定项目展开按钮事件
            const expandBtns = groupElement.querySelectorAll('.expand-btn');
            expandBtns.forEach((btn, index) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const projectId = parseInt(btn.dataset.projectId);
                    console.log(`分组视图下项目展开按钮被点击，项目ID: ${projectId}`);
                    this.toggleExpand(projectId);
                });
            });

            // 绑定分组内的批量执行按钮事件
            const batchExecuteBtn = groupElement.querySelector('.group-batch-execute-btn');
            if (batchExecuteBtn) {
                console.log('🔧 为单个分组绑定批量执行按钮事件...');
                
                // 移除之前的事件监听器，避免重复绑定
                if (batchExecuteBtn._batchExecuteHandler) {
                    batchExecuteBtn.removeEventListener('click', batchExecuteBtn._batchExecuteHandler);
                    delete batchExecuteBtn._batchExecuteHandler;
                }
                
                // 创建新的事件处理函数，保存this上下文
                const self = this;
                batchExecuteBtn._batchExecuteHandler = function(event) {
                    console.log('🚀 单个分组批量执行按钮点击事件触发!');
                    console.log('📍 点击的按钮:', event.currentTarget);
                    
                    event.preventDefault();
                    event.stopPropagation();
                    
                    const productId = batchExecuteBtn.getAttribute('data-product-id');
                    const uniqueGroupId = batchExecuteBtn.getAttribute('data-unique-group-id');
                    
                    console.log('🆔 单个分组批量执行，产品ID:', productId);
                    console.log('🏷️ 单个分组批量执行，唯一分组ID:', uniqueGroupId);
                    
                    if (productId && uniqueGroupId) {
                        console.log('✅ 单个分组数据属性检查通过，开始执行批量测试');
                        self.batchExecuteGroupTests(productId, uniqueGroupId);
                    } else {
                        console.error('❌ 单个分组批量执行按钮缺少必要的数据属性');
                        showToast('按钮配置错误，请刷新页面重试', 'error');
                    }
                };
                
                // 绑定事件
                batchExecuteBtn.addEventListener('click', batchExecuteBtn._batchExecuteHandler);
                console.log('✅ 单个分组批量执行按钮事件绑定完成');
            }

            // 绑定分组内的添加项目按钮事件
            const addProjectBtn = groupElement.querySelector('.group-add-project-btn');
            if (addProjectBtn) {
                // 这里可以添加添加项目按钮的事件绑定，如果需要的话
                // 当前可能已经在其他地方绑定了
            }

            console.log('单个分组事件绑定完成');
        } catch (error) {
            console.error('绑定单个分组事件失败:', error);
        }
    }

    // 加载最近执行记录
    async loadRecentExecutions(projectId, page = 1, pageSize = 5) {
        try {
            const response = await fetch(`/api/automation/projects/${projectId}/executions?page=${page}&page_size=${pageSize}`);
            const result = await response.json();
            
            if (result.success) {
                const container = document.getElementById(`recent-executions-${projectId}`);
                if (container) {
                    if (result.data.length === 0) {
                        container.innerHTML = '<div class="no-data">暂无执行记录</div>';
                    } else {
                        // 生成执行记录HTML
                        const executionsHtml = result.data.map(execution => {
                            const duration = execution.start_time && execution.end_time 
                                ? this.calculateDuration(execution.start_time, execution.end_time)
                                : '计算中...';
                            
                            return `
                            <div class="execution-record" 
                                 data-execution-id="${execution.id}"
                                 onclick="automationManagement.showExecutionLog(${execution.id})"
                                 style="cursor: pointer;">
                                <div class="execution-main-info">
                                    <div class="execution-header">
                                        <span class="execution-process-name">${execution.process_name}</span>
                                        <span class="execution-status ${this.getStatusClass(execution.status)}">${this.getStatusText(execution.status, execution.cancel_type)}</span>
                                    </div>
                                    <div class="execution-details">
                                        <span class="execution-system">${execution.system}</span>
                                        <span class="execution-type">${execution.product_type}</span>
                                        <span class="execution-env">${execution.environment}</span>
                                    </div>
                                </div>
                                <div class="execution-time-info">
                                    <div class="execution-time">开始: ${formatDateTimeUTC(execution.start_time)}</div>
                                    ${execution.end_time ? `<div class="execution-end-time">结束: ${formatDateTimeUTC(execution.end_time)}</div>` : ''}
                                    <div class="execution-duration">耗时: ${duration}</div>
                                </div>
                                <div class="execution-operator">
                                    <span class="user-info">${execution.executed_by || '未知用户'}</span>
                                </div>
                            </div>`;
                        }).join('');
                        
                        // 生成分页控件HTML - 始终显示分页控件
                        const pagination = result.pagination;
                        const startItem = (pagination.page - 1) * pagination.page_size + 1;
                        const endItem = Math.min(pagination.page * pagination.page_size, pagination.total_count);
                        
                        const paginationHtml = `
                            <div class="execution-pagination">
                                <div class="pagination-info">
                                    <span>显示第 ${startItem}-${endItem} 条，共 ${pagination.total_count} 条记录</span>
                                </div>
                                <div class="pagination-controls">
                                    <div class="pagination-size-selector">
                                        <label>每页显示：</label>
                                        <select id="pageSizeSelect-${projectId}" class="form-control" onchange="automationManagement.changePageSize(${projectId}, this.value)">
                                            <option value="5" ${pagination.page_size === 5 ? 'selected' : ''}>5</option>
                                            <option value="10" ${pagination.page_size === 10 ? 'selected' : ''}>10</option>
                                            <option value="20" ${pagination.page_size === 20 ? 'selected' : ''}>20</option>
                                            <option value="50" ${pagination.page_size === 50 ? 'selected' : ''}>50</option>
                                        </select>
                                    </div>
                                    <div class="pagination-buttons">
                                        <button class="btn btn-secondary" onclick="automationManagement.loadRecentExecutions(${projectId}, 1, ${pagination.page_size})" ${pagination.page === 1 ? 'disabled' : ''}>
                                            <i class="fas fa-angle-double-left"></i>
                                        </button>
                                        <button class="btn btn-secondary" onclick="automationManagement.loadRecentExecutions(${projectId}, ${pagination.page - 1}, ${pagination.page_size})" ${!pagination.has_prev ? 'disabled' : ''}>
                                            <i class="fas fa-angle-left"></i>
                                        </button>
                                        <div class="page-numbers">
                                            ${this.generatePageNumbers(projectId, pagination)}
                                        </div>
                                        <button class="btn btn-secondary" onclick="automationManagement.loadRecentExecutions(${projectId}, ${pagination.page + 1}, ${pagination.page_size})" ${!pagination.has_next ? 'disabled' : ''}>
                                            <i class="fas fa-angle-right"></i>
                                        </button>
                                        <button class="btn btn-secondary" onclick="automationManagement.loadRecentExecutions(${projectId}, ${pagination.total_pages}, ${pagination.page_size})" ${pagination.page === pagination.total_pages ? 'disabled' : ''}>
                                            <i class="fas fa-angle-double-right"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                        
                        container.innerHTML = executionsHtml + paginationHtml;
                    }
                }
            }
        } catch (error) {
            console.error('加载执行记录失败:', error);
        }
    }
    
    // 生成页码数字
    generatePageNumbers(projectId, pagination) {
        const { page, total_pages, page_size } = pagination;
        const maxVisiblePages = 5;
        let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(total_pages, startPage + maxVisiblePages - 1);

        // 调整起始页，确保显示足够的页码
        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        let pageNumbersHtml = '';

        // 第一页
        if (startPage > 1) {
            pageNumbersHtml += `<button class="btn btn-secondary page-number" onclick="automationManagement.loadRecentExecutions(${projectId}, 1, ${page_size})">1</button>`;
            if (startPage > 2) {
                pageNumbersHtml += `<span class="page-ellipsis">...</span>`;
            }
        }

        // 中间页码
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === page;
            pageNumbersHtml += `
                <button class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} page-number" onclick="automationManagement.loadRecentExecutions(${projectId}, ${i}, ${page_size})">
                    ${i}
                </button>
            `;
        }

        // 最后一页
        if (endPage < total_pages) {
            if (endPage < total_pages - 1) {
                pageNumbersHtml += `<span class="page-ellipsis">...</span>`;
            }
            pageNumbersHtml += `<button class="btn btn-secondary page-number" onclick="automationManagement.loadRecentExecutions(${projectId}, ${total_pages}, ${page_size})">${total_pages}</button>`;
        }

        return pageNumbersHtml;
    }

    // 计算执行持续时间
    calculateDuration(startTime, endTime) {
        if (!startTime || !endTime) return '未知';
        
        try {
            const start = new Date(startTime);
            const end = new Date(endTime);
            const diffMs = end - start;
            
            if (diffMs < 0) return '未知';
            
            const diffSec = Math.floor(diffMs / 1000);
            const minutes = Math.floor(diffSec / 60);
            const seconds = diffSec % 60;
            
            if (minutes > 0) {
                return `${minutes}分${seconds}秒`;
            } else {
                return `${seconds}秒`;
            }
        } catch (error) {
            return '未知';
        }
    }

    // 打开添加项目弹窗
    async openAddProjectModal() {
        this.currentEditingProject = null;
        this.isEditing = false;
        this.editingTestSteps = null;
        this.editingUploadedImages.clear();
        this.uploadedImages.clear();
        this.testSteps = [];
        this.selectedProducts = [];
        await this.resetForm();
        this.renderTestSteps();
        this.showModal();
    }

    // 为特定分组打开添加项目弹窗
    async openAddProjectModalForGroup(buttonElement) {
        try {
            console.log('为分组打开添加项目弹窗');
            
            // 获取分组信息
            const groupInfo = {
                productId: buttonElement.dataset.productId,
                productName: buttonElement.dataset.productName,
                systemType: buttonElement.dataset.systemType,
                productType: buttonElement.dataset.productType,
                environment: buttonElement.dataset.environment,
                productAddress: buttonElement.dataset.productAddress,
                versionNumber: buttonElement.dataset.versionNumber
            };
            
            console.log('分组信息:', groupInfo);
            
            // 先执行常规的打开弹窗操作
            this.currentEditingProject = null;
            this.isEditing = false;
            this.editingTestSteps = null;
            this.editingUploadedImages.clear();
            this.uploadedImages.clear();
            this.testSteps = [];
            this.selectedProducts = [];
            await this.resetForm();
            this.renderTestSteps();
            
            // 在弹窗显示后预填充分组信息
            this.showModal();
            
            // 等待DOM更新后再预填充
            setTimeout(() => {
                this.prefillGroupInfo(groupInfo);
            }, 100);
            
        } catch (error) {
            console.error('为分组打开添加项目弹窗失败:', error);
            // 如果出错，回退到普通的添加项目弹窗
            this.openAddProjectModal();
        }
    }

    // 预填充分组信息到表单
    prefillGroupInfo(groupInfo) {
        try {
            console.log('开始预填充分组信息:', groupInfo);
            
            // 根据分组方式选择不同的产品匹配逻辑
            let matchingProducts = [];
            
            if (this.groupingMethod === 'product_address') {
                // 按地址分组时，找到相同地址的所有产品
                matchingProducts = this.products.filter(product => 
                    product.product_address === groupInfo.productAddress ||
                    (groupInfo.productAddress && product.product_address === groupInfo.productAddress) ||
                    // 如果没有productAddress，尝试通过其他信息匹配
                    (product.product_id === groupInfo.productId &&
                     product.system_type === groupInfo.systemType &&
                     product.product_type === groupInfo.productType &&
                     product.environment === groupInfo.environment)
                );
            } else {
                // 其他分组方式使用原有的匹配逻辑
                matchingProducts = this.products.filter(product => 
                    product.product_id === groupInfo.productId &&
                    product.product_name === groupInfo.productName &&
                    product.system_type === groupInfo.systemType &&
                    product.product_type === groupInfo.productType &&
                    product.environment === groupInfo.environment
                );
            }
            
            console.log('找到匹配的产品:', matchingProducts);
            
            if (matchingProducts.length > 0) {
                // 对于按地址分组，如果有多个产品，优先选择与当前productName匹配的
                let targetProduct = matchingProducts[0];
                if (this.groupingMethod === 'product_address' && matchingProducts.length > 1) {
                    const nameMatch = matchingProducts.find(p => p.product_name === groupInfo.productName);
                    if (nameMatch) {
                        targetProduct = nameMatch;
                    }
                }
                
                const productIndex = this.products.findIndex(p => 
                    p.product_id === targetProduct.product_id &&
                    p.product_name === targetProduct.product_name &&
                    p.system_type === targetProduct.system_type &&
                    p.product_type === targetProduct.product_type &&
                    p.environment === targetProduct.environment &&
                    p.product_address === targetProduct.product_address
                );
                
                if (productIndex !== -1) {
                    if (this.groupingMethod === 'product_address') {
                        // 为相同地址的所有产品构建选中ID，避免只选一个
                        const selectedIds = matchingProducts.map(mp => {
                            const idx = this.products.findIndex(p => 
                                p.product_id === mp.product_id &&
                                p.product_name === mp.product_name &&
                                p.system_type === mp.system_type &&
                                p.product_type === mp.product_type &&
                                p.environment === mp.environment &&
                                p.product_address === mp.product_address
                            );
                            return idx !== -1 ? `${mp.product_id}_${idx}` : null;
                        }).filter(Boolean);
                        this.selectedProducts = Array.from(new Set(selectedIds));
                        console.log('按地址分组预选的所有产品IDs:', this.selectedProducts);
                    } else {
                        const selectedId = `${targetProduct.product_id}_${productIndex}`;
                        console.log('生成的产品ID:', selectedId);
                        console.log('匹配的产品:', targetProduct);
                        console.log('产品索引:', productIndex);
                        console.log('数组中该索引的产品:', this.products[productIndex]);
                        this.selectedProducts = [selectedId];
                    }
                    
                    // 更新复选框状态
                    this.updateCheckboxes();
                    
                    // 更新产品选择显示
                    this.updateSelectedProducts();
                    
                    // 自动填充其他字段
                    this.autoFillFields();
                    
                    console.log('分组信息预填充完成');
                } else {
                    console.warn('未找到产品索引');
                }
            } else {
                console.warn('未找到匹配的产品');
            }
            
        } catch (error) {
            console.error('预填充分组信息失败:', error);
        }
    }

    // 编辑项目
    async editProject(projectId) {
        try {
            const currentTime = Date.now();
            console.log('编辑项目被调用，项目ID:', projectId);
            console.log('当前处理状态:', this.isProcessing);
            console.log('距离上次编辑时间:', currentTime - this.lastEditTime);
            
            // 防抖：如果正在处理中或距离上次点击时间太短，则忽略
            if (this.isProcessing) {
                console.log('正在处理中，忽略此次点击');
                return;
            }
            
            if (currentTime - this.lastEditTime < 1000) {
                console.log('点击间隔太短，忽略此次点击');
                return;
            }
            
            this.isProcessing = true;
            this.lastEditTime = currentTime;
            
            console.log('所有项目:', this.projects);
            console.log('projects 类型:', typeof this.projects);
            console.log('projects 是否为数组:', Array.isArray(this.projects));
            
            // 确保 projects 是数组
            if (!Array.isArray(this.projects)) {
                console.error('this.projects 不是数组，当前类型:', typeof this.projects);
                console.log('尝试重新加载项目数据...');
                await this.loadProjects();
                
                // 重新检查
                if (!Array.isArray(this.projects)) {
                    throw new Error('无法加载项目数据，projects 仍然不是数组');
                }
            }
            
        const project = this.projects.find(p => p.id === projectId);
            if (!project) {
                console.error('未找到项目:', projectId);
                return;
            }

            console.log('找到项目:', project);
            console.log('项目的product_ids:', project.product_ids);
            console.log('当前所有产品:', this.products);
        this.currentEditingProject = project;
        this.testSteps = Array.isArray(project.test_steps) ? project.test_steps : [];
            
            // 将旧的产品ID转换为新的唯一标识符格式
            if (Array.isArray(project.product_ids)) {
                this.selectedProducts = [];
                
                // 使用 "product_id + product_package_name" 作为复合键，避免同一产品ID的不同包被合并
                const usedIndexes = new Set();
                const hasPackageNames = Array.isArray(project.product_package_names) && project.product_package_names.length === project.product_ids.length;
                const seenCompositeKeys = new Set();
                
                project.product_ids.forEach((productId, idx) => {
                    const targetPackageName = hasPackageNames ? project.product_package_names[idx] : null;
                    const compositeKey = `${productId}__${targetPackageName || ''}`;
                    if (seenCompositeKeys.has(compositeKey)) return; // 跳过完全重复的一对
                    
                    // 候选列表：按 product_id（和可选的包名）过滤
                    let candidates = this.products
                        .map((p, index) => ({ p, index }))
                        .filter(({ p }) => p.product_id === productId);
                    if (targetPackageName) {
                        const nameMatches = candidates.filter(({ p }) => p.product_name === targetPackageName);
                        if (nameMatches.length > 0) {
                            candidates = nameMatches;
                        }
                    }
                    
                    // 次优先：按系统 + 环境筛选
                    if (project.system || project.environment) {
                        const strictMatches = candidates.filter(({ p }) =>
                            (!project.system || p.system_type === project.system) &&
                            (!project.environment || p.environment === project.environment)
                        );
                        if (strictMatches.length > 0) {
                            candidates = strictMatches;
                        }
                    }
                    
                    // 选择一个未使用的候选
                    let chosen = candidates.find(({ index }) => !usedIndexes.has(index));
                    if (!chosen && candidates.length > 0) {
                        chosen = candidates[0];
                    }
                    
                    if (chosen) {
                        usedIndexes.add(chosen.index);
                        seenCompositeKeys.add(compositeKey);
                        const uniqueId = `${chosen.p.product_id}_${chosen.index}`;
                        this.selectedProducts.push(uniqueId);
                        console.log('添加选中产品(按product_id+product_name):', uniqueId);
                    }
                });
            } else {
                this.selectedProducts = [];
            }
            
        this.uploadedImages.clear();

        // 更新标题
        document.getElementById('automation-modal-title').textContent = '编辑自动化项目';
        
        // 填充表单
        document.getElementById('processName').value = project.process_name;
        document.getElementById('automationSystem').value = project.system || '';
        document.getElementById('automationProductType').value = project.product_type || '';
        document.getElementById('automationEnvironment').value = project.environment || '';
        
        // 处理产品地址 - 支持多产品地址
        this.handleProductAddressForEdit(project);
        
        // 加载枚举值并初始化自定义选择框
            console.log('开始加载枚举值...');
        await this.loadEnumValues();
            console.log('枚举值加载完成，初始化选择框...');
        this.initCustomSelects();
        
        // 设置多选产品ID
            console.log('初始化多选框...');
        await this.initProductMultiSelect();
            console.log('更新选中的产品...');
        this.updateSelectedProducts();

        // 渲染测试步骤
            console.log('渲染测试步骤...');
        this.renderTestSteps();
        
            console.log('显示模态框...');
        this.showModal();
            console.log('editProject 方法执行完成');
            
            // 设置一个延迟来重置处理状态
            setTimeout(() => {
                this.isProcessing = false;
                console.log('处理状态已重置');
            }, 2000);
            
        } catch (error) {
            console.error('editProject 方法出错:', error);
            console.error('错误堆栈:', error.stack);
            showToast('编辑项目时出现错误: ' + error.message, 'error');
            this.isProcessing = false;
        }
    }

    // 显示弹窗
    showModal() {
        try {
            console.log('showModal 开始执行...');
        const modal = document.getElementById('automationModal');
            if (!modal) {
                console.error('找不到模态框元素 #automationModal');
                return;
            }
            
            console.log('模态框元素找到，添加 show 类...');
        modal.classList.add('show');
            
            // 强制设置显示样式
            modal.style.display = 'flex';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            
        document.body.style.overflow = 'hidden';
            
            // 表单提交事件已在构造函数中绑定，这里不需要重复绑定
            console.log('模态框显示，表单事件已绑定');
            
            // 确保模态框确实显示了
            setTimeout(() => {
                const isVisible = modal.classList.contains('show');
                const computedStyle = window.getComputedStyle(modal);
                console.log('模态框显示状态检查:', {
                    hasShowClass: isVisible,
                    display: computedStyle.display,
                    opacity: computedStyle.opacity,
                    visibility: computedStyle.visibility,
                    zIndex: computedStyle.zIndex,
                    position: computedStyle.position,
                    inlineDisplay: modal.style.display,
                    classList: Array.from(modal.classList)
                });
                
                // 如果模态框仍然不可见，强制显示
                if (computedStyle.display === 'none') {
                    console.log('模态框仍然隐藏，强制显示...');
                    modal.style.display = 'flex !important';
                    modal.style.visibility = 'visible !important';
                    modal.style.opacity = '1 !important';
                }
            }, 100);
            
            console.log('showModal 执行完成');
        } catch (error) {
            console.error('showModal 出错:', error);
        }
    }

    // 关闭弹窗
    closeModal() {
        console.log('关闭模态框');
        
        // 清理图片缓存
        this.clearImageCache();
        
        const modal = document.getElementById('automationModal');
        if (modal) {
        modal.classList.remove('show');
            modal.style.display = 'none';
        }
        document.body.style.overflow = '';
        
        // 清理编辑状态
        this.clearEditingState();
        
        // 重置表单数据
        const form = document.getElementById('automationForm');
        if (form) {
            form.reset();
        }
        this.testSteps = [];
        this.selectedProducts = [];
        this.resetMultiselect();
        
        // 清理事件监听器
        this.cleanupEventListeners();
        
        // 重置处理状态
        this.isProcessing = false;
        this.lastEditTime = 0;
        
        // 强制刷新当前页面，确保数据是最新的
        this.refreshCurrentPage();
        
        console.log('模态框已关闭，状态已重置，页面已刷新');
    }
    
    // 刷新当前页面
    refreshCurrentPage() {
        console.log('刷新自动化管理页面...');
        console.log('当前视图模式:', this.showGroupedView ? '分组视图' : '列表视图');
        
        // 清除缓存的数据
        this.projects = [];
        this.groupedProjects = [];
        this.totalItems = 0;
        this.totalPages = 0;
        
        // 重新加载项目数据
        this.loadProjects();
        
        // 如果当前有展开的项目，重新加载执行记录
        if (this.expandedProjects.size > 0) {
            this.expandedProjects.forEach(projectId => {
                this.loadRecentExecutions(projectId, 1, 5);
            });
        }
        
        console.log('自动化管理页面刷新完成');
    }

    // ==================== 导入测试步骤功能 ====================
    
    // 打开导入测试步骤弹窗
    async openImportTestStepsModal() {
        try {
            // 显示弹窗
            const modal = document.getElementById('importTestStepsModal');
            if (modal) {
                modal.style.display = 'block';
                modal.classList.add('show');
                document.body.style.overflow = 'hidden';
            }
            
            // 加载产品分组
            await this.loadProductGroupsForImport();
            
            // 初始化搜索功能
            this.initImportSearch();
            
        } catch (error) {
            console.error('打开导入弹窗失败:', error);
            showToast('打开导入弹窗失败', 'error');
        }
    }
    
    // 关闭导入测试步骤弹窗
    closeImportTestStepsModal() {
        const modal = document.getElementById('importTestStepsModal');
        if (modal) {
            modal.classList.remove('show');
            modal.style.display = 'none';
        }
        document.body.style.overflow = '';
        
        // 清理状态
        this.selectedImportProduct = null;
        this.selectedImportProject = null;
        this.selectedImportSteps = [];
        
        // 重置UI
        const productsList = document.getElementById('productsList');
        const projectsList = document.getElementById('projectsList');
        const stepsPreview = document.getElementById('stepsPreviewContainer');
        const importBtn = document.getElementById('importStepsBtn');
        const selectedCount = document.getElementById('selectedStepsCount');
        const selectAllBtn = document.getElementById('selectAllStepsBtn');
        const deselectAllBtn = document.getElementById('deselectAllStepsBtn');
        
        if (productsList) productsList.innerHTML = '';
        if (projectsList) {
            projectsList.innerHTML = `
                <div class="no-selection">
                    <i class="fas fa-cube" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                    <p>请先选择一个产品包名</p>
                </div>
            `;
        }
        if (stepsPreview) {
            stepsPreview.innerHTML = `
                <div class="no-selection">
                    <i class="fas fa-list-ol" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                    <p>请先选择一个测试案例</p>
                </div>
            `;
        }
        if (importBtn) importBtn.disabled = true;
        if (selectedCount) selectedCount.textContent = '已选择 0 个步骤';
        if (selectAllBtn) selectAllBtn.disabled = true;
        if (deselectAllBtn) deselectAllBtn.disabled = true;
    }
    
    // 加载产品分组用于导入
    async loadProductGroupsForImport() {
        try {
            const productsList = document.getElementById('productsList');
            if (!productsList) return;
            
            // 显示加载状态
            productsList.innerHTML = `
                <div class="loading-placeholder">
                    <i class="fas fa-spinner"></i>
                    <p>正在加载产品列表...</p>
                </div>
            `;
            
            // 获取产品分组数据
            const response = await fetch('/api/automation/projects/grouped');
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || '获取产品分组失败');
            }
            
            const productGroups = result.data || [];
            
            if (productGroups.length === 0) {
                productsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-folder-open" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                        <p>暂无可用的产品</p>
                    </div>
                `;
                return;
            }
            
            // 渲染产品分组列表
            this.renderProductGroupsList(productGroups);
            
        } catch (error) {
            console.error('加载产品分组失败:', error);
            const productsList = document.getElementById('productsList');
            if (productsList) {
                productsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem; color: #e53e3e;"></i>
                        <p>加载产品列表失败</p>
                    </div>
                `;
            }
            showToast('加载产品列表失败', 'error');
        }
    }
    
    // 渲染产品分组列表
    renderProductGroupsList(productGroups) {
        const productsList = document.getElementById('productsList');
        if (!productsList) return;
        
        const html = productGroups.map(group => {
            const projectsCount = group.projects ? group.projects.length : 0;
            return `
                <div class="product-group">
                    <div class="product-group-header" data-product-id="${group.product_id}" data-product-name="${this.escapeHtml(group.product_name)}" 
                         onclick="automationManagement.selectImportProduct('${this.escapeJsString(group.product_name)}', '${this.escapeJsString(group.product_id)}')">
                        <div class="product-group-info">
                            <div class="product-name">${this.escapeHtml(group.product_name)}</div>
                            <div class="product-meta">
                                <span><i class="fas fa-cube"></i> ${this.escapeHtml(group.system_type || '未知系统')}</span>
                                <span><i class="fas fa-tag"></i> ${this.escapeHtml(group.product_type || '未知类型')}</span>
                                <span><i class="fas fa-tag"></i> ${this.escapeHtml(group.product_id || '未知类型')}</span>
                                <span><i class="fas fa-project-diagram"></i> ${projectsCount} 个项目</span>
                            </div>
                        </div>
                        <i class="fas fa-chevron-right expand-icon"></i>
                    </div>
                </div>
            `;
        }).join('');
        
        productsList.innerHTML = html;
        
        // 保存产品分组数据以便后续使用
        this.productGroupsData = productGroups;
    }
    
    // 选择导入产品
    selectImportProduct(productName, productId) {
        try {
            // 更新选中状态
            const productsContainer = document.getElementById('productsList');
            if (productsContainer) {
                productsContainer.querySelectorAll('.product-group-header').forEach(item => {
                    item.classList.remove('selected');
                });
                
                const candidateItems = productsContainer.querySelectorAll(`.product-group-header[data-product-id="${productId}"]`);
                let selectedItem = null;
                if (candidateItems && candidateItems.length > 0) {
                    selectedItem = Array.from(candidateItems).find(el => el.getAttribute('data-product-name') === productName) || candidateItems[0];
                }
                if (selectedItem) {
                    selectedItem.classList.add('selected');
                }
            }
            
            // 保存选中的产品信息
            this.selectedImportProduct = { name: productName, id: productId };
            
            // 加载该产品下的项目列表
            this.loadProjectsForProduct(productName);
            
            // 清空测试步骤区域
            this.clearStepsPreview();
            
        } catch (error) {
            console.error('选择产品失败:', error);
            showToast('选择产品失败', 'error');
        }
    }
    
    // 为选中产品加载项目列表
    loadProjectsForProduct(productName) {
        try {
            const projectsList = document.getElementById('projectsList');
            if (!projectsList) return;
            
            // 从缓存的数据中查找对应产品的项目
            const productGroup = this.productGroupsData.find(group => group.product_name === productName);
            
            if (!productGroup || !productGroup.projects) {
                projectsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-cube" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                        <p>该产品下暂无测试案例</p>
                    </div>
                `;
                return;
            }
            
            // 过滤掉当前正在编辑的项目
            let filteredProjects = productGroup.projects.filter(project => {
                return this.currentEditingProject ? project.id !== this.currentEditingProject.id : true;
            });
            
            // 如果当前有搜索词，应用搜索过滤
            const searchInput = document.getElementById('importSearchInput');
            if (searchInput && searchInput.value.trim()) {
                const searchTerm = searchInput.value.trim().toLowerCase();
                filteredProjects = filteredProjects.filter(project => {
                    const projectName = project.process_name.toLowerCase();
                    const projectMeta = (project.system || '').toLowerCase() + ' ' + (project.product_type || '').toLowerCase();
                    return this.fuzzyMatch(projectName, searchTerm) || this.fuzzyMatch(projectMeta, searchTerm);
                });
            }
            
            if (filteredProjects.length === 0) {
                const isSearching = searchInput && searchInput.value.trim();
                projectsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-cube" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                        <p>${isSearching ? '没有匹配的测试案例' : '该产品下暂无可导入的测试案例'}</p>
                    </div>
                `;
                return;
            }
            
            // 渲染项目列表
            this.renderImportProjectsList(filteredProjects);
            
            // 如果搜索结果只有一个项目，自动选择它
            const isSearching = searchInput && searchInput.value.trim();
            if (isSearching && filteredProjects.length === 1) {
                setTimeout(() => {
                    this.selectImportProject(filteredProjects[0].id);
                }, 100);
            }
            
        } catch (error) {
            console.error('加载项目列表失败:', error);
            const projectsList = document.getElementById('projectsList');
            if (projectsList) {
                projectsList.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem; color: #e53e3e;"></i>
                        <p>加载项目列表失败</p>
                    </div>
                `;
            }
        }
    }
    
    // 渲染导入项目列表
    renderImportProjectsList(projects) {
        const projectsList = document.getElementById('projectsList');
        if (!projectsList) return;
        
        const html = projects.map(project => {
            const steps = Array.isArray(project.test_steps) ? project.test_steps : (project.test_steps ? JSON.parse(project.test_steps) : []);
            const testStepsCount = steps.length;
            return `
                <div class="project-item" data-project-id="${project.id}" onclick="automationManagement.selectImportProject(${project.id})">
                    <div class="project-item-name">${this.escapeHtml(project.process_name)}</div>
                    <div class="project-item-meta">
                        <span><i class="fas fa-cogs"></i> ${this.escapeHtml(project.system || '未知系统')}</span>
                        <span><i class="fas fa-tag"></i> ${this.escapeHtml(project.product_type || '未知类型')}</span>
                        <span><i class="fas fa-list-ol"></i> ${testStepsCount} 个步骤</span>
                    </div>
                </div>
            `;
        }).join('');
        
        projectsList.innerHTML = html;
    }
    
    // 选择导入项目
    async selectImportProject(projectId) {
        try {
            // 更新选中状态
            const projectsContainer = document.getElementById('projectsList');
            if (projectsContainer) {
                projectsContainer.querySelectorAll('.project-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                const selectedItem = projectsContainer.querySelector(`[data-project-id="${projectId}"]`);
                if (selectedItem) {
                    selectedItem.classList.add('selected');
                }
            }
            
            // 加载项目详情和测试步骤
            await this.loadProjectStepsPreview(projectId);
            
        } catch (error) {
            console.error('选择项目失败:', error);
            showToast('选择项目失败', 'error');
        }
    }
    
    // 加载项目测试步骤预览
    async loadProjectStepsPreview(projectId) {
        try {
            const stepsPreview = document.getElementById('stepsPreviewContainer');
            if (!stepsPreview) return;
            
            // 显示加载状态
            stepsPreview.innerHTML = `
                <div class="loading-placeholder">
                    <i class="fas fa-spinner"></i>
                    <p>正在加载测试步骤...</p>
                </div>
            `;
            
            // 获取项目详情
            const response = await fetch(`/api/automation/projects/${projectId}`);
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || '获取项目详情失败');
            }
            
            const project = result.data;
            const testSteps = project.test_steps || [];
            
            // 保存选中的项目和步骤
            this.selectedImportProject = project;
            this.currentProjectSteps = testSteps;
            this.selectedImportSteps = [];
            
            if (testSteps.length === 0) {
                stepsPreview.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-clipboard-list" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                        <p>该项目暂无测试步骤</p>
                    </div>
                `;
                
                // 禁用导入按钮
                const importBtn = document.getElementById('importStepsBtn');
                if (importBtn) importBtn.disabled = true;
                
                return;
            }
            
            // 渲染测试步骤预览
            this.renderStepsPreview(testSteps);
            
            // 启用导入按钮
            const importBtn = document.getElementById('importStepsBtn');
            if (importBtn) importBtn.disabled = false;
            
        } catch (error) {
            console.error('加载测试步骤预览失败:', error);
            const stepsPreview = document.getElementById('stepsPreviewContainer');
            if (stepsPreview) {
                stepsPreview.innerHTML = `
                    <div class="no-selection">
                        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem; color: #e53e3e;"></i>
                        <p>加载测试步骤失败</p>
                    </div>
                `;
            }
            showToast('加载测试步骤失败', 'error');
        }
    }
    
    // 渲染测试步骤预览（支持选择）
    renderStepsPreview(testSteps) {
        const stepsPreview = document.getElementById('stepsPreviewContainer');
        if (!stepsPreview) return;
        
        const html = testSteps.map((step, index) => {
            const isSelected = this.selectedImportSteps.includes(index);
            return `
                <div class="step-item ${isSelected ? 'selected' : ''}" data-step-index="${index}">
                    <div class="step-item-header" onclick="automationManagement.toggleStepSelection(${index})">
                        <input type="checkbox" class="step-checkbox" ${isSelected ? 'checked' : ''} 
                               onchange="automationManagement.toggleStepSelection(${index})">
                        <div class="step-number">${index + 1}</div>
                        <div class="step-name">${this.escapeHtml(step.step_name || `步骤 ${index + 1}`)}</div>
                        <div class="step-expand-btn" onclick="event.stopPropagation(); automationManagement.toggleStepDetails(${index})">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </div>
                    <div class="step-details">
                        <div class="step-detail-item">
                            <span class="step-detail-label">操作类型</span>
                            <span class="step-detail-value">${this.getOperationTypeText(step.operation_type)}</span>
                        </div>
                        <div class="step-detail-item">
                            <span class="step-detail-label">操作事件</span>
                            <span class="step-detail-value">${this.getOperationEventText(step.operation_event)}</span>
                        </div>
                        <div class="step-detail-item">
                            <span class="step-detail-label">操作参数</span>
                            <span class="step-detail-value">${this.escapeHtml(step.operation_params || '无')}</span>
                        </div>
                        <div class="step-detail-item">
                            <span class="step-detail-label">执行次数</span>
                            <span class="step-detail-value">${step.operation_count || 1} 次</span>
                        </div>
                        <div class="step-detail-item">
                            <span class="step-detail-label">暂停时间</span>
                            <span class="step-detail-value">${step.pause_time || 1} 秒</span>
                        </div>
                        ${step.assertion_enabled === 'yes' ? `
                        <div class="step-detail-item">
                            <span class="step-detail-label">断言设置</span>
                            <span class="step-detail-value">已启用 (${step.assertion_type || 'ui'})</span>
                        </div>
                        ` : ''}
                        ${step.screenshot_enabled === 'yes' ? `
                        <div class="step-detail-item">
                            <span class="step-detail-label">截图设置</span>
                            <span class="step-detail-value">已启用 (${step.screenshot_config?.timing || 'after'})</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        stepsPreview.innerHTML = html;
        
        // 启用控制按钮
        const selectAllBtn = document.getElementById('selectAllStepsBtn');
        const deselectAllBtn = document.getElementById('deselectAllStepsBtn');
        if (selectAllBtn) selectAllBtn.disabled = false;
        if (deselectAllBtn) deselectAllBtn.disabled = false;
        
        // 更新选择计数
        this.updateSelectedStepsCount();
    }
    
    // 初始化导入搜索功能
    initImportSearch() {
        const searchInput = document.getElementById('projectSearchInput');
        if (!searchInput) return;
        
        // 添加输入事件监听（实时搜索）
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            this.filterImportProjects(searchTerm);
        });
        
        // 添加Enter键支持
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.performSearch();
            }
        });
    }
    
    // 执行搜索
    performSearch() {
        const searchInput = document.getElementById('projectSearchInput');
        if (!searchInput) return;
        
        const searchTerm = searchInput.value.toLowerCase().trim();
        this.filterImportProjects(searchTerm);
    }
    
    // 过滤导入项目 - 层级关联的智能搜索
    filterImportProjects(searchTerm) {
        if (!searchTerm) {
            // 如果搜索词为空，显示所有内容
            this.showAllImportContent();
            return;
        }
        
        // 执行层级关联搜索
        this.performHierarchicalSearch(searchTerm);
    }
    
    // 显示所有导入内容
    showAllImportContent() {
        const productGroups = document.querySelectorAll('.product-group');
        const projectItems = document.querySelectorAll('.project-item');
        const stepItems = document.querySelectorAll('.step-item');
        
        productGroups.forEach(item => item.style.display = 'block');
        projectItems.forEach(item => item.style.display = 'flex');
        stepItems.forEach(item => item.style.display = 'block');
        
        // 隐藏无结果提示
        this.hideNoResultsMessage();
    }
    
    // 执行层级关联搜索
    performHierarchicalSearch(searchTerm) {
        const searchTermLower = searchTerm.toLowerCase();
        
        // 收集所有匹配的元素
        const matchedProducts = new Set();
        const matchedProjects = new Set();
        const matchedSteps = new Set();
        
        // 1. 首先搜索项目案例（中间层级）- 这是最重要的匹配
        const projectItems = document.querySelectorAll('.project-item');
        projectItems.forEach(item => {
            const projectName = item.querySelector('.project-item-name')?.textContent.toLowerCase() || '';
            const projectMeta = item.querySelector('.project-item-meta')?.textContent.toLowerCase() || '';
            
            if (this.fuzzyMatch(projectName, searchTermLower) || this.fuzzyMatch(projectMeta, searchTermLower)) {
                matchedProjects.add(item);
                // 找到对应的产品组
                const productGroup = this.findParentProductGroup();
                if (productGroup) {
                    matchedProducts.add(productGroup);
                }
            }
        });
        
        // 2. 搜索测试步骤（最下层级）
        const stepItems = document.querySelectorAll('.step-item');
        stepItems.forEach(item => {
            const stepName = item.querySelector('.step-name')?.textContent.toLowerCase() || '';
            const stepType = item.querySelector('.step-type')?.textContent.toLowerCase() || '';
            const stepEvent = item.querySelector('.step-event')?.textContent.toLowerCase() || '';
            const stepDetails = item.querySelector('.step-details')?.textContent.toLowerCase() || '';
            
            if (this.fuzzyMatch(stepName, searchTermLower) || 
                this.fuzzyMatch(stepType, searchTermLower) || 
                this.fuzzyMatch(stepEvent, searchTermLower) || 
                this.fuzzyMatch(stepDetails, searchTermLower)) {
                matchedSteps.add(item);
                // 找到对应的项目案例和产品组
                const parentInfo = this.findCurrentSelection();
                if (parentInfo.project) {
                    matchedProjects.add(parentInfo.project);
                }
                if (parentInfo.product) {
                    matchedProducts.add(parentInfo.product);
                }
            }
        });
        
        // 3. 搜索产品组（最上层级）
        const productGroups = document.querySelectorAll('.product-group-header');
        productGroups.forEach(item => {
            const productName = item.querySelector('.product-name')?.textContent.toLowerCase() || '';
            const productMeta = item.querySelector('.product-meta')?.textContent.toLowerCase() || '';
            
            if (this.fuzzyMatch(productName, searchTermLower) || this.fuzzyMatch(productMeta, searchTermLower)) {
                const productGroup = item.closest('.product-group');
                if (productGroup) {
                    matchedProducts.add(productGroup);
                }
                
                // 如果匹配的是产品组，需要检查该组下是否有匹配的项目
                // 但不自动显示所有项目，而是等用户选择产品组后再显示
            }
        });
        
        // 4. 应用过滤结果
        this.applyHierarchicalSearchResults(matchedProducts, matchedProjects, matchedSteps);
    }
    
    // 查找当前选中的产品组
    findParentProductGroup() {
        const selectedProductHeader = document.querySelector('.product-group-header.selected');
        if (selectedProductHeader) {
            return selectedProductHeader.closest('.product-group');
        }
        return null;
    }
    
    // 查找当前选中状态
    findCurrentSelection() {
        const selectedProject = document.querySelector('.project-item.selected');
        const selectedProductGroup = this.findParentProductGroup();
        
        return {
            project: selectedProject,
            product: selectedProductGroup
        };
    }
    
    // 应用层级搜索结果
    applyHierarchicalSearchResults(matchedProducts, matchedProjects, matchedSteps) {
        // 过滤产品组
        const allProductGroups = document.querySelectorAll('.product-group');
        allProductGroups.forEach(item => {
            if (matchedProducts.has(item)) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
        
        // 过滤项目案例
        const allProjects = document.querySelectorAll('.project-item');
        allProjects.forEach(item => {
            if (matchedProjects.has(item)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
        
        // 过滤测试步骤
        const allSteps = document.querySelectorAll('.step-item');
        allSteps.forEach(item => {
            if (matchedSteps.has(item)) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
        
        // 智能自动选择逻辑
        if (matchedProducts.size === 1 && matchedProjects.size > 0) {
            // 如果只匹配到一个产品且有项目匹配，自动选择该产品
            const matchedProduct = Array.from(matchedProducts)[0];
            const productHeader = matchedProduct.querySelector('.product-group-header');
            if (productHeader) {
                const productId = productHeader.getAttribute('data-product-id');
                const productName = productHeader.querySelector('.product-name')?.textContent;
                if (productId && productName) {
                    // 延迟执行选择，确保DOM更新完成
                    setTimeout(() => {
                        this.selectImportProduct(productName, productId);
                    }, 100);
                }
            }
        }
        
        // 如果没有匹配结果，显示提示
        if (matchedProducts.size === 0 && matchedProjects.size === 0 && matchedSteps.size === 0) {
            this.showNoResultsMessage();
        } else {
            this.hideNoResultsMessage();
        }
    }
    
    // 显示无结果提示
    showNoResultsMessage() {
        let noResultsDiv = document.querySelector('.no-search-results');
        if (!noResultsDiv) {
            noResultsDiv = document.createElement('div');
            noResultsDiv.className = 'no-search-results';
            noResultsDiv.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #666;">
                    <i class="fas fa-search" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
                    <div style="font-size: 16px;">没有找到匹配的结果</div>
                    <div style="font-size: 14px; margin-top: 8px;">请尝试其他搜索关键词</div>
                </div>
            `;
            
            const importContent = document.querySelector('.import-steps-content');
            if (importContent) {
                importContent.appendChild(noResultsDiv);
            }
        }
        noResultsDiv.style.display = 'block';
    }
    
    // 隐藏无结果提示
    hideNoResultsMessage() {
        const noResultsDiv = document.querySelector('.no-search-results');
        if (noResultsDiv) {
            noResultsDiv.style.display = 'none';
        }
    }
    
    // 模糊匹配函数
    fuzzyMatch(text, searchTerm) {
        if (!text || !searchTerm) return false;
        
        // 简单的模糊匹配：包含搜索词或搜索词的每个字符都在文本中按顺序出现
        if (text.includes(searchTerm)) {
            return true;
        }
        
        // 字符序列匹配（模糊匹配）
        let searchIndex = 0;
        for (let i = 0; i < text.length && searchIndex < searchTerm.length; i++) {
            if (text[i] === searchTerm[searchIndex]) {
                searchIndex++;
            }
        }
        
        return searchIndex === searchTerm.length;
    }
    
    // 切换步骤详情展开/收起
    toggleStepDetails(stepIndex) {
        const stepItem = document.querySelector(`[data-step-index="${stepIndex}"]`);
        if (!stepItem) return;
        
        const expandBtn = stepItem.querySelector('.step-expand-btn i');
        const stepDetails = stepItem.querySelector('.step-details');
        
        if (stepItem.classList.contains('expanded')) {
            stepItem.classList.remove('expanded');
            stepDetails.style.display = 'none';
            expandBtn.classList.remove('fa-chevron-up');
            expandBtn.classList.add('fa-chevron-down');
        } else {
            stepItem.classList.add('expanded');
            stepDetails.style.display = 'block';
            expandBtn.classList.remove('fa-chevron-down');
            expandBtn.classList.add('fa-chevron-up');
        }
    }
    
    // 清空测试步骤预览区域
    clearStepsPreview() {
        const stepsPreview = document.getElementById('stepsPreviewContainer');
        const selectAllBtn = document.getElementById('selectAllStepsBtn');
        const deselectAllBtn = document.getElementById('deselectAllStepsBtn');
        const selectedCount = document.getElementById('selectedStepsCount');
        const importBtn = document.getElementById('importStepsBtn');
        
        if (stepsPreview) {
            stepsPreview.innerHTML = `
                <div class="no-selection">
                    <i class="fas fa-list-ol" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 0.5rem;"></i>
                    <p>请先选择一个测试案例</p>
                </div>
            `;
        }
        
        if (selectAllBtn) selectAllBtn.disabled = true;
        if (deselectAllBtn) deselectAllBtn.disabled = true;
        if (selectedCount) selectedCount.textContent = '已选择 0 个步骤';
        if (importBtn) importBtn.disabled = true;
        
        // 清空选择状态
        this.selectedImportSteps = [];
        this.currentProjectSteps = [];
    }
    
    // 切换步骤选择状态
    toggleStepSelection(stepIndex) {
        const index = this.selectedImportSteps.indexOf(stepIndex);
        
        if (index > -1) {
            // 如果已选中，则取消选择
            this.selectedImportSteps.splice(index, 1);
        } else {
            // 如果未选中，则添加选择
            this.selectedImportSteps.push(stepIndex);
        }
        
        // 更新UI
        this.updateStepSelectionUI(stepIndex);
        this.updateSelectedStepsCount();
    }
    
    // 更新步骤选择的UI
    updateStepSelectionUI(stepIndex) {
        const stepItem = document.querySelector(`[data-step-index="${stepIndex}"]`);
        const checkbox = stepItem?.querySelector('.step-checkbox');
        
        if (stepItem && checkbox) {
            const isSelected = this.selectedImportSteps.includes(stepIndex);
            
            if (isSelected) {
                stepItem.classList.add('selected');
                checkbox.checked = true;
            } else {
                stepItem.classList.remove('selected');
                checkbox.checked = false;
            }
        }
    }
    
    // 全选测试步骤
    selectAllSteps() {
        if (!this.currentProjectSteps || this.currentProjectSteps.length === 0) {
            return;
        }
        
        // 选择所有步骤
        this.selectedImportSteps = this.currentProjectSteps.map((_, index) => index);
        
        // 更新UI
        document.querySelectorAll('.step-item').forEach((item, index) => {
            item.classList.add('selected');
            const checkbox = item.querySelector('.step-checkbox');
            if (checkbox) checkbox.checked = true;
        });
        
        this.updateSelectedStepsCount();
    }
    
    // 取消全选测试步骤
    deselectAllSteps() {
        // 清空选择
        this.selectedImportSteps = [];
        
        // 更新UI
        document.querySelectorAll('.step-item').forEach(item => {
            item.classList.remove('selected');
            const checkbox = item.querySelector('.step-checkbox');
            if (checkbox) checkbox.checked = false;
        });
        
        this.updateSelectedStepsCount();
    }
    
    // 更新选择计数显示
    updateSelectedStepsCount() {
        const selectedCount = document.getElementById('selectedStepsCount');
        const importBtn = document.getElementById('importStepsBtn');
        
        if (selectedCount) {
            selectedCount.textContent = `已选择 ${this.selectedImportSteps.length} 个步骤`;
        }
        
        if (importBtn) {
            importBtn.disabled = this.selectedImportSteps.length === 0;
        }
    }
    
    // 导入选中的测试步骤
    async importSelectedSteps() {
        try {
            if (!this.selectedImportSteps || this.selectedImportSteps.length === 0) {
                showToast('请先选择要导入的测试步骤', 'warning');
                return;
            }
            
            if (!this.currentProjectSteps) {
                showToast('没有可用的测试步骤数据', 'error');
                return;
            }
            
            // 获取选中的测试步骤
            const selectedSteps = this.selectedImportSteps.map(index => this.currentProjectSteps[index]);
            
            // 显示自定义确认对话框
            showCustomConfirm({
                title: '导入测试步骤',
                message: `确定要导入 ${selectedSteps.length} 个测试步骤吗？`,
                details: [
                    '导入的步骤将追加到当前测试步骤的末尾',
                    '不会覆盖现有的测试步骤',
                    `即将导入 ${selectedSteps.length} 个步骤`
                ],
                type: 'info',
                confirmText: '确定导入',
                cancelText: '取消',
                onConfirm: () => {
                    try {
                        // 深拷贝测试步骤
                        const importedSteps = JSON.parse(JSON.stringify(selectedSteps));
                        
                        // 重置步骤ID和索引，并初始化敏感数据（登录/注册配置与步骤图片）
                        importedSteps.forEach((step, index) => {
                            step.step_name = step.step_name || `导入步骤 ${index + 1}`;
                            // 清理可能的内部ID或索引
                            delete step.id;
                            delete step.index;
                            
                            // 1) 登录/注册：清空配置与临时账号，需用户再次点击“配置”后才生效
                            if (step && step.operation_type === 'web' && (step.operation_event === 'login' || step.operation_event === 'register')) {
                                step.auth_config = {};
                                step.auth_temp_credentials_list = [];
                                step.auth_temp_source = '';
                                // 清理可能存在的顶层账号字段
                                if ('email' in step) delete step.email;
                                if ('password' in step) delete step.password;
                                // 注册步骤：下次打开配置时强制重新生成
                                step.auth_regen_on_open = (step.operation_event === 'register');
                            }
                            
                            // 2) 步骤图片：若为游戏操作，清空参数以便用户重新上传
                            if (step && step.operation_type === 'game') {
                                step.operation_params = '';
                                // 同时清理可能存在的图片相关字段
                                delete step.image_path;
                                delete step.image_url;
                            }
                        });
                        
                        // 追加导入的测试步骤到现有步骤
                        if (this.isEditing) {
                            // 编辑模式：追加到编辑中的测试步骤
                            if (!this.editingTestSteps) {
                                this.editingTestSteps = [];
                            }
                            this.editingTestSteps.push(...importedSteps);
                            this.testSteps.push(...importedSteps);
                        } else {
                            // 新建模式：追加到当前测试步骤
                            if (!this.testSteps) {
                                this.testSteps = [];
                            }
                            this.testSteps.push(...importedSteps);
                        }
                        
                        // 清理图片缓存（因为导入的步骤可能有不同的图片）
                        this.uploadedImages.clear();
                        this.editingUploadedImages.clear();
                        
                        // 确保导入的游戏步骤不会显示图片预览（再次检查并清理缓存键）
                        const startIndex = (this.isEditing ? this.editingTestSteps.length : this.testSteps.length) - importedSteps.length;
                        for (let i = 0; i < importedSteps.length; i++) {
                            const stepIndex = startIndex + i;
                            const cacheKey = `step_${stepIndex}`;
                            this.uploadedImages.delete(cacheKey);
                            this.editingUploadedImages.delete(cacheKey);
                        }
                        
                        // 重新渲染测试步骤
                        this.renderTestSteps();
                        
                        // 关闭导入弹窗
                        this.closeImportTestStepsModal();
                        
                        showToast(`成功追加导入 ${importedSteps.length} 个测试步骤`, 'success');
                        
                    } catch (innerError) {
                        console.error('导入测试步骤失败:', innerError);
                        showToast('导入测试步骤失败', 'error');
                    }
                }
            });
            
        } catch (error) {
            console.error('导入测试步骤失败:', error);
            showToast('导入测试步骤失败', 'error');
        }
    }
    
    // 获取操作类型文本
    getOperationTypeText(type) {
        const typeMap = {
            'web': 'Web操作',
            'game': '游戏操作',
            'api': 'API操作'
        };
        return typeMap[type] || type || '未知';
    }
    
    // 获取操作事件文本
    getOperationEventText(event) {
        const eventMap = {
            'click': '点击',
            'input': '输入',
            'scroll': '滚动',
            'wait': '等待',
            'navigate': '导航',
            'screenshot': '截图',
            'assertion': '断言'
        };
        return eventMap[event] || event || '未知';
    }
    
    // HTML转义
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // JavaScript字符串转义
    escapeJsString(text) {
        if (!text) return '';
        return text.replace(/\\/g, '\\\\')
                  .replace(/'/g, "\\'")
                  .replace(/"/g, '\\"')
                  .replace(/\n/g, '\\n')
                  .replace(/\r/g, '\\r')
                  .replace(/\t/g, '\\t');
    }
    
    // 格式化日期
    formatDate(dateString) {
        if (!dateString) return '未知';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('zh-CN');
        } catch (error) {
            return '未知';
        }
    }
    
    // 清理事件监听器
    cleanupEventListeners() {
        try {
            console.log('清理事件监听器...');
            
            // 清理多选框事件监听器
            const input = document.getElementById('productIdsInput');
            if (input && this.multiselectClickHandler) {
                input.removeEventListener('click', this.multiselectClickHandler);
                this.multiselectClickHandler = null;
            }
            
            if (this.documentClickHandler) {
                document.removeEventListener('click', this.documentClickHandler);
                this.documentClickHandler = null;
            }
            
            console.log('事件监听器清理完成');
        } catch (error) {
            console.error('清理事件监听器时出错:', error);
        }
    }

    // 加载枚举值
    async loadEnumValues() {
        try {
            const systemTypes = await VersionAPI.getEnumValues('system_type');
            const productTypes = await VersionAPI.getEnumValues('product_type');
            const environments = await VersionAPI.getEnumValues('environment');
            
            if (systemTypes.success) {
                this.enumValues.system_type = systemTypes.data;
            }
            if (productTypes.success) {
                this.enumValues.product_type = productTypes.data;
            }
            if (environments.success) {
                this.enumValues.environment = environments.data;
            }
        } catch (error) {
            console.error('加载枚举值失败:', error);
        }
    }

    // 初始化自定义下拉选择框
    initCustomSelects() {
        this.initCustomSelect('automationSystem', 'system_type');
        this.initCustomSelect('automationProductType', 'product_type');
        this.initCustomSelect('automationEnvironment', 'environment');
    }

    // 初始化单个自定义下拉选择框
    initCustomSelect(inputId, enumKey) {
        const input = document.getElementById(inputId);
        const dropdown = document.getElementById(inputId + 'Dropdown');
        
        if (!input || !dropdown) return;

        // 显示下拉选项
        const showDropdown = () => {
            this.populateDropdown(dropdown, this.enumValues[enumKey], input.value);
            dropdown.classList.add('show');
        };

        // 过滤选项
        const filterOptions = () => {
            const value = input.value.toLowerCase();
            const filteredOptions = this.enumValues[enumKey].filter(option => 
                option.toLowerCase().includes(value)
            );
            this.populateDropdown(dropdown, filteredOptions, input.value);
        };

        // 隐藏所有下拉框
        const hideDropdowns = (e) => {
            if (!e.target.closest('.custom-select-container')) {
                document.querySelectorAll('.custom-select-dropdown').forEach(dd => {
                    dd.classList.remove('show');
                });
            }
        };

        input.addEventListener('focus', showDropdown);
        input.addEventListener('input', filterOptions);
        document.addEventListener('click', hideDropdowns);
    }

    // 填充下拉选项
    populateDropdown(dropdown, options, currentValue) {
        dropdown.innerHTML = '';
        
        options.forEach(option => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'custom-select-option';
            optionDiv.textContent = option;
            
            if (option === currentValue) {
                optionDiv.classList.add('selected');
            }
            
            optionDiv.addEventListener('click', () => {
                const input = dropdown.previousElementSibling;
                input.value = option;
                dropdown.classList.remove('show');
            });
            
            dropdown.appendChild(optionDiv);
        });

        // 如果当前值不在选项中，添加"添加新选项"
        if (currentValue && !options.includes(currentValue)) {
            const addOptionDiv = document.createElement('div');
            addOptionDiv.className = 'custom-select-option';
            addOptionDiv.style.borderTop = '1px solid #e2e8f0';
            addOptionDiv.style.fontStyle = 'italic';
            addOptionDiv.innerHTML = `<i class=\"fas fa-plus\"></i> 添加 \"${currentValue}\"`;
            
            addOptionDiv.addEventListener('click', async () => {
                const idBase = dropdown.id.replace('Dropdown', '').replace('automation', '');
                const mapping = { System: 'system_type', ProductType: 'product_type', Environment: 'environment' };
                const fieldName = mapping[idBase] || idBase.toLowerCase();
                await this.addNewEnumValue(fieldName, currentValue);
                dropdown.classList.remove('show');
            });
            
            dropdown.appendChild(addOptionDiv);
        }
    }

    // 添加新的枚举值
    async addNewEnumValue(fieldName, value) {
        try {
            const response = await VersionAPI.addEnumValue(fieldName, value);
            if (response.success) {
                // 更新本地枚举值
                if (!this.enumValues[fieldName].includes(value)) {
                    this.enumValues[fieldName].push(value);
                }
                showToast(`成功添加新选项: ${value}`, 'success');
            } else {
                showToast(response.message || '添加选项失败', 'error');
            }
        } catch (error) {
            handleApiError(error, '添加选项失败');
        }
    }

    // 初始化多选框
    async initMultiselect() {
        try {
        const input = document.getElementById('productIdsInput');
        const dropdown = document.getElementById('productIdsDropdown');
        
            if (!input || !dropdown) {
                console.warn('多选框元素未找到');
                return;
            }

        // 确保产品数据已加载
        if (this.products.length === 0) {
                console.log('产品数据为空，开始加载...');
            await this.loadProducts();
        }

        // 清空下拉框并填充产品选项
        this.populateDropdownOptions(dropdown);

        // 移除之前的事件监听器（如果存在）
        if (this.multiselectClickHandler) {
            input.removeEventListener('click', this.multiselectClickHandler);
        }
        if (this.documentClickHandler) {
            document.removeEventListener('click', this.documentClickHandler);
        }

        // 创建新的事件处理器
        this.multiselectClickHandler = async () => {
                try {
            const isActive = input.classList.contains('active');
            document.querySelectorAll('.multiselect-input').forEach(inp => {
                inp.classList.remove('active');
            });
            document.querySelectorAll('.multiselect-dropdown').forEach(dd => {
                dd.classList.remove('show');
            });
            
            if (!isActive) {
                // 确保每次点击时都有最新的产品数据
                if (this.products.length === 0) {
                    await this.loadProducts();
                }
                this.populateDropdownOptions(dropdown);
                input.classList.add('active');
                dropdown.classList.add('show');
                    }
                } catch (error) {
                    console.error('多选框点击处理器出错:', error);
            }
        };

        this.documentClickHandler = (e) => {
                try {
            if (!e.target.closest('.custom-multiselect-container')) {
                input.classList.remove('active');
                dropdown.classList.remove('show');
                    }
                } catch (error) {
                    console.error('文档点击处理器出错:', error);
            }
        };

        // 绑定新的事件监听器
        input.addEventListener('click', this.multiselectClickHandler);
        document.addEventListener('click', this.documentClickHandler);

        this.updateSelectedProducts();
            console.log('多选框初始化完成');
        } catch (error) {
            console.error('initMultiselect 出错:', error);
            throw error;
        }
    }

    // 填充下拉选项
    populateDropdownOptions(dropdown) {
        dropdown.innerHTML = '';
        this.products.forEach((product, index) => {
            // 使用索引作为唯一标识符
            const uniqueId = `${product.product_id}_${index}`;
            const option = document.createElement('div');
            option.className = 'multiselect-option';
            
            // 构建更详细的产品显示信息
            const productDisplayName = product.product_name || '未命名产品';
            const systemInfo = product.system_type ? ` (${product.system_type})` : '';
            const fullDisplayName = `${productDisplayName}${systemInfo}`;
            
            option.innerHTML = `
                <input type="checkbox" value="${uniqueId}" data-product-index="${index}"
                       ${this.selectedProducts.includes(uniqueId) ? 'checked' : ''}>
                <div class="option-content">
                    <div class="product-id">${product.product_id}</div>
                    <div class="product-details">
                        ${fullDisplayName}
                    </div>
                </div>
            `;
            
            option.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    const checkbox = option.querySelector('input[type="checkbox"]');
                    checkbox.checked = !checkbox.checked;
                }
                this.updateProductSelection();
            });
            
            dropdown.appendChild(option);
        });
    }

    // 更新产品选择
    updateProductSelection() {
        const checkboxes = document.querySelectorAll('#productIdsDropdown input[type="checkbox"]:checked');
        let newSelectedProducts = Array.from(checkboxes).map(cb => cb.value);
        
        // 去重：同一 product_id + product_name 只保留一个（优先保留首次出现的）
        const compositeKeyOf = (uid) => {
            const idx = parseInt(uid.substring(uid.lastIndexOf('_') + 1));
            const p = this.products[idx];
            return p ? `${p.product_id}__${p.product_name || ''}` : uid;
        };
        const seenCompositeKeys = new Set();
        newSelectedProducts = newSelectedProducts.filter(uniqueId => {
            const key = compositeKeyOf(uniqueId);
            if (seenCompositeKeys.has(key)) return false;
            seenCompositeKeys.add(key);
            return true;
        });
        
        // 仅取消同一复合键的多余勾选
        const allCheckboxes = document.querySelectorAll('#productIdsDropdown input[type="checkbox"]');
        allCheckboxes.forEach(cb => {
            const key = compositeKeyOf(cb.value);
            if (seenCompositeKeys.has(key) && !newSelectedProducts.includes(cb.value)) {
                cb.checked = false;
            }
        });
        
        // 如果没有选择任何产品，直接更新
        if (newSelectedProducts.length === 0) {
            this.selectedProducts = [];
            this.updateSelectedProducts();
            this.autoFillFields();
            return;
        }
        
        // 获取新选择的产品对象
        const newSelectedProductObjs = newSelectedProducts.map(uniqueId => {
            const index = parseInt(uniqueId.split('_')[1]);
            return this.products[index];
        });
        
        // 检查新选择的产品系统类型
        const newSystems = [...new Set(newSelectedProductObjs.map(p => p.system_type))];
        
        if (newSystems.length > 1) {
            showToast('选择的产品必须来自同一系统', 'error');
            // 找到刚才点击的checkbox（新增的那个）并取消选中
            allCheckboxes.forEach(cb => {
                if (newSelectedProducts.includes(cb.value) && !this.selectedProducts.includes(cb.value)) {
                    cb.checked = false;
                }
            });
            return; // 不更新选择
        }
        
        // 更新选择（已去重）
        this.selectedProducts = newSelectedProducts;
        this.updateSelectedProducts();
        this.autoFillFields();
    }

    // 更新复选框状态
    updateCheckboxes() {
        const checkboxes = document.querySelectorAll('#productIdsDropdown input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = this.selectedProducts.includes(cb.value);
        });
    }

    // 更新已选产品显示
    updateSelectedProducts() {
        const container = document.getElementById('productIdsSelected');
        const placeholder = document.querySelector('.multiselect-placeholder');
        
        if (!container || !placeholder) return;

        container.innerHTML = '';
        
        if (this.selectedProducts.length === 0) {
            placeholder.textContent = '请选择产品ID';
            placeholder.style.display = 'block';
        } else {
            placeholder.style.display = 'none';
            // 芯片按 product_id + product_name 去重
            const seenCompositeKeys = new Set();
            this.selectedProducts.forEach(uniqueId => {
                const lastUnderscoreIndex = uniqueId.lastIndexOf('_');
                const index = parseInt(uniqueId.substring(lastUnderscoreIndex + 1));
                const product = this.products[index];
                if (product) {
                    const key = `${product.product_id}__${product.product_name || ''}`;
                    if (seenCompositeKeys.has(key)) return;
                    seenCompositeKeys.add(key);
                    const item = document.createElement('div');
                    item.className = 'selected-item';
                    
                    // 构建更详细的产品显示信息
                    const productDisplayName = product.product_name || '未命名产品';
                    const systemInfo = product.system_type ? ` (${product.system_type})` : '';
                    const fullDisplayName = `${productDisplayName}${systemInfo}`;
                    
                    item.innerHTML = `
                        <span>${product.product_id} - ${fullDisplayName}</span>
                        <span class="remove-item" onclick="automationManagement.removeSelectedProduct('${uniqueId}')">&times;</span>
                    `;
                    container.appendChild(item);
                }
            });
        }
        
        // 更新产品地址显示
        this.onProductSelectionChange();
    }

    // 移除选中的产品
    removeSelectedProduct(uniqueId) {
        this.selectedProducts = this.selectedProducts.filter(id => id !== uniqueId);
        this.updateCheckboxes();
        this.updateSelectedProducts();
        this.autoFillFields();
    }

    // 重置多选框
    resetMultiselect() {
        this.selectedProducts = [];
        const placeholder = document.querySelector('.multiselect-placeholder');
        const selectedContainer = document.getElementById('productIdsSelected');
        const input = document.getElementById('productIdsInput');
        const dropdown = document.getElementById('productIdsDropdown');
        
        if (placeholder) {
            placeholder.textContent = '请选择产品ID';
            placeholder.style.display = 'block';
        }
        if (selectedContainer) {
            selectedContainer.innerHTML = '';
        }
        if (input) {
            input.classList.remove('active');
        }
        if (dropdown) {
            dropdown.classList.remove('show');
            // 重置所有复选框状态
            const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
        }
    }

    // 重置测试步骤列表
    resetTestStepsList() {
        this.testSteps = [];
        const testStepsList = document.getElementById('testStepsList');
        if (testStepsList) {
            testStepsList.innerHTML = `
                <div class="no-steps">
                    <i class="fas fa-clipboard-list" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                    <p>暂无测试步骤，点击上方按钮添加第一个步骤</p>
                </div>
            `;
        }
    }

    // 自动填充字段
    autoFillFields() {
        if (this.selectedProducts.length > 0) {
            const firstUniqueId = this.selectedProducts[0];
            console.log('autoFillFields - uniqueId:', firstUniqueId);
            const index = parseInt(firstUniqueId.split('_')[1]);
            console.log('autoFillFields - 解析的索引:', index);
            const firstProduct = this.products[index];
            console.log('autoFillFields - 找到的产品:', firstProduct);
            if (firstProduct) {
                document.getElementById('automationSystem').value = firstProduct.system_type || '';
                document.getElementById('automationProductType').value = firstProduct.product_type || '';
                document.getElementById('automationEnvironment').value = firstProduct.environment || '';
                document.getElementById('automationProductAddress').value = firstProduct.product_address || '';
                console.log('autoFillFields - 字段已填充');
            } else {
                console.warn('autoFillFields - 未找到对应索引的产品');
            }
        }
    }

    // 添加测试步骤
    addTestStep() {
        const newStep = {
            step_name: '',
            operation_type: 'web',
            operation_event: 'click',
            input_value: '',
            operation_params: '',
            operation_count: 1,
            pause_time: 1,
            // 断言设置相关字段
            assertion_enabled: 'no',
            assertion_type: 'ui',
            assertion_method: 'pytest-selenium',
            assertion_params: '',
            assertion_config: {
                ui_assertions: [],
                image_assertions: [],
                custom_assertions: []
            },
            // 截图设置相关字段
            screenshot_enabled: 'no',
            screenshot_config: {
                timing: 'after',
                format: 'png',
                quality: 90,
                prefix: 'screenshot_step',
                full_page: false,
                path: 'screenshots/'
            },
            // 注册配置生成控制
            auth_regen_on_open: false,
            auth_temp_credentials_list: []
        };
        
        this.testSteps.push(newStep);
        
        // 如果是编辑模式，同时更新编辑副本
        if (this.isEditing && this.editingTestSteps) {
            this.editingTestSteps.push(JSON.parse(JSON.stringify(newStep)));
        }
        
        // 重新计算所有步骤的标签页索引
        this.recalculateStepTabIndexes();
        
        this.renderTestSteps();
    }

    // 渲染测试步骤
    renderTestSteps() {
        const container = document.getElementById('testStepsList');
        
        if (!container) return;
        
        if (this.testSteps.length === 0) {
            container.innerHTML = `
                <div class="no-steps">
                    <i class="fas fa-clipboard-list" style="font-size: 3rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                    <p>暂无测试步骤，点击上方按钮添加第一个步骤</p>
                </div>
            `;
            return;
        }

        const html = this.testSteps.map((step, index) => this.renderTestStep(step, index)).join('');
        container.innerHTML = html;
    }

    // 渲染单个测试步骤
    renderTestStep(step, index) {
        return `
            <div class="test-step" data-index="${index}">
                <div class="test-step-header">
                    <div class="test-step-title">
                        <div class="step-number">${index + 1}</div>
                        <div class="step-title-text">测试步骤 ${index + 1}</div>
                    </div>
                    <button type="button" class="btn btn-danger btn-sm" onclick="automationManagement.removeTestStep(${index})">
                        <i class="fas fa-trash"></i> 删除
                    </button>
                </div>
                <div class="test-step-content">
                    <div class="form-group">
                        <label for="step-name-${index}">步骤名称 <span class="required">*</span></label>
                        <input type="text" id="step-name-${index}" value="${(step.step_name || '').replace(/"/g, '&quot;')}" 
                               placeholder="请输入步骤名称" 
                               onchange="automationManagement.updateTestStep(${index}, 'step_name', this.value)">
                    </div>
                    <div class="form-group">
                        <label for="operation-type-${index}">操作类型 <span class="required">*</span></label>
                        <select id="operation-type-${index}" onchange="automationManagement.updateTestStep(${index}, 'operation_type', this.value)">
                            <option value="web" ${step.operation_type === 'web' ? 'selected' : ''}>Web操作</option>
                            <option value="game" ${step.operation_type === 'game' ? 'selected' : ''}>游戏操作</option>
                        </select>
                    </div>
                    ${step.operation_type === 'web' ? `
                    <div class="form-group operation-event-group">
                        <label for="operation-event-${index}">操作事件 <span class="required">*</span></label>
                        <div class="tab-switch-controls">
                        <select id="operation-event-${index}" onchange="automationManagement.updateTestStep(${index}, 'operation_event', this.value)">
                            <option value="click" ${(step.operation_event || 'click') === 'click' ? 'selected' : ''}>单击</option>
                            <option value="double_click" ${step.operation_event === 'double_click' ? 'selected' : ''}>双击</option>
                            <option value="input" ${step.operation_event === 'input' ? 'selected' : ''}>输入</option>
                                <option value="hover" ${step.operation_event === 'hover' ? 'selected' : ''}>悬停</option>
                                <option value="check" ${step.operation_event === 'check' ? 'selected' : ''}>勾选</option>
                                <option value="uncheck" ${step.operation_event === 'uncheck' ? 'selected' : ''}>取消勾选</option>
                                <option value="select_option" ${step.operation_event === 'select_option' ? 'selected' : ''}>选择下拉项</option>
                                <option value="drag_and_drop" ${step.operation_event === 'drag_and_drop' ? 'selected' : ''}>拖拽到元素</option>
                                <option value="press_key" ${step.operation_event === 'press_key' ? 'selected' : ''}>按键</option>
                                <option value="login" ${step.operation_event === 'login' ? 'selected' : ''}>登录</option>
                                <option value="register" ${step.operation_event === 'register' ? 'selected' : ''}>注册</option>
                        </select>
                            <button type="button" 
                                    class="tab-config-btn ${['login','register'].includes(step.operation_event) ? 'enabled' : 'disabled'}" 
                                    onclick="automationManagement.openAuthConfigModal(${index})"
                                    ${['login','register'].includes(step.operation_event) ? '' : 'disabled'}>
                                <i class="fas fa-cog"></i>
                                <span>配置</span>
                            </button>
                        </div>
                        ${['login','register'].includes(step.operation_event) ? 
                            `<div class="tab-switch-status">
                                <i class="fas fa-info-circle"></i>
                                <span>已启用 - 点击配置按钮进行详细设置</span>
                            </div>` : ''
                        }
                        ${step.operation_event === 'input' 
                            ? `<input type="text" id="input-value-${index}" value="${(step.input_value || '').replace(/\"/g, '&quot;')}" placeholder="请输入输入内容" onchange="automationManagement.updateTestStep(${index}, 'input_value', this.value)" style="margin-top: 8px;">`
                            : step.operation_event === 'select_option'
                                ? `<input type=\"text\" id=\"input-value-${index}\" value=\"${(step.input_value || '').replace(/\\\"/g, '&quot;')}\" placeholder=\"请输入选项（如 value=us 或 label=United States 或 index=2）\" onchange=\"automationManagement.updateTestStep(${index}, 'input_value', this.value)\" style=\"margin-top: 8px;\">`
                                : step.operation_event === 'press_key'
                                    ? `<input type=\"text\" id=\"input-value-${index}\" value=\"${(step.input_value || '').replace(/\\\"/g, '&quot;')}\" placeholder=\"请输入按键（如 Enter 或 Control+S）\" onchange=\"automationManagement.updateTestStep(${index}, 'input_value', this.value)\" style=\"margin-top: 8px;\">`
                                    : step.operation_event === 'drag_and_drop'
                                        ? `<input type=\"text\" id=\"input-value-${index}\" value=\"${(step.input_value || '').replace(/\\\"/g, '&quot;')}\" placeholder=\"请输入目标元素定位参数（如 id=target 或 xpath=//div[@id='target']）\" onchange=\"automationManagement.updateTestStep(${index}, 'input_value', this.value)\" style=\"margin-top: 8px;\">`
                                        : ''}
                    </div>
                    ` : ''}
                    ${!(step.operation_type === 'web' && (step.operation_event === 'login' || step.operation_event === 'register')) ? `
                    <div class="form-group">
                        <label>${step.operation_type === 'web' ? '元素定位参数' : '步骤图片'} <span class="required">*</span></label>
                        ${this.renderOperationInput(step, index)}
                    </div>
                    ` : ''}
                    <div class="form-group">
                        <label for="operation-count-${index}">操作次数</label>
                        <input type="number" id="operation-count-${index}" min="1" value="${step.operation_count || 1}" 
                               placeholder="1" 
                               onchange="automationManagement.updateTestStep(${index}, 'operation_count', this.value)">
                    </div>
                    <div class="form-group">
                        <label for="pause-time-${index}">暂停时间(秒)</label>
                        <input type="number" id="pause-time-${index}" min="0" step="0.1" value="${step.pause_time || 1}" 
                               placeholder="1.0" 
                               onchange="automationManagement.updateTestStep(${index}, 'pause_time', this.value)">
                    </div>
                    
                    <!-- 标签页跳转功能 - 仅在Web操作时显示 -->
                    ${step.operation_type === 'web' ? `
                    <div class="form-group tab-switch-group">
                        <label>
                            <i class="fas fa-external-link-alt" style="color: #667eea; margin-right: 0.5rem;"></i>
                            标签页跳转
                        </label>
                        <div class="tab-switch-controls">
                            <select class="form-control tab-switch-select" onchange="automationManagement.toggleTabSwitch(${index}, this.value)">
                                <option value="no" ${(step.tab_switch_enabled || 'no') === 'no' ? 'selected' : ''}>否</option>
                                <option value="yes" ${step.tab_switch_enabled === 'yes' ? 'selected' : ''}>是</option>
                            </select>
                            <button type="button" 
                                    class="tab-config-btn ${step.tab_switch_enabled === 'yes' ? 'enabled' : 'disabled'}" 
                                    onclick="automationManagement.openTabSwitchModal(${index})"
                                    ${step.tab_switch_enabled !== 'yes' ? 'disabled' : ''}>
                                <i class="fas fa-cog"></i>
                                <span>配置</span>
                            </button>
                        </div>
                        ${step.tab_switch_enabled === 'yes' ? 
                            `<div class="tab-switch-status">
                                <i class="fas fa-info-circle"></i>
                                <span>已启用 - 点击配置按钮进行详细设置</span>
                            </div>` : ''
                        }
                    </div>
                    ` : ''}
                    
                    <!-- 断言设置功能 -->
                    <div class="form-group assertion-group">
                        <label>
                            <i class="fas fa-check-circle" style="color: #10b981; margin-right: 0.5rem;"></i>
                            断言设置
                        </label>
                        <div class="assertion-controls">
                            <select class="form-control assertion-select" onchange="automationManagement.toggleAssertion(${index}, this.value)">
                                <option value="no" ${(step.assertion_enabled || 'no') === 'no' ? 'selected' : ''}>否</option>
                                <option value="yes" ${step.assertion_enabled === 'yes' ? 'selected' : ''}>是</option>
                            </select>
                            <button type="button" 
                                    class="assertion-config-btn ${step.assertion_enabled === 'yes' ? 'enabled' : 'disabled'}" 
                                    onclick="automationManagement.openAssertionModal(${index})"
                                    ${step.assertion_enabled !== 'yes' ? 'disabled' : ''}>
                                <i class="fas fa-cog"></i>
                                <span>配置</span>
                            </button>
                        </div>
                        ${step.assertion_enabled === 'yes' ? 
                            `<div class="assertion-status">
                                <i class="fas fa-info-circle"></i>
                                <span>已启用 - 点击配置按钮进行详细设置</span>
                            </div>` : ''
                        }
                    </div>
                    
                    <!-- 截图设置功能 -->
                    <div class="form-group screenshot-group">
                        <label>
                            <i class="fas fa-camera" style="color: #ec4899; margin-right: 0.5rem;"></i>
                            截图设置
                        </label>
                        <div class="screenshot-controls">
                            <select class="form-control screenshot-select" onchange="automationManagement.toggleScreenshot(${index}, this.value)">
                                <option value="no" ${(step.screenshot_enabled || 'no') === 'no' ? 'selected' : ''}>否</option>
                                <option value="yes" ${step.screenshot_enabled === 'yes' ? 'selected' : ''}>是</option>
                            </select>
                            <button type="button" 
                                    class="screenshot-config-btn ${step.screenshot_enabled === 'yes' ? 'enabled' : 'disabled'}" 
                                    onclick="automationManagement.openScreenshotModal(${index})"
                                    ${step.screenshot_enabled !== 'yes' ? 'disabled' : ''}>
                                <i class="fas fa-cog"></i>
                                <span>配置</span>
                            </button>
                        </div>
                        ${step.screenshot_enabled === 'yes' ? 
                            `<div class="screenshot-status">
                                <i class="fas fa-info-circle"></i>
                                <span>已启用 - 点击配置按钮进行详细设置</span>
                            </div>
                            <!-- 内联截图设置弹框 -->
                            <div class="step-screenshot-settings screenshot-inline-modal" style="display: none;">
                                <div class="screenshot-inline-container">
                                    <div class="screenshot-inline-header">
                                        <div>
                                            <i class="fas fa-camera"></i>
                                            <span>截图配置</span>
                                        </div>
                                        <button class="screenshot-inline-close" onclick="closeInlineScreenshotModal(${index})">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                    <div class="screenshot-inline-content">
                                        <p class="screenshot-description">设置步骤的截图参数，包括截图时机和其他选项。</p>
                                        
                                        <div class="screenshot-timing-section">
                                            <label class="timing-label">截图时机</label>
                                            <div class="timing-buttons">
                                                <button class="timing-btn" data-timing="after" onclick="setScreenshotTiming(${index}, 'after')">步骤后</button>
                                                <button class="timing-btn" data-timing="before" onclick="setScreenshotTiming(${index}, 'before')">步骤前</button>
                                                <button class="timing-btn" data-timing="both" onclick="setScreenshotTiming(${index}, 'both')">前后都</button>
                                                <button class="timing-btn" data-timing="on_failure" onclick="setScreenshotTiming(${index}, 'on_failure')">失败时</button>
                                            </div>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>图片格式</label>
                                            <select id="screenshot-format" class="form-control">
                                                <option value="png">PNG</option>
                                                <option value="jpg">JPG</option>
                                                <option value="webp">WebP</option>
                                            </select>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>图片质量 (1-100)</label>
                                            <input type="number" id="screenshot-quality" class="form-control" value="90" min="1" max="100">
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>文件名前缀</label>
                                            <input type="text" id="screenshot-prefix" class="form-control" value="screenshot_step" placeholder="screenshot_step">
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>
                                                <input type="checkbox" id="screenshot-full-page" style="margin-right: 0.5rem;">
                                                全页面截图
                                            </label>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>保存路径</label>
                                            <input type="text" id="screenshot-path" class="form-control" value="screenshots/" placeholder="screenshots/">
                                        </div>
                                        
                                        <div class="screenshot-inline-footer">
                                            <button class="btn-secondary" onclick="closeInlineScreenshotModal(${index})">取消</button>
                                            <button class="btn-primary" onclick="automationManagement.saveScreenshotConfig()">保存</button>
                                        </div>
                                    </div>
                                </div>
                            </div>` : ''
                        }
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染操作输入框
    renderOperationInput(step, index) {
        if (step.operation_type === 'web') {
            // 转义HTML属性值中的引号
            const escapedValue = (step.operation_params || '').replace(/"/g, '&quot;');
            return `<input type="text" class="form-control" 
                           placeholder="请输入元素定位参数（如：id=button1 或 xpath=//button[@class='submit']）" 
                           value="${escapedValue}" 
                           onchange="automationManagement.updateTestStep(${index}, 'operation_params', this.value)">`;
        } else if (step.operation_type === 'game') {
            // 检查是否有图片（从缓存或已保存的路径）
            const hasImage = this.uploadedImages.has(`step_${index}`) || (step.operation_params && step.operation_params.trim() !== '');
            const imageSource = this.uploadedImages.get(`step_${index}`) || 
                               (step.operation_params && step.operation_params.trim() !== '' ? 
                                (step.operation_params.startsWith('/') ? step.operation_params : '/' + step.operation_params) : '');

            return `
                <div class="upload-section-enhanced">
                    <input type="file" id="step-image-${index}" accept="image/*" 
                           style="display: none;" 
                           onchange="automationManagement.uploadStepImage(${index}, this)">
                    <button type="button" class="upload-btn-enhanced" 
                            onclick="document.getElementById('step-image-${index}').click()">
                        <i class="fas fa-upload"></i> 上传步骤图片
                    </button>
                    ${hasImage ? `
                        <div class="image-preview-enhanced" id="image-preview-${index}">
                            <img src="${imageSource}" 
                                 alt="步骤图片预览">
                            <button type="button" class="remove-image-enhanced" 
                                    onclick="automationManagement.removeStepImage(${index})">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }
    }

    // 更新测试步骤
    updateTestStep(index, field, value) {
        let prevOperationEvent = null;
        if (field === 'operation_event' && this.testSteps[index]) {
            prevOperationEvent = this.testSteps[index].operation_event;
        }
        if (this.testSteps[index]) {
            // 对数字字段进行类型转换
            if (field === 'operation_count') {
                const numValue = parseInt(value) || 1;
                this.testSteps[index][field] = numValue;
                // 如果是编辑模式，同时更新编辑副本
                if (this.isEditing && this.editingTestSteps) {
                    this.editingTestSteps[index][field] = numValue;
                }
            } else if (field === 'pause_time') {
                const numValue = parseFloat(value) || 1;
                this.testSteps[index][field] = numValue;
                // 如果是编辑模式，同时更新编辑副本
                if (this.isEditing && this.editingTestSteps) {
                    this.editingTestSteps[index][field] = numValue;
                }
            } else {
                this.testSteps[index][field] = value;
                // 如果是编辑模式，同时更新编辑副本
                if (this.isEditing && this.editingTestSteps) {
                    this.editingTestSteps[index][field] = value;
                }
                // 在切换到register时，如是从非register切回，则标记下次打开需要重新生成
                if (field === 'operation_event' && value === 'register' && prevOperationEvent !== 'register') {
                    this.testSteps[index].auth_regen_on_open = true;
                    if (this.isEditing && this.editingTestSteps) {
                        this.editingTestSteps[index].auth_regen_on_open = true;
                    }
                }
            }
            
            // 如果是操作类型变化，重新渲染
            if (field === 'operation_type') {
                const emptyValue = '';
                this.testSteps[index].operation_params = emptyValue;
                
                // 如果变更为游戏操作，清空标签页跳转相关数据
                if (value === 'game') {
                    this.testSteps[index].tab_switch_enabled = 'no';
                    this.testSteps[index].tab_switch_action = 'no';
                    this.testSteps[index].tab_target_url = '';
                    this.testSteps[index].tab_target_name = '';
                    // 游戏操作不需要事件与输入
                    this.testSteps[index].operation_event = 'click';
                    this.testSteps[index].input_value = '';
                }
                
                // 如果是编辑模式，同时更新编辑副本
                if (this.isEditing && this.editingTestSteps) {
                    this.editingTestSteps[index].operation_params = emptyValue;
                    // 同样清空编辑副本中的标签页跳转数据
                    if (value === 'game') {
                        this.editingTestSteps[index].tab_switch_enabled = 'no';
                        this.editingTestSteps[index].tab_switch_action = 'no';
                        this.editingTestSteps[index].tab_target_url = '';
                        this.editingTestSteps[index].tab_target_name = '';
                        this.editingTestSteps[index].operation_event = 'click';
                        this.editingTestSteps[index].input_value = '';
                    }
                }
                
                // 重新计算标签页索引（因为可能有标签页跳转数据被清空）
                this.recalculateStepTabIndexes();
                this.renderTestSteps();
            }
            
            // 当操作事件变化时（仅针对web步骤），若非"输入"则清空输入内容，并重新渲染以显示/隐藏输入框
            if (field === 'operation_event') {
                if (this.testSteps[index].operation_type !== 'web') {
                    return; // 非web不处理事件
                }
                // 标记注册配置在下次打开时是否需要重新生成
                const prev = prevOperationEvent;
                // 已在上方赋值，这里读取赋值后的值
                const current = value;
                if (prev === 'register' && current !== 'register') {
                    // 离开注册：下一次回到注册并点击配置时需要重新生成，并清理临时账号以避免登录沿用注册生成的账号
                    this.testSteps[index].auth_regen_on_open = true;
                    this.testSteps[index].auth_temp_credentials_list = [];
                    if (this.isEditing && this.editingTestSteps) {
                        this.editingTestSteps[index].auth_regen_on_open = true;
                        this.editingTestSteps[index].auth_temp_credentials_list = [];
                    }
                }
                if (value !== 'input') {
                    this.testSteps[index].input_value = '';
                    if (this.isEditing && this.editingTestSteps) {
                        this.editingTestSteps[index].input_value = '';
                    }
                }
                this.renderTestSteps();
            }
            
            // 如果是跳转相关字段变化，重新计算所有步骤的标签页索引
            if (field === 'tab_switch_action' || field === 'tab_target_url' || field === 'tab_switch_enabled') {
                this.recalculateStepTabIndexes();
            }
            
            // 特殊处理断言和截图相关字段的null值
            if ((field.startsWith('assertion_') || field.startsWith('screenshot_')) && value === null) {
                // 对于null值，确保编辑副本也设置为null
                if (this.isEditing && this.editingTestSteps && this.editingTestSteps[index]) {
                    this.editingTestSteps[index][field] = null;
                }
            }

        }
    }

    // 移除测试步骤
    removeTestStep(index) {
        this.testSteps.splice(index, 1);
        
        // 如果是编辑模式，同时更新编辑副本
        if (this.isEditing && this.editingTestSteps) {
            this.editingTestSteps.splice(index, 1);
        }
        
        // 重新计算所有步骤的标签页索引
        this.recalculateStepTabIndexes();
        
        this.renderTestSteps();
    }

    // 切换标签页跳转功能
    toggleTabSwitch(index, value) {
        this.updateTestStep(index, 'tab_switch_enabled', value);
        
        // 如果选择"否"，清空相关字段
        if (value === 'no') {
            this.updateTestStep(index, 'tab_target_url', '');
            this.updateTestStep(index, 'tab_target_name', '');
            this.updateTestStep(index, 'tab_target_index', '');
            this.updateTestStep(index, 'tab_switch_action', 'no');
        }
        
        // 更新配置按钮状态
        const configBtn = document.querySelector(`.test-step:nth-child(${index + 1}) .tab-config-btn`);
        if (configBtn) {
            if (value === 'yes') {
                configBtn.classList.remove('disabled');
                configBtn.disabled = false;
            } else {
                configBtn.classList.add('disabled');
                configBtn.disabled = true;
            }
        }
        
        // 注意：重新计算标签页索引已经在updateTestStep中处理了
        // 重新渲染以更新状态显示
        this.renderTestSteps();
    }

    // 切换断言状态
    toggleAssertion(index, value) {
        this.updateTestStep(index, 'assertion_enabled', value);
        
        // 如果选择"否"，清空相关字段
        if (value === 'no') {
            this.updateTestStep(index, 'assertion_type', '');
            this.updateTestStep(index, 'assertion_target', '');
            this.updateTestStep(index, 'assertion_expected', '');
            this.updateTestStep(index, 'assertion_operator', '');
        }
        
        // 更新配置按钮状态
        const configBtn = document.querySelector(`.test-step:nth-child(${index + 1}) .assertion-config-btn`);
        if (configBtn) {
            if (value === 'yes') {
                configBtn.classList.remove('disabled');
                configBtn.disabled = false;
            } else {
                configBtn.classList.add('disabled');
                configBtn.disabled = true;
            }
        }
        
        // 重新渲染以更新状态显示
        this.renderTestSteps();
    }

    // 截图设置相关方法
    toggleScreenshot(index, value) {
        this.updateTestStep(index, 'screenshot_enabled', value);
        
        // 如果选择"否"，清空相关字段
        if (value === 'no') {
            this.updateTestStep(index, 'screenshot_timing', '');
            this.updateTestStep(index, 'screenshot_format', '');
            this.updateTestStep(index, 'screenshot_quality', '');
            this.updateTestStep(index, 'screenshot_prefix', '');
            this.updateTestStep(index, 'screenshot_full_page', '');
            this.updateTestStep(index, 'screenshot_path', '');
            this.updateTestStep(index, 'screenshot_config', null);
        }
        
        // 更新配置按钮状态
        const configBtn = document.querySelector(`.test-step:nth-child(${index + 1}) .screenshot-config-btn`);
        if (configBtn) {
            if (value === 'yes') {
                configBtn.classList.remove('disabled');
                configBtn.disabled = false;
            } else {
                configBtn.classList.add('disabled');
                configBtn.disabled = true;
            }
        }
        
        // 重新渲染以更新状态显示
        this.renderTestSteps();
    }

    // 打开截图配置弹框
    openScreenshotModal(index) {
        this.currentScreenshotIndex = index;
        const step = this.testSteps[index];
        
        // 获取当前步骤的截图配置
        const screenshotConfig = step.screenshot_config || { timing: 'after' };
        this.originalScreenshotConfig = JSON.parse(JSON.stringify(screenshotConfig));
        this.tempScreenshotConfig = JSON.parse(JSON.stringify(screenshotConfig));
        
        // 显示弹框
        const modal = document.getElementById('screenshotModal');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // 设置timing按钮状态
        const timingButtons = modal.querySelectorAll('.timing-btn');
        timingButtons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.timing === screenshotConfig.timing) {
                btn.classList.add('active');
            }
        });
        
        // 添加按钮点击事件（只添加一次）
        if (!modal._timingHandlerAdded) {
            timingButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    // 移除所有按钮的active类
                    timingButtons.forEach(b => b.classList.remove('active'));
                    // 添加active类到当前按钮
                    btn.classList.add('active');
                    
                    // 保存到临时配置
                    this.tempScreenshotConfig.timing = btn.dataset.timing;
                });
            });
            modal._timingHandlerAdded = true;
        }
    }
    
    // 保存截图配置
    saveScreenshotConfig() {
        if (this.currentScreenshotIndex === null) return;
        
        const step = this.testSteps[this.currentScreenshotIndex];
        if (!step.screenshot_config) {
            step.screenshot_config = {};
        }
        
        // 应用临时配置
        step.screenshot_config = JSON.parse(JSON.stringify(this.tempScreenshotConfig));
        
        // 使用updateTestStep来更新步骤数据，确保同时更新编辑副本
        this.updateTestStep(this.currentScreenshotIndex, 'screenshot_config', step.screenshot_config);
        
        // 关闭弹框
        this.closeScreenshotModal();
        
        showToast('截图配置保存成功', 'success');
    }

    // 取消截图配置
    cancelScreenshotModal() {
        // 恢复原始配置
        if (this.currentScreenshotIndex !== null && this.originalScreenshotConfig) {
            const step = this.testSteps[this.currentScreenshotIndex];
            step.screenshot_config = JSON.parse(JSON.stringify(this.originalScreenshotConfig));
        }
        
        // 关闭弹框
        this.closeScreenshotModal();
    }

    // 关闭截图配置弹框
    closeScreenshotModal() {
        const modal = document.getElementById('screenshotModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
            this.currentScreenshotIndex = null;
            this.originalScreenshotConfig = null;
            this.tempScreenshotConfig = null;
        }
    }





    // 打开标签页跳转配置弹框
    openTabSwitchModal(index) {
        this.currentTabSwitchIndex = index;
        const step = this.testSteps[index];
        
        // 更新弹框标题中的步骤信息
        const infoContent = document.querySelector('.tab-switch-info .info-content p');
        if (infoContent) {
            // 计算如果当前步骤选择跳转，将在哪个标签页操作
            // 标签页 = 1(产品地址) + 前面所有跳转步骤数量 + 1(当前步骤跳转)
            let targetTab = 1; // 产品地址页固定为1
            
            // 统计前面步骤中的跳转数量
            for (let i = 0; i < index; i++) {
                const prevStep = this.testSteps[i];
                if (prevStep.tab_switch_enabled === 'yes') {
                    targetTab++;
                }
            }
            
            // 当前步骤假设选择跳转，再+1
            targetTab++;
            
            infoContent.innerHTML = `当前步骤位于 <strong>标签页 #${targetTab}</strong>，将跳转到新的标签页进行当前测试步骤操作。`;
        }
        
        // 设置弹框中的值
        const targetUrlInput = document.getElementById('modal-tab-target-url');
        const targetIndexInput = document.getElementById('modal-tab-target-index');
        
        // 设置现有的跳转URL
        if (targetUrlInput) {
            targetUrlInput.value = step.tab_target_url || '';
            
            // 添加实时验证
            targetUrlInput.addEventListener('input', () => {
                targetUrlInput.classList.remove('error');
            });
            
            targetUrlInput.addEventListener('blur', () => {
                if (targetUrlInput.value.trim()) {
                    try {
                        new URL(targetUrlInput.value.trim());
                        targetUrlInput.classList.remove('error');
                    } catch (e) {
                        targetUrlInput.classList.add('error');
                    }
                }
            });
        }
        
        // 自动计算并设置目标标签页索引
        this.updateTargetTabIndex();
        
        // 更新标签页导航图
        this.updateTabNavigationFlow();
        
        // 显示弹框
        const modal = document.getElementById('tabSwitchModal');
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
            
            // 添加ESC键关闭功能  
            this.escKeyHandler = (e) => {
                if (e.key === 'Escape') {
                    this.closeTabSwitchModal();
                }
            };
            document.addEventListener('keydown', this.escKeyHandler);
        }
    }

    // 打开断言配置弹框
    openAssertionModal(index) {
        this.currentAssertionIndex = index;
        const step = this.testSteps[index];
        
        // 设置弹框中的值
        this.loadAssertionConfig(step);
        
        // 显示弹框
        const modal = document.getElementById('assertionModal');
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
            
            // 添加ESC键关闭功能  
            this.assertionEscKeyHandler = (e) => {
                if (e.key === 'Escape') {
                    this.closeAssertionModal();
                }
            };
            document.addEventListener('keydown', this.assertionEscKeyHandler);
        }
    }

    // 关闭标签页跳转配置弹框
    closeTabSwitchModal() {
        const modal = document.getElementById('tabSwitchModal');
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
        
        // 移除ESC键事件监听器
        if (this.escKeyHandler) {
            document.removeEventListener('keydown', this.escKeyHandler);
            this.escKeyHandler = null;
        }
        
        this.currentTabSwitchIndex = null;
    }

    // 关闭断言配置弹框
    closeAssertionModal() {
        const modal = document.getElementById('assertionModal');
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
        
        // 移除ESC键事件监听器
        if (this.assertionEscKeyHandler) {
            document.removeEventListener('keydown', this.assertionEscKeyHandler);
            this.assertionEscKeyHandler = null;
        }
        
        this.currentAssertionIndex = null;
    }

    // 登录/注册配置：打开弹框
    openAuthConfigModal(index) {
        this.currentAuthIndex = index;
        const step = this.testSteps[index];
        const modal = document.getElementById('authConfigModal');
        try { console.log('[AuthConfig] openAuthConfigModal', { index, operation_event: step && step.operation_event, isEditing: this.isEditing, currentEditingProjectId: this.currentEditingProject && this.currentEditingProject.id }); } catch (_) {}
        if (!modal) return;

        // 确保无论后续是否提前 return，弹窗都会展示
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        this.authEscKeyHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeAuthConfigModal();
            }
        };
        document.addEventListener('keydown', this.authEscKeyHandler);

        const config = step && step.auth_config ? step.auth_config : {};
        const emailSelectorInput = document.getElementById('auth-email-selector');
        const passwordSelectorInput = document.getElementById('auth-password-selector');
        const repeatPasswordSelectorInput = document.getElementById('auth-repeat-password-selector');
        const submitSelectorInput = document.getElementById('auth-submit-selector');
        if (emailSelectorInput) emailSelectorInput.value = config.email_selector || '';
        if (passwordSelectorInput) passwordSelectorInput.value = config.password_selector || '';
        if (repeatPasswordSelectorInput) repeatPasswordSelectorInput.value = config.repeat_password_selector || '';
        if (submitSelectorInput) submitSelectorInput.value = config.submit_selector || '';

        // 渲染地址与账号列表（注册：需要为每个地址生成唯一账号；登录：尝试读取历史账号）
        if ((step.operation_event || '') === 'register') {
            const addresses = this.collectProjectProductAddresses();
            const existingList = Array.isArray(config.address_credentials_list) ? config.address_credentials_list : [];

            // 如果保持在注册且之前已经有临时列表，则沿用，不重新生成
            if (Array.isArray(step.auth_temp_credentials_list) && step.auth_temp_credentials_list.length === addresses.length && step.auth_regen_on_open !== true) {
                this.renderAuthAddressList(step.auth_temp_credentials_list);
            } else {
                fetch('/api/automation/auth-accounts/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ addresses })
                })
                .then(res => res.json())
                .then(resp => {
                    const genList = (resp && resp.success && resp.data && Array.isArray(resp.data.accounts_list)) ? resp.data.accounts_list : [];
                    const preferGenerated = step.auth_regen_on_open === true;
                    const mergedList = addresses.map((addr, i) => {
                        const e = existingList[i] || {};
                        const g = genList[i] || {};
                        const email = preferGenerated ? (g.email || e.email || '') : (e.email || g.email || '');
                        const password = preferGenerated ? (g.password || e.password || '') : (e.password || g.password || '');
                        return { address: (addr || '').trim(), email, password };
                    });
                    // 保存为临时列表，直到用户点击保存
                    this.testSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(mergedList));
                    this.testSteps[index].auth_temp_source = 'register';
                    if (this.isEditing && this.editingTestSteps) {
                        this.editingTestSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(mergedList));
                        this.editingTestSteps[index].auth_temp_source = 'register';
                    }
                    // 重置标志：已重新生成
                    this.testSteps[index].auth_regen_on_open = false;
                    if (this.isEditing && this.editingTestSteps) {
                        this.editingTestSteps[index].auth_regen_on_open = false;
                    }
                    this.renderAuthAddressList(mergedList);
                })
                .catch(() => {
                    // 失败时退化为渲染已有列表
                    if (existingList.length > 0) {
                        this.renderAuthAddressList(existingList);
                    } else {
                        this.renderAuthAddressList(config.address_credentials || {});
                    }
                });
            }
        } else {
            const addresses = this.collectProjectProductAddresses();
            const savedList = (config && config.credentials_source === 'login' && Array.isArray(config.address_credentials_list)) ? config.address_credentials_list : [];
            const fallback = (config && config.credentials_source === 'login') ? (config.address_credentials || {}) : {};
            try { console.log('[AuthConfig] enter login branch', { addresses, fallbackKeys: Object.keys(fallback || {}), savedListLen: savedList.length }); } catch(_){ }
            // 优先使用会话中的临时数据或已保存到步骤的列表，避免二次打开被清空
            if (step.auth_temp_source === 'login' && Array.isArray(step.auth_temp_credentials_list) && step.auth_temp_credentials_list.length === (addresses || []).length) {
                const tempList = step.auth_temp_credentials_list || [];
                const hasAddress = tempList.some(it => it && typeof it.address === 'string' && it.address.trim());
                if (hasAddress) {
                    const allMatch = (addresses || []).every((addr, i) => ((tempList[i] && (tempList[i].address || '').trim()) === ((addr || '').trim())));
                    if (allMatch) {
                        this.renderAuthAddressList(tempList);
                        return;
                    } else {
                        const tempMap = {};
                        tempList.forEach(it => {
                            const key = (it && it.address ? String(it.address).trim() : '').trim();
                            if (key) tempMap[key] = { email: it.email || '', password: it.password || '' };
                        });
                        const remapped = (addresses || []).map(addr => tempMap[(addr || '').trim()] || { email: '', password: '' });
                        this.renderAuthAddressList(remapped);
                        return;
                    }
                } else {
                    // 没有地址字段，可能地址顺序已变更，跳过使用临时列表
                }
            }
            if (Array.isArray(savedList) && savedList.length === (addresses || []).length) {
                const hasAddress = savedList.some(it => it && typeof it.address === 'string' && it.address.trim());
                if (hasAddress) {
                    const allMatch = (addresses || []).every((addr, i) => ((savedList[i] && (savedList[i].address || '').trim()) === ((addr || '').trim())));
                    if (allMatch) {
                        this.renderAuthAddressList(savedList);
                        return;
                    } else {
                        const savedMap = {};
                        savedList.forEach(it => {
                            const key = (it && it.address ? String(it.address).trim() : '').trim();
                            if (key) savedMap[key] = { email: it.email || '', password: it.password || '' };
                        });
                        const remapped = (addresses || []).map(addr => savedMap[(addr || '').trim()] || { email: '', password: '' });
                        this.renderAuthAddressList(remapped);
                        return;
                    }
                } else {
                    // 没有地址字段，可能地址顺序已变更，跳过使用保存列表
                }
            }
            if (this.currentEditingProject && this.currentEditingProject.id) {
                const url = `/api/automation/auth-accounts?project_id=${this.currentEditingProject.id}`;
                try { console.log('[AuthConfig] fetch', { url, projectId: this.currentEditingProject.id }); } catch(_){}
                fetch(url)
                    .then(res => res.json())
                    .then(resp => {
                        try { console.log('[AuthConfig] api result', resp); } catch(_){}
                        const data = (resp && resp.success && resp.data) ? resp.data : {};
                        const accounts = data.accounts || {};
                        const accountsList = Array.isArray(data.accounts_list) ? data.accounts_list : [];
                        const accountsSlots = data.accounts_slots || {};
                        const productSlots = data.product_address_slots || {};
                        try { console.log('[AuthConfig] parsed data', { by_address_keys: Object.keys(accounts || {}), by_order_len: accountsList.length, by_slot_keys: Object.keys(accountsSlots || {}), product_slots: productSlots }); } catch(_){}
                        try { console.log('[AuthConfig] accountsSlots data:', accountsSlots); } catch(_){}
                        try { console.log('[AuthConfig] productSlots data:', productSlots); } catch(_){}
                        // 优先使用槽位映射（by_slot）：按地址进行分组与顺序分配，确保相同地址依次取不同账号
                        const slotEntries = Object.entries(accountsSlots || {}).filter(([k, v]) => {
                            const info = v || {};
                            return (info.email && info.email.trim()) || (info.password && info.password.trim());
                        });
                        try { console.log('[AuthConfig] slotEntries:', slotEntries); } catch(_){}
                        if (slotEntries.length > 0) {
                            // 将槽位按数字顺序排序
                            const sortedSlotKeys = slotEntries
                                .map(([k]) => String(k))
                                .sort((a, b) => {
                                    const na = parseInt(String(a).replace(/\D/g, '')) || 0;
                                    const nb = parseInt(String(b).replace(/\D/g, '')) || 0;
                                    return na - nb;
                                });
                            // address -> 对应槽位队列（保持顺序）
                            const addrToSlotQueue = {};
                            sortedSlotKeys.forEach((slotKey) => {
                                const addr = (productSlots && productSlots[slotKey]) ? String(productSlots[slotKey]).trim() : (accountsSlots[slotKey] || {}).address || '';
                                const normAddr = (addr || '').trim();
                                try { console.log('[AuthConfig] slot mapping:', { slotKey, addr, normAddr, productSlots_value: productSlots[slotKey], accountsSlots_value: accountsSlots[slotKey] }); } catch(_){}
                                if (!normAddr) return;
                                if (!addrToSlotQueue[normAddr]) addrToSlotQueue[normAddr] = [];
                                addrToSlotQueue[normAddr].push(slotKey);
                            });
                            try { console.log('[AuthConfig] addrToSlotQueue:', addrToSlotQueue); } catch(_){}
                            
                            // 为每个地址维护一个使用计数器，用于依次分配不同的槽位
                            const addrUsageCount = {};
                            const mergedList = (addresses || []).map((addr) => {
                                const normAddr = (addr || '').trim();
                                const availableSlots = addrToSlotQueue[normAddr] || [];
                                
                                // 初始化或递增使用计数
                                if (!addrUsageCount[normAddr]) addrUsageCount[normAddr] = 0;
                                
                                // 依次分配不同的槽位（不循环重复，超出范围则为空）
                                const slotKey = addrUsageCount[normAddr] < availableSlots.length ? availableSlots[addrUsageCount[normAddr]] : null;
                                addrUsageCount[normAddr]++;
                                
                                const slotData = slotKey ? (accountsSlots[slotKey] || {}) : {};
                                const result = {
                                    address: normAddr,
                                    email: slotData.email || '',
                                    password: slotData.password || ''
                                };
                                try { console.log('[AuthConfig] merging address:', { normAddr, availableSlots, usageCount: addrUsageCount[normAddr], slotKey, slotData, result }); } catch(_){}
                                return result;
                            });
                            try { console.log('[AuthConfig] using by_slot', { sortedSlotKeys, addrToSlotQueue, addresses, mergedList }); } catch(_){}
                            // 若 by_slot 仍有空白，继续用 accounts_list/by_address/fallback 进行补全
                            let finalList = mergedList;
                            const hasEmpty = (mergedList || []).some(it => !(it && it.email && it.email.trim()));
                            if (hasEmpty) {
                                try { console.log('[AuthConfig] by_slot has empty, try to fill from accounts_list/by_address'); } catch(_){}
                                // 按地址分组 accounts_list
                                const grouped = {};
                                (accountsList || []).forEach((item) => {
                                    const key = (item && item.address ? String(item.address).trim() : '').trim();
                                    if (!grouped[key]) grouped[key] = [];
                                    grouped[key].push({ email: item.email || '', password: item.password || '' });
                                });
                                // 已使用邮箱集合（按地址）
                                const usedByAddr = {};
                                finalList = (addresses || []).map((addr, i) => {
                                    const key = (addr || '').trim();
                                    const prev = mergedList[i] || { address: key, email: '', password: '' };
                                    if (!usedByAddr[key]) usedByAddr[key] = new Set();
                                    if (prev.email && prev.email.trim()) usedByAddr[key].add(prev.email.trim());
                                    if (prev.email && prev.email.trim()) {
                                        return prev;
                                    }
                                    // 先从 accounts_list 中按地址取下一个未使用的
                                    const list = grouped[key] || [];
                                    let picked = null;
                                    while (list.length > 0) {
                                        const next = list.shift();
                                        const em = (next && next.email) ? next.email.trim() : '';
                                        if (em && !usedByAddr[key].has(em)) {
                                            picked = { email: em, password: (next && next.password) ? next.password : '' };
                                            usedByAddr[key].add(em);
                                            break;
                                        }
                                    }
                                    // 仍无则回退到 by_address 或 fallback
                                    if (!picked) {
                                        const back = (accounts && accounts[key]) ? accounts[key] : ((fallback && fallback[key]) ? fallback[key] : {});
                                        const backEmail = (back && back.email) ? String(back.email).trim() : '';
                                        if (backEmail && !usedByAddr[key].has(backEmail)) {
                                            picked = { email: backEmail, password: (back && back.password) ? back.password : '' };
                                            usedByAddr[key].add(backEmail);
                                        }
                                    }
                                    return {
                                        address: key,
                                        email: picked && picked.email ? picked.email : (prev.email || ''),
                                        password: picked && picked.password ? picked.password : (prev.password || '')
                                    };
                                });
                                try { console.log('[AuthConfig] filled from accounts_list/by_address', { finalList }); } catch(_){}
                            }
                            this.testSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(finalList));
                            this.testSteps[index].auth_temp_source = 'login';
                            if (this.isEditing && this.editingTestSteps) {
                                this.editingTestSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(finalList));
                                this.editingTestSteps[index].auth_temp_source = 'login';
                            }
                            this.renderAuthAddressList(finalList);
                            return;
                        }
                        // 其次使用 accounts_list：按地址分组，重复地址依次取列表中的下一个
                        if (accountsList.length > 0) {
                            // 分组：address -> [{email,password}...]
                            const grouped = {};
                            accountsList.forEach((item) => {
                                const key = (item && item.address ? String(item.address).trim() : '').trim();
                                if (!grouped[key]) grouped[key] = [];
                                grouped[key].push({ email: item.email || '', password: item.password || '' });
                            });
                            const usedByAddr = {};
                            const mergedList = (addresses || []).map((addr) => {
                                const key = (addr || '').trim();
                                if (!usedByAddr[key]) usedByAddr[key] = new Set();
                                const list = grouped[key] || [];
                                let picked = { email: '', password: '' };
                                while (list.length > 0) {
                                    const next = list.shift();
                                    const email = (next && next.email) ? next.email : '';
                                    if (!usedByAddr[key].has(email)) {
                                        picked = { email: email || '', password: (next && next.password) ? next.password : '' };
                                        usedByAddr[key].add(email);
                                        break;
                                    }
                                }
                                // 若列表耗尽仍为空，则回退到 by_address/fallback，避免空白；且避免重复
                                if (!(picked.email && picked.email.trim())) {
                                    const back = (accounts && accounts[key]) ? accounts[key] : ((fallback && fallback[key]) ? fallback[key] : {});
                                    const backEmail = (back && back.email) ? back.email : '';
                                    if (backEmail && !usedByAddr[key].has(backEmail)) {
                                        picked = { email: backEmail, password: (back && back.password) ? back.password : '' };
                                        usedByAddr[key].add(backEmail);
                                    }
                                }
                                return { address: key, email: picked.email || '', password: picked.password || '' };
                            });
                            try { console.log('[AuthConfig] using by_order', { groupedKeys: Object.keys(grouped), addresses, mergedList }); } catch(_){}
                            // 保存临时列表用于编辑态
                            this.testSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(mergedList));
                            this.testSteps[index].auth_temp_source = 'login';
                            if (this.isEditing && this.editingTestSteps) {
                                this.editingTestSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(mergedList));
                                this.editingTestSteps[index].auth_temp_source = 'login';
                            }
                            this.renderAuthAddressList(mergedList);
                            return;
                        }
                        // 否则退回到 by_address 映射（按出现顺序，重复地址仅分配一次，其余留空）
                        const usedByAddr = {};
                        const mergedList = (addresses || []).map((addr) => {
                            const key = (addr || '').trim();
                            if (!usedByAddr[key]) usedByAddr[key] = new Set();
                            const back = (accounts && accounts[key]) ? accounts[key] : ((fallback && fallback[key]) ? fallback[key] : {});
                            const email = (back && back.email) ? String(back.email).trim() : '';
                            if (email && !usedByAddr[key].has(email)) {
                                usedByAddr[key].add(email);
                                return { address: key, email: email, password: (back && back.password) ? back.password : '' };
                            }
                            return { address: key, email: '', password: '' };
                        });
                        try { console.log('[AuthConfig] using by_address fallback', { mergedList }); } catch(_){}
                        this.testSteps[index].auth_temp_source = 'login';
                        this.renderAuthAddressList(mergedList);
                    })
                    .catch((err) => {
                        try { console.log('[AuthConfig] fetch error, render fallback', err); } catch(_){}
                        this.renderAuthAddressList(fallback || {});
                    });
            } else {
                try { console.log('[AuthConfig] skip fetch (no project id), try lookup by address'); } catch(_){ }
                fetch('/api/automation/auth-accounts/lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ addresses })
                })
                .then(res => res.json())
                .then(resp => {
                    const data = (resp && resp.success && resp.data) ? resp.data : {};
                    const byAddress = data.accounts || {};
                    const accountsList = Array.isArray(data.accounts_list) ? data.accounts_list : [];
                    let mergedList = [];
                    if (accountsList.length > 0) {
                        // 分组：address -> [{email,password}...]
                        const grouped = {};
                        accountsList.forEach((item) => {
                            const key = (item && item.address ? String(item.address).trim() : '').trim();
                            if (!grouped[key]) grouped[key] = [];
                            grouped[key].push({ email: item.email || '', password: item.password || '' });
                        });
                        const usedByAddr = {};
                        mergedList = (addresses || []).map((addr) => {
                            const key = (addr || '').trim();
                            if (!usedByAddr[key]) usedByAddr[key] = new Set();
                            const list = grouped[key] || [];
                            let picked = { email: '', password: '' };
                            while (list.length > 0) {
                                const next = list.shift();
                                const email = (next && next.email) ? next.email : '';
                                if (!usedByAddr[key].has(email)) {
                                    picked = { email: email || '', password: (next && next.password) ? next.password : '' };
                                    usedByAddr[key].add(email);
                                    break;
                                }
                            }
                            // 若列表耗尽仍为空，则回退到 by_address/fallback，避免重复
                            if (!(picked.email && picked.email.trim())) {
                                const back = (byAddress && byAddress[key]) ? byAddress[key] : ((fallback && fallback[key]) ? fallback[key] : {});
                                const backEmail = (back && back.email) ? back.email : '';
                                if (backEmail && !usedByAddr[key].has(backEmail)) {
                                    picked = { email: backEmail, password: (back && back.password) ? back.password : '' };
                                    usedByAddr[key].add(backEmail);
                                }
                            }
                            return { address: key, email: picked.email || '', password: picked.password || '' };
                        });
                        try { console.log('[AuthConfig] using lookup accounts_list', { addresses, mergedList }); } catch(_){ }
                    } else {
                        // 按 by_address 回退，但对于重复地址只分配一次账号，其余留空
                        const assignedByAddr = {};
                        mergedList = (addresses || []).map((addr) => {
                            const key = (addr || '').trim();
                            if (!assignedByAddr[key]) assignedByAddr[key] = new Set();
                            const back = (byAddress && byAddress[key]) ? byAddress[key] : ((fallback && fallback[key]) ? fallback[key] : {});
                            const email = (back && back.email) ? String(back.email).trim() : '';
                            if (email && !assignedByAddr[key].has(email)) {
                                assignedByAddr[key].add(email);
                                return { address: key, email: email, password: (back && back.password) ? back.password : '' };
                            }
                            return { address: key, email: '', password: '' };
                        });
                        try { console.log('[AuthConfig] using lookup by_address fallback', mergedList); } catch(_){ }
                    }
                    this.testSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(mergedList));
                    this.testSteps[index].auth_temp_source = 'login';
                    if (this.isEditing && this.editingTestSteps) {
                        this.editingTestSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(mergedList));
                        this.editingTestSteps[index].auth_temp_source = 'login';
                    }
                    this.renderAuthAddressList(mergedList);
                })
                .catch((err) => {
                    try { console.log('[AuthConfig] lookup failed, render fallback', err); } catch(_){ }
                    const existingList = Array.isArray(config.address_credentials_list) ? config.address_credentials_list : [];
                    let renderList;
                    if (existingList.length === (addresses || []).length) {
                        renderList = existingList;
                    } else {
                        // 回退时也应避免将同一邮箱分配给重复地址
                        const assignedByAddr = {};
                        renderList = (addresses || []).map((addr) => {
                            const key = (addr || '').trim();
                            if (!assignedByAddr[key]) assignedByAddr[key] = new Set();
                            const back = (fallback && fallback[key]) ? fallback[key] : {};
                            const email = (back && back.email) ? String(back.email).trim() : '';
                            if (email && !assignedByAddr[key].has(email)) {
                                assignedByAddr[key].add(email);
                                return { address: key, email: email, password: (back && back.password) ? back.password : '' };
                            }
                            return { address: key, email: '', password: '' };
                        });
                    }
                    this.testSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(renderList));
                    this.testSteps[index].auth_temp_source = 'login';
                    if (this.isEditing && this.editingTestSteps) {
                        this.editingTestSteps[index].auth_temp_credentials_list = JSON.parse(JSON.stringify(renderList));
                        this.editingTestSteps[index].auth_temp_source = 'login';
                    }
                    this.renderAuthAddressList(renderList);
                });
            }
        }

    }

    // 渲染登录/注册的地址账号列表
    renderAuthAddressList(existingCredentials) {
        const container = document.getElementById('auth-address-list');
        if (!container) return;

        try { console.log('[AuthConfig] renderAuthAddressList input', existingCredentials); } catch(_){}
        const addresses = this.collectProjectProductAddresses();
        try { console.log('[AuthConfig] renderAuthAddressList addresses', addresses); } catch(_){}
        if (!addresses || addresses.length === 0) {
            container.innerHTML = `
                <div class="no-address">
                    <i class="fas fa-info-circle" style="margin-right: 6px;"></i>
                    <span>请先在上方填写产品地址后再配置账号信息</span>
                </div>
            `;
            return;
        }

        container.innerHTML = addresses.map((addr, idx) => {
            const cred = Array.isArray(existingCredentials) ? (existingCredentials[idx] || {}) : (existingCredentials[addr] || {});
            const email = cred.email || '';
            const password = cred.password || '';
            const emailValid = this.isValidEmail ? this.isValidEmail(email) : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
            const showWarn = !emailValid;
            const emailInputClass = `form-control auth-email${showWarn ? ' is-invalid' : ''}`;
            const emailInputStyle = showWarn ? ' style="border: 2px solid #dc3545; box-shadow: 0 0 0 2px rgba(220,53,69,.1) inset;"' : '';
            const emailWarnHtml = showWarn ? `<div class="auth-empty-tip" style="color:#dc3545;margin-top:4px;font-size:12px;">暂无登录账号，请确认</div>` : '';
            return `
                <div class="auth-address-card auth-address-item" data-address="${addr}">
                    <div class="auth-card-header">
                        <div class="auth-card-title">
                            <i class="fas fa-link"></i>
                            <span>地址</span>
                        </div>
                        <input type="text" class="form-control auth-address" value="${addr}" readonly>
                    </div>
                    <div class="auth-credentials-grid">
                        <div class="form-group">
                            <label><i class="fas fa-envelope"></i> 邮箱</label>
                            <input type="text" class="${emailInputClass}" value="${email}" placeholder="user@example.com"${emailInputStyle}>
                            ${emailWarnHtml}
                        </div>
                        <div class="form-group">
                            <label><i class="fas fa-lock"></i> 密码</label>
                            <input type="text" class="form-control auth-password" value="${password}" placeholder="123456">
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定实时校验：邮箱格式正确则移除警告
        try {
            const emailInputs = container.querySelectorAll('.auth-email');
            const updateState = (inputEl) => {
                const value = (inputEl.value || '').trim();
                const valid = this.isValidEmail ? this.isValidEmail(value) : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
                const tip = inputEl.parentElement ? inputEl.parentElement.querySelector('.auth-empty-tip') : null;
                if (valid) {
                    inputEl.classList.remove('is-invalid');
                    inputEl.style.border = '';
                    inputEl.style.boxShadow = '';
                    if (tip) tip.style.display = 'none';
                } else {
                    inputEl.classList.add('is-invalid');
                    inputEl.style.border = '2px solid #dc3545';
                    inputEl.style.boxShadow = '0 0 0 2px rgba(220,53,69,.1) inset';
                    if (tip) {
                        tip.style.display = '';
                    } else if (inputEl.parentElement) {
                        const warn = document.createElement('div');
                        warn.className = 'auth-empty-tip';
                        warn.style.color = '#dc3545';
                        warn.style.marginTop = '4px';
                        warn.style.fontSize = '12px';
                        warn.textContent = '暂无登录账号，请确认';
                        inputEl.parentElement.appendChild(warn);
                    }
                }
            };
            emailInputs.forEach((el) => {
                updateState(el);
                el.addEventListener('input', () => updateState(el));
                el.addEventListener('blur', () => updateState(el));
            });
        } catch (_) {}
    }

    // 收集当前表单中的产品地址（直接读取"添加自动化项目"弹窗中的地址列表，保留重复）
    collectCurrentProductAddresses() {
        const addresses = [];

        // 1) 优先从地址列表容器读取（无论显示/收起状态）
        const addressListContainer = document.getElementById('addressListContainer');
        if (addressListContainer) {
            const inputs = addressListContainer.querySelectorAll('.product-address-item .address-input, .address-input');
            inputs.forEach(input => {
                const value = (input.value || '').trim();
                if (value) addresses.push(value); // 不去重，确保与上方地址列表一一对应
            });
        }

        // 2) 若未获取到，则尝试单地址输入框
        if (addresses.length === 0) {
            const singleAddressInput = document.getElementById('automationProductAddress');
            if (singleAddressInput) {
                const value = (singleAddressInput.value || '').trim();
                if (value) addresses.push(value);
            }
        }

        // 3) 再次兜底：创建项目页面的多地址容器（如存在）
        if (addresses.length === 0) {
            const multiAddressContainer = document.getElementById('multiAddressContainer');
            if (multiAddressContainer) {
                const inputs = multiAddressContainer.querySelectorAll('.address-input');
                inputs.forEach(input => {
                    const value = (input.value || '').trim();
                    if (value) addresses.push(value);
                });
            }
        }

        return addresses;
    }

    // 收集项目数据库中的产品地址（用于auth配置，从已保存的项目数据中读取）
    collectProjectProductAddresses() {
        // 优先从当前表单读取（用户可能在编辑态中修改了地址但尚未保存）
        const formAddresses = this.collectCurrentProductAddresses();
        if (Array.isArray(formAddresses) && formAddresses.length > 0) {
            return formAddresses;
        }

        const addresses = [];

        // 从当前编辑项目中读取地址配置
        if (this.currentEditingProject && this.currentEditingProject.product_address) {
            try {
                const productAddress = this.currentEditingProject.product_address;
                if (typeof productAddress === 'string') {
                    // 尝试解析为JSON（多地址格式）
                    try {
                        const parsed = JSON.parse(productAddress);
                        if (typeof parsed === 'object' && parsed !== null) {
                            // 多地址格式：{"SCS_1":"https://example1.com/","SCS_2":"https://example2.com/"}
                            Object.values(parsed).forEach(addr => {
                                if (typeof addr === 'string' && addr.trim()) {
                                    addresses.push(addr.trim());
                                }
                            });
                        } else if (typeof parsed === 'string' && parsed.trim()) {
                            // 单地址格式
                            addresses.push(parsed.trim());
                        }
                    } catch (e) {
                        // 不是JSON，可能是单个地址字符串
                        if (productAddress.trim()) {
                            addresses.push(productAddress.trim());
                        }
                    }
                }
            } catch (error) {
                console.error('解析项目地址失败:', error);
            }
        }

        // 如果没有从项目数据中获取到地址，则回退到表单中的地址
        if (addresses.length === 0) {
            return this.collectCurrentProductAddresses();
        }

        return addresses;
    }

    // 校验邮箱格式
    isValidEmail(email) {
        const value = (email || '').trim();
        if (!value) return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    // 登录/注册配置：关闭弹框
    closeAuthConfigModal() {
        const modal = document.getElementById('authConfigModal');
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }

        if (this.authEscKeyHandler) {
            document.removeEventListener('keydown', this.authEscKeyHandler);
            this.authEscKeyHandler = null;
        }

        this.currentAuthIndex = null;
    }

    // 登录/注册配置：保存
    saveAuthConfig() {
        if (this.currentAuthIndex === null || this.currentAuthIndex === undefined) return;
        const step = this.testSteps[this.currentAuthIndex];
        if (!step) return;

        const emailSelectorInput = document.getElementById('auth-email-selector');
        const passwordSelectorInput = document.getElementById('auth-password-selector');
        const repeatPasswordSelectorInput = document.getElementById('auth-repeat-password-selector');
        const submitSelectorInput = document.getElementById('auth-submit-selector');
        const emailSelector = emailSelectorInput ? emailSelectorInput.value.trim() : '';
        const passwordSelector = passwordSelectorInput ? passwordSelectorInput.value.trim() : '';
        const repeatPasswordSelector = repeatPasswordSelectorInput ? repeatPasswordSelectorInput.value.trim() : '';
        const submitSelector = submitSelectorInput ? submitSelectorInput.value.trim() : '';

        if (!emailSelector || !passwordSelector || !submitSelector) {
            this.showErrorMessage('请填写邮箱、密码与提交按钮的元素定位参数');
            if (emailSelectorInput && !emailSelector) emailSelectorInput.focus();
            else if (passwordSelectorInput && !passwordSelector) passwordSelectorInput.focus();
            else if (submitSelectorInput && !submitSelector) submitSelectorInput.focus();
            return;
        }

        const list = document.getElementById('auth-address-list');
        const items = list ? list.querySelectorAll('.auth-address-item') : [];
        const addressCredentials = {};
        const credentialsList = [];
        items.forEach(item => {
            const addr = (item.dataset.address || (item.querySelector('.auth-address') ? item.querySelector('.auth-address').value : '')).trim();
            const email = item.querySelector('.auth-email') ? item.querySelector('.auth-email').value.trim() : '';
            const password = item.querySelector('.auth-password') ? item.querySelector('.auth-password').value.trim() : '';
            if (addr) {
                addressCredentials[addr] = { email, password };
            }
            credentialsList.push({ address: addr, email, password });
        });

        const config = {
            email_selector: emailSelector,
            password_selector: passwordSelector,
            repeat_password_selector: repeatPasswordSelector,
            submit_selector: submitSelector,
            address_credentials: addressCredentials,
            address_credentials_list: credentialsList,
            credentials_source: (step.operation_event || '') === 'register' ? 'register' : 'login'
        };

        // 保存后重置临时列表，并清除强制再生成标志（包含 address 以便按地址重映射）
        this.testSteps[this.currentAuthIndex].auth_temp_credentials_list = JSON.parse(JSON.stringify(credentialsList));
        this.testSteps[this.currentAuthIndex].auth_temp_source = (step.operation_event || '') === 'register' ? 'register' : 'login';
        this.testSteps[this.currentAuthIndex].auth_regen_on_open = false;
        if (this.isEditing && this.editingTestSteps) {
            this.editingTestSteps[this.currentAuthIndex].auth_temp_credentials_list = JSON.parse(JSON.stringify(credentialsList));
            this.editingTestSteps[this.currentAuthIndex].auth_temp_source = (step.operation_event || '') === 'register' ? 'register' : 'login';
            this.editingTestSteps[this.currentAuthIndex].auth_regen_on_open = false;
        }

        this.updateTestStep(this.currentAuthIndex, 'auth_config', config);
        showToast('登录/注册配置已保存', 'success');
        this.closeAuthConfigModal();
    }

    // 加载断言配置
    loadAssertionConfig(step) {
        // 设置当前断言类型
        const assertionConfig = step.assertion_config || {
            ui_assertions: [],
            image_assertions: [],
            custom_assertions: []
        };
        
        // 渲染断言列表
        this.renderAssertionTabs(assertionConfig);
    }

    // 渲染断言选项卡
    renderAssertionTabs(config) {
        // 默认显示UI断言选项卡
        this.showAssertionTab('ui');
        this.renderUIAssertions(config.ui_assertions || []);
        this.renderImageAssertions(config.image_assertions || []);
        this.renderCustomAssertions(config.custom_assertions || []);
    }

    // 显示指定的断言选项卡
    showAssertionTab(tabType) {
        // 切换选项卡按钮状态
        document.querySelectorAll('.assertion-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        document.querySelectorAll('.assertion-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        // 激活指定选项卡
        const activeBtn = document.querySelector(`.assertion-tab-btn[data-tab="${tabType}"]`);
        const activeContent = document.querySelector(`.assertion-tab-content[data-tab="${tabType}"]`);
        
        if (activeBtn) activeBtn.classList.add('active');
        if (activeContent) activeContent.classList.add('active');
    }

    // 渲染UI断言列表
    renderUIAssertions(assertions) {
        const container = document.getElementById('ui-assertions-list');
        if (!container) return;
        
        if (assertions.length === 0) {
            container.innerHTML = `
                <div class="no-assertions">
                    <i class="fas fa-clipboard-list"></i>
                    <p>尚未添加断言</p>
                    <span>点击上方按钮添加断言</span>
                </div>
            `;
        } else {
            container.innerHTML = assertions.map((assertion, index) => `
                <div class="assertion-item">
                    <div class="assertion-content">
                        <h4>${assertion.name || `UI断言 ${index + 1}`}</h4>
                        <p>${assertion.description || '元素存在性验证'}</p>
                        <code>${assertion.xpath || ''}</code>
                    </div>
                    <div class="assertion-actions">
                        <button class="btn-edit" onclick="automationManagement.editUIAssertion(${index})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="automationManagement.deleteUIAssertion(${index})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    // 渲染图片断言列表
    renderImageAssertions(assertions) {
        const container = document.getElementById('image-assertions-list');
        if (!container) return;
        
        if (assertions.length === 0) {
            container.innerHTML = `
                <div class="no-assertions">
                    <i class="fas fa-clipboard-list"></i>
                    <p>尚未添加断言</p>
                    <span>点击上方按钮添加断言</span>
                </div>
            `;
        } else {
            container.innerHTML = assertions.map((assertion, index) => `
                <div class="assertion-item">
                    <div class="assertion-content">
                        <h4>${assertion.name || `图片断言 ${index + 1}`}</h4>
                        <p>${assertion.description || '图片匹配验证'}</p>
                        <div class="image-preview">
                            <img src="${assertion.image_path || ''}" alt="断言图片" />
                        </div>
                    </div>
                    <div class="assertion-actions">
                        <button class="btn-edit" onclick="automationManagement.editImageAssertion(${index})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="automationManagement.deleteImageAssertion(${index})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    // 渲染自定义断言列表
    renderCustomAssertions(assertions) {
        const container = document.getElementById('custom-assertions-list');
        if (!container) return;
        
        if (assertions.length === 0) {
            container.innerHTML = `
                <div class="no-assertions">
                    <i class="fas fa-clipboard-list"></i>
                    <p>尚未添加断言</p>
                    <span>点击上方按钮添加断言</span>
                </div>
            `;
        } else {
            container.innerHTML = assertions.map((assertion, index) => `
                <div class="assertion-item">
                    <div class="assertion-content">
                        <h4>${assertion.name || `自定义断言 ${index + 1}`}</h4>
                        <p>${assertion.description || '自定义代码验证'}</p>
                        <code class="assertion-code">${assertion.code || ''}</code>
                    </div>
                    <div class="assertion-actions">
                        <button class="btn-edit" onclick="automationManagement.editCustomAssertion(${index})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="automationManagement.deleteCustomAssertion(${index})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    // 保存断言配置
    saveAssertionConfig() {
        const step = this.testSteps[this.currentAssertionIndex];
        if (!step) return;
        
        // 收集所有断言数据
        const config = {
            ui_assertions: this.getUIAssertions(),
            image_assertions: this.getImageAssertions(), 
            custom_assertions: this.getCustomAssertions()
        };
        
        // 更新步骤配置
        this.updateTestStep(this.currentAssertionIndex, 'assertion_config', config);
        
        // 关闭弹框
        this.closeAssertionModal();
        
        // 显示成功消息
        showToast('断言配置已保存', 'success');
    }

    // 获取UI断言数据
    getUIAssertions() {
        return this.getCurrentUIAssertions();
    }

    // 获取图片断言数据
    getImageAssertions() {
        return this.getCurrentImageAssertions();
    }

    // 获取自定义断言数据
    getCustomAssertions() {
        return this.getCurrentCustomAssertions();
    }

    // 添加UI断言
    addUIAssertion() {
        this.currentUIAssertionIndex = null;
        this.showUIAssertionModal();
    }

    // 添加图片断言
    addImageAssertion() {
        this.currentImageAssertionIndex = null;
        this.showImageAssertionModal();
    }

    // 添加自定义断言
    addCustomAssertion() {
        this.currentCustomAssertionIndex = null;
        this.showCustomAssertionModal();
        // 初始化代码编辑器主题
        setTimeout(() => {
            this.initCodeTheme();
        }, 100);
    }

    // 编辑UI断言
    editUIAssertion(index) {
        this.currentUIAssertionIndex = index;
        const assertions = this.getCurrentUIAssertions();
        const assertion = assertions[index];
        if (assertion) {
            this.loadUIAssertionData(assertion);
            this.showUIAssertionModal();
        }
    }

    // 删除UI断言
    deleteUIAssertion(index) {
        const step = this.testSteps[this.currentAssertionIndex];
        if (!step.assertion_config) step.assertion_config = {};
        if (!step.assertion_config.ui_assertions) step.assertion_config.ui_assertions = [];
        
        const assertion = step.assertion_config.ui_assertions[index];
        const assertionName = assertion ? `"${assertion.name || `UI断言 ${index + 1}`}"` : '此UI断言';
        
        showCustomConfirm({
            title: '删除UI断言',
            message: `确定要删除${assertionName}吗？`,
            details: [
                '删除的断言配置将无法恢复',
                '可能影响测试步骤的验证逻辑'
            ],
            type: 'danger',
            confirmText: '确定删除',
            cancelText: '取消',
            onConfirm: () => {
                step.assertion_config.ui_assertions.splice(index, 1);
                this.renderUIAssertions(step.assertion_config.ui_assertions);
                showToast('UI断言删除成功', 'success');
            }
        });
    }

    // 编辑图片断言
    editImageAssertion(index) {
        this.currentImageAssertionIndex = index;
        const assertions = this.getCurrentImageAssertions();
        const assertion = assertions[index];
        if (assertion) {
            this.loadImageAssertionData(assertion);
            this.showImageAssertionModal();
        }
    }

    // 删除图片断言
    deleteImageAssertion(index) {
        const step = this.testSteps[this.currentAssertionIndex];
        if (!step.assertion_config) step.assertion_config = {};
        if (!step.assertion_config.image_assertions) step.assertion_config.image_assertions = [];
        
        const assertion = step.assertion_config.image_assertions[index];
        const assertionName = assertion ? `"${assertion.method} 断言"` : '此图片断言';
        
        showCustomConfirm({
            title: '删除图片断言',
            message: `确定要删除${assertionName}吗？`,
            details: [
                '删除的图片基准和配置将无法恢复',
                '可能影响测试步骤的图像验证',
                '建议在删除前确认不再需要此断言'
            ],
            type: 'danger',
            confirmText: '确定删除',
            cancelText: '取消',
            onConfirm: () => {
                step.assertion_config.image_assertions.splice(index, 1);
                this.renderImageAssertions(step.assertion_config.image_assertions);
                showToast('图片断言删除成功', 'success');
            }
        });
    }

    // 编辑自定义断言
    editCustomAssertion(index) {
        this.currentCustomAssertionIndex = index;
        const assertions = this.getCurrentCustomAssertions();
        const assertion = assertions[index];
        if (assertion) {
            this.loadCustomAssertionData(assertion);
            this.showCustomAssertionModal();
            // 初始化代码编辑器主题
            setTimeout(() => {
                this.initCodeTheme();
            }, 100);
        }
    }

    // 删除自定义断言
    deleteCustomAssertion(index) {
        const step = this.testSteps[this.currentAssertionIndex];
        if (!step.assertion_config) step.assertion_config = {};
        if (!step.assertion_config.custom_assertions) step.assertion_config.custom_assertions = [];
        
        const assertion = step.assertion_config.custom_assertions[index];
        const assertionName = assertion ? `"${assertion.name || `自定义断言 ${index + 1}`}"` : '此自定义断言';
        
        showCustomConfirm({
            title: '删除自定义断言',
            message: `确定要删除${assertionName}吗？`,
            details: [
                '删除的自定义代码和配置将无法恢复',
                '可能影响测试步骤的自定义验证逻辑',
                '建议在删除前备份重要的断言代码'
            ],
            type: 'danger',
            confirmText: '确定删除',
            cancelText: '取消',
            onConfirm: () => {
                step.assertion_config.custom_assertions.splice(index, 1);
                this.renderCustomAssertions(step.assertion_config.custom_assertions);
                showToast('自定义断言删除成功', 'success');
            }
        });
    }

    // 重新计算所有步骤的标签页索引
    recalculateStepTabIndexes() {
        this.testSteps.forEach((step, index) => {
            // 计算该步骤的标签页索引
            let tabIndex = 1; // 产品地址页固定为1
            
            // 统计前面步骤中的跳转数量（只考虑Web操作类型）
            for (let i = 0; i < index; i++) {
                const prevStep = this.testSteps[i];
                if (prevStep.operation_type === 'web' && prevStep.tab_switch_enabled === 'yes') {
                    tabIndex++;
                }
            }
            
            // 如果当前步骤有跳转，则在新标签页操作（只对Web操作有效）
            if (step.operation_type === 'web' && step.tab_switch_enabled === 'yes') {
                tabIndex++;
            }
            
            // 更新步骤的标签页索引
            step.current_tab_index = tabIndex;
        });
        
        // 如果是编辑模式，同时更新编辑副本
        if (this.isEditing && this.editingTestSteps) {
            this.editingTestSteps.forEach((step, index) => {
                let tabIndex = 1;
                for (let i = 0; i < index; i++) {
                    const prevStep = this.editingTestSteps[i];
                    if (prevStep.operation_type === 'web' && prevStep.tab_switch_enabled === 'yes') {
                        tabIndex++;
                    }
                }
                if (step.operation_type === 'web' && step.tab_switch_enabled === 'yes') {
                    tabIndex++;
                }
                step.current_tab_index = tabIndex;
            });
        }
    }

    // 保存标签页跳转配置
    saveTabSwitchConfig() {
        if (this.currentTabSwitchIndex !== null) {
            const targetUrlInput = document.getElementById('modal-tab-target-url');
            const targetIndexInput = document.getElementById('modal-tab-target-index');
            
            // 验证必填字段
            if (!targetUrlInput || !targetUrlInput.value.trim()) {
                this.showErrorMessage('请填写目标标签页网址');
                if (targetUrlInput) {
                    targetUrlInput.classList.add('error');
                    targetUrlInput.focus();
                }
                return;
            }
            
            // 验证URL格式
            try {
                new URL(targetUrlInput.value.trim());
            } catch (e) {
                this.showErrorMessage('请输入有效的网址格式');
                if (targetUrlInput) {
                    targetUrlInput.classList.add('error');
                    targetUrlInput.focus();
                }
                return;
            }
            
            // 移除错误样式
            if (targetUrlInput) {
                targetUrlInput.classList.remove('error');
            }
            
            // 保存所有字段 - 固定为跳转模式
            this.updateTestStep(this.currentTabSwitchIndex, 'tab_switch_action', 'yes');
            this.updateTestStep(this.currentTabSwitchIndex, 'tab_target_url', targetUrlInput.value.trim());
            this.updateTestStep(this.currentTabSwitchIndex, 'tab_target_index', targetIndexInput ? targetIndexInput.value : '');
            
            // 重新计算所有步骤的标签页索引
            this.recalculateStepTabIndexes();
            
            showToast('标签页跳转配置已保存', 'success');
        }
        this.closeTabSwitchModal();
    }

    // 显示错误消息
    showErrorMessage(message) {
        // 可以使用现有的通知系统或创建临时提示
        const existingAlert = document.querySelector('.temp-alert');
        if (existingAlert) {
            existingAlert.remove();
        }
        
        const alert = document.createElement('div');
        alert.className = 'temp-alert error';
        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fed7d7;
            color: #c53030;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid #feb2b2;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            z-index: 10000;
            font-size: 14px;
            max-width: 300px;
        `;
        alert.textContent = message;
        document.body.appendChild(alert);
        
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 3000);
    }





    // 计算目标标签页索引
    updateTargetTabIndex() {
        if (this.currentTabSwitchIndex === null || !this.testSteps) return;
        
        const targetIndex = this.calculateTargetTabIndex(this.currentTabSwitchIndex);
        const targetIndexInput = document.getElementById('modal-tab-target-index');
        if (targetIndexInput) {
            targetIndexInput.value = targetIndex;
        }
    }

    // 计算目标标签页索引的核心逻辑
    calculateTargetTabIndex(currentStepIndex) {
        let tabCount = 1; // 初始产品地址页面
        
        // 遍历当前步骤之前的所有步骤
        for (let i = 0; i < currentStepIndex; i++) {
            const step = this.testSteps[i];
            // 只考虑Web操作类型的步骤
            if (step.operation_type === 'web' && step.tab_switch_enabled === 'yes') {
                tabCount++;
            }
        }
        
        // 当前步骤选择跳转，所以目标索引是下一个
        return tabCount + 1;
    }

    // 更新标签页导航图
    updateTabNavigationFlow() {
        const flowContainer = document.getElementById('tab-flow-container');
        if (!flowContainer || this.currentTabSwitchIndex === null) return;
        
        // 固定为跳转模式
        const isJumping = true;
        
        // 计算当前步骤应该高亮的标签页
        const currentHighlightTab = this.calculateCurrentHighlightTab(this.currentTabSwitchIndex, isJumping);
        const totalTabs = this.calculateTotalTabs(this.currentTabSwitchIndex, isJumping);
        
        // 生成导航图HTML
        let flowHtml = '';
        
        for (let i = 1; i <= totalTabs; i++) {
            const isHighlight = i === currentHighlightTab;
            
            let tabClass = 'tab-item';
            let tabLabel = '';
            
            if (i === 1) {
                // 产品地址：只有当它是高亮标签页时才显示为current，否则显示为next
                tabClass += isHighlight ? ' current' : ' next';
                tabLabel = '产品地址';
            } else {
                // 其他标签页：高亮时显示为highlight，否则显示为next
                tabClass += isHighlight ? ' highlight' : ' next';
                tabLabel = `测试步骤${this.getStepNumberForTab(i)}`;
            }
            
            flowHtml += `
                <div class="${tabClass}">
                    <div class="tab-number">${i}</div>
                    <div class="tab-label">${tabLabel}</div>
                </div>
            `;
            
            // 添加连接线（除了最后一个）
            if (i < totalTabs) {
                flowHtml += `
                    <div class="tab-connector">
                        <div class="connector-line"></div>
                        <div class="connector-text">跳转</div>
                    </div>
                `;
            }
        }
        
        flowContainer.innerHTML = flowHtml;
    }

    // 计算当前步骤应该高亮的标签页
    calculateCurrentHighlightTab(currentStepIndex, isJumping) {
        let highlightTab = 1; // 默认高亮产品地址页
        
        if (isJumping) {
            // 如果当前步骤选择跳转，高亮下一个标签页
            highlightTab = this.calculateTargetTabIndex(currentStepIndex);
        } else {
            // 如果当前步骤选择不跳转，需要计算应该在哪个标签页操作
            let tabCount = 1;
            for (let i = 0; i < currentStepIndex; i++) {
                const step = this.testSteps[i];
                // 只考虑Web操作类型的步骤
                if (step.operation_type === 'web' && step.tab_switch_enabled === 'yes') {
                    tabCount++;
                }
            }
            highlightTab = tabCount;
        }
        
        return highlightTab;
    }

    // 计算总标签页数量
    calculateTotalTabs(currentStepIndex, isJumping) {
        let tabCount = 1; // 初始产品地址页面
        
        // 遍历当前步骤之前的步骤
        for (let i = 0; i < currentStepIndex; i++) {
            const step = this.testSteps[i];
            // 只考虑Web操作类型的步骤
            if (step.operation_type === 'web' && step.tab_switch_enabled === 'yes') {
                tabCount++;
            }
        }
        
        // 如果当前步骤选择跳转，再加一个
        if (isJumping) {
            tabCount++;
        }
        
        return tabCount;
    }

    // 获取标签页对应的步骤编号
    getStepNumberForTab(tabIndex) {
        if (tabIndex === 1) return ''; // 产品地址页
        
        let stepCount = 0;
        for (let i = 0; i < this.testSteps.length; i++) {
            const step = this.testSteps[i];
            // 只考虑Web操作类型的步骤
            if (step.operation_type === 'web' && step.tab_switch_enabled === 'yes') {
                stepCount++;
                if (stepCount === tabIndex - 1) {
                    return i + 1;
                }
            }
        }
        
        // 如果是当前正在配置的步骤
        if (this.currentTabSwitchIndex !== null) {
            return this.currentTabSwitchIndex + 1;
        }
        
        return tabIndex - 1;
    }

    // 上传步骤图片 - 修改为缓存预览并更新编辑副本
    async uploadStepImage(index, fileInput) {
        const file = fileInput.files[0];
        if (!file) return;

        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            showToast('请选择图片文件', 'error');
            return;
        }

        // 验证文件大小（最大5MB）
        if (file.size > 5 * 1024 * 1024) {
            showToast('图片大小不能超过5MB', 'error');
            return;
        }

        try {
            // 创建临时预览URL
            const imageUrl = URL.createObjectURL(file);
            
            // 缓存图片文件和预览URL
            this.uploadedImages.set(`step_${index}`, imageUrl);
            this.uploadedImages.set(`step_${index}_file`, file);
            
            // 暂时设置一个临时路径标识
            const tempPath = `temp_image_${index}`;
            
            // 如果是编辑模式，更新编辑副本
            if (this.isEditing && this.editingTestSteps) {
                this.editingTestSteps[index].operation_params = tempPath;
            } else {
                this.testSteps[index].operation_params = tempPath;
            }
            
            // 重新渲染以显示预览
            this.renderTestSteps();
            
            showToast('图片预览已加载，保存项目时将上传到服务器', 'success');
        } catch (error) {
            console.error('加载图片预览失败:', error);
            showToast('加载图片预览失败', 'error');
        }
    }

    // 移除步骤图片 - 修改为只更新编辑副本
    removeStepImage(index) {
        // 清理缓存的图片
        const imageUrl = this.uploadedImages.get(`step_${index}`);
        if (imageUrl && imageUrl.startsWith('blob:')) {
            URL.revokeObjectURL(imageUrl); // 释放内存
        }
        
        this.uploadedImages.delete(`step_${index}`);
        this.uploadedImages.delete(`step_${index}_file`);
        
        // 如果是编辑模式，只更新编辑副本
        if (this.isEditing && this.editingTestSteps) {
            this.editingTestSteps[index].operation_params = '';
        } else {
            // 非编辑模式，直接更新
            this.testSteps[index].operation_params = '';
        }
        
        // 重新渲染
        this.renderTestSteps();
        
        showToast('图片已移除', 'success');
    }

        // 保存项目 - 修改为使用编辑副本数据
    async saveProject() {
        // 防重复提交
        if (this.isProcessing) {
            console.log('正在处理中，忽略重复提交');
            return;
        }
        
        this.isProcessing = true;
        
        try {
            // 验证表单
            const formElement = document.getElementById('automationForm');
            console.log('表单元素:', formElement);
            
            const formData = new FormData(formElement);
            const data = Object.fromEntries(formData.entries());
            console.log('原始表单数据:', data);
            
            // 获取多选的产品ID和包名（从新的多选框获取实际的产品ID和包名）
            // 先解析选中的产品对象
            const selectedProductsDetailed = this.selectedProducts.map(uniqueId => {
                // uniqueId格式为 "product_id_index"，通过查找最后一个下划线来分离
                const lastUnderscoreIndex = uniqueId.lastIndexOf('_');
                const index = parseInt(uniqueId.substring(lastUnderscoreIndex + 1));
                return this.products[index];
            }).filter(Boolean);
            
            // 去重：按 product_id + product_name + environment 作为复合键
            const seenCompositeKeys = new Set();
            const uniqueSelectedProducts = [];
            for (const product of selectedProductsDetailed) {
                const compositeKey = `${product.product_id}__${product.product_name || ''}__${product.environment || ''}`;
                if (!seenCompositeKeys.has(compositeKey)) {
                    seenCompositeKeys.add(compositeKey);
                    uniqueSelectedProducts.push(product);
                }
            }
            
            // 构建最终的产品ID和包名数组
            let selectedProductIds = uniqueSelectedProducts.map(p => p.product_id);
            let selectedProductPackageNames = uniqueSelectedProducts.map(p => p.product_name);
            
            // 验证必填字段
            console.log('验证数据:', {
                process_name: data.processName,
                product_ids: selectedProductIds,
                product_ids_length: selectedProductIds.length,
                testSteps_length: this.testSteps.length,
                selectedProducts: Array.from(document.querySelectorAll('input[name="product_ids"]:checked')).map(cb => cb.value)
            });
            
            if (!data.processName) {
                showToast('请填写流程名称', 'error');
                return;
            }
            
            if (selectedProductIds.length === 0) {
                showToast('请选择至少一个产品ID', 'error');
                return;
            }
            
            if (this.testSteps.length === 0) {
                showToast('请添加至少一个测试步骤', 'error');
                return;
            }
            
            showLoading();
            
            // 使用编辑副本数据（如果存在）
            const stepsToProcess = this.isEditing && this.editingTestSteps ? this.editingTestSteps : this.testSteps;
            
            // 校验每个测试步骤的步骤名称必填
            const invalidNameIndex = stepsToProcess.findIndex(step => !step || !String(step.step_name || '').trim());
            if (invalidNameIndex !== -1) {
                hideLoading();
                showToast(`请为第 ${invalidNameIndex + 1} 个测试步骤填写步骤名称`, 'error');
                return;
            }
            
            // 先上传所有缓存的图片
            const updatedTestSteps = [...stepsToProcess];
            for (let i = 0; i < updatedTestSteps.length; i++) {
                const step = updatedTestSteps[i];
                if (step.operation_params && step.operation_params.startsWith('temp_image_')) {
                    const cachedFile = this.uploadedImages.get(`step_${i}_file`);
                    if (cachedFile) {
                        try {
                            const uploadFormData = new FormData();
                            uploadFormData.append('image', cachedFile);
                            
                            const uploadResponse = await fetch('/api/automation/upload-image', {
                                method: 'POST',
                                body: uploadFormData
                            });
                            
                            const uploadResult = await uploadResponse.json();
                            
                            if (uploadResult.success) {
                                step.operation_params = uploadResult.data.file_path;
                            } else {
                                throw new Error(uploadResult.message || '图片上传失败');
                            }
                        } catch (uploadError) {
                            hideLoading();
                            showToast(`第${i + 1}步的图片上传失败: ${uploadError.message}`, 'error');
                            return;
                        }
                    }
                }
            }
            
            // 获取产品地址信息（规范化：单产品-字符串/数组；多产品-对象映射）
            let productAddress = '';
            
            const addressListContainer = document.getElementById('addressListContainer');
            const singleAddressInput = document.getElementById('automationProductAddress');
            
            if (addressListContainer && addressListContainer.style.display !== 'none') {
                // 多地址模式：从地址输入框收集实际输入的地址，按产品ID分组
                const addressInputs = addressListContainer.querySelectorAll('.address-input');
                const pidToAddresses = {};
                
                addressInputs.forEach(input => {
                    const value = input.value.trim();
                    if (!value) return;
                    const productItem = input.closest('.product-address-item');
                    if (!productItem || !productItem.dataset || !productItem.dataset.productId) return;
                    const addressUniqueId = productItem.dataset.productId; // 如："123_5_addr_0" 或 "123_5"
                    const baseUniqueId = addressUniqueId.split('_addr_')[0];
                    const lastUnderscoreIndex = baseUniqueId.lastIndexOf('_');
                    const productIndex = parseInt(baseUniqueId.substring(lastUnderscoreIndex + 1));
                    const product = this.products[productIndex];
                    if (product && product.product_id) {
                        const pid = product.product_id;
                        if (!pidToAddresses[pid]) pidToAddresses[pid] = [];
                        pidToAddresses[pid].push(value);
                    }
                });
                
                if (selectedProductIds.length === 1) {
                    const pid = selectedProductIds[0];
                    const addresses = pidToAddresses[pid] || [];
                    if (addresses.length > 1) {
                        const mapping = {};
                        addresses.forEach((addr, idx) => {
                            mapping[`${pid}_${idx + 1}`] = addr;
                        });
                        productAddress = JSON.stringify(mapping);
                    } else if (addresses.length === 1) {
                        productAddress = addresses[0];
                    }
                } else if (selectedProductIds.length > 1) {
                    const mapping = {};
                    selectedProductIds.forEach(pid => {
                        const addresses = pidToAddresses[pid] || [];
                        if (addresses.length === 1) {
                            mapping[pid] = addresses[0];
                        } else if (addresses.length > 1) {
                            addresses.forEach((addr, idx) => {
                                mapping[`${pid}_${idx + 1}`] = addr;
                            });
                        }
                    });
                    if (Object.keys(mapping).length > 0) {
                        productAddress = JSON.stringify(mapping);
                    }
                }
            } else if (singleAddressInput && singleAddressInput.style.display !== 'none') {
                // 单地址模式：直接获取单个地址输入框的值
                productAddress = singleAddressInput.value.trim();
            } else {
                // 后备方案：从产品数据中获取地址
                if (selectedProductIds.length > 1) {
                    const mapping = {};
                    uniqueSelectedProducts.forEach(p => {
                        mapping[p.product_id] = this.parseProductAddress(p.product_address);
                    });
                    productAddress = JSON.stringify(mapping);
                } else if (selectedProductIds.length === 1) {
                    const onlyProduct = uniqueSelectedProducts[0];
                    if (onlyProduct) {
                        productAddress = this.parseProductAddress(onlyProduct.product_address) || '';
                    }
                }
            }
            
            // 构建服务器期望的数据结构
            const serverData = {
                process_name: data.processName,
                system: data.automationSystem,
                product_type: data.automationProductType,
                environment: data.automationEnvironment,
                product_address: productAddress,
                product_ids: selectedProductIds,
                product_package_names: selectedProductPackageNames,
                test_steps: updatedTestSteps
            };
            
            console.log('保存项目 - 当前编辑状态:', {
                currentEditingProject: this.currentEditingProject,
                isEditing: this.isEditing,
                editingTestSteps: this.editingTestSteps
            });
            
            const url = this.currentEditingProject 
                ? `/api/automation/projects/${this.currentEditingProject.id}`
                : '/api/automation/projects';
            
            const method = this.currentEditingProject ? 'PUT' : 'POST';
            
            console.log('保存项目 - 请求信息:', {
                url: url,
                method: method,
                data: serverData
            });
            
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(serverData)
            });
            
            const result = await response.json();
            
            hideLoading();
            
            if (result.success) {
                showToast(result.message || '保存成功', 'success');
                // 清理缓存和编辑状态
                this.clearImageCache();
                this.clearEditingState();
                this.closeModal();
                await this.loadProjects();
            } else {
                showToast(result.message || '保存失败', 'error');
            }
        } catch (error) {
            hideLoading();
            console.error('保存项目失败:', error);
            showToast('网络错误，请重试', 'error');
        } finally {
            // 重置处理状态
            this.isProcessing = false;
        }
    }

    // 清理编辑状态
    clearEditingState() {
        this.currentEditingProject = null;
        this.isEditing = false;
        this.editingTestSteps = null;
        this.editingUploadedImages.clear();
    }

    // 清理图片缓存
    clearImageCache() {
        // 释放所有blob URL
        this.uploadedImages.forEach((value, key) => {
            if (typeof value === 'string' && value.startsWith('blob:')) {
                URL.revokeObjectURL(value);
            }
        });
        this.uploadedImages.clear();
    }



    // 测试连接
    async testConnection(projectId) {
        try {
            // 添加测试连接按钮动画
            this.addTestConnectionButtonAnimation(projectId);
            
            // 显示局部测试动画，而不是全屏loading
            this.showTestConnectionAnimation(projectId);
            
            const response = await fetch(`/api/automation/projects/${projectId}/test-connection`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            // 隐藏局部测试动画
            this.hideTestConnectionAnimation(projectId);
            
            if (result.success) {
                showToast(result.message, 'success');
                
                // 显示详细结果
                if (result.details) {
                    console.log('连接测试详情:', result.details);
                }
            } else {
                showToast(result.message, 'error');
                
                // 显示详细错误信息
                if (result.details) {
                    console.error('连接测试错误详情:', result.details);
                }
            }
            
            // 移除动画
            this.removeTestConnectionButtonAnimation(projectId);
            
        } catch (error) {
            // 隐藏局部测试动画
            this.hideTestConnectionAnimation(projectId);
            console.error('测试连接失败:', error);
            showToast('网络错误，请重试', 'error');
            // 出错时移除动画
            this.removeTestConnectionButtonAnimation(projectId);
        }
    }

    // 执行测试
    async executeTest(projectId) {
        try {
            // 立即更新按钮状态为"取消测试"并添加动画
            this.updateTestButtonToExecuting(projectId);
            
            showLoading();
            
            const response = await fetch(`/api/automation/projects/${projectId}/execute`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            hideLoading();
            
            if (result.success) {
                showToast('测试已开始执行', 'success');
                
                // 添加到运行中的项目集合
                this.runningProjects.add(projectId);
                console.log('执行测试 - 添加到运行中项目:', projectId);
                
                // 启动状态轮询
                this.startStatusPolling();
                console.log('执行测试 - 启动状态轮询');
                
                // 立即获取最新状态并智能更新
                await this.refreshProjectStatus();
                
                // 如果项目已展开，刷新执行记录
                if (this.expandedProjects.has(projectId)) {
                    await this.loadRecentExecutions(projectId);
                }
            } else {
                showToast(result.message || '执行失败', 'error');
                // 执行失败时恢复按钮状态
                this.updateTestButtonToExecute(projectId);
            }
        } catch (error) {
            hideLoading();
            console.error('执行测试失败:', error);
            showToast('网络错误，请重试', 'error');
            // 出错时恢复按钮状态
            this.updateTestButtonToExecute(projectId);
        }
    }

    // 取消测试
    async cancelTest(projectId) {
        try {
            // 检查项目当前状态
            const project = this.projects.find(p => p.id === projectId);
            if (!project) {
                showToast('项目不存在', 'error');
                return;
            }
            
            // 立即更新按钮状态为"取消中..."并添加动画
            this.updateTestButtonToCancelling(projectId);
            
            showLoading();
            
            const response = await fetch(`/api/automation/projects/${projectId}/cancel`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            hideLoading();
            
            if (result.success) {
                showToast(result.message || '测试已取消', 'success');
                
                // 从运行中的项目集合移除
                this.runningProjects.delete(projectId);
                
                // 等待后端完成状态更新，然后获取最新状态
                setTimeout(async () => {
                    await this.refreshProjectStatus();
                    // 如果项目展开，额外刷新执行记录
                    if (this.expandedProjects.has(projectId)) {
                        await this.loadRecentExecutions(projectId);
                    }
                }, 500); // 500ms延迟确保后端状态更新完成
            } else {
                showToast(result.message || '取消失败', 'error');
                // 取消失败时恢复按钮状态
                if (project.status === 'running') {
                    this.updateTestButtonToExecuting(projectId);
                } else {
                    this.updateTestButtonToExecute(projectId);
                }
            }
        } catch (error) {
            hideLoading();
            console.error('取消测试失败:', error);
            showToast('网络错误，请重试', 'error');
            // 出错时恢复按钮状态
            const project = this.projects.find(p => p.id === projectId);
            if (project && project.status === 'running') {
                this.updateTestButtonToExecuting(projectId);
            } else {
                this.updateTestButtonToExecute(projectId);
            }
        }
    }

    // 批量执行分组下的所有测试项目
    async batchExecuteGroupTests(productId, uniqueGroupId) {
        console.log('🎯 进入 batchExecuteGroupTests 方法');
        console.log('📥 接收参数:', { productId, uniqueGroupId });
        
        // 立即禁用按钮，防止重复点击
        const button = document.querySelector(`[data-unique-group-id="${uniqueGroupId}"].group-batch-execute-btn`);
        if (button) {
            button.disabled = true;
        }
        
        try {
            console.log(`🚀 开始批量执行分组测试 - 产品ID: ${productId}, 分组ID: ${uniqueGroupId}`);
            
            // 调试信息
            console.log('📦 当前分组数据:', this.groupedProjects);
            console.log('🔍 目标分组ID:', uniqueGroupId);
            
            // 从分组数据中找到对应的分组
            let targetGroup = null;
            for (const group of this.groupedProjects) {
                // 重建分组的唯一分组ID
                const groupUniqueId = `${group.product_id}_${group.product_name}_${group.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
                console.log(`🔍 检查分组: ${group.product_name} (${groupUniqueId})`);
                
                if (groupUniqueId === uniqueGroupId) {
                    targetGroup = group;
                    console.log('✅ 找到目标分组:', targetGroup);
                    break;
                }
            }
            
            if (!targetGroup) {
                console.error('❌ 未找到目标分组:', uniqueGroupId);
                showToast('未找到目标分组', 'error');
                this.updateGroupExecuteButtonToNormal(uniqueGroupId);
                return;
            }
            
            // 获取分组下的所有项目
            let groupProjects = targetGroup.projects || [];
            
            // 兜底：如果按地址分组但projects为空，则根据地址从所有项目收集
            if (groupProjects.length === 0 && this.groupingMethod === 'product_address') {
                const groupAddress = targetGroup.product_address || targetGroup.product_name; // product_name在地址分组时为地址
                console.log('🧭 按地址分组兜底匹配，目标地址:', groupAddress);
                const allProjects = this.allProjectsCache || [];
                if (allProjects.length === 0) {
                    console.log('📥 allProjectsCache 为空，尝试从DOM或最近加载结果推断');
                }
                const fallback = (this.allProjectsCache || []).filter(p => p.product_address === groupAddress);
                if (fallback.length > 0) {
                    console.log(`✅ 兜底找到 ${fallback.length} 个项目`);
                    groupProjects = fallback;
                }
            }
            
            console.log(`📊 找到分组下的项目数量: ${groupProjects.length}`);
            console.log('🎯 匹配的项目:', groupProjects.map(p => ({
                id: p.id,
                name: p.process_name
            })));

            if (groupProjects.length === 0) {
                showToast('该分组下没有可执行的项目', 'warning');
                this.updateGroupExecuteButtonToNormal(uniqueGroupId);
                return;
            }

            // 检查是否有项目正在运行
            const runningProjects = groupProjects.filter(project => 
                this.runningProjects.has(project.id) || project.status === 'running'
            );

            if (runningProjects.length > 0) {
                const runningNames = runningProjects.map(p => p.process_name).join('、');
                showToast(`以下项目正在运行中，请等待完成后再试：${runningNames}`, 'warning');
                this.updateGroupExecuteButtonToNormal(uniqueGroupId);
                return;
            }

            // 确认对话框
            const projectNames = groupProjects.map(p => p.process_name);
            
            showCustomConfirm({
                title: '批量执行确认',
                message: `确定要一键执行以下 ${groupProjects.length} 个项目的测试吗？`,
                details: projectNames,
                warningText: '项目将按顺序依次执行，请确保测试环境稳定',
                type: 'warning',
                confirmText: '开始执行',
                cancelText: '取消',
                onConfirm: () => {
                    // 显示进度面板，不再使用loading遮罩
                    this.showBatchExecutionPanel(groupProjects);
                    
                    // 更新分组按钮状态为执行中
                    this.updateGroupExecuteButtonToExecuting(uniqueGroupId, groupProjects.length);
                    
                    showToast(`开始批量执行测试，共 ${groupProjects.length} 个项目`, 'info');
                    
                    // 继续执行原有逻辑
                    this.executeBatchGroupTestsConfirmed(uniqueGroupId, groupProjects);
                },
                onCancel: () => {
                    this.updateGroupExecuteButtonToNormal(uniqueGroupId);
                }
            });
            
            return; // 等待用户确认

        } catch (error) {
            console.error('❌ [批量执行] 批量执行测试失败:', error);
            showToast('批量执行测试失败: ' + error.message, 'error');
            
            // 清理批量执行状态
            this.batchRunningProjects = new Set(); // 清空批量执行集合
            
            // 恢复分组按钮状态
            if (uniqueGroupId) {
                this.updateGroupExecuteButtonToNormal(uniqueGroupId);
            }
            
            // 隐藏进度面板
            this.hideBatchExecutionPanel();
        }
    }

    // 确认后执行批量分组测试
    async executeBatchGroupTestsConfirmed(uniqueGroupId, groupProjects) {
        try {
            console.log(`🚀 [批量执行] 开始批量执行 ${groupProjects.length} 个项目`);
            console.log(`📋 [批量执行] 项目列表:`, groupProjects.map(p => `${p.process_name} (ID: ${p.id})`));
            
            // 按顺序执行每个项目
            for (let i = 0; i < groupProjects.length; i++) {
                const project = groupProjects[i];
                const projectInfo = `${i + 1}/${groupProjects.length} - ${project.process_name} (ID: ${project.id})`;
                
                console.log(`\n🎯 [批量执行] ==================== 开始执行项目 ${projectInfo} ====================`);
                
                try {
                    // 设置当前执行项目
                    this.setCurrentProject(i);
                    
                    showToast(`正在执行第 ${projectInfo}`, 'info');
                    
                    console.log(`⏳ [批量执行] 调用 executeSingleProjectInBatch 执行项目 ${project.id}`);
                    
                    // 调用单个项目的执行方法（会等待执行完成）
                    await this.executeSingleProjectInBatch(project.id);
                    
                    console.log(`✅ [批量执行] 项目 ${project.process_name} 执行完全完成`);
                    
                    // 标记项目为完成
                    this.completeProject(project.id, true);
                    
                    showToast(`项目 ${project.process_name} 执行成功！`, 'success');
                    
                    // 项目间添加额外的间隔，确保系统完全处理完成
                    if (i < groupProjects.length - 1) {
                        console.log(`⏰ [批量执行] 项目 ${project.process_name} 完成，准备间隔等待...`);
                        showToast(`项目 ${project.process_name} 执行完成，等待3秒后执行下一个项目...`, 'info');
                        
                        // 使用带倒计时的等待方法
                        await this.delayWithCountdown(3);
                        
                        console.log(`✅ [批量执行] 间隔等待完成，准备执行下一个项目`);
                    }
                    
                } catch (error) {
                    console.error(`❌ [批量执行] 执行项目 ${project.process_name} 失败:`, error);
                    
                    // 标记项目为失败
                    this.completeProject(project.id, false);
                    
                    // 更友好的错误信息
                    let errorText = error.message || '未知错误';
                    if (errorText.includes('执行失败')) {
                        errorText = '执行过程中出现错误';
                    } else if (errorText.includes('超时')) {
                        errorText = '执行超时';
                    } else if (errorText.includes('取消')) {
                        errorText = '执行被取消';
                    }
                    
                    showToast(`项目 ${project.process_name} ${errorText}`, 'error');
                    this.addProgressNotification(`❌ ${project.process_name} ${errorText}`, 'error');
                    
                    // 失败后也添加间隔，确保系统稳定性
                    if (i < groupProjects.length - 1) {
                        console.log(`⚠️ [批量执行] 项目 ${project.process_name} 执行失败，等待3秒后继续下一个项目`);
                        showToast(`等待3秒后继续执行下一个项目...`, 'warning');
                        this.addProgressNotification('⏳ 等待3秒后继续...', 'info');
                        
                        // 使用带倒计时的等待方法
                        await this.delayWithCountdown(3);
                        
                        console.log(`⏰ [批量执行] 失败间隔等待完成，准备执行下一个项目`);
                    }
                }
                
                console.log(`🏁 [批量执行] ==================== 项目 ${projectInfo} 处理完成 ====================\n`);
            }
            
            console.log(`🎉 [批量执行] 所有项目执行完成！准备清理状态...`);
            
            // 清理批量执行状态
            this.batchRunningProjects = new Set(); // 清空批量执行集合
            
            // 恢复分组按钮状态
            this.updateGroupExecuteButtonToNormal(uniqueGroupId);
            
            // 标记批量执行完成
            this.batchExecution.currentIndex = -1; // 重置当前索引，表示全部完成
            this.updateBatchProgress(); // 更新进度显示
            
            // 停止进度条动画
            this.stopProgressAnimations();
            
            // 显示最终结果
            const { successCount, errorCount } = this.batchExecution;
            
            // 添加完成庆祝动画
            this.addBatchCompletionAnimation(successCount, errorCount);
            const resultMessage = `批量执行完成！成功: ${successCount} 个，失败: ${errorCount} 个`;
            
            console.log(`📊 [批量执行] ${resultMessage}`);
            if (errorCount === 0) {
                showToast(resultMessage, 'success');
                this.addProgressNotification('🎉 全部项目执行成功！', 'success');
            } else if (successCount === 0) {
                showToast(resultMessage, 'error');
                this.addProgressNotification('❌ 所有项目都执行失败了', 'error');
            } else {
                showToast(resultMessage, 'warning');
                this.addProgressNotification(`✅ ${successCount}个成功，❌ ${errorCount}个失败`, 'info');
            }
            
            // 自动在3秒后最小化面板，但不关闭
            setTimeout(() => {
                if (this.batchExecution.isActive && !this.batchExecution.isMinimized) {
                    this.toggleBatchPanel();
                }
            }, 3000);

        } catch (error) {
            console.error('批量执行过程中发生错误:', error);
            
            // 更友好的错误处理
            let errorMessage = '批量执行过程中遇到了问题';
            if (error.message) {
                if (error.message.includes('Cannot access')) {
                    errorMessage = '批量执行状态异常，请重新尝试';
                } else if (error.message.includes('执行失败')) {
                    errorMessage = '项目执行失败，批量任务已停止';
                } else if (error.message.includes('取消')) {
                    errorMessage = '批量执行已被取消';
                } else {
                    errorMessage = `批量执行失败: ${error.message}`;
                }
            }
            
            showToast(errorMessage, 'error');
            this.addProgressNotification('❌ 批量执行中断', 'error');
            
            // 清理批量执行状态
            this.batchRunningProjects = new Set();
            this.batchExecution.currentIndex = -1;
            this.stopProgressAnimations();
            this.updateBatchProgress();
            
            // 恢复分组按钮状态
            this.updateGroupExecuteButtonToNormal(uniqueGroupId);
        }
    }

    // 在批量执行中执行单个项目，等待执行完成后再返回
    async executeSingleProjectInBatch(projectId) {
        try {
            console.log(`🚀 开始执行项目 ${projectId}`);
            
            // 1. 发送执行请求
            const response = await fetch(`/api/automation/projects/${projectId}/execute`, {
                method: 'POST'
            });
            
            // 处理HTTP错误
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`项目 ${projectId} 不存在或已删除`);
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || '启动执行失败');
            }
            
            console.log(`✅ 项目 ${projectId} 启动执行成功`);
            
            // 2. 添加到运行中的项目集合 - 使用专门的批量执行标记
            this.batchRunningProjects = this.batchRunningProjects || new Set();
            this.batchRunningProjects.add(projectId);
            
            // 3. 启动状态轮询（如果还没有启动的话）
            this.startStatusPolling();
            
            // 4. 等待执行完成 - 使用改进的等待机制
            console.log(`⏳ 等待项目 ${projectId} 执行完成...`);
            await this.waitForProjectCompletionInBatch(projectId);
            
            // 5. 额外等待确保日志收集完成
            console.log(`📝 项目 ${projectId} 执行完成，等待日志收集完成...`);
            await this.waitForLogCollection(projectId);
            
            console.log(`🎉 项目 ${projectId} 完全执行完成（包括日志收集）`);
            return { success: true, projectId };
            
        } catch (error) {
            console.error(`❌ 项目 ${projectId} 执行失败:`, error);
            
            // 清理批量执行标记
            if (this.batchRunningProjects) {
                this.batchRunningProjects.delete(projectId);
            }
            
            // 更友好的错误信息
            let friendlyMessage = error.message;
            if (error.message && error.message.includes('执行失败')) {
                friendlyMessage = '项目执行过程中出现错误';
            } else if (error.message && error.message.includes('超时')) {
                friendlyMessage = '项目执行超时';
            } else if (error.message && error.message.includes('取消')) {
                friendlyMessage = '项目执行被手动取消';
            } else if (!error.message) {
                friendlyMessage = '项目执行遇到未知错误';
            }
            
            throw new Error(friendlyMessage);
        }
    }
    
    // 批量执行专用的项目完成等待机制
    async waitForProjectCompletionInBatch(projectId) {
        return new Promise((resolve, reject) => {
            const checkInterval = 2000; // 每2秒检查一次，与轮询频率一致
            const maxWaitTime = 30 * 60 * 1000; // 最长等待30分钟
            const startTime = Date.now();
            
            let lastKnownStatus = null;
            let consecutiveCompletedChecks = 0; // 连续完成状态检查次数
            const requiredConsecutiveChecks = 2; // 需要连续检查到完成状态的次数
            
            const checkStatus = async () => {
                try {
                    // 检查是否超时
                    if (Date.now() - startTime > maxWaitTime) {
                        reject(new Error('执行超时'));
                        return;
                    }
                    
                    // 获取项目状态
                    const response = await fetch(`/api/automation/projects/${projectId}`);
                    
                    // 处理HTTP错误
                    if (!response.ok) {
                        if (response.status === 404) {
                            console.warn(`⚠️ [批量执行] 项目 ${projectId} 不存在或已删除，跳过状态检查`);
                            resolve(); // 404时直接认为项目完成
                            return;
                        }
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        const project = result.data;
                        const status = project.status;
                        const lastStatus = project.last_status;
                        
                        console.log(`📊 [批量执行] 项目 ${projectId} 状态检查: status=${status}, last_status=${lastStatus}`);
                        
                        // 检查是否真正完成
                        const isCompleted = this.isProjectReallyCompleted(status, lastStatus);
                        
                        if (isCompleted) {
                            consecutiveCompletedChecks++;
                            console.log(`✅ [批量执行] 项目 ${projectId} 完成状态检查 ${consecutiveCompletedChecks}/${requiredConsecutiveChecks}`);
                            
                            // 需要连续检查到完成状态，确保不是状态闪烁
                            if (consecutiveCompletedChecks >= requiredConsecutiveChecks) {
                                // 从批量执行集合移除
                                if (this.batchRunningProjects) {
                                    this.batchRunningProjects.delete(projectId);
                                }
                                
                                console.log(`🏁 [批量执行] 项目 ${projectId} 确认完成，last_status: ${lastStatus}`);
                                
                                if (lastStatus === 'failed') {
                                    reject(new Error('执行失败'));
                                } else if (lastStatus === 'cancelled') {
                                    reject(new Error('执行被取消'));
                                } else {
                                    resolve();
                                }
                                return;
                            }
                        } else {
                            // 重置连续检查计数
                            consecutiveCompletedChecks = 0;
                        }
                        
                        lastKnownStatus = lastStatus;
                    }
                    
                    // 继续等待
                    setTimeout(checkStatus, checkInterval);
                    
                } catch (error) {
                    console.error(`❌ [批量执行] 检查项目 ${projectId} 状态失败:`, error);
                    
                    // 如果是网络错误或404，等待更长时间后重试
                    if (error.message.includes('404') || error.message.includes('Network')) {
                        console.log(`🔄 [批量执行] 项目 ${projectId} 状态检查遇到网络问题，延长重试间隔`);
                        setTimeout(checkStatus, checkInterval * 2); // 延长重试间隔
                    } else {
                        // 其他错误正常重试
                        setTimeout(checkStatus, checkInterval);
                    }
                }
            };
            
            // 开始检查
            checkStatus();
        });
    }
    
    // 判断项目是否真正完成
    isProjectReallyCompleted(status, lastStatus) {
        // 项目不在运行状态，且有明确的完成状态
        return status !== 'running' && 
               lastStatus && 
               ['completed', 'passed', 'failed', 'cancelled'].includes(lastStatus);
    }
    
    // 等待日志收集完成
    async waitForLogCollection(projectId) {
        console.log(`📋 [批量执行] 开始等待项目 ${projectId} 日志收集完成...`);
        
        // 等待3秒确保日志收集完成
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 额外检查执行记录是否完整
        try {
            const response = await fetch(`/api/automation/projects/${projectId}/executions?page=1&page_size=1`);
            const result = await response.json();
            
            if (result.success && result.data && result.data.length > 0) {
                const latestRecord = result.data[0];
                const logContent = latestRecord.detailed_log || latestRecord.log_message || '';
                console.log(`📋 [批量执行] 项目 ${projectId} 最新执行记录: ${latestRecord.status}, 日志长度: ${logContent.length}`);
                
                // 如果日志为空或状态还是running，再等待一下
                if (!logContent || latestRecord.status === 'running') {
                    console.log(`⏰ [批量执行] 项目 ${projectId} 日志可能还在收集中，再等待3秒...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        } catch (error) {
            console.warn(`检查项目 ${projectId} 执行记录失败:`, error);
            // 不阻塞执行，继续进行
        }
        
        console.log(`✅ [批量执行] 项目 ${projectId} 日志收集等待完成`);
    }

    // 等待项目执行完成（单独执行时使用的原始方法）
    async waitForProjectCompletion(projectId) {
        return new Promise((resolve, reject) => {
            const checkInterval = 3000; // 每3秒检查一次
            const maxWaitTime = 30 * 60 * 1000; // 最长等待30分钟
            const startTime = Date.now();
            
            const checkStatus = async () => {
                try {
                    // 检查是否超时
                    if (Date.now() - startTime > maxWaitTime) {
                        reject(new Error('执行超时'));
                        return;
                    }
                    
                    // 检查项目是否还在运行中
                    if (!this.runningProjects.has(projectId)) {
                        console.log(`✅ 项目 ${projectId} 已完成执行`);
                        resolve();
                        return;
                    }
                    
                    // 获取项目状态
                    const response = await fetch(`/api/automation/projects/${projectId}`);
                    const result = await response.json();
                    
                    if (result.success) {
                        const project = result.data;
                        const status = project.status;
                        const lastStatus = project.last_status;
                        
                        console.log(`📊 项目 ${projectId} 当前状态: ${status}, 最后执行状态: ${lastStatus}`);
                        
                        // 检查项目是否仍在运行中
                        // 如果项目状态不是running，或者最后执行状态是完成状态，则认为执行完成
                        if (status !== 'running' || 
                            (lastStatus && ['completed', 'failed', 'cancelled'].includes(lastStatus))) {
                            
                            // 从运行中项目集合移除
                            this.runningProjects.delete(projectId);
                            
                            if (lastStatus === 'failed') {
                                reject(new Error('执行失败'));
                            } else if (lastStatus === 'cancelled') {
                                reject(new Error('执行被取消'));
                            } else {
                                resolve();
                            }
                            return;
                        }
                    }
                    
                    // 继续等待
                    setTimeout(checkStatus, checkInterval);
                    
                } catch (error) {
                    console.error(`❌ [日志收集] 检查项目 ${projectId} 状态失败:`, error);
                    
                    // 如果是网络错误或404，等待更长时间后重试
                    if (error.message.includes('404') || error.message.includes('Network')) {
                        console.log(`🔄 [日志收集] 项目 ${projectId} 状态检查遇到网络问题，延长重试间隔`);
                        setTimeout(checkStatus, checkInterval * 2); // 延长重试间隔
                    } else {
                        // 其他错误正常重试
                        setTimeout(checkStatus, checkInterval);
                    }
                }
            };
            
            // 开始检查
            checkStatus();
        });
    }

    // 更新分组执行按钮为执行中状态
    updateGroupExecuteButtonToExecuting(uniqueGroupId, projectCount) {
        const button = document.querySelector(`[data-unique-group-id="${uniqueGroupId}"].group-batch-execute-btn`);
        if (button) {
            button.disabled = true;
            button.innerHTML = `
                <i class="fas fa-spinner fa-spin"></i>
                <span>执行中(${projectCount}项)</span>
            `;
            button.classList.remove('btn-success');
            button.classList.add('btn-warning');
        }
    }

    // 恢复分组执行按钮为正常状态
    updateGroupExecuteButtonToNormal(uniqueGroupId) {
        const button = document.querySelector(`[data-unique-group-id="${uniqueGroupId}"].group-batch-execute-btn`);
        if (button) {
            button.disabled = false;
            button.innerHTML = `
                <i class="fas fa-play-circle"></i>
                <span>一键执行测试</span>
            `;
            button.classList.remove('btn-warning');
            button.classList.add('btn-success');
        }
    }

    // 延迟函数
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========================= 批量执行进度面板管理 =========================
    
    // 显示批量执行进度面板
    showBatchExecutionPanel(projects) {
        this.batchExecution = {
            isActive: true,
            projects: projects.map((p, index) => ({
                ...p,
                status: 'pending',
                index: index
            })),
            currentIndex: -1,
            successCount: 0,
            errorCount: 0,
            isMinimized: false,
            isListExpanded: true,
            isWaiting: false,
            waitTime: 3
        };
        
        const panel = document.getElementById('batchExecutionPanel');
        panel.classList.remove('hidden');
        
        this.updateBatchProgress();
        this.renderProjectList();
    }
    
    // 隐藏批量执行进度面板
    hideBatchExecutionPanel() {
        this.batchExecution.isActive = false;
        const panel = document.getElementById('batchExecutionPanel');
        panel.classList.add('hidden');
    }
    
    // 关闭进度面板
    closeBatchPanel() {
        this.hideBatchExecutionPanel();
    }
    
    // 最小化/展开进度面板
    toggleBatchPanel() {
        this.batchExecution.isMinimized = !this.batchExecution.isMinimized;
        const panel = document.getElementById('batchExecutionPanel');
        const minimizeBtn = panel.querySelector('.panel-minimize-btn i');
        
        panel.classList.toggle('minimized', this.batchExecution.isMinimized);
        minimizeBtn.className = this.batchExecution.isMinimized ? 'fas fa-plus' : 'fas fa-minus';
    }
    
    // 切换项目列表展开/收起
    toggleProjectList() {
        this.batchExecution.isListExpanded = !this.batchExecution.isListExpanded;
        const listContent = document.getElementById('projectListContent');
        const expandBtn = document.getElementById('expandListBtn');
        
        listContent.classList.toggle('collapsed', !this.batchExecution.isListExpanded);
        expandBtn.classList.toggle('expanded', this.batchExecution.isListExpanded);
    }
    
    // 更新批量执行进度
    updateBatchProgress() {
        const { projects, currentIndex, successCount, errorCount } = this.batchExecution;
        const totalCount = projects.length;
        const completedCount = successCount + errorCount;
        const remainingCount = totalCount - completedCount;
        
        // 计算进度百分比，考虑正在运行的项目
        let progressPercent = 0;
        if (totalCount > 0) {
            // 计算基础进度（已完成的项目）
            const baseProgress = (completedCount / totalCount) * 100;
            
            // 如果有项目正在运行，给它一个中间进度值
            const runningProjects = projects.filter(p => p.status === 'running');
            let runningProgress = 0;
            
            if (runningProjects.length > 0) {
                // 为每个正在运行的项目分配50%的进度
                runningProgress = (runningProjects.length * 50) / totalCount;
            }
            
            progressPercent = Math.min(baseProgress + runningProgress, 100);
        }
        
        // 更新总体进度
        document.getElementById('overallProgressText').textContent = `${completedCount}/${totalCount}`;
        document.getElementById('overallProgressFill').style.width = `${progressPercent}%`;
        document.getElementById('successCount').textContent = successCount;
        document.getElementById('errorCount').textContent = errorCount;
        document.getElementById('remainingCount').textContent = remainingCount;
        
        // 更新当前项目信息
        if (this.batchExecution.isWaiting) {
            // 等待状态的显示
            document.getElementById('currentProjectName').textContent = '等待间隔中...';
            document.getElementById('currentProjectStatus').textContent = `等待 ${this.batchExecution.waitTime} 秒`;
            document.getElementById('currentProjectStatus').className = 'current-project-status waiting';
            document.getElementById('currentProjectProgressFill').style.width = '50%';
            document.getElementById('currentProjectProgressText').textContent = '项目间隔等待';
        } else if (currentIndex >= 0 && currentIndex < projects.length) {
            const currentProject = projects[currentIndex];
            document.getElementById('currentProjectName').textContent = currentProject.process_name;
            document.getElementById('currentProjectStatus').textContent = this.getStatusDisplayText(currentProject.status);
            document.getElementById('currentProjectStatus').className = `current-project-status ${currentProject.status}`;
            
            // 更新当前项目进度
            const projectProgress = this.getProjectProgress(currentProject.status);
            document.getElementById('currentProjectProgressFill').style.width = `${projectProgress}%`;
            document.getElementById('currentProjectProgressText').textContent = this.getProgressText(currentProject.status);
        } else if (completedCount === totalCount && totalCount > 0) {
            // 所有项目都已完成
            document.getElementById('currentProjectName').textContent = '全部完成';
            document.getElementById('currentProjectStatus').textContent = '已完成';
            document.getElementById('currentProjectStatus').className = 'current-project-status completed';
            document.getElementById('currentProjectProgressFill').style.width = '100%';
            document.getElementById('currentProjectProgressText').textContent = '批量执行完成';
        } else {
            document.getElementById('currentProjectName').textContent = '暂无';
            document.getElementById('currentProjectStatus').textContent = '准备中';
            document.getElementById('currentProjectStatus').className = 'current-project-status';
            document.getElementById('currentProjectProgressFill').style.width = '0%';
            document.getElementById('currentProjectProgressText').textContent = '等待开始';
        }
    }
    
    // 渲染项目列表
    renderProjectList() {
        const container = document.getElementById('projectListContent');
        const { projects, currentIndex } = this.batchExecution;
        
        const html = projects.map((project, index) => {
            let itemClass = 'project-item';
            if (index === currentIndex) {
                itemClass += ' current';
            } else if (project.status === 'completed') {
                itemClass += ' completed';
            } else if (project.status === 'failed') {
                itemClass += ' failed';
            }
            
            return `
                <div class="${itemClass} batch-project-item" data-project-id="${project.id}">
                    <div class="project-item-name">${project.process_name}</div>
                    <div class="project-item-status ${project.status}">
                        ${this.getStatusDisplayText(project.status)}
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = html;
    }
    
    // 更新项目状态
    updateProjectStatus(projectId, status) {
        const project = this.batchExecution.projects.find(p => p.id === projectId);
        if (project) {
            project.status = status;
            this.updateBatchProgress();
            this.renderProjectList();
        }
    }
    
    // 设置当前执行项目
    setCurrentProject(projectIndex) {
        this.batchExecution.currentIndex = projectIndex;
        this.batchExecution.isWaiting = false; // 重置等待状态
        if (projectIndex >= 0 && projectIndex < this.batchExecution.projects.length) {
            const project = this.batchExecution.projects[projectIndex];
            project.status = 'running';
            
            // 添加项目卡片的动画效果
            this.animateProjectCard(project.id, 'running');
            
            // 添加平滑的进度动画效果
            this.animateProjectProgress();
        }
        this.updateBatchProgress();
        this.renderProjectList();
    }
    
    // 设置等待状态
    setWaitingState(isWaiting = true, waitTime = 3) {
        this.batchExecution.isWaiting = isWaiting;
        this.batchExecution.waitTime = waitTime;
        this.updateBatchProgress();
        this.renderProjectList();
    }
    
    // 带倒计时的等待方法
    async delayWithCountdown(seconds = 3) {
        this.setWaitingState(true, seconds);
        
        for (let i = seconds; i > 0; i--) {
            this.batchExecution.waitTime = i;
            this.updateBatchProgress();
            await this.delay(1000); // 等待1秒
        }
        
        this.setWaitingState(false);
    }
    
    // 项目进度动画效果
    animateProjectProgress() {
        const progressFill = document.getElementById('overallProgressFill');
        if (!progressFill) return;
        
        // 确保有过渡动画
        progressFill.style.transition = 'width 0.5s ease-in-out';
        
        // 添加开始执行的视觉提示
        this.addProgressNotification('项目开始执行...', 'info');
        
        // 为单个项目添加额外的视觉反馈
        if (this.batchExecution.projects.length === 1) {
            // 先快速到30%，然后在执行过程中缓慢增长到50%
            setTimeout(() => {
                this.updateBatchProgress();
                // 在项目执行期间，让进度条有微小的增长动画
                this.simulateExecutionProgress();
            }, 100);
        }
    }
    
    // 模拟执行过程中的进度增长
    simulateExecutionProgress() {
        const progressFill = document.getElementById('overallProgressFill');
        if (!progressFill || this.batchExecution.projects.length !== 1) return;
        
        const project = this.batchExecution.projects[0];
        if (project.status !== 'running') return;
        
        // 在项目执行期间，让进度条从50%缓慢增长到80%
        let currentProgress = 50;
        const targetProgress = 80;
        const incrementTime = 200; // 每200ms增长一点
        const increment = 2; // 每次增长2%
        
        const growthInterval = setInterval(() => {
            if (project.status !== 'running' || currentProgress >= targetProgress) {
                clearInterval(growthInterval);
                return;
            }
            
            currentProgress += increment;
            const totalProgress = Math.min(currentProgress, targetProgress);
            progressFill.style.width = `${totalProgress}%`;
        }, incrementTime);
        
        // 存储interval，以便在项目完成时清理
        this.batchExecution.progressInterval = growthInterval;
    }
    
    // 项目完成动画效果
    animateProjectCompletion(success) {
        const progressFill = document.getElementById('overallProgressFill');
        if (!progressFill) return;
        
        // 为完成的项目添加视觉反馈
        if (success) {
            // 成功时，让进度条快速跳到完成位置
            progressFill.style.transition = 'width 0.3s ease-out';
            
            // 短暂的高亮效果
            progressFill.style.boxShadow = '0 0 10px rgba(34, 197, 94, 0.6)';
            setTimeout(() => {
                progressFill.style.boxShadow = '';
            }, 500);
        } else {
            // 失败时，添加红色闪烁效果
            const originalBackground = progressFill.style.backgroundColor;
            progressFill.style.backgroundColor = '#ef4444';
            progressFill.style.transition = 'background-color 0.3s ease';
            
            setTimeout(() => {
                progressFill.style.backgroundColor = originalBackground;
            }, 300);
                 }
     }
     
     // 添加进度通知
     addProgressNotification(message, type = 'info') {
         // 创建通知元素
         const notification = document.createElement('div');
         notification.className = `progress-notification ${type}`;
         notification.textContent = message;
         notification.style.cssText = `
             position: fixed;
             top: 20px;
             right: 20px;
             padding: 12px 20px;
             border-radius: 6px;
             color: white;
             font-weight: 500;
             z-index: 1000;
             opacity: 0;
             transform: translateX(100%);
             transition: all 0.3s ease;
         `;
         
         // 根据类型设置颜色
         switch (type) {
             case 'success':
                 notification.style.backgroundColor = '#10b981';
                 break;
             case 'error':
                 notification.style.backgroundColor = '#ef4444';
                 break;
             case 'info':
             default:
                 notification.style.backgroundColor = '#3b82f6';
                 break;
         }
         
         // 添加到页面
         document.body.appendChild(notification);
         
         // 显示动画
         requestAnimationFrame(() => {
             notification.style.opacity = '1';
             notification.style.transform = 'translateX(0)';
         });
         
         // 自动移除
         setTimeout(() => {
             notification.style.opacity = '0';
             notification.style.transform = 'translateX(100%)';
             setTimeout(() => {
                 if (notification.parentNode) {
                     notification.parentNode.removeChild(notification);
                 }
             }, 300);
         }, 3000);
     }
     
     // 批量执行完成庆祝动画
     addBatchCompletionAnimation(successCount, errorCount) {
         const progressBar = document.querySelector('.progress-bar');
         const overallProgress = document.querySelector('.overall-progress');
         
         if (!progressBar || !overallProgress) return;
         
         if (errorCount === 0 && successCount > 0) {
             // 全部成功 - 绿色闪烁和彩虹效果
             this.createSuccessConfetti();
             
             // 进度条闪烁效果
             progressBar.style.animation = 'successPulse 0.8s ease-in-out 3';
             
         } else if (successCount === 0) {
             // 全部失败 - 红色震动效果
             overallProgress.style.animation = 'failureShake 0.5s ease-in-out 2';
             
         } else {
             // 部分成功 - 橙色渐变效果
             progressBar.style.animation = 'partialSuccess 1s ease-in-out 2';
         }
         
         // 清理动画
         setTimeout(() => {
             progressBar.style.animation = '';
             overallProgress.style.animation = '';
         }, 3000);
     }
     
     // 创建成功彩纸效果
     createSuccessConfetti() {
         const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd'];
         
         for (let i = 0; i < 50; i++) {
             setTimeout(() => {
                 const confetti = document.createElement('div');
                 confetti.style.cssText = `
                     position: fixed;
                     width: 10px;
                     height: 10px;
                     background: ${colors[Math.floor(Math.random() * colors.length)]};
                     top: -10px;
                     left: ${Math.random() * 100}vw;
                     border-radius: 50%;
                     pointer-events: none;
                     z-index: 2000;
                     animation: confettiFall ${2 + Math.random() * 3}s linear forwards;
                 `;
                 
                 document.body.appendChild(confetti);
                 
                 // 清理彩纸
                 setTimeout(() => {
                     if (confetti.parentNode) {
                         confetti.parentNode.removeChild(confetti);
                     }
                 }, 5000);
             }, i * 100);
         }
     }
     
     // 项目卡片动画效果
     animateProjectCard(projectId, status) {
         // 在下一个渲染周期中查找并动画化项目卡片
         setTimeout(() => {
             const projectCards = document.querySelectorAll('.batch-project-item');
             projectCards.forEach(card => {
                 const cardProjectId = card.getAttribute('data-project-id');
                 if (cardProjectId === projectId.toString()) {
                     switch (status) {
                         case 'running':
                             card.style.transform = 'scale(1.02)';
                             card.style.boxShadow = '0 4px 20px rgba(59, 130, 246, 0.3)';
                             card.style.transition = 'all 0.3s ease';
                             
                             // 添加脉冲效果
                             card.classList.add('project-running-pulse');
                             break;
                         case 'completed':
                             card.style.transform = 'scale(1)';
                             card.style.boxShadow = '0 4px 20px rgba(34, 197, 94, 0.3)';
                             card.classList.remove('project-running-pulse');
                             card.classList.add('project-completed-flash');
                             
                             // 移除完成动画
                             setTimeout(() => {
                                 card.classList.remove('project-completed-flash');
                                 card.style.boxShadow = '';
                             }, 1000);
                             break;
                         case 'failed':
                             card.style.transform = 'scale(1)';
                             card.style.boxShadow = '0 4px 20px rgba(239, 68, 68, 0.3)';
                             card.classList.remove('project-running-pulse');
                             card.classList.add('project-failed-shake');
                             
                             // 移除失败动画
                             setTimeout(() => {
                                 card.classList.remove('project-failed-shake');
                                 card.style.boxShadow = '';
                             }, 1000);
                             break;
                     }
                 }
             });
         }, 100);
     }
     
     // 完成项目执行
    completeProject(projectId, success = true) {
        const project = this.batchExecution.projects.find(p => p.id === projectId);
        if (project) {
            project.status = success ? 'completed' : 'failed';
            if (success) {
                this.batchExecution.successCount++;
            } else {
                this.batchExecution.errorCount++;
            }
            
            // 清理进度动画
            if (this.batchExecution.progressInterval) {
                clearInterval(this.batchExecution.progressInterval);
                this.batchExecution.progressInterval = null;
            }
            
            // 添加项目卡片动画
            this.animateProjectCard(projectId, success ? 'completed' : 'failed');
            
            // 添加完成动画
            this.animateProjectCompletion(success);
            
            // 添加完成通知
            if (success) {
                this.addProgressNotification(`项目 "${project.process_name}" 执行成功！`, 'success');
            } else {
                this.addProgressNotification(`项目 "${project.process_name}" 执行失败！`, 'error');
            }
            
            this.updateBatchProgress();
            this.renderProjectList();
        }
    }
    
    // 获取状态显示文本
    getStatusDisplayText(status) {
        const statusMap = {
            'pending': '等待中',
            'running': '执行中',
            'completed': '已完成',
            'failed': '失败'
        };
        return statusMap[status] || status;
    }
    
    // 获取项目进度百分比
    getProjectProgress(status) {
        const progressMap = {
            'pending': 0,
            'running': 50,
            'completed': 100,
            'failed': 100
        };
        return progressMap[status] || 0;
    }
    
    // 获取进度文本
    getProgressText(status) {
        const textMap = {
            'pending': '等待开始',
            'running': '执行中...',
            'completed': '执行完成',
            'failed': '执行失败'
        };
        return textMap[status] || '未知状态';
    }
    
    // 停止进度条动画
    stopProgressAnimations() {
        try {
            // 移除所有进度条的动画类
            const progressElements = document.querySelectorAll('.progress-fill, .current-project-progress-fill, .overall-progress-fill');
            progressElements.forEach(element => {
                if (element) {
                    // 移除可能的动画类
                    element.classList.remove('progress-animated', 'progress-stripes', 'animate');
                    // 停止CSS动画
                    element.style.animation = 'none';
                    element.style.webkitAnimation = 'none';
                }
            });
            
            // 确保进度条显示为完成状态
            const overallFill = document.getElementById('overallProgressFill');
            const currentFill = document.getElementById('currentProjectProgressFill');
            
            if (overallFill) {
                overallFill.style.animation = 'none';
                overallFill.style.webkitAnimation = 'none';
            }
            
            if (currentFill) {
                currentFill.style.animation = 'none';
                currentFill.style.webkitAnimation = 'none';
            }
            
            console.log('✅ 进度条动画已停止');
        } catch (error) {
            console.error('停止进度条动画时出错:', error);
        }
    }

    // 显示执行历史
    async showExecutionHistory(projectId) {
        try {
            const response = await fetch(`/api/automation/projects/${projectId}/executions`);
            const result = await response.json();
            
            if (result.success) {
                this.renderExecutionHistory(result.data);
                document.getElementById('executionHistoryModal').classList.add('show');
                document.body.style.overflow = 'hidden';
            } else {
                showToast(result.message || '获取执行记录失败', 'error');
            }
        } catch (error) {
            console.error('获取执行记录失败:', error);
            showToast('网络错误，请重试', 'error');
        }
    }

    // 渲染执行历史
    renderExecutionHistory(executions) {
        const container = document.getElementById('execution-history-list');
        
        if (executions.length === 0) {
            container.innerHTML = '<div class="no-data">暂无执行记录</div>';
            return;
        }

        const html = executions.map(execution => `
            <div class="execution-history-item">
                <div class="execution-info">
                    <div class="execution-time">${formatDateTimeUTC(execution.start_time)}</div>
                    <div class="execution-status ${this.getStatusClass(execution.status)}">
                                                        ${this.getStatusText(execution.status, execution.cancel_type)}
                    </div>
                    <div class="execution-operator">操作人: ${execution.executed_by || '未知用户'}</div>
                </div>
                <div class="execution-details">
                    ${execution.log_message || '无详细信息'}
                </div>
                <div class="execution-actions">
                    <button type="button" class="btn btn-primary btn-sm" onclick="automationManagement.showExecutionLog(${execution.id})">
                        <i class="fas fa-file-alt"></i>
                        查看日志
                    </button>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    }

    // 关闭执行历史弹窗
    closeExecutionHistoryModal() {
        document.getElementById('executionHistoryModal').classList.remove('show');
        document.body.style.overflow = '';
    }

    // 显示执行日志详情
    async showExecutionLog(executionId) {
        try {
            // 显示加载状态
            showLoading();
            
            // 获取执行记录详情
            const response = await fetch(`/api/automation/executions/${executionId}`);
            const result = await response.json();
            
            if (result.success) {
                const execution = result.data;
                this.populateExecutionLogModal(execution);
                document.getElementById('executionLogModal').classList.add('show');
                document.body.style.overflow = 'hidden';
            } else {
                showToast(result.message || '获取执行日志失败', 'error');
            }
        } catch (error) {
            console.error('获取执行日志失败:', error);
            showToast('网络错误，请重试', 'error');
        } finally {
            hideLoading();
        }
    }

    // 填充执行日志弹窗内容
    populateExecutionLogModal(execution) {
        // 计算执行时长
        const duration = execution.start_time && execution.end_time 
            ? this.calculateDuration(execution.start_time, execution.end_time)
            : '计算中...';
        
        // 解析并格式化详细日志
        const logContent = execution.detailed_log || execution.log_message || '暂无日志信息';
        const parsedLog = this.parseLogContent(logContent);
        const formattedLog = this.formatParsedLogContent(parsedLog);
        
        // 更新弹窗内容
        document.getElementById('executionLogTitle').textContent = execution.process_name;
        document.getElementById('executionLogStatus').textContent = this.getStatusText(execution.status, execution.cancel_type);
        document.getElementById('executionLogStatus').className = `execution-status ${this.getStatusClass(execution.status)}`;
        document.getElementById('executionLogOperator').textContent = execution.executed_by || '未知用户';
        document.getElementById('executionLogStartTime').textContent = formatDateTimeUTC(execution.start_time) || '未知';
        document.getElementById('executionLogEndTime').textContent = formatDateTimeUTC(execution.end_time) || '未知';
        document.getElementById('executionLogDuration').textContent = duration;
        
        // 更新统计信息
        document.getElementById('testStepsCount').textContent = parsedLog.testStepsCount;
        document.getElementById('testMethodsCount').textContent = parsedLog.testMethodsCount;
        document.getElementById('screenshotsCount').textContent = parsedLog.screenshotsCount;
        
        // 显示格式化的日志内容
        document.getElementById('executionLogContent').innerHTML = formattedLog;
        
        // 绑定交互事件
        this.bindLogInteractions();
        
        // 设置复制和下载功能
        this.setupLogActions(logContent, execution.process_name);
    }

    // 解析日志内容，提取统计信息和分组数据
    parseLogContent(logContent) {
        if (!logContent) {
            return {
                testStepsCount: 0,
                testMethodsCount: 0,
                screenshotsCount: 0,
                testSteps: [],
                initLogs: [],
                endLogs: []
            };
        }

        const lines = logContent.split('\n');
        const testSteps = [];
        const testMethods = new Set();
        const screenshots = [];
        let initLogs = [];
        let endLogs = [];
        let currentStep = null;
        let currentStepLogs = [];
        let isInStep = false;
        let isInEndPhase = false;

        // 解析日志行
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // 检测测试方法 - 只识别 [test_SC] 格式
            const methodMatch = line.match(/\[(test_\w+(?:_\d+)?)\]/);
            if (methodMatch) {
                testMethods.add(methodMatch[1]);
            }

            // 检测测试完成标志 - 匹配类似 "[test_SC] test_SC 完成" 的模式
            const testCompletionMatch = line.match(/\[(test_\w+(?:_\d+)?)\]\s+\1\s+完成/);
            let shouldSwitchToEndPhase = false;
            if (testCompletionMatch) {
                shouldSwitchToEndPhase = true;
            }

            // 检测截图 - 识别多种截图日志格式
            const screenshotMatch = line.match(/\[(test_\w+(?:_\d+)?)\]\s.*(?:截图成功保存|数据信息保存成功):\s*([^\s]+\.png)/);
            if (screenshotMatch) {
                screenshots.push({
                    method: screenshotMatch[1],
                    path: screenshotMatch[2],
                    line: line
                });
            } else {
                // 兼容没有方法标记但包含 over_test_ 文件名的日志，如："请求测试截图: over_test_...png"
                const overAbsMatch = line.match(/((?:[A-Za-z]:\\\\|\/)\S*?over_test_(test_\w+(?:_\d+)?)_[^\\\\\/\s]*\.png)/);
                const overBareMatch = overAbsMatch ? null : line.match(/(over_test_(test_\w+(?:_\d+)?)_[^\\\\\/\s]*\.png)/);
                const requestShotMatch = overAbsMatch || overBareMatch ? null : line.match(/请求测试截图:\s*([^\s]+\.png)/);
                const matchedPath = (overAbsMatch && overAbsMatch[1]) || (overBareMatch && overBareMatch[1]) || (requestShotMatch && requestShotMatch[1]);
                if (matchedPath) {
                    const methodInName = matchedPath.match(/over_test_(test_\w+(?:_\d+)?)/);
                    const methodFromName = methodInName ? methodInName[1] : null;
                    if (methodFromName) {
                        testMethods.add(methodFromName);
                    }
                    screenshots.push({
                        method: methodFromName,
                        path: matchedPath,
                        line: line
                    });
                }
            }

            // 检测测试步骤开始
            const stepMatch = line.match(/开始测试步骤(\d+)\s*(.+?)\s*的操作/);
            if (stepMatch && !isInEndPhase) {
                const stepNumber = parseInt(stepMatch[1]);
                const stepName = stepMatch[2].trim();
                
                // 检查是否已存在相同的测试步骤
                const existingStep = testSteps.find(step => 
                    step.stepNumber === stepNumber && step.stepName === stepName
                );
                
                if (existingStep) {
                    // 如果已存在，切换到该步骤
                    currentStep = existingStep;
                    currentStepLogs = currentStep.logs;
                    isInStep = true;
                } else {
                    // 保存当前步骤（如果有的话）
                    if (currentStep) {
                        currentStep.logs = currentStepLogs;
                        if (!testSteps.includes(currentStep)) {
                            testSteps.push(currentStep);
                        }
                    }

                    // 创建新步骤
                    currentStep = {
                        stepNumber: stepNumber,
                        stepName: stepName,
                        logs: [],
                        methods: new Map()
                    };
                    currentStepLogs = [];
                    // 不立即添加到数组中，等收集完日志后再添加
                    isInStep = true;
                }
            }

            // 检测并发执行信息（用于统计测试方法数量）
            const concurrentMatch = line.match(/开始并发执行\s*(\d+)\s*个独立浏览器实例/);
            if (concurrentMatch) {
                // 这个数字就是测试方法的数量
            }

            // 分配日志到相应的组
            // 特殊处理：优先处理截图日志，确保它们分配到正确的测试步骤中
            if (methodMatch && screenshotMatch) {
                // 截图日志优先分配到对应的测试步骤中
                const logMethod = methodMatch[1];
                let foundStep = null;
                
                // 尝试从截图日志中提取步骤信息
                let stepNumberFromLog = null;
                const stepInfoMatch = line.match(/步骤_(?:test_)?step_(\d+)_|测试步骤_(?:test_)?step_(\d+)_/);
                if (stepInfoMatch) {
                    // 从截图日志中找到了步骤号
                    stepNumberFromLog = parseInt(stepInfoMatch[1] || stepInfoMatch[2]);
                } else {
                    // 兼容形如: 测试步骤_over_test_test_step_2_... 或 文件名中包含 over_test_test_step_2_ 的情况
                    const overStepInfoMatch = line.match(/over_test_(?:test_)?step_(\d+)_/);
                    if (overStepInfoMatch) {
                        stepNumberFromLog = parseInt(overStepInfoMatch[1]);
                    }
                }
                
                if (stepNumberFromLog !== null) {
                    // 首先检查当前正在处理的步骤
                    if (currentStep && currentStep.stepNumber === stepNumberFromLog) {
                        foundStep = currentStep;
                    } else {
                        // 再从已保存的步骤中查找
                        foundStep = testSteps.find(step => step.stepNumber === stepNumberFromLog);
                    }
                }
                
                // 如果没有从步骤信息中找到，再尝试从方法名查找
                if (!foundStep) {
                    // 优先检查当前步骤的方法集合
                    if (currentStep && currentStep.methods && currentStep.methods.has(logMethod)) {
                        foundStep = currentStep;
                    } else {
                // 从后往前查找包含该方法的测试步骤
                for (let i = testSteps.length - 1; i >= 0; i--) {
                    if (testSteps[i].methods && testSteps[i].methods.has(logMethod)) {
                        foundStep = testSteps[i];
                        break;
                            }
                        }
                    }
                }
                
                if (foundStep) {
                    // 将截图日志添加到找到的步骤中
                    if (foundStep === currentStep) {
                        // 如果是当前步骤，添加到当前步骤日志中
                        currentStepLogs.push(line);
                    } else {
                        // 如果是已保存的步骤，直接添加到步骤日志中
                        foundStep.logs.push(line);
                    }
                    
                    if (!foundStep.methods.has(logMethod)) {
                        foundStep.methods.set(logMethod, []);
                    }
                    foundStep.methods.get(logMethod).push(line);
                } else {
                    // 如果没找到对应步骤，添加到结束日志
                    endLogs.push(line);
                }
            } else if (methodMatch && isInEndPhase) {
                // 其他包含测试方法标识的日志在结束阶段的处理
                const logMethod = methodMatch[1];
                let foundStep = null;
                
                // 如果是截图日志，尝试从步骤信息中提取步骤号
                if (screenshotMatch) {
                    let stepNumberFromLog = null;
                    const stepInfoMatch = line.match(/步骤_(?:test_)?step_(\d+)_|测试步骤_(?:test_)?step_(\d+)_/);
                    if (stepInfoMatch) {
                        stepNumberFromLog = parseInt(stepInfoMatch[1] || stepInfoMatch[2]);
                    } else {
                        const overStepInfoMatch = line.match(/over_test_(?:test_)?step_(\d+)_/);
                        if (overStepInfoMatch) {
                            stepNumberFromLog = parseInt(overStepInfoMatch[1]);
                        }
                    }
                    
                    if (stepNumberFromLog !== null) {
                        // 首先检查当前正在处理的步骤
                        if (currentStep && currentStep.stepNumber === stepNumberFromLog) {
                            foundStep = currentStep;
                        } else {
                            // 再从已保存的步骤中查找
                            foundStep = testSteps.find(step => step.stepNumber === stepNumberFromLog);
                        }
                    }
                }
                
                // 如果没有从步骤信息中找到，再从后往前查找包含该方法的测试步骤
                if (!foundStep) {
                    if (currentStep && currentStep.methods && currentStep.methods.has(logMethod)) {
                        foundStep = currentStep;
                    } else {
                    for (let i = testSteps.length - 1; i >= 0; i--) {
                        if (testSteps[i].methods && testSteps[i].methods.has(logMethod)) {
                            foundStep = testSteps[i];
                            break;
                            }
                        }
                    }
                }
                
                if (foundStep) {
                    // 将日志添加到找到的步骤中
                    foundStep.logs.push(line);
                    if (!foundStep.methods.has(logMethod)) {
                        foundStep.methods.set(logMethod, []);
                    }
                    foundStep.methods.get(logMethod).push(line);
                } else {
                    // 如果没找到对应步骤，添加到结束日志
                    endLogs.push(line);
                }
            } else if (isInEndPhase && !testCompletionMatch) {
                // 测试完成后的日志归入结束分组（但不包括完成标志本身和方法相关日志）
                endLogs.push(line);
            } else if (isInStep && currentStep) {
                currentStepLogs.push(line);
                
                // 按测试方法分组
                if (methodMatch) {
                    const method = methodMatch[1];
                    if (!currentStep.methods.has(method)) {
                        currentStep.methods.set(method, []);
                    }
                    currentStep.methods.get(method).push(line);
                }
            } else {
                initLogs.push(line);
            }

            // 在处理完当前日志后，检查是否需要切换到结束阶段
            if (shouldSwitchToEndPhase) {
                // 保存当前步骤后再切换到结束阶段
                if (currentStep) {
                    currentStep.logs = currentStepLogs;
                    if (!testSteps.includes(currentStep)) {
                        testSteps.push(currentStep);
                    }
                }
                isInEndPhase = true;
                isInStep = false;
                currentStep = null;
            }
        }

        // 保存最后一个步骤
        if (currentStep) {
            currentStep.logs = currentStepLogs;
            if (!testSteps.includes(currentStep)) {
                testSteps.push(currentStep);
            }
        }

        // 从并发执行信息中提取测试方法数量，否则使用检测到的唯一方法数量
        let testMethodsCount = testMethods.size;
        const concurrentLine = lines.find(line => line.includes('开始并发执行') && line.includes('个独立浏览器实例'));
        if (concurrentLine) {
            const match = concurrentLine.match(/开始并发执行\s*(\d+)\s*个独立浏览器实例/);
            if (match) {
                testMethodsCount = parseInt(match[1]);
            }
        }

        return {
            testStepsCount: testSteps.length,
            testMethodsCount: testMethodsCount,
            screenshotsCount: screenshots.length,
            testSteps: testSteps,
            initLogs: initLogs,
            endLogs: endLogs,
            screenshots: screenshots,
            allMethods: Array.from(testMethods)
        };
    }

    // 格式化解析后的日志内容
    formatParsedLogContent(parsedLog) {
        let html = '';

        // 初始化日志
        if (parsedLog.initLogs.length > 0) {
            html += this.createTestStepHTML(0, '初始化', parsedLog.initLogs, null, parsedLog.screenshots);
        }

        // 测试步骤日志
        parsedLog.testSteps.forEach(step => {
            html += this.createTestStepHTML(
                step.stepNumber, 
                step.stepName, 
                step.logs, 
                step.methods,
                parsedLog.screenshots
            );
        });

        // 结束日志
        if (parsedLog.endLogs && parsedLog.endLogs.length > 0) {
            html += this.createTestStepHTML('结束', '测试完成与清理', parsedLog.endLogs, null, parsedLog.screenshots);
        }

        return html || '<div class="log-content" style="padding: 1.5rem;">暂无日志信息</div>';
    }

    // 创建测试步骤HTML
    createTestStepHTML(stepNumber, stepName, logs, methods, screenshots) {
        const stepId = `step-${stepNumber}`;
        const logsCount = logs.length;
        const methodsCount = methods ? methods.size : 0;

        // 处理特殊的步骤编号（如"结束"）
        let displayStepNumber = stepNumber;
        let stepClass = '';
        if (stepNumber === '结束') {
            displayStepNumber = '🏁';
            stepClass = ' end-step';
        }

        let html = `
            <div class="log-test-step-group${stepClass}">
                <div class="log-test-step-header" onclick="automationManagement.toggleStep('${stepId}')">
                    <div class="log-test-step-title">
                        <div class="step-number">${displayStepNumber}</div>
                        <span>${stepName}</span>
                    </div>
                    <div class="log-test-step-info">
                        <span>${logsCount} 条日志</span>
                        ${methodsCount > 0 ? `<span>${methodsCount} 个测试方法</span>` : ''}
                        <i class="fas fa-chevron-down step-toggle" id="${stepId}-toggle"></i>
                    </div>
                </div>
                <div class="log-test-step-content" id="${stepId}-content">
        `;

        if (methods && methods.size > 0) {
            // 有测试方法时，按标签形式显示
            const methodsArray = Array.from(methods.entries());
            
            // 按照test_SC_数字的顺序排序
            methodsArray.sort(([a], [b]) => {
                // 提取数字部分进行排序
                const aMatch = a.match(/test_SC_(\d+)/);
                const bMatch = b.match(/test_SC_(\d+)/);
                
                if (aMatch && bMatch) {
                    return parseInt(aMatch[1]) - parseInt(bMatch[1]);
                }
                
                // 如果没有匹配到数字，按字符串排序
                return a.localeCompare(b);
            });
            
            html += `
                <div class="log-test-methods-container">
                    <div class="log-test-method-tabs">
            `;
            
            // 生成测试方法标签
            methodsArray.forEach(([methodName, methodLogs], index) => {
                const isActive = index === 0 ? 'active' : '';
                
                // 计算该方法在当前步骤中的截图数量
                // 只统计在当前步骤日志中出现的截图
                const methodScreenshots = screenshots.filter(s => {
                    return s.method === methodName && methodLogs.some(log => log.includes(s.path));
                }).length;
                const screenshotInfo = methodScreenshots > 0 ? ` 📷${methodScreenshots}` : '';
                
                html += `
                    <div class="log-test-method-tab ${isActive}" 
                         onclick="automationManagement.switchMethodTab('${stepId}', '${methodName}', this)">
                        [${methodName}] (${methodLogs.length}${screenshotInfo})
                    </div>
                `;
            });
            
            html += `
                    </div>
                    <div class="log-test-method-content">
            `;

            // 生成测试方法内容
            methodsArray.forEach(([methodName, methodLogs], index) => {
                const isActive = index === 0 ? 'active' : '';
                const methodId = `${stepId}-${methodName}`;
                html += `
                    <div class="log-test-method-panel ${isActive}" id="${methodId}-panel" data-method="${methodName}">
                        <div class="log-content">${this.formatLogLines(methodLogs, screenshots)}</div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        } else {
            // 没有测试方法时，直接显示日志
            html += `
                <div style="padding: 1rem;">
                    <div class="log-content">${this.formatLogLines(logs, screenshots)}</div>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;

        return html;
    }

    // 格式化日志行，包括截图处理
    formatLogLines(lines, screenshots) {
        if (!lines || lines.length === 0) return '暂无日志信息';

        let formatted = lines
            .map(line => this.formatSingleLogLine(line, screenshots))
            .join('<br>');

        return formatted;
    }

    // 格式化单个日志行
    formatSingleLogLine(line, screenshots) {
        if (!line) return '';

        // 转义HTML字符
        let formatted = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        // 检查是否是截图日志 - 识别多种截图日志格式
        const screenshotMatch = line.match(/\[(test_\w+(?:_\d+)?)\]\s.*(?:截图成功保存|数据信息保存成功):\s*([^\s]+\.png)/);
        if (screenshotMatch) {
            const imagePath = screenshotMatch[2];
            const fileName = imagePath.split('\\').pop() || imagePath.split('/').pop();
            const relativePath = `/IMG_LOGS/${fileName}`;
            formatted = formatted.replace(
                new RegExp(imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                `<a href="#" class="screenshot-btn-compact" onclick="automationManagement.viewScreenshot('${relativePath}'); return false;">
                    <i class="fas fa-camera"></i> 查看截图
                </a>`
            );
        } else {
            // 兼容无方法标记的 over_test_ 文件或"请求测试截图: xxx.png"
            const overAbsMatch = line.match(/((?:[A-Za-z]:\\\\|\/)\S*?over_test_(test_\w+(?:_\d+)?)_[^\\\\\/\s]*\.png)/);
            const overBareMatch = overAbsMatch ? null : line.match(/(over_test_(test_\w+(?:_\d+)?)_[^\\\\\/\s]*\.png)/);
            const requestShotMatch = overAbsMatch || overBareMatch ? null : line.match(/请求测试截图:\s*([^\s]+\.png)/);
            const imagePath = (overAbsMatch && overAbsMatch[1]) || (overBareMatch && overBareMatch[1]) || (requestShotMatch && requestShotMatch[1]);
            if (imagePath) {
                const fileName = imagePath.split('\\').pop() || imagePath.split('/').pop();
                const relativePath = `/IMG_LOGS/${fileName}`;
                formatted = formatted.replace(
                    new RegExp(imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    `<a href="#" class="screenshot-btn-compact" onclick="automationManagement.viewScreenshot('${relativePath}'); return false;">
                        <i class="fas fa-camera"></i> 查看截图
                    </a>`
                );
            }
        }

        // 添加语法高亮
        formatted = formatted
            // 时间戳高亮
            .replace(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/g, '<span class="timestamp">$1</span>')
            // INFO级别日志
            .replace(/(INFO|信息)/g, '<span class="info">$1</span>')
            // WARNING级别日志
            .replace(/(WARNING|警告)/g, '<span class="warning">$1</span>')
            // ERROR级别日志
            .replace(/(ERROR|错误)/g, '<span class="error">$1</span>')
            // DEBUG级别日志
            .replace(/(DEBUG|调试)/g, '<span class="debug">$1</span>')
            // 成功信息
            .replace(/(成功|通过|PASSED)/g, '<span class="success">$1</span>')
            // 失败信息
            .replace(/(失败|错误|FAILED)/g, '<span class="error">$1</span>');

        return formatted;
    }

    // 格式化日志内容（保持向后兼容）
    formatLogContent(logContent) {
        if (!logContent) return '暂无日志信息';
        
        // 转义HTML字符
        let formatted = logContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        
        // 添加语法高亮
        formatted = formatted
            // 时间戳高亮
            .replace(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/g, '<span class="timestamp">$1</span>')
            // INFO级别日志
            .replace(/(INFO|信息)/g, '<span class="info">$1</span>')
            // WARNING级别日志
            .replace(/(WARNING|警告)/g, '<span class="warning">$1</span>')
            // ERROR级别日志
            .replace(/(ERROR|错误)/g, '<span class="error">$1</span>')
            // DEBUG级别日志
            .replace(/(DEBUG|调试)/g, '<span class="debug">$1</span>')
            // 成功信息
            .replace(/(成功|通过|PASSED)/g, '<span class="success">$1</span>')
            // 失败信息
            .replace(/(失败|错误|FAILED)/g, '<span class="error">$1</span>')
            // 换行符转换为<br>
            .replace(/\n/g, '<br>');
        
        return formatted;
    }

    // 设置日志操作功能
    setupLogActions(logContent, processName) {
        // 复制功能
        document.getElementById('copyLogBtn').onclick = () => {
            navigator.clipboard.writeText(logContent).then(() => {
                showToast('日志内容已复制到剪贴板', 'success');
            }).catch(() => {
                showToast('复制失败，请手动复制', 'error');
            });
        };
        
        // 下载功能
        document.getElementById('downloadLogBtn').onclick = () => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${processName}_执行日志_${timestamp}.txt`;
            const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('日志文件已下载', 'success');
        };
    }

    // 关闭执行日志弹窗
    closeExecutionLogModal() {
        document.getElementById('executionLogModal').classList.remove('show');
        document.body.style.overflow = '';
    }

    // 删除自动化项目
    async deleteProject(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        // 显示自定义确认删除对话框
        showCustomConfirm({
            title: '删除自动化项目',
            message: `确定要删除自动化项目"${project.process_name}"吗？`,
            details: [
                '删除项目的所有配置信息',
                '删除项目的所有执行历史记录',
                '删除对应的Python测试文件',
                '此操作不可恢复'
            ],
            warningText: '请确认是否继续？',
            type: 'danger',
            confirmText: '确定删除',
            cancelText: '取消',
            onConfirm: async () => {
                try {
                    showLoading(document.querySelector('.automation-list'));
                    
                    const response = await AutomationAPI.deleteProject(projectId);
                    
                    if (response.success) {
                        showToast('自动化项目删除成功', 'success');
                        // 重新加载项目列表
                        this.loadProjects();
                    } else {
                        showToast(response.message || '删除项目失败', 'error');
                    }
                } catch (error) {
                    console.error('删除项目失败:', error);
                    handleApiError(error, '删除项目失败');
                } finally {
                    // 隐藏加载状态
                    const loadingElement = document.querySelector('.automation-list .loading');
                    if (loadingElement) {
                        loadingElement.remove();
                    }
                }
            }
        });
    }

    // 启动状态轮询
    startStatusPolling() {
        // 清除现有的轮询
        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
        }
        
        console.log('启动状态轮询，运行中的项目数量:', this.runningProjects.size);
        console.log('运行中的项目ID:', Array.from(this.runningProjects));
        
        // 每2秒轮询一次状态，避免请求过于频繁
        this.statusPollingInterval = setInterval(async () => {
            console.log('状态轮询检查 - 运行中项目数量:', this.runningProjects.size);
            // 始终执行状态更新，确保执行记录状态同步
                await this.updateProjectStatus();
            
            // 如果没有运行中的项目，停止轮询
            if (this.runningProjects.size === 0) {
                console.log('没有运行中的项目，停止轮询');
                this.stopStatusPolling();
            }
        }, 2000);
        
        // 立即执行一次状态检查
        this.updateProjectStatus();
    }

    // 停止状态轮询
    stopStatusPolling() {
        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
            this.statusPollingInterval = null;
        }
    }

    // 更新项目状态
    async updateProjectStatus() {
        try {
            console.log('开始更新项目状态...');
            const response = await fetch('/api/automation/projects');
            const result = await response.json();
            
            if (result.success) {
                // 确保 this.projects 是数组
                if (!Array.isArray(this.projects)) {
                    console.error('updateProjectStatus: this.projects 不是数组，当前类型:', typeof this.projects);
                    this.projects = [];
                }
                
                const oldProjects = [...this.projects];
                
                // 确保从API获取的数据是数组
                const projectsData = result.data.projects || result.data;
                this.projects = Array.isArray(projectsData) ? projectsData : [];
                
                console.log('状态轮询 - 获取到的项目数据:', this.projects);
                console.log('状态轮询 - 项目数据类型:', typeof this.projects);
                console.log('状态轮询 - 项目数据是否为数组:', Array.isArray(this.projects));
                
                // 更新运行中的项目集合
                const oldRunningCount = this.runningProjects.size;
                this.runningProjects.clear();
                this.projects.forEach(project => {
                    // 使用 last_status 来判断项目是否在运行
                    if (project.last_status === 'running') {
                        this.runningProjects.add(project.id);
                    }
                });
                
                // 调试信息
                console.log('状态轮询 - 运行中的项目:', Array.from(this.runningProjects));
                console.log('状态轮询 - 项目状态:', this.projects.map(p => ({id: p.id, name: p.process_name, status: p.status, last_status: p.last_status})));
                console.log('运行中项目数量变化:', oldRunningCount, '->', this.runningProjects.size);
                
                // 检查状态变化并立即更新UI
                const hasStatusChanges = this.checkStatusChanges(oldProjects, this.projects);
                
                // 如果有状态变化，立即智能更新UI
                if (hasStatusChanges) {
                    console.log('检测到状态变化，更新UI');
                    await this.smartUpdateProjects(oldProjects, this.projects);
                    
                    // 更新按钮状态和项目状态显示
                    this.updateButtonStatesAndStatus();
                    
                    // 如果有项目状态变为非运行状态，刷新执行记录
                    for (const project of this.projects) {
                        const oldProject = oldProjects.find(p => p.id === project.id);
                        if (oldProject && oldProject.last_status === 'running' && project.last_status !== 'running') {
                            console.log(`项目 ${project.process_name} 状态从 running 变为 ${project.last_status}`);
                            if (this.expandedProjects.has(project.id)) {
                                await this.loadRecentExecutions(project.id);
                            }
                        }
                    }
                } else {
                    // 即使没有状态变化，也要更新已展开项目的执行记录状态
                    // 确保执行记录的状态与项目状态保持一致
                    for (const projectId of this.expandedProjects) {
                        const project = this.projects.find(p => p.id === projectId);
                        if (project && project.last_status !== 'running') {
                            // 检查执行记录是否需要更新
                            await this.refreshExecutionRecordsIfNeeded(projectId);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('更新项目状态失败:', error);
        }
    }

    // 检查状态变化
    checkStatusChanges(oldProjects, newProjects) {
        let hasChanges = false;
        
        // 确保参数是数组
        if (!Array.isArray(oldProjects) || !Array.isArray(newProjects)) {
            console.error('checkStatusChanges: 参数不是数组', {
                oldProjects: typeof oldProjects,
                newProjects: typeof newProjects
            });
            return false;
        }
        
        newProjects.forEach(newProject => {
            const oldProject = oldProjects.find(p => p.id === newProject.id);
            
            if (oldProject && oldProject.last_status !== newProject.last_status) {
                hasChanges = true;
                
                // 状态发生变化
                if (newProject.last_status === 'running') {
                    this.runningProjects.add(newProject.id);
                } else if (this.runningProjects.has(newProject.id)) {
                    // 检查项目是否在批量执行中
                    const isInBatchExecution = this.batchRunningProjects && this.batchRunningProjects.has(newProject.id);
                    
                    if (!isInBatchExecution) {
                        // 只有非批量执行的项目才自动移除和显示提示
                    this.runningProjects.delete(newProject.id);
                    
                    // 移除所有按钮动画
                    this.removeCancelButtonAnimation(newProject.id);
                    this.removeExecuteButtonAnimation(newProject.id);
                    
                    // 显示状态变化提示
                    const statusText = this.getStatusText(newProject.last_status, null);
                    showToast(`项目 "${newProject.process_name}" ${statusText}`, 
                             newProject.last_status === 'passed' ? 'success' : 
                             newProject.last_status === 'failed' ? 'error' : 'info');
                    } else {
                        // 批量执行中的项目，只记录状态变化，不自动移除
                        console.log(`📊 [状态轮询] 批量执行项目 ${newProject.id} 状态变化: ${newProject.last_status}`);
                    }
                }
            }
        });
        
        // 如果没有运行中的项目，停止轮询
        if (this.runningProjects.size === 0) {
            this.stopStatusPolling();
        }
        
        return hasChanges;
    }

    // 智能更新项目：只更新有变化的部分，保持展开状态
    async smartUpdateProjects(oldProjects, newProjects) {
        const container = document.getElementById('automation-list');
        if (!container) return;

        // 确保参数是数组
        if (!Array.isArray(oldProjects) || !Array.isArray(newProjects)) {
            console.error('smartUpdateProjects: 参数不是数组', {
                oldProjects: typeof oldProjects,
                newProjects: typeof newProjects
            });
            // 如果参数不是数组，直接重新渲染
            this.renderProjectsList();
            return;
        }

        // 如果当前没有项目卡片，直接重新渲染
        if (container.children.length === 0) {
            this.renderProjectsList();
            // 重新加载已展开项目的执行记录
            for (const projectId of this.expandedProjects) {
                await this.loadRecentExecutions(projectId);
            }
            return;
        }

        // 检查每个项目是否有变化
        let hasStructuralChange = false;
        
        // 检查项目数量是否变化
        if (oldProjects.length !== newProjects.length) {
            hasStructuralChange = true;
        } else {
            // 检查项目ID是否变化（新增或删除）
            const oldIds = new Set(oldProjects.map(p => p.id));
            const newIds = new Set(newProjects.map(p => p.id));
            if (oldIds.size !== newIds.size || ![...oldIds].every(id => newIds.has(id))) {
                hasStructuralChange = true;
            }
        }

        if (hasStructuralChange) {
            // 有结构性变化，需要完全重新渲染
            console.log('检测到结构性变化，重新渲染项目列表');
            this.renderProjectsList();
            // 重新加载已展开项目的执行记录
            for (const projectId of this.expandedProjects) {
                await this.loadRecentExecutions(projectId);
            }
        } else {
            // 只有状态变化，局部更新
            console.log('只有状态变化，进行局部更新');
            const updatedProjects = [];
            for (const newProject of newProjects) {
                const oldProject = oldProjects.find(p => p.id === newProject.id);
                if (oldProject && this.hasProjectChanged(oldProject, newProject)) {
                    console.log(`更新项目 ${newProject.process_name} 的状态`);
                    await this.updateSingleProject(newProject);
                    updatedProjects.push(newProject.id);
                }
            }
            
            // 对于展开但未更新的项目，也刷新执行记录（防止执行记录状态滞后）
            for (const projectId of this.expandedProjects) {
                if (!updatedProjects.includes(projectId)) {
                    await this.loadRecentExecutions(projectId);
                }
            }
        }
    }

    // 检查单个项目是否有变化
    hasProjectChanged(oldProject, newProject) {
        return (
            oldProject.status !== newProject.status ||
            oldProject.last_status !== newProject.last_status ||
            oldProject.execution_count !== newProject.execution_count ||
            oldProject.process_name !== newProject.process_name ||
            oldProject.system !== newProject.system ||
            oldProject.product_type !== newProject.product_type ||
            oldProject.environment !== newProject.environment
        );
    }

    // 更新单个项目卡片
    async updateSingleProject(project) {
        const projectCard = document.querySelector(`[data-project-id="${project.id}"]`);
        if (!projectCard) return;

        const isExpanded = this.expandedProjects.has(project.id);
        console.log(`更新项目 ${project.process_name}，展开状态: ${isExpanded}`);
        
        // 如果项目是展开状态，先保存当前的执行记录容器
        let executionContainer = null;
        if (isExpanded) {
            executionContainer = document.getElementById(`recent-executions-${project.id}`);
        }
        
        const newCardHtml = this.renderProjectCard(project, isExpanded);
        
        // 创建临时容器来解析新HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newCardHtml;
        const newCard = tempDiv.firstElementChild;
        
        // 添加data-project-id属性用于标识
        newCard.setAttribute('data-project-id', project.id);
        
        // 替换旧卡片
        projectCard.parentNode.replaceChild(newCard, projectCard);
        
        // 重新绑定展开按钮事件
        const newExpandButton = newCard.querySelector('.expand-btn');
        if (newExpandButton) {
            console.log('重新绑定展开按钮事件，项目ID:', project.id);
            // 移除之前的事件监听器（如果有的话）
            // 注意：由于我们使用内联函数，这里不需要移除之前的事件监听器
            // 因为每次都是新的函数引用
            
            // 添加新的事件监听器，使用箭头函数保持 this 上下文
            newExpandButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                const projectId = parseInt(event.currentTarget.getAttribute('data-project-id'));
                console.log('展开按钮被点击，项目ID:', projectId);
                
                if (projectId) {
                    this.toggleExpand(projectId);
                }
            });
        }
        
        // 更新按钮状态
        const isRunning = project.status === 'running';
        if (isRunning) {
            this.updateTestButtonToExecuting(project.id);
        } else {
            this.updateTestButtonToExecute(project.id);
        }
        
        // 如果项目是展开状态，重新加载执行记录
        if (isExpanded) {
            await this.loadRecentExecutions(project.id);
        }
    }

    // 刷新单个项目状态
    async refreshSingleProjectStatus(projectId) {
        try {
            console.log(`刷新项目 ${projectId} 的状态`);
            
            // 获取单个项目的最新状态
            const response = await fetch(`/api/automation/projects?page=1&page_size=1000`);
            const result = await response.json();
            
            if (result.success && result.data && result.data.projects) {
                const updatedProject = result.data.projects.find(p => p.id === projectId);
                if (updatedProject) {
                    // 更新内存中的项目状态
                    const projectIndex = this.projects.findIndex(p => p.id === projectId);
                    if (projectIndex !== -1) {
                        console.log(`项目 ${updatedProject.process_name} 状态更新: ${this.projects[projectIndex].last_status} -> ${updatedProject.last_status}`);
                        this.projects[projectIndex] = updatedProject;
                    }
                    
                    // 如果是分组视图，也更新分组数据
                    if (this.showGroupedView && Array.isArray(this.groupedProjects)) {
                        for (const group of this.groupedProjects) {
                            if (group.projects) {
                                const groupProjectIndex = group.projects.findIndex(p => p.id === projectId);
                                if (groupProjectIndex !== -1) {
                                    group.projects[groupProjectIndex] = updatedProject;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`刷新项目 ${projectId} 状态失败:`, error);
        }
    }

    // 刷新项目状态（立即获取最新状态并智能更新）
    async refreshProjectStatus() {
        try {
            const response = await fetch('/api/automation/projects');
            const result = await response.json();
            
            if (result.success) {
                const oldProjects = [...this.projects];
                const newProjects = result.data.projects || result.data;
                
                // 确保 newProjects 是数组
                this.projects = Array.isArray(newProjects) ? newProjects : [];
                
                // 确保 this.projects 是数组
                if (!Array.isArray(this.projects)) {
                    console.error('refreshProjectStatus: this.projects 不是数组，当前类型:', typeof this.projects);
                    this.projects = [];
                    return;
                }
                
                // 更新按钮状态和项目状态显示
                this.updateButtonStatesAndStatus();
                
                // 检查状态变化
                this.checkStatusChanges(oldProjects, newProjects);
                
                // 智能更新UI
                await this.smartUpdateProjects(oldProjects, newProjects);
            }
        } catch (error) {
            console.error('刷新项目状态失败:', error);
        }
    }

    // 添加取消按钮动画
    addCancelButtonAnimation(projectId) {
        const button = document.getElementById(`test-btn-${projectId}`);
        if (button) {
            button.classList.add('btn-cancel-test', 'spinning');
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('.btn-text');
            
            if (icon) {
                icon.className = 'fas fa-spinner';
            }
            if (textSpan) {
                textSpan.textContent = '取消中...';
            }
        }
    }

    // 移除取消按钮动画
    removeCancelButtonAnimation(projectId) {
        const button = document.getElementById(`test-btn-${projectId}`);
        if (button) {
            button.classList.remove('btn-cancel-test', 'spinning');
            
            // 恢复原始状态
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('.btn-text');
            
            if (icon) {
                icon.className = 'fas fa-stop'; // 恢复为停止图标
            }
            if (textSpan) {
                textSpan.textContent = '取消测试'; // 恢复为取消测试文本
            }
        }
    }

    // 添加执行按钮动画
    addExecuteButtonAnimation(projectId) {
        const button = document.getElementById(`test-btn-${projectId}`);
        if (button) {
            button.classList.add('btn-execute-test', 'spinning');
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('.btn-text');
            
            if (icon) {
                icon.className = 'fas fa-spinner';
            }
            if (textSpan) {
                textSpan.textContent = '执行中...';
            }
        }
    }

    // 移除执行按钮动画
    removeExecuteButtonAnimation(projectId) {
        const button = document.getElementById(`test-btn-${projectId}`);
        if (button) {
            button.classList.remove('btn-execute-test', 'spinning');
            
            // 恢复原始状态
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('.btn-text');
            
            if (icon) {
                icon.className = 'fas fa-play'; // 恢复为播放图标
            }
            if (textSpan) {
                textSpan.textContent = '执行测试'; // 恢复为执行测试文本
            }
        }
    }

    // 更新测试按钮为"取消测试"状态
    updateTestButtonToCancel(projectId) {
        const button = document.getElementById(`test-btn-${projectId}`);
        if (button) {
            // 更新按钮样式
            button.className = 'btn btn-warning btn-sm btn-cancel-test';
            button.onclick = () => this.cancelTest(projectId);
            button.title = '取消测试';
            
            // 更新图标和文本
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('.btn-text');
            
            if (icon) {
                icon.className = 'fas fa-stop';
            }
            if (textSpan) {
                textSpan.textContent = '取消测试';
            }
            
            // 移除动画类
            button.classList.remove('spinning');
        }
    }

    // 更新测试按钮为"执行测试"状态
    updateTestButtonToExecute(projectId) {
        const button = document.getElementById(`test-btn-${projectId}`);
        if (button) {
            // 更新按钮样式
            button.className = 'btn btn-success btn-sm btn-execute-test';
            button.onclick = () => this.executeTest(projectId);
            button.title = '执行测试';
            
            // 更新图标和文本
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('.btn-text');
            
            if (icon) {
                icon.className = 'fas fa-play';
            }
            if (textSpan) {
                textSpan.textContent = '执行测试';
            }
            
            // 移除动画类
            button.classList.remove('spinning');
        }
    }

    // 更新测试按钮为"执行中..."状态
    updateTestButtonToExecuting(projectId) {
        const button = document.getElementById(`test-btn-${projectId}`);
        if (button) {
            // 更新按钮样式
            button.className = 'btn btn-warning btn-sm btn-cancel-test spinning';
            button.onclick = () => this.cancelTest(projectId);
            button.title = '取消测试';
            
            // 更新图标和文本
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('.btn-text');
            
            if (icon) {
                icon.className = 'fas fa-spinner fa-spin';
            }
            if (textSpan) {
                textSpan.textContent = '取消测试';
            }
        }
    }

    // 更新测试按钮为"取消中..."状态
    updateTestButtonToCancelling(projectId) {
        const button = document.getElementById(`test-btn-${projectId}`);
        if (button) {
            // 更新按钮样式
            button.className = 'btn btn-warning btn-sm btn-cancel-test spinning';
            button.onclick = null; // 禁用点击
            button.title = '取消中...';
            
            // 更新图标和文本
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('.btn-text');
            
            if (icon) {
                icon.className = 'fas fa-spinner fa-spin';
            }
            if (textSpan) {
                textSpan.textContent = '取消中...';
            }
        }
    }

    // 更新按钮状态和项目状态显示
    updateButtonStatesAndStatus() {
        // 确保 this.projects 是数组
        if (!Array.isArray(this.projects)) {
            console.error('updateButtonStatesAndStatus: this.projects 不是数组，当前类型:', typeof this.projects);
            this.projects = [];
            return;
        }
        
        this.projects.forEach(project => {
            // 使用最新的状态（优先使用last_status）
            const currentStatus = project.last_status || project.status;
            const isRunning = currentStatus === 'running';
            
            // 更新测试按钮状态
            if (isRunning) {
                this.updateTestButtonToExecuting(project.id);
            } else {
                this.updateTestButtonToExecute(project.id);
            }
            
            // 更新项目状态显示
            this.updateProjectStatusDisplay(project.id, currentStatus);
            
            // 更新运行中的项目集合
            if (isRunning) {
                this.runningProjects.add(project.id);
            } else {
                this.runningProjects.delete(project.id);
            }
        });
        
        // 管理状态轮询
        if (this.runningProjects.size > 0) {
            this.startStatusPolling();
        } else {
            this.stopStatusPolling();
        }
    }

    // 更新项目状态显示
    updateProjectStatusDisplay(projectId, status) {
        const statusBadge = document.querySelector(`[data-project-id="${projectId}"] .status-badge`);
        if (statusBadge) {
            const statusClass = this.getStatusClass(status);
            const statusText = this.getStatusText(status, null);
            
            statusBadge.className = `status-badge ${statusClass}`;
            statusBadge.textContent = statusText;
        }
    }

    // 展开项目后同步状态
    async syncProjectStatusAfterExpand(projectId) {
        try {
            console.log(`展开项目后同步状态: ${projectId}`);
            
            // 获取最新的执行记录
            const executionResponse = await fetch(`/api/automation/projects/${projectId}/executions?page=1&page_size=1`);
            const executionResult = await executionResponse.json();
            
            if (executionResult.success && executionResult.data.length > 0) {
                const latestExecution = executionResult.data[0];
                const project = this.projects.find(p => p.id === projectId);
                
                if (project) {
                    const projectStatus = project.last_status || project.status;
                    const executionStatus = latestExecution.status;
                    
                    console.log(`项目状态对比 - 项目: ${projectStatus}, 执行记录: ${executionStatus}`);
                    
                    // 如果状态不一致，以执行记录的状态为准（因为执行记录更准确）
                    if (projectStatus !== executionStatus) {
                        console.log(`状态不一致，更新项目卡片状态显示为: ${executionStatus}`);
                        
                        // 更新内存中的项目状态
                        project.last_status = executionStatus;
                        
                        // 更新UI显示
                        this.updateProjectStatusDisplay(projectId, executionStatus);
                        
                        // 更新按钮状态
                        if (executionStatus === 'running') {
                            this.updateTestButtonToExecuting(projectId);
                        } else {
                            this.updateTestButtonToExecute(projectId);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`展开项目后同步状态失败: ${projectId}`, error);
        }
    }

    // 检查并刷新执行记录状态
    async refreshExecutionRecordsIfNeeded(projectId) {
        try {
            // 获取最新的执行记录
            const response = await fetch(`/api/automation/projects/${projectId}/executions?page=1&page_size=5`);
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                // 检查最新的执行记录状态
                const latestExecution = result.data[0];
                const project = this.projects.find(p => p.id === projectId);
                
                if (project) {
                    // 检查项目状态与最新执行记录状态是否一致
                    const projectStatus = project.last_status || project.status;
                    const executionStatus = latestExecution.status;
                    
                    if (projectStatus !== executionStatus) {
                        console.log(`项目 ${project.process_name} 状态不一致 - 项目状态: ${projectStatus}, 执行记录状态: ${executionStatus}`);
                        
                        // 先刷新项目状态，再刷新执行记录
                        await this.refreshSingleProjectStatus(projectId);
                    await this.loadRecentExecutions(projectId);
                        
                        // 更新项目卡片状态显示
                        this.updateProjectStatusDisplay(projectId, executionStatus);
                    }
                } else {
                    // 如果找不到项目，直接刷新执行记录
                    console.log(`项目 ${projectId} 在内存中未找到，直接刷新执行记录`);
                    await this.loadRecentExecutions(projectId);
                }
            }
        } catch (error) {
            console.error('检查执行记录状态失败:', error);
        }
    }

    // 添加测试连接按钮动画
    addTestConnectionButtonAnimation(projectId) {
        const button = document.querySelector(`button[onclick*="testConnection(${projectId})"]`);
        if (button) {
            button.classList.add('btn-test-connection', 'spinning');
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('span') || button;
            
            if (icon) {
                icon.className = 'fas fa-spinner';
            }
            if (textSpan && textSpan.textContent) {
                textSpan.textContent = '测试中...';
            }
        }
    }

    // 显示测试连接动画
    showTestConnectionAnimation(projectId) {
        // 检查是否已经有动画在运行
        const existingAnimation = document.getElementById(`test-animation-${projectId}`);
        if (existingAnimation) {
            existingAnimation.remove();
        }
        
        // 创建测试动画容器
        const animationContainer = document.createElement('div');
        animationContainer.className = 'test-connection-animation';
        animationContainer.id = `test-animation-${projectId}`;
        
        // 生成随机测试步骤
        const testSteps = [
            '正在初始化测试环境...',
            '正在验证网络连接...',
            '正在测试目标网站...',
            '正在分析连接质量...',
            '正在生成测试报告...'
        ];
        
        animationContainer.innerHTML = `
            <div class="test-animation-overlay">
                <div class="test-animation-content">
                    <div class="test-animation-spinner">
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                    </div>
                    <div class="test-animation-text">
                        <h4>正在测试连接...</h4>
                        <p id="test-step-text-${projectId}">正在初始化测试环境...</p>
                    </div>
                    <div class="test-animation-progress">
                        <div class="progress-bar">
                            <div class="progress-fill"></div>
                        </div>
                        <div class="progress-text">
                            <span id="progress-percentage-${projectId}">0%</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // 添加到body，而不是项目卡片
        document.body.appendChild(animationContainer);
        
        // 添加动画类
        setTimeout(() => {
            animationContainer.classList.add('active');
        }, 10);
        
        // 启动测试步骤动画
        this.startTestStepAnimation(projectId, testSteps);
        
        // 启动进度动画
        this.startProgressAnimation(projectId);
    }

    // 启动测试步骤动画
    startTestStepAnimation(projectId, testSteps) {
        let currentStep = 0;
        const stepText = document.getElementById(`test-step-text-${projectId}`);
        
        if (!stepText) return;
        
        const stepInterval = setInterval(() => {
            if (currentStep < testSteps.length) {
                stepText.style.opacity = '0';
                stepText.style.transform = 'translateY(-10px)';
                
                setTimeout(() => {
                    stepText.textContent = testSteps[currentStep];
                    stepText.style.opacity = '1';
                    stepText.style.transform = 'translateY(0)';
                }, 200);
                
                currentStep++;
            } else {
                clearInterval(stepInterval);
            }
        }, 1500);
        
        // 保存定时器引用以便清理
        this.testStepInterval = stepInterval;
    }

    // 启动进度动画
    startProgressAnimation(projectId) {
        let progress = 0;
        const progressPercentage = document.getElementById(`progress-percentage-${projectId}`);
        
        if (!progressPercentage) return;
        
        const progressInterval = setInterval(() => {
            if (progress < 100) {
                progress += Math.random() * 15 + 5; // 随机增加5-20%
                progress = Math.min(progress, 100);
                progressPercentage.textContent = `${Math.round(progress)}%`;
            } else {
                clearInterval(progressInterval);
            }
        }, 800);
        
        // 保存定时器引用以便清理
        this.progressInterval = progressInterval;
    }

    // 隐藏测试连接动画
    hideTestConnectionAnimation(projectId) {
        // 清理定时器
        if (this.testStepInterval) {
            clearInterval(this.testStepInterval);
            this.testStepInterval = null;
        }
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        
        const animationContainer = document.getElementById(`test-animation-${projectId}`);
        if (animationContainer) {
            // 添加成功状态
            const content = animationContainer.querySelector('.test-animation-content');
            if (content) {
                content.innerHTML = `
                    <div class="test-animation-spinner success">
                        <i class="fas fa-check-circle"></i>
                    </div>
                    <div class="test-animation-text">
                        <h4>测试完成</h4>
                        <p>连接测试已成功完成</p>
                    </div>
                `;
            }
            
            // 添加淡出动画
            setTimeout(() => {
                animationContainer.classList.add('fade-out');
                
                // 动画结束后移除元素
                setTimeout(() => {
                    if (animationContainer.parentNode) {
                        animationContainer.parentNode.removeChild(animationContainer);
                    }
                }, 300);
            }, 500);
        }
    }

    // 移除测试连接按钮动画
    removeTestConnectionButtonAnimation(projectId) {
        const button = document.querySelector(`button[onclick*="testConnection(${projectId})"]`);
        if (button) {
            button.classList.remove('btn-test-connection', 'spinning');
            
            // 恢复原始状态
            const icon = button.querySelector('i');
            const textSpan = button.querySelector('span') || button;
            
            if (icon) {
                icon.className = 'fas fa-plug'; // 恢复为插头图标
            }
            if (textSpan && textSpan.textContent) {
                textSpan.textContent = '测试连接'; // 恢复为测试连接文本
            }
        }
    }

    // 改变每页显示数量
    changePageSize(projectId, newPageSize) {
        // 重新加载第一页，使用新的页面大小
        this.loadRecentExecutions(projectId, 1, parseInt(newPageSize));
    }

    // ==================== 代码管理功能 ====================
    
    // 当前编辑的项目ID
    currentCodeProjectId = null;
    // 原始代码内容
    originalCodeContent = '';
    
    // 打开代码管理弹窗
    async openCodeManagement(projectId) {
        try {
            console.log('打开代码管理，项目ID:', projectId);
            this.currentCodeProjectId = projectId;
            
            // 强制清理所有缓存
            console.log('强制清理缓存...');
            this.projects = []; // 清空项目缓存
            this.originalCodeContent = ''; // 清空原始代码缓存
            
            // 强制刷新项目数据，确保获取最新状态
            console.log('强制刷新项目数据...');
            await this.loadProjects();
            
            // 显示弹窗
            const modal = document.getElementById('codeManagementModal');
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';
            
            // 更新标题
            const project = this.projects.find(p => p.id === projectId);
            if (project) {
                document.getElementById('code-modal-title').textContent = `代码管理 - ${project.process_name}`;
            }
            
            // 强制清理编辑器缓存
            if (this.codeEditor) {
                this.codeEditor.toTextArea();
                this.codeEditor = null;
            }
            
            // 初始化代码编辑器
            this.initCodeEditor();
            
            // 等待编辑器完全初始化
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // 加载代码
            await this.loadProjectCode(projectId);
            
        } catch (error) {
            console.error('打开代码管理失败:', error);
            showToast('打开代码管理失败: ' + error.message, 'error');
        }
    }
    
    // 关闭代码管理弹窗
    closeCodeManagementModal() {
        const modal = document.getElementById('codeManagementModal');
        modal.style.display = 'none';
        
        // 恢复页面滚动
        document.body.style.overflow = '';
        
        // 清理CodeMirror编辑器
        if (this.codeEditor) {
            this.codeEditor.toTextArea();
            this.codeEditor = null;
        }
        
        this.currentCodeProjectId = null;
        this.originalCodeContent = '';
    }
    
    // 加载项目代码
    async loadProjectCode(projectId) {
        try {
            console.log('开始加载项目代码，项目ID:', projectId);
            
            // 强制清理编辑器内容
            if (this.codeEditor) {
                this.codeEditor.setValue('');
            }
            
            // 添加随机时间戳和随机数，确保每次请求都是唯一的
            const timestamp = Date.now();
            const random = Math.random();
            const cacheBuster = Math.floor(Math.random() * 1000000);
            
            const response = await fetch(`/api/automation/projects/${projectId}/code?t=${timestamp}&r=${random}&cb=${cacheBuster}`, {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate, private',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-Cache-Buster': cacheBuster.toString()
                },
                // 禁用缓存
                cache: 'no-store'
            });
            const result = await response.json();
            
            console.log('加载代码响应:', result);
            console.log('请求URL参数 - 时间戳:', timestamp, '随机数:', random, '缓存破坏器:', cacheBuster);
            
            if (result.success) {
                const fileName = document.getElementById('code-file-name');
                
                // 强制设置代码内容到CodeMirror编辑器
                const codeContent = result.data.code || '';
                
                console.log('准备设置代码内容，长度:', codeContent.length);
                console.log('代码内容前50字符:', codeContent.substring(0, 50));
                
                // 确保编辑器存在
                if (this.codeEditor) {
                    console.log('编辑器存在，开始设置内容...');
                    
                    // 清空编辑器内容
                    this.codeEditor.setValue('');
                    console.log('编辑器已清空');
                    
                    // 设置新内容
                    this.codeEditor.setValue(codeContent);
                    console.log('代码内容已设置到编辑器');
                    
                    // 强制刷新
                    this.codeEditor.refresh();
                    console.log('编辑器已刷新');
                    
                    // 再次确保内容设置成功
                    const currentContent = this.codeEditor.getValue();
                    console.log('编辑器当前内容长度:', currentContent.length);
                    console.log('编辑器当前内容前50字符:', currentContent.substring(0, 50));
                    
                    // 如果内容设置失败，尝试再次设置
                    if (currentContent.length === 0 && codeContent.length > 0) {
                        console.log('内容设置失败，尝试再次设置...');
                        setTimeout(() => {
                            this.codeEditor.setValue(codeContent);
                            this.codeEditor.refresh();
                            console.log('重新设置内容完成');
                        }, 100);
                    }
                } else {
                    console.error('编辑器不存在！');
                }
                
                fileName.textContent = result.data.filename || 'test_file.py';
                
                // 保存原始代码
                this.originalCodeContent = codeContent;
                
                // 更新状态
                this.updateCodeStatus('代码已加载');
                this.updateCodeInfo();
                
                console.log('加载代码成功，文件名:', result.data.filename);
                console.log('代码内容长度:', codeContent.length);
                console.log('原始代码内容长度:', this.originalCodeContent.length);
                
            } else {
                throw new Error(result.message || '加载代码失败');
            }
            
        } catch (error) {
            console.error('加载项目代码失败:', error);
            showToast('加载代码失败: ' + error.message, 'error');
            
            // 显示错误信息在编辑器中
            this.codeEditor.setValue(`# 加载代码失败: ${error.message}\n# 请检查项目配置或联系管理员`);
            this.updateCodeStatus('加载失败');
        }
    }
    
    // 初始化代码编辑器
    initCodeEditor() {
        try {
            console.log('初始化代码编辑器...');
            
            // 获取文本区域元素
            const textarea = document.getElementById('codeEditor');
            if (!textarea) {
                console.error('找不到代码编辑器文本区域');
                return;
            }
            
            // 销毁现有编辑器实例
            if (this.codeEditor) {
                this.codeEditor.toTextArea();
                this.codeEditor = null;
            }
        
            // 创建新的CodeMirror编辑器实例
            this.codeEditor = CodeMirror.fromTextArea(textarea, {
            mode: 'python',
                theme: 'monokai',
            lineNumbers: true,
                autoCloseBrackets: true,
                matchBrackets: true,
            indentUnit: 4,
            tabSize: 4,
            indentWithTabs: false,
                lineWrapping: true,
            foldGutter: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
            extraKeys: {
                    'Tab': 'indentMore',
                    'Shift-Tab': 'indentLess'
                },
                // 添加缓存控制配置
                undoDepth: 200,
                historyEventDelay: 1250,
                // 不设置初始值，让loadProjectCode方法设置
                autofocus: false
            });
            
            // 强制刷新编辑器显示
            setTimeout(() => {
                if (this.codeEditor) {
                    this.codeEditor.refresh();
                    console.log('代码编辑器刷新完成');
        
                    // 检查编辑器是否正常工作
                    const content = this.codeEditor.getValue();
                    console.log('编辑器初始化后内容长度:', content.length);
                }
            }, 100);
            
            console.log('代码编辑器初始化完成');
            
        } catch (error) {
            console.error('初始化代码编辑器失败:', error);
        }
    }
    
    // 更新代码状态
    updateCodeStatus(status) {
        const statusElement = document.getElementById('code-status-text');
        if (statusElement) {
            statusElement.textContent = status;
        }
    }
    
    // 更新代码信息（行数、字符数）
    updateCodeInfo() {
        const lineCountElement = document.getElementById('code-line-count');
        const charCountElement = document.getElementById('code-char-count');
        
        if (this.codeEditor && lineCountElement && charCountElement) {
            const content = this.codeEditor.getValue();
            const lines = content.split('\n').length;
            const chars = content.length;
            
            lineCountElement.textContent = `${lines} 行`;
            charCountElement.textContent = `${chars} 字符`;
        }
    }
    
    // 保存代码（不关闭弹框）
    async saveCode() {
        if (!this.currentCodeProjectId) {
            showToast('没有选中的项目', 'error');
            return;
        }
        
        try {
            const code = this.codeEditor.getValue();
            
            // 更新状态
            this.updateCodeStatus('保存中...');
            
            console.log('开始保存代码，项目ID:', this.currentCodeProjectId);
            console.log('代码内容长度:', code.length);
            
            const response = await fetch(`/api/automation/projects/${this.currentCodeProjectId}/code`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                body: JSON.stringify({
                    code: code
                })
            });
            
            const result = await response.json();
            console.log('保存响应:', result);
            
            if (result.success) {
                // 更新原始代码
                this.originalCodeContent = code;
                this.updateCodeStatus('已保存');
                showToast('代码保存成功', 'success');
                
                // 更新项目列表中的状态
                this.renderProjectsList();
                
                // 强制刷新编辑器内容，确保显示最新代码
                setTimeout(() => {
                    console.log('强制刷新编辑器内容');
                    this.loadProjectCode(this.currentCodeProjectId);
                }, 200);
                
            } else {
                throw new Error(result.message || '保存失败');
            }
            
        } catch (error) {
            console.error('保存代码失败:', error);
            showToast('保存代码失败: ' + error.message, 'error');
            this.updateCodeStatus('保存失败');
        }
    }
    
    // 保存代码并关闭弹框
    async saveCodeAndClose() {
        if (!this.currentCodeProjectId) {
            showToast('没有选中的项目', 'error');
            return;
        }
        
        try {
            const code = this.codeEditor.getValue();
            
            // 更新状态
            this.updateCodeStatus('保存中...');
            
            console.log('开始保存代码并关闭，项目ID:', this.currentCodeProjectId);
            console.log('代码内容长度:', code.length);
            
            const response = await fetch(`/api/automation/projects/${this.currentCodeProjectId}/code`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                body: JSON.stringify({
                    code: code
                })
            });
            
            const result = await response.json();
            console.log('保存响应:', result);
            
            if (result.success) {
                // 更新原始代码
                this.originalCodeContent = code;
                this.updateCodeStatus('已保存');
                showToast('代码保存成功', 'success');
                
                // 强制刷新项目列表缓存
                this.projects = []; // 清空项目缓存
                await this.loadProjects(); // 重新加载项目数据（会根据当前视图模式自动渲染）
                
                // 保存成功后自动关闭弹框
                setTimeout(() => {
                    this.closeCodeManagementModal();
                }, 1000); // 延迟1秒关闭，让用户看到保存成功的提示
                
            } else {
                throw new Error(result.message || '保存失败');
            }
            
        } catch (error) {
            console.error('保存代码失败:', error);
            showToast('保存代码失败: ' + error.message, 'error');
            this.updateCodeStatus('保存失败');
        }
    }
    
    // 重置代码
    resetCode() {
        if (!this.currentCodeProjectId) {
            showToast('没有选中的项目', 'error');
            return;
        }
        
        this.codeEditor.setValue(this.originalCodeContent);
        this.updateCodeStatus('已重置');
        this.updateCodeInfo();
        showToast('代码已重置为原始内容', 'info');
    }

    // ==================== 分页功能 ====================
    
    // 计算分页数据 - 根据当前视图模式
    calculatePaginationData() {
        if (this.showGroupedView) {
            // 分组视图下，分页基于分组的数量
            this.totalItems = Array.isArray(this.groupedProjects) ? this.groupedProjects.length : 0;
        } else {
            // 列表视图下，分页基于项目的数量
            this.totalItems = Array.isArray(this.projects) ? this.projects.length : 0;
        }
        
        // 计算总页数
        this.totalPages = Math.ceil(this.totalItems / this.pageSize);
        
        // 确保当前页在有效范围内
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages > 0 ? this.totalPages : 1;
        }
        
        console.log('分页数据计算完成:', {
            viewMode: this.showGroupedView ? '分组视图' : '列表视图',
            totalItems: this.totalItems,
            currentPage: this.currentPage,
            pageSize: this.pageSize,
            totalPages: this.totalPages
        });
    }
    
    // 渲染分页控件 - 只在有数据时显示
    renderPagination() {
        const paginationContainer = document.getElementById('pagination-container');
        if (!paginationContainer) return;

        // 如果没有数据，隐藏分页控件
        if (this.totalItems === 0) {
            paginationContainer.style.display = 'none';
            return;
        }

        // 有数据时显示分页控件
        paginationContainer.style.display = 'block';
        
        const startItem = (this.currentPage - 1) * this.pageSize + 1;
        const endItem = Math.min(this.currentPage * this.pageSize, this.totalItems);

        const paginationHtml = `
            <div class="pagination-info">
                <span>显示第 ${startItem}-${endItem} ${this.showGroupedView ? '个分组' : '条记录'}，共 ${this.totalItems} ${this.showGroupedView ? '个分组' : '条记录'}</span>
            </div>
            <div class="pagination-controls">
                <div class="pagination-size-selector">
                    <label>每页显示：</label>
                    <select id="pageSizeSelect" class="form-control">
                        <option value="5" ${this.pageSize === 5 ? 'selected' : ''}>5</option>
                        <option value="10" ${this.pageSize === 10 ? 'selected' : ''}>10</option>
                        <option value="20" ${this.pageSize === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${this.pageSize === 50 ? 'selected' : ''}>50</option>
                    </select>
                </div>
                <div class="pagination-buttons">
                    <button class="btn btn-secondary" id="firstPageBtn" ${this.currentPage === 1 ? 'disabled' : ''}>
                        <i class="fas fa-angle-double-left"></i>
                    </button>
                    <button class="btn btn-secondary" id="prevPageBtn" ${this.currentPage === 1 ? 'disabled' : ''}>
                        <i class="fas fa-angle-left"></i>
                    </button>
                    <div class="page-numbers">
                        ${this.generatePageNumbers()}
                    </div>
                    <button class="btn btn-secondary" id="nextPageBtn" ${this.currentPage === this.totalPages ? 'disabled' : ''}>
                        <i class="fas fa-angle-right"></i>
                    </button>
                    <button class="btn btn-secondary" id="lastPageBtn" ${this.currentPage === this.totalPages ? 'disabled' : ''}>
                        <i class="fas fa-angle-double-right"></i>
                    </button>
                </div>
            </div>
        `;

        paginationContainer.innerHTML = paginationHtml;
        this.bindPaginationEvents();
    }

    // 生成页码按钮
    generatePageNumbers() {
        const maxVisiblePages = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(this.totalPages, startPage + maxVisiblePages - 1);

        // 调整起始页，确保显示足够的页码
        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        let pageNumbersHtml = '';

        // 第一页
        if (startPage > 1) {
            pageNumbersHtml += `<button class="btn btn-secondary page-number" data-page="1">1</button>`;
            if (startPage > 2) {
                pageNumbersHtml += `<span class="page-ellipsis">...</span>`;
            }
        }

        // 中间页码
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === this.currentPage;
            pageNumbersHtml += `
                <button class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} page-number" data-page="${i}">
                    ${i}
                </button>
            `;
        }

        // 最后一页
        if (endPage < this.totalPages) {
            if (endPage < this.totalPages - 1) {
                pageNumbersHtml += `<span class="page-ellipsis">...</span>`;
            }
            pageNumbersHtml += `<button class="btn btn-secondary page-number" data-page="${this.totalPages}">${this.totalPages}</button>`;
        }

        return pageNumbersHtml;
    }

    // 绑定分页事件
    bindPaginationEvents() {
        // 页码按钮
        const pageNumbers = document.querySelectorAll('.page-number');
        pageNumbers.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = parseInt(e.target.dataset.page);
                this.goToPage(page);
            });
        });

        // 首页按钮
        const firstPageBtn = document.getElementById('firstPageBtn');
        if (firstPageBtn) {
            firstPageBtn.addEventListener('click', () => this.goToPage(1));
        }

        // 上一页按钮
        const prevPageBtn = document.getElementById('prevPageBtn');
        if (prevPageBtn) {
            prevPageBtn.addEventListener('click', () => this.goToPage(this.currentPage - 1));
        }

        // 下一页按钮
        const nextPageBtn = document.getElementById('nextPageBtn');
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', () => this.goToPage(this.currentPage + 1));
        }

        // 末页按钮
        const lastPageBtn = document.getElementById('lastPageBtn');
        if (lastPageBtn) {
            lastPageBtn.addEventListener('click', () => this.goToPage(this.totalPages));
        }

        // 每页显示数量选择器
        const pageSizeSelect = document.getElementById('pageSizeSelect');
        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                this.pageSize = parseInt(e.target.value);
                this.currentPage = 1; // 重置到第一页
                
                // 根据当前视图模式调用相应的渲染函数
                if (this.showGroupedView) {
                    this.renderGroupedProjects();
                } else {
                    this.renderProjectsList();
                }
            });
        }
    }

    // 跳转到指定页
    goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) {
            return;
        }
        
        this.currentPage = page;
        
        // 根据当前视图模式调用相应的渲染函数
        if (this.showGroupedView) {
            this.renderGroupedProjects();
        } else {
            this.renderProjectsList();
        }
        
        // 滚动到列表顶部
        const automationList = document.querySelector('.automation-list');
        if (automationList) {
            automationList.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // 处理编辑时的产品地址显示
    handleProductAddressForEdit(project) {
        try {
            // 重置地址显示
            this.resetProductAddressDisplay();
            
            // 检查是否有产品ID
            if (!project.product_ids || project.product_ids.length === 0) {
                return;
            }
            
            // 获取项目中的产品信息
            const projectProducts = [];
            const processedComposite = new Set(); // 避免重复产品（按product_id+name+env）
            
            project.product_ids.forEach(productId => {
                const product = this.products.find(p => p.product_id === productId);
                if (product) {
                    const compositeKey = `${product.product_id}_${product.product_name || ''}_${product.environment || ''}`;
                    if (processedComposite.has(compositeKey)) {
                        return;
                    }
                    processedComposite.add(compositeKey);
                    
                    // 如果项目有存储的多产品地址映射，使用它
                    let productAddress = product.product_address || '';
                    
                    // 检查project_address是否是JSON格式的地址映射或数组，或已是对象/数组
                    if (project.product_address) {
                        const addrValue = project.product_address;
                        if (typeof addrValue === 'string') {
                            // 解析为对象（可能是{SC_1: url, SC_2: url}或{SC: url}）
                            try {
                                const maybeObj = JSON.parse(addrValue);
                                if (maybeObj && typeof maybeObj === 'object' && !Array.isArray(maybeObj)) {
                                    // 收集与该产品相关的所有键（SC、SC_1、SC_2...）
                                    const relatedEntries = Object.entries(maybeObj).filter(([k]) => k === productId || k.startsWith(`${productId}_`));
                                    if (relatedEntries.length > 1) {
                                        relatedEntries.forEach(([k, v], idx) => {
                                            projectProducts.push({
                                                ...product,
                                                product_address: v,
                                                display_name: `${product.product_name} (地址${idx + 1})`
                                            });
                                        });
                                        return;
                                    } else if (relatedEntries.length === 1) {
                                        productAddress = relatedEntries[0][1];
                                        // 继续向下push单条地址
                                    }
                                }
                            } catch (_) {}
                            // 再尝试解析为数组（单产品场景）
                            try {
                                const maybeArr = JSON.parse(addrValue);
                                if (Array.isArray(maybeArr)) {
                                    maybeArr.forEach((addr, index) => {
                                        projectProducts.push({
                                            ...product,
                                            product_address: addr,
                                            display_name: `${product.product_name} (地址${index + 1})`
                                        });
                                    });
                                    return;
                                }
                            } catch (_) {}
                            // 字符串且无法解析，若仅一个产品则当作单地址
                            if (project.product_ids && project.product_ids.length === 1) {
                                productAddress = addrValue;
                            }
                        } else if (Array.isArray(addrValue)) {
                            addrValue.forEach((addr, index) => {
                                projectProducts.push({
                                    ...product,
                                    product_address: addr,
                                    display_name: `${product.product_name} (地址${index + 1})`
                                });
                            });
                            return;
                        } else if (addrValue && typeof addrValue === 'object') {
                            // 直接对象的情况
                            const relatedEntries = Object.entries(addrValue).filter(([k]) => k === productId || k.startsWith(`${productId}_`));
                            if (relatedEntries.length > 1) {
                                relatedEntries.forEach(([k, v], idx) => {
                                    projectProducts.push({
                                        ...product,
                                        product_address: v,
                                        display_name: `${product.product_name} (地址${idx + 1})`
                                    });
                                });
                                return;
                            } else if (relatedEntries.length === 1) {
                                productAddress = relatedEntries[0][1];
                            }
                        }
                    }
                    
                    projectProducts.push({
                        ...product,
                        product_address: productAddress
                    });
                }
            });
            
            // 根据产品数量决定显示方式
            if (projectProducts.length === 1) {
                this.showSingleProductAddress(projectProducts[0]);
            } else if (projectProducts.length > 1) {
                this.showMultiProductAddresses(projectProducts);
            }
            
        } catch (error) {
            console.error('处理编辑时的产品地址出错:', error);
            // 回退到简单显示
            document.getElementById('automationProductAddress').style.display = 'block';
            document.getElementById('automationProductAddress').value = project.product_address || '';
        }
    }

    // 初始化产品多选功能
    async initProductMultiSelect() {
        try {
            const input = document.getElementById('productIdsInput');
            const dropdown = document.getElementById('productIdsDropdown');
            
            if (!input || !dropdown) {
                console.error('产品多选元素未找到');
                return;
            }

            // 清空下拉框并填充产品选项
            this.populateProductDropdownOptions(dropdown);

            // 移除之前的事件监听器（如果存在）
            if (this.multiselectClickHandler) {
                input.removeEventListener('click', this.multiselectClickHandler);
            }
            if (this.documentClickHandler) {
                document.removeEventListener('click', this.documentClickHandler);
            }

            // 创建新的事件处理器
            this.multiselectClickHandler = async () => {
                try {
                    const isActive = input.classList.contains('active');
                    document.querySelectorAll('.multiselect-input').forEach(inp => {
                        inp.classList.remove('active');
                    });
                    document.querySelectorAll('.multiselect-dropdown').forEach(dd => {
                        dd.classList.remove('show');
                    });
                    
                    if (!isActive) {
                        // 确保每次点击时都有最新的产品数据
                        if (this.products.length === 0) {
                            await this.loadProducts();
                        }
                        this.populateProductDropdownOptions(dropdown);
                        input.classList.add('active');
                        dropdown.classList.add('show');
                    }
                } catch (error) {
                    console.error('产品多选框点击处理器出错:', error);
                }
            };

            this.documentClickHandler = (e) => {
                try {
                    if (!e.target.closest('.custom-multiselect-container')) {
                        input.classList.remove('active');
                        dropdown.classList.remove('show');
                    }
                } catch (error) {
                    console.error('文档点击处理器出错:', error);
                }
            };

            // 绑定新的事件监听器
            input.addEventListener('click', this.multiselectClickHandler);
            document.addEventListener('click', this.documentClickHandler);

            this.updateSelectedProducts();
            console.log('产品多选框初始化完成');
        } catch (error) {
            console.error('initProductMultiSelect 出错:', error);
            throw error;
        }
    }

    // 填充产品下拉选项
    populateProductDropdownOptions(dropdown) {
        dropdown.innerHTML = '';
        this.products.forEach((product, index) => {
            // 使用索引作为唯一标识符
            const uniqueId = `${product.product_id}_${index}`;
            const option = document.createElement('div');
            option.className = 'multiselect-option';
            
            // 构建更详细的产品显示信息
            const productDisplayName = product.product_name || '未命名产品';
            const systemInfo = product.system_type ? ` (${product.system_type})` : '';
            const fullDisplayName = `${productDisplayName}${systemInfo}`;
            
            option.innerHTML = `
                <input type="checkbox" value="${uniqueId}" data-product-index="${index}"
                       ${this.selectedProducts.includes(uniqueId) ? 'checked' : ''}>
                <div class="option-content">
                    <div class="product-id">${product.product_id}</div>
                    <div class="product-details">
                        ${fullDisplayName}
                    </div>
                </div>
            `;
            
            option.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    const checkbox = option.querySelector('input[type="checkbox"]');
                    checkbox.checked = !checkbox.checked;
                }
                this.updateProductSelection();
            });
            
            dropdown.appendChild(option);
        });
    }

    // 更新产品选择
    updateProductSelection() {
        const checkboxes = document.querySelectorAll('#productIdsDropdown input[type="checkbox"]:checked');
        this.selectedProducts = Array.from(checkboxes).map(cb => cb.value);
        
        // 更新显示
        this.updateSelectedProducts();
        
        // 触发产品选择变化事件
        this.onProductSelectionChange();
    }

    // 更新选中的产品显示
    updateSelectedProducts() {
        const container = document.getElementById('productIdsSelected');
        const placeholder = document.querySelector('.multiselect-placeholder');
        
        if (!container || !placeholder) return;

        container.innerHTML = '';
        
        if (this.selectedProducts.length === 0) {
            placeholder.textContent = '请选择产品ID';
            placeholder.style.display = 'block';
        } else {
            placeholder.style.display = 'none';
            // 芯片按 product_id + product_name 去重
            const seenCompositeKeys = new Set();
            this.selectedProducts.forEach(uniqueId => {
                const lastUnderscoreIndex = uniqueId.lastIndexOf('_');
                const index = parseInt(uniqueId.substring(lastUnderscoreIndex + 1));
                const product = this.products[index];
                if (product) {
                    const key = `${product.product_id}__${product.product_name || ''}`;
                    if (seenCompositeKeys.has(key)) return;
                    seenCompositeKeys.add(key);
                    const item = document.createElement('div');
                    item.className = 'selected-item';
                    
                    // 构建更详细的产品显示信息
                    const productDisplayName = product.product_name || '未命名产品';
                    const systemInfo = product.system_type ? ` (${product.system_type})` : '';
                    const fullDisplayName = `${productDisplayName}${systemInfo}`;
                    
                    item.innerHTML = `
                        <span>${product.product_id} - ${fullDisplayName}</span>
                        <span class="remove-item" onclick="automationManagement.removeSelectedProduct('${uniqueId}')">&times;</span>
                    `;
                    container.appendChild(item);
                }
            });
        }
        
        // 更新产品地址显示
        this.onProductSelectionChange();
    }

    // 设置事件监听器
    setupEventListeners() {
        // 加载产品数据
        this.loadProducts();
        
        // 绑定事件
        this.bindEvents();
        
        // 启动状态轮询，确保实时更新
        this.startStatusPolling();
    }

    // 打开编辑项目弹窗
    async openEditProjectModal(projectId) {
        try {
            const project = this.projects.find(p => p.id === projectId);
            if (!project) {
                showToast('项目不存在', 'error');
                return;
            }

            this.currentEditingProject = project;
            this.isEditing = true;
            
            // 创建测试步骤的深拷贝，避免直接修改原始数据
            this.editingTestSteps = JSON.parse(JSON.stringify(project.test_steps || []));
            this.testSteps = [...this.editingTestSteps];
            
            // 创建图片缓存的副本
            this.editingUploadedImages.clear();
            this.uploadedImages.clear();
            
            // 为每个有图片的步骤创建预览
            this.testSteps.forEach((step, index) => {
                if (step.operation_params && step.operation_params.trim() !== '' && step.operation_type === 'game') {
                    // 为已保存的图片创建预览URL
                    const imageUrl = `/static/${step.operation_params}`;
                    this.editingUploadedImages.set(`step_${index}`, imageUrl);
                    this.uploadedImages.set(`step_${index}`, imageUrl);
                }
            });

            // 填充表单
            this.populateForm(project);
            
            // 渲染测试步骤
            this.renderTestSteps();
            
            // 显示弹窗
            this.showModal();
            
            showToast('编辑模式已启用，修改不会立即保存', 'info');
        } catch (error) {
            console.error('打开编辑弹窗失败:', error);
            showToast('打开编辑弹窗失败', 'error');
        }
    }

    // 填充表单数据（编辑模式）
    populateForm(project) {
        try {
            // 更新标题
            document.getElementById('automation-modal-title').textContent = '编辑自动化项目';
            
            // 填充基本信息
            document.getElementById('processName').value = project.process_name || '';
            document.getElementById('automationSystem').value = project.system || '';
            document.getElementById('automationProductType').value = project.product_type || '';
            document.getElementById('automationEnvironment').value = project.environment || '';
            
            // 填充产品选择
            if (project.product_ids && Array.isArray(project.product_ids)) {
                // 清空当前选择
                this.selectedProducts = [];
                
                // 为每个产品ID选择一个具体的产品索引（允许重复产品ID映射到不同索引）
                const usedIndexes = new Set();
                
                project.product_ids.forEach((productId, i) => {
                    // 候选列表：先按product_id过滤
                    let candidateIndexes = this.products
                        .map((p, idx) => ({ p, idx }))
                        .filter(({ p }) => p.product_id === productId);
                    
                    // 优先匹配系统和环境
                    if (project.system || project.environment) {
                        const strictMatches = candidateIndexes.filter(({ p }) =>
                            (!project.system || p.system_type === project.system) &&
                            (!project.environment || p.environment === project.environment)
                        );
                        if (strictMatches.length > 0) {
                            candidateIndexes = strictMatches;
                        }
                    }
                    
                    // 选择一个未使用的索引
                    let chosen = candidateIndexes.find(({ idx }) => !usedIndexes.has(idx));
                    if (!chosen && candidateIndexes.length > 0) {
                        // 若都已使用，则允许复用第一个候选
                        chosen = candidateIndexes[0];
                    }
                    
                    if (chosen) {
                        usedIndexes.add(chosen.idx);
                        const uniqueId = `${productId}_${chosen.idx}`;
                        this.selectedProducts.push(uniqueId);
                    }
                });
                
                // 更新UI显示
                this.updateSelectedProducts();
                this.onProductSelectionChange();
            }
            
            console.log('表单填充完成:', {
                process_name: project.process_name,
                system: project.system,
                product_type: project.product_type,
                environment: project.environment,
                product_ids: project.product_ids,
                selectedProducts: this.selectedProducts
            });
        } catch (error) {
            console.error('填充表单失败:', error);
            showToast('填充表单数据失败', 'error');
        }
    }

    // 重置表单
    async resetForm() {
        // 重置表单数据
        const form = document.getElementById('automationForm');
        if (form) {
            form.reset();
        }
        
        // 重置产品地址显示状态
        this.resetProductAddressDisplay();
        
        // 重置多选框
        this.resetMultiselect();
        
        // 更新标题
        document.getElementById('automation-modal-title').textContent = '添加自动化项目';
        
        // 清空测试步骤
        this.resetTestStepsList();
        
        // 加载枚举值并初始化自定义选择框
        await this.loadEnumValues();
        this.initCustomSelects();
        await this.initProductMultiSelect();
    }

    // 绑定分组展开按钮事件
    bindGroupExpandButtonEvents() {
        const groupHeaders = document.querySelectorAll('.group-header');
        console.log('找到分组头部数量:', groupHeaders.length);
        
        groupHeaders.forEach((header, index) => {
            this.bindSingleGroupHeaderEvents(header, index);
        });
    }

    // 绑定分组添加项目按钮事件
    bindGroupAddProjectButtonEvents() {
        const addButtons = document.querySelectorAll('.group-add-project-btn');
        console.log('找到分组添加项目按钮数量:', addButtons.length);
        
        addButtons.forEach((button) => {
            this.bindSingleAddButtonEvents(button);
        });
    }

    // 绑定分组批量执行按钮事件
    bindGroupBatchExecuteButtonEvents() {
        console.log('🔧 开始绑定分组批量执行按钮事件...');
        const batchExecuteButtons = document.querySelectorAll('.group-batch-execute-btn');
        console.log('📊 找到分组批量执行按钮数量:', batchExecuteButtons.length);
        
        if (batchExecuteButtons.length === 0) {
            console.warn('⚠️ 未找到任何分组批量执行按钮，检查CSS选择器是否正确');
            return;
        }
        
        batchExecuteButtons.forEach((button, index) => {
            console.log(`🔗 处理第 ${index + 1} 个批量执行按钮:`, button);
            console.log(`📝 按钮HTML:`, button.outerHTML);
            
            // 移除之前的事件监听器，避免重复绑定
            if (button._batchExecuteHandler) {
                console.log(`🗑️ 移除按钮 ${index + 1} 的旧事件监听器`);
                button.removeEventListener('click', button._batchExecuteHandler);
                delete button._batchExecuteHandler;
            }
            
            // 创建新的事件处理函数，保存this上下文
            const self = this;
            button._batchExecuteHandler = function(event) {
                console.log('🚀 分组批量执行按钮点击事件触发!');
                console.log('📍 点击的按钮:', event.currentTarget);
                
                event.preventDefault();
                event.stopPropagation();
                
                const productId = button.getAttribute('data-product-id');
                const uniqueGroupId = button.getAttribute('data-unique-group-id');
                
                console.log('🆔 分组批量执行，产品ID:', productId);
                console.log('🏷️ 分组批量执行，唯一分组ID:', uniqueGroupId);
                console.log('📋 按钮所有属性:', {
                    productId,
                    uniqueGroupId,
                    className: button.className,
                    dataset: button.dataset
                });
                
                if (productId && uniqueGroupId) {
                    console.log('✅ 数据属性检查通过，开始执行批量测试');
                    console.log('🔍 this上下文检查:', self);
                    self.batchExecuteGroupTests(productId, uniqueGroupId);
                } else {
                    console.error('❌ 批量执行按钮缺少必要的数据属性');
                    console.error('缺少的属性:', {
                        productId: !productId ? '缺少 data-product-id' : '已存在',
                        uniqueGroupId: !uniqueGroupId ? '缺少 data-unique-group-id' : '已存在'
                    });
                    showToast('按钮配置错误，请刷新页面重试', 'error');
                }
            };
            
            // 绑定事件
            console.log(`🔗 为按钮 ${index + 1} 绑定点击事件`);
            button.addEventListener('click', button._batchExecuteHandler);
            console.log(`✅ 按钮 ${index + 1} 事件绑定完成`);
        });
        
        console.log('🎉 所有分组批量执行按钮事件绑定完成');
        
        // 添加调试信息：检查页面上的所有相关按钮
        setTimeout(() => {
            this.debugButtonStatus();
        }, 100);
    }
    
    // 调试方法：检查页面上的按钮状态
    debugButtonStatus() {
        console.log('🔍 开始调试页面按钮状态...');
        
        // 检查所有分组批量执行按钮
        const batchButtons = document.querySelectorAll('.group-batch-execute-btn');
        console.log('🎯 页面上的批量执行按钮数量:', batchButtons.length);
        
        batchButtons.forEach((btn, index) => {
            console.log(`📋 按钮 ${index + 1}:`, {
                element: btn,
                className: btn.className,
                productId: btn.getAttribute('data-product-id'),
                uniqueGroupId: btn.getAttribute('data-unique-group-id'),
                innerHTML: btn.innerHTML,
                hasClickHandler: !!btn._batchExecuteHandler,
                isVisible: btn.offsetParent !== null,
                isDisabled: btn.disabled
            });
        });
        
        // 检查所有分组添加项目按钮（作为对比）
        const addButtons = document.querySelectorAll('.group-add-project-btn');
        console.log('📊 页面上的添加项目按钮数量:', addButtons.length);
        
        // 检查所有分组头部
        const groupHeaders = document.querySelectorAll('.group-header');
        console.log('🏷️ 页面上的分组头部数量:', groupHeaders.length);
        
        // 检查页面整体结构
        const groupViews = document.querySelectorAll('.product-group');
        console.log('📦 分组视图数量:', groupViews.length);
        
        console.log('🔍 调试完成');
    }
    
    // 手动调试方法（可在控制台调用）
    manualDebugButtons() {
        console.log('🔧 手动调试批量执行按钮...');
        this.debugButtonStatus();
        
        // 尝试手动绑定事件
        console.log('🔄 尝试重新绑定事件...');
        this.bindGroupBatchExecuteButtonEvents();
        
        return '调试完成，请查看控制台日志';
    }

    // 为单个分组头部绑定事件
    bindSingleGroupHeaderEvents(header, index = 0) {
            console.log(`绑定分组头部 ${index}:`, header);
            
            // 移除之前的事件监听器，避免重复绑定
            if (header._clickHandler) {
                header.removeEventListener('click', header._clickHandler);
                delete header._clickHandler;
            }
            
            // 创建新的事件处理函数
            header._clickHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                console.log('分组头部点击事件触发');
                
                const productId = event.currentTarget.getAttribute('data-product-id');
            const uniqueGroupId = event.currentTarget.getAttribute('data-unique-group-id');
                console.log('分组头部被点击，产品ID:', productId);
            console.log('分组头部被点击，唯一分组ID:', uniqueGroupId);
            
            if (uniqueGroupId) {
                this.toggleGroupExpansion(uniqueGroupId);
            } else if (productId) {
                // 回退到使用产品ID
                console.warn('未找到唯一分组ID，使用产品ID作为回退');
                    this.toggleGroupExpansion(productId);
                } else {
                console.error('无法获取分组ID');
                }
            };
            
            // 绑定新的事件监听器
            header.addEventListener('click', header._clickHandler);
    }

    // 为单个添加按钮绑定事件
    bindSingleAddButtonEvents(addBtn) {
        console.log('绑定添加按钮事件:', addBtn);
        if (addBtn) {
            // 移除之前的事件监听器，避免重复绑定
            if (addBtn._clickHandler) {
                addBtn.removeEventListener('click', addBtn._clickHandler);
                delete addBtn._clickHandler;
            }
            
            // 创建新的事件处理函数
            addBtn._clickHandler = (event) => {
                console.log('=== 添加项目按钮被点击 ===');
                console.log('事件对象:', event);
                console.log('目标元素:', event.target);
                console.log('当前元素:', event.currentTarget);
                
                event.preventDefault();
                event.stopPropagation(); // 阻止事件冒泡
                event.stopImmediatePropagation(); // 阻止同一元素上其他监听器执行
                
                console.log('调用 openAddProjectModalForGroup');
                this.openAddProjectModalForGroup(addBtn);
                
                return false; // 额外保险
            };
            
            // 绑定新的事件监听器
            addBtn.addEventListener('click', addBtn._clickHandler);
            console.log('添加按钮事件已绑定');
        } else {
            console.log('未找到添加按钮');
        }
    }

    // 为单个分组绑定所有相关事件
    bindSingleGroupEvents(groupElement) {
        // 绑定分组头部事件
        const groupHeader = groupElement.querySelector('.group-header');
        if (groupHeader) {
            this.bindSingleGroupHeaderEvents(groupHeader);
        }
        
        // 绑定添加项目按钮事件（现在独立于分组头部）
        const addBtn = groupElement.querySelector('.group-add-project-btn');
        if (addBtn) {
            this.bindSingleAddButtonEvents(addBtn);
        }
        
        // 绑定分组内的批量执行按钮事件
        const batchExecuteBtn = groupElement.querySelector('.group-batch-execute-btn');
        if (batchExecuteBtn) {
            console.log('🔧 为单个分组绑定批量执行按钮事件...');
            
            // 移除之前的事件监听器，避免重复绑定
            if (batchExecuteBtn._batchExecuteHandler) {
                batchExecuteBtn.removeEventListener('click', batchExecuteBtn._batchExecuteHandler);
                delete batchExecuteBtn._batchExecuteHandler;
            }
            
            // 创建新的事件处理函数，保存this上下文
            const self = this;
            batchExecuteBtn._batchExecuteHandler = function(event) {
                console.log('🚀 单个分组批量执行按钮点击事件触发!');
                console.log('📍 点击的按钮:', event.currentTarget);
                
                event.preventDefault();
                event.stopPropagation();
                
                const productId = batchExecuteBtn.getAttribute('data-product-id');
                const uniqueGroupId = batchExecuteBtn.getAttribute('data-unique-group-id');
                
                console.log('🆔 单个分组批量执行，产品ID:', productId);
                console.log('🏷️ 单个分组批量执行，唯一分组ID:', uniqueGroupId);
                
                if (productId && uniqueGroupId) {
                    console.log('✅ 单个分组数据属性检查通过，开始执行批量测试');
                    self.batchExecuteGroupTests(productId, uniqueGroupId);
                } else {
                    console.error('❌ 单个分组批量执行按钮缺少必要的数据属性');
                    showToast('按钮配置错误，请刷新页面重试', 'error');
                }
            };
            
            // 绑定事件
            batchExecuteBtn.addEventListener('click', batchExecuteBtn._batchExecuteHandler);
            console.log('✅ 单个分组批量执行按钮事件绑定完成');
        }
        
        // 绑定项目展开按钮事件
        const expandButtons = groupElement.querySelectorAll('.expand-btn');
        expandButtons.forEach(button => {
            this.bindSingleExpandButtonEvents(button);
        });
    }

    // 切换分组展开状态
    async toggleGroupExpansion(groupId) {
        try {
            console.log('切换分组展开状态:', groupId);
            console.log('当前展开状态:', Array.from(this.expandedGroups));
            console.log('所有分组数据:', this.groupedProjects.map((g, index) => ({
                index: index,
                product_id: g.product_id,
                product_name: g.product_name,
                environment: g.environment,
                product_type: g.product_type,
                projectCount: g.projects?.length || 0,
                uniqueId: `${g.product_id}_${g.product_name}_${g.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_')
            })));
            
            // 防止重复操作
            if (this.isProcessing) {
                console.log('操作正在进行中，请稍候...');
                return;
            }
            
            this.isProcessing = true;
            
            // 验证数据完整性
            if (!Array.isArray(this.groupedProjects)) {
                console.error('groupedProjects 不是数组，尝试重新加载数据');
                await this.loadGroupedProjects();
                
                if (!Array.isArray(this.groupedProjects)) {
                    console.error('无法加载分组数据');
                    this.showErrorMessage('数据加载失败，请刷新页面重试');
                    this.isProcessing = false;
                    return;
                }
            }
            
            // 查找分组，支持两种ID格式
            let group = null;
            let productId = null;
            
            // 首先尝试通过唯一ID查找
            if (groupId.includes('_')) {
                // 这是一个唯一的分组ID
                group = this.groupedProjects.find(g => {
                    const uniqueId = `${g.product_id}_${g.product_name}_${g.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
                    return uniqueId === groupId;
                });
                if (group) {
                    productId = group.product_id;
                }
            } else {
                // 这是一个产品ID，使用旧逻辑
                productId = groupId;
                group = this.groupedProjects.find(g => g.product_id === productId);
            }
            
            console.log('找到的分组:', group);
            console.log('分组产品名称:', group?.product_name);
            if (!group) {
                console.error('找不到分组ID:', groupId);
                this.showErrorMessage('分组数据错误，请刷新页面重试');
                this.isProcessing = false;
                return;
            }
            
            const wasExpanded = this.expandedGroups.has(groupId);
            if (wasExpanded) {
                this.expandedGroups.delete(groupId);
                console.log('收起分组:', groupId);
            } else {
                this.expandedGroups.add(groupId);
                console.log('展开分组:', groupId);
            }
            
            // 查找分组元素，优先使用唯一ID
            let groupElement = null;
            if (groupId.includes('_')) {
                groupElement = document.querySelector(`.product-group[data-unique-group-id="${groupId}"]`);
            }
            if (!groupElement) {
                groupElement = document.querySelector(`.product-group[data-product-id="${productId}"]`);
            }
            
            if (groupElement) {
            // 使用 requestAnimationFrame 确保DOM更新稳定
                requestAnimationFrame(() => {
                try {
                        // 渲染单个分组
                        const newGroupHtml = this.renderProductGroup(group, !wasExpanded);
                        
                        // 创建临时容器来解析新HTML
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = newGroupHtml;
                        const newGroupElement = tempDiv.firstElementChild;
                        
                        // 替换旧元素
                        groupElement.parentNode.replaceChild(newGroupElement, groupElement);
                        
                        // 只为新的分组元素绑定事件
                        this.bindSingleGroupEvents(newGroupElement);
                        
                        // 如果是展开操作，加载执行记录
                        if (!wasExpanded) {
                            this.loadRecentExecutionsForGroup(productId, groupId);
                        }
                        
                        this.isProcessing = false;
                } catch (renderError) {
                        console.error('更新分组失败:', renderError);
                        this.showErrorMessage('更新分组失败，请重试');
                        this.isProcessing = false;
                }
            });
            } else {
                console.error('找不到分组元素:', groupId);
                this.isProcessing = false;
            }
        } catch (error) {
            console.error('toggleGroupExpansion error:', error);
            this.showErrorMessage('分组展开/收起操作失败，请重试');
            this.isProcessing = false;
        }
    }

    // 为分组加载执行记录
    async loadRecentExecutionsForGroup(productId, uniqueGroupId) {
        // 使用唯一分组ID优先定位分组，避免 product_id 重复导致错组
        let group = null;
        if (uniqueGroupId) {
            group = this.groupedProjects.find(g => `${g.product_id}_${g.product_name}_${g.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_') === uniqueGroupId);
        }
        if (!group && productId) {
            const candidates = this.groupedProjects.filter(g => g.product_id === productId);
            if (candidates.length > 1) {
                // 优先选择页面上已展开的对应分组
                const expandedCandidate = candidates.find(g => {
                    const uid = `${g.product_id}_${g.product_name}_${g.environment}`.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const el = document.querySelector(`.product-group[data-unique-group-id="${uid}"] .group-projects.expanded`);
                    return !!el;
                });
                group = expandedCandidate || candidates[0];
            } else {
                group = candidates[0] || null;
            }
        }
        if (!group) return;
        
        // 等待一帧，确保新DOM已挂载
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        // 仅为当前已展开的项目加载执行记录；如果没有已展开项目，则为该分组全部项目加载
        const expandedProjects = group.projects.filter(p => this.expandedProjects.has(p.id));
        const projectsToLoad = expandedProjects.length > 0 ? expandedProjects : group.projects;
        
        for (const project of projectsToLoad) {
            await this.loadRecentExecutions(project.id);
        }
    }

    // 测试分组连接
    async testConnectionForGroup(productId) {
        const group = this.groupedProjects.find(g => g.product_id === productId);
        if (!group) return;
        
        showToast(`正在测试 ${group.product_name} 的所有项目连接...`, 'info');
        
        for (const project of group.projects) {
            await this.testConnection(project.id);
        }
    }

    // 执行分组所有测试
    async executeAllTestsForGroup(productId) {
        const group = this.groupedProjects.find(g => g.product_id === productId);
        if (!group) return;
        
        showToast(`正在执行 ${group.product_name} 的所有测试...`, 'info');
        
        for (const project of group.projects) {
            await this.executeTest(project.id);
        }
    }

    // 显示错误提示
    showErrorMessage(message) {
        // 检查是否存在全局的showToast函数
        if (typeof showToast === 'function') {
            showToast(message, 'error');
        } else {
            // 如果没有showToast，使用alert作为备选方案
            alert(message);
        }
    }

    // 强制刷新分组视图（用于调试）
    forceRefreshGroupedView() {
        console.log('强制刷新分组视图...');
        // 清除所有缓存数据
        this.projects = [];
        this.groupedProjects = [];
        this.totalItems = 0;
        this.totalPages = 0;
        
        // 重新渲染分组视图
        this.renderGroupedProjects().then(() => {
            console.log('分组视图强制刷新完成');
        }).catch(error => {
            console.error('分组视图强制刷新失败:', error);
        });
    }

    // === UI断言弹框管理 ===
    showUIAssertionModal() {
        const modal = document.getElementById('uiAssertionModal');
        if (modal) {
            modal.classList.add('show');
            // 重置表单
            if (this.currentUIAssertionIndex === null) {
                this.resetUIAssertionForm();
            }
        }
    }

    closeUIAssertionModal() {
        const modal = document.getElementById('uiAssertionModal');
        if (modal) {
            modal.classList.remove('show');
        }
    }

    resetUIAssertionForm() {
        // 重置断言类型
        document.getElementById('ui-assertion-type').value = 'exists';
        
        // 重置所有输入框
        document.getElementById('ui-target-element').value = '';
        document.getElementById('text-target-element').value = '';
        document.getElementById('text-expected-value').value = '';
        document.getElementById('attr-target-element').value = '';
        document.getElementById('attr-expected-value').value = '';
        document.getElementById('count-target-element').value = '';
        document.getElementById('count-expected-value').value = '';
        
        // 清除验证错误状态
        this.clearUIAssertionValidation();
        
        // 显示正确的配置区域
        this.handleUIAssertionTypeChange();
    }

    loadUIAssertionData(assertion) {
        document.getElementById('ui-target-element').value = assertion.target_element || '';
        document.getElementById('ui-assertion-type').value = assertion.type || 'exists';
        
        if (assertion.type === 'text_contains') {
            document.getElementById('text-target-element').value = assertion.target_element || '';
            document.getElementById('text-expected-value').value = assertion.expected_value || '';
        } else if (assertion.type === 'attribute_match') {
            document.getElementById('attr-target-element').value = assertion.target_element || '';
            document.getElementById('attr-expected-value').value = assertion.expected_value || '';
        } else if (assertion.type === 'element_count') {
            document.getElementById('count-target-element').value = assertion.target_element || '';
            document.getElementById('count-expected-value').value = assertion.expected_value || '';
        }
        
        this.handleUIAssertionTypeChange();
    }

    handleUIAssertionTypeChange() {
        const type = document.getElementById('ui-assertion-type').value;
        
        // 隐藏所有额外配置
        document.querySelectorAll('.assertion-extra-config').forEach(config => {
            config.style.display = 'none';
        });
        
        // 显示对应的配置
        if (type === 'exists' || type === 'visible') {
            document.getElementById('basic-assertion-config').style.display = 'block';
        } else if (type === 'text_contains') {
            document.getElementById('text-contains-config').style.display = 'block';
        } else if (type === 'attribute_match') {
            document.getElementById('attribute-match-config').style.display = 'block';
        } else if (type === 'element_count') {
            document.getElementById('element-count-config').style.display = 'block';
        }
    }

    saveUIAssertion() {
        // 清除之前的验证错误
        this.clearUIAssertionValidation();
        
        const type = document.getElementById('ui-assertion-type').value;
        let assertion = {
            type: type,
            id: Date.now().toString()
        };

        let validationErrors = [];

        // 根据断言类型收集数据并验证
        if (type === 'exists' || type === 'visible') {
            assertion.target_element = document.getElementById('ui-target-element').value.trim();
            
            if (!assertion.target_element) {
                validationErrors.push({
                    field: 'ui-target-element',
                    message: '请填写目标元素选择器'
                });
            }
            
            assertion.name = `${type === 'exists' ? '元素存在' : '元素可见'}: ${assertion.target_element}`;
            assertion.description = `验证元素 ${assertion.target_element} ${type === 'exists' ? '存在' : '可见'}`;
            
        } else if (type === 'text_contains') {
            assertion.target_element = document.getElementById('text-target-element').value.trim();
            assertion.expected_value = document.getElementById('text-expected-value').value.trim();
            
            if (!assertion.target_element) {
                validationErrors.push({
                    field: 'text-target-element',
                    message: '请填写目标元素选择器'
                });
            }
            
            if (!assertion.expected_value) {
                validationErrors.push({
                    field: 'text-expected-value',
                    message: '请填写预期文本内容'
                });
            }
            
            assertion.name = `文本包含: ${assertion.target_element}`;
            assertion.description = `验证元素 ${assertion.target_element} 包含文本 "${assertion.expected_value}"`;
            
        } else if (type === 'attribute_match') {
            assertion.target_element = document.getElementById('attr-target-element').value.trim();
            assertion.expected_value = document.getElementById('attr-expected-value').value.trim();
            
            if (!assertion.target_element) {
                validationErrors.push({
                    field: 'attr-target-element',
                    message: '请填写目标元素选择器'
                });
            }
            
            if (!assertion.expected_value) {
                validationErrors.push({
                    field: 'attr-expected-value',
                    message: '请填写属性验证规则'
                });
            } else if (!assertion.expected_value.includes(':')) {
                validationErrors.push({
                    field: 'attr-expected-value',
                    message: '属性验证规则格式应为"属性名:预期值"'
                });
            }
            
            assertion.name = `属性匹配: ${assertion.target_element}`;
            assertion.description = `验证元素 ${assertion.target_element} 属性匹配 "${assertion.expected_value}"`;
            
        } else if (type === 'element_count') {
            assertion.target_element = document.getElementById('count-target-element').value.trim();
            assertion.expected_value = document.getElementById('count-expected-value').value.trim();
            
            if (!assertion.target_element) {
                validationErrors.push({
                    field: 'count-target-element',
                    message: '请填写目标元素选择器'
                });
            }
            
            if (!assertion.expected_value) {
                validationErrors.push({
                    field: 'count-expected-value',
                    message: '请填写预期数量'
                });
            } else if (isNaN(assertion.expected_value) || parseInt(assertion.expected_value) < 0) {
                validationErrors.push({
                    field: 'count-expected-value',
                    message: '预期数量必须是非负整数'
                });
            }
            
            assertion.name = `元素数量: ${assertion.target_element}`;
            assertion.description = `验证元素 ${assertion.target_element} 数量为 ${assertion.expected_value}`;
        }

        // 如果有验证错误，显示错误并返回
        if (validationErrors.length > 0) {
            this.showUIAssertionValidationErrors(validationErrors);
            showToast('请修正表单错误后再保存', 'error');
            return;
        }

        // 保存断言
        const step = this.testSteps[this.currentAssertionIndex];
        if (!step.assertion_config) step.assertion_config = {};
        if (!step.assertion_config.ui_assertions) step.assertion_config.ui_assertions = [];

        if (this.currentUIAssertionIndex === null) {
            // 新增
            step.assertion_config.ui_assertions.push(assertion);
        } else {
            // 编辑
            step.assertion_config.ui_assertions[this.currentUIAssertionIndex] = assertion;
        }

        this.renderUIAssertions(step.assertion_config.ui_assertions);
        this.closeUIAssertionModal();
        showToast('UI断言保存成功', 'success');
    }

    // === 图片断言弹框管理 ===
    showImageAssertionModal() {
        const modal = document.getElementById('imageAssertionModal');
        if (modal) {
            modal.classList.add('show');
            if (this.currentImageAssertionIndex === null) {
                this.resetImageAssertionForm();
            }
        }
    }

    closeImageAssertionModal() {
        const modal = document.getElementById('imageAssertionModal');
        if (modal) {
            modal.classList.remove('show');
        }
    }

    resetImageAssertionForm() {
        document.getElementById('image-comparison-method').value = 'ssim';
        document.getElementById('similarity-threshold').value = '0.9';
        document.getElementById('tolerance-pixels').value = '0';
        document.getElementById('image-file-input').value = '';
        document.getElementById('image-preview').style.display = 'none';
        this.currentImageFile = null;
    }

    loadImageAssertionData(assertion) {
        document.getElementById('image-comparison-method').value = assertion.method || 'ssim';
        document.getElementById('similarity-threshold').value = assertion.threshold || 0.9;
        document.getElementById('tolerance-pixels').value = assertion.tolerance || 0;
        
        if (assertion.image_path && !assertion.image_path.startsWith('blob:')) {
            document.getElementById('preview-img').src = assertion.image_path;
            document.getElementById('image-preview').style.display = 'block';
        } else {
            // 如果是blob URL或者无效路径，隐藏预览
            document.getElementById('image-preview').style.display = 'none';
        }
    }

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            showToast('请选择图片文件', 'error');
            return;
        }

        // 验证文件大小 (2MB)
        if (file.size > 2 * 1024 * 1024) {
            showToast('图片文件不能超过2MB', 'error');
            return;
        }

        this.currentImageFile = file;
        
        // 显示预览
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('preview-img').src = e.target.result;
            document.getElementById('image-preview').style.display = 'block';
        };
        reader.readAsDataURL(file);
    }

    removeImage() {
        this.currentImageFile = null;
        document.getElementById('image-file-input').value = '';
        document.getElementById('image-preview').style.display = 'none';
    }

    handleImageMethodChange() {
        const method = document.getElementById('image-comparison-method').value;
        
        // 根据方法调整默认阈值
        const threshold = document.getElementById('similarity-threshold');
        switch(method) {
            case 'ssim':
                threshold.value = '0.9';
                break;
            case 'mse':
                threshold.value = '100';
                break;
            case 'phash':
                threshold.value = '0.8';
                break;
            case 'template':
                threshold.value = '0.8';
                break;
        }
    }

    async saveImageAssertion() {
        const method = document.getElementById('image-comparison-method').value;
        const threshold = document.getElementById('similarity-threshold').value;
        const tolerance = document.getElementById('tolerance-pixels').value;

        if (!this.currentImageFile && this.currentImageAssertionIndex === null) {
            showToast('请上传基准图片', 'error');
            return;
        }

        let imagePath = '';
        
        // 如果有新的图片文件，先上传到服务器
        if (this.currentImageFile) {
            try {
                const assertionId = Date.now().toString();
                const formData = new FormData();
                formData.append('file', this.currentImageFile);
                formData.append('assertion_id', assertionId);
                formData.append('method', method);

                const response = await fetch('/api/automation/upload-assertion-image', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                if (result.success) {
                    imagePath = result.file_path;
                } else {
                    showToast(`图片上传失败: ${result.message}`, 'error');
                    return;
                }
            } catch (error) {
                showToast(`图片上传失败: ${error.message}`, 'error');
                return;
            }
        } else if (this.currentImageAssertionIndex !== null) {
            // 编辑现有断言时，保持原有路径
            const step = this.testSteps[this.currentAssertionIndex];
            const existingAssertion = step.assertion_config?.image_assertions?.[this.currentImageAssertionIndex];
            if (existingAssertion && existingAssertion.image_path && !existingAssertion.image_path.startsWith('blob:')) {
                imagePath = existingAssertion.image_path;
            } else {
                showToast('请重新上传基准图片', 'error');
                return;
            }
        }

        const assertion = {
            id: Date.now().toString(),
            method: method,
            threshold: parseFloat(threshold),
            tolerance: parseInt(tolerance),
            image_path: imagePath,
            name: `图片断言: ${method.toUpperCase()}`,
            description: `使用${this.getMethodName(method)}进行图片对比，阈值: ${threshold}`
        };

        // 保存断言
        const step = this.testSteps[this.currentAssertionIndex];
        if (!step.assertion_config) step.assertion_config = {};
        if (!step.assertion_config.image_assertions) step.assertion_config.image_assertions = [];

        if (this.currentImageAssertionIndex === null) {
            step.assertion_config.image_assertions.push(assertion);
        } else {
            step.assertion_config.image_assertions[this.currentImageAssertionIndex] = assertion;
        }

        this.renderImageAssertions(step.assertion_config.image_assertions);
        this.closeImageAssertionModal();
        showToast('图片断言保存成功', 'success');
    }

    getMethodName(method) {
        const names = {
            'ssim': '结构相似性指数',
            'mse': '均方误差',
            'phash': '感知哈希',
            'template': '模板匹配'
        };
        return names[method] || method;
    }

    // === 自定义断言弹框管理 ===
    showCustomAssertionModal() {
        const modal = document.getElementById('customAssertionModal');
        if (modal) {
            modal.classList.add('show');
            if (this.currentCustomAssertionIndex === null) {
                this.resetCustomAssertionForm();
            }
        }
    }

    closeCustomAssertionModal() {
        const modal = document.getElementById('customAssertionModal');
        if (modal) {
            modal.classList.remove('show');
        }
    }

    resetCustomAssertionForm() {
        document.getElementById('custom-target-element').value = '';
        document.getElementById('custom-expected-result').value = '';
        document.getElementById('custom-assertion-code').value = '';
    }

    loadCustomAssertionData(assertion) {
        document.getElementById('custom-target-element').value = assertion.target_element || '';
        document.getElementById('custom-expected-result').value = assertion.expected_result || '';
        document.getElementById('custom-assertion-code').value = assertion.code || '';
    }

    saveCustomAssertion() {
        const targetElement = document.getElementById('custom-target-element').value;
        const expectedResult = document.getElementById('custom-expected-result').value;
        const code = document.getElementById('custom-assertion-code').value;

        // 验证：要么填写了目标元素和预期结果，要么填写了自定义脚本
        if ((!targetElement || !expectedResult) && !code.trim()) {
            showToast('请填写目标元素和预期结果，或者填写自定义脚本', 'error');
            return;
        }

        if (targetElement && !expectedResult) {
            showToast('填写了目标元素时，预期结果不能为空', 'error');
            return;
        }

        if (expectedResult && !targetElement) {
            showToast('填写了预期结果时，目标元素不能为空', 'error');
            return;
        }

        // 生成断言名称和描述
        let assertionName, assertionDescription;
        if (targetElement && expectedResult) {
            assertionName = `自定义断言: ${targetElement}`;
            assertionDescription = `文本断言: ${expectedResult}`;
        } else if (code.trim()) {
            assertionName = `自定义脚本断言`;
            assertionDescription = `自定义脚本验证逻辑`;
        } else {
            assertionName = `自定义断言`;
            assertionDescription = `自定义验证逻辑`;
        }

        const assertion = {
            id: Date.now().toString(),
            target_element: targetElement,
            expected_result: expectedResult,
            code: code,
            name: assertionName,
            description: assertionDescription
        };

        // 保存断言
        const step = this.testSteps[this.currentAssertionIndex];
        if (!step.assertion_config) step.assertion_config = {};
        if (!step.assertion_config.custom_assertions) step.assertion_config.custom_assertions = [];

        if (this.currentCustomAssertionIndex === null) {
            step.assertion_config.custom_assertions.push(assertion);
        } else {
            step.assertion_config.custom_assertions[this.currentCustomAssertionIndex] = assertion;
        }

        this.renderCustomAssertions(step.assertion_config.custom_assertions);
        this.closeCustomAssertionModal();
        showToast('自定义断言保存成功', 'success');
    }

    // === 获取当前断言数据的辅助方法 ===
    getCurrentUIAssertions() {
        const step = this.testSteps[this.currentAssertionIndex];
        return (step && step.assertion_config && step.assertion_config.ui_assertions) || [];
    }

    getCurrentImageAssertions() {
        const step = this.testSteps[this.currentAssertionIndex];
        return (step && step.assertion_config && step.assertion_config.image_assertions) || [];
    }

    // 切换代码编辑器主题
    toggleCodeTheme() {
        const textarea = document.getElementById('custom-assertion-code');
        if (textarea) {
            textarea.classList.toggle('light-theme');
            
            // 保存主题偏好
            const isLight = textarea.classList.contains('light-theme');
            localStorage.setItem('codeTheme', isLight ? 'light' : 'dark');
            
            // 显示提示信息
            showToast(`已切换到${isLight ? '浅色' : '深色'}主题`, 'success');
        }
    }

    // 初始化代码编辑器主题
    initCodeTheme() {
        const textarea = document.getElementById('custom-assertion-code');
        if (textarea) {
            const savedTheme = localStorage.getItem('codeTheme');
            if (savedTheme === 'light') {
                textarea.classList.add('light-theme');
            }
        }
    }

    getCurrentCustomAssertions() {
        const step = this.testSteps[this.currentAssertionIndex];
        return (step && step.assertion_config && step.assertion_config.custom_assertions) || [];
    }

    // === 表单验证相关方法 ===
    isValidCSSSelector(selector) {
        try {
            document.querySelector(selector);
            return true;
        } catch (e) {
            return false;
        }
    }

    clearUIAssertionValidation() {
        // 清除所有输入框的错误状态
        const fields = [
            'ui-target-element',
            'text-target-element', 
            'text-expected-value',
            'attr-target-element',
            'attr-expected-value', 
            'count-target-element',
            'count-expected-value'
        ];
        
        fields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.classList.remove('error');
                this.removeFieldError(fieldId);
            }
        });
    }

    showUIAssertionValidationErrors(errors) {
        errors.forEach(error => {
            const field = document.getElementById(error.field);
            if (field) {
                field.classList.add('error');
                this.showFieldError(error.field, error.message);
            }
        });
    }

    showFieldError(fieldId, message) {
        // 移除现有的错误消息
        this.removeFieldError(fieldId);
        
        const field = document.getElementById(fieldId);
        if (field) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'field-error';
            errorDiv.textContent = message;
            errorDiv.id = `${fieldId}-error`;
            
            // 在字段后面插入错误消息
            field.parentNode.insertBefore(errorDiv, field.nextSibling);
        }
    }

    removeFieldError(fieldId) {
        const errorElement = document.getElementById(`${fieldId}-error`);
        if (errorElement) {
            errorElement.remove();
        }
    }

    // 绑定日志交互事件
    bindLogInteractions() {
        // 添加滚动监听，实现粘性步骤标题功能
        this.setupStickyStepHeaders();
    }

    // 设置粘性步骤标题功能
    setupStickyStepHeaders() {
        const logWrapper = document.querySelector('.log-content-wrapper');
        const logContainer = document.getElementById('executionLogContent');
        
        if (!logWrapper || !logContainer) return;

        // 创建粘性标题容器
        let stickyHeader = document.getElementById('sticky-step-header');
        if (!stickyHeader) {
            stickyHeader = document.createElement('div');
            stickyHeader.id = 'sticky-step-header';
            stickyHeader.style.display = 'none';
            logWrapper.insertBefore(stickyHeader, logContainer);
        }

        // 滚动事件处理
        const handleScroll = () => {
            const wrapperRect = logWrapper.getBoundingClientRect();
            const wrapperTop = wrapperRect.top;
            const wrapperHeight = wrapperRect.height;
            
            // 获取所有展开的步骤组
            const stepGroups = logContainer.querySelectorAll('.log-test-step-group');
            let activeStep = null;
            let activeStepRect = null;

            // 找到当前可视区域内最主要的步骤
            for (let i = 0; i < stepGroups.length; i++) {
                const stepGroup = stepGroups[i];
                const stepContent = stepGroup.querySelector('.log-test-step-content');
                
                // 只考虑展开的步骤
                if (!stepContent || !stepContent.classList.contains('expanded')) {
                    continue;
                }
                
                const stepRect = stepGroup.getBoundingClientRect();
                const stepTop = stepRect.top - wrapperTop;
                const stepBottom = stepRect.bottom - wrapperTop;

                // 检查步骤是否在可视区域内
                if (stepTop <= 80 && stepBottom > 80) { // 80px留给粘性标题和一些缓冲
                    activeStep = stepGroup;
                    activeStepRect = stepRect;
                    break;
                }
            }

            if (activeStep) {
                const stepHeader = activeStep.querySelector('.log-test-step-header');
                
                if (stepHeader) {
                    // 计算原始标题的位置
                    const headerRect = stepHeader.getBoundingClientRect();
                    const headerTop = headerRect.top - wrapperTop;
                    
                    // 只有当原始标题滚出视野时才显示粘性标题
                    if (headerTop < 0) {
                        // 复制步骤标题内容到粘性标题
                        stickyHeader.innerHTML = stepHeader.innerHTML;
                        // 完全使用原始标题的样式类名
                        stickyHeader.className = stepHeader.className;
                        
                        // 显示粘性标题
                        stickyHeader.style.display = 'block';
                        
                        // 计算淡出效果
                        const contentBottom = activeStepRect.bottom - wrapperTop;
                        const fadeZone = 100; // 淡出区域高度
                        
                        if (contentBottom < fadeZone) {
                            const opacity = Math.max(0.1, contentBottom / fadeZone);
                            stickyHeader.style.opacity = opacity;
                        } else {
                            stickyHeader.style.opacity = 1;
                        }
                        
                        // 绑定点击事件到粘性标题
                        this.bindStickyHeaderClick(stickyHeader, activeStep);
                    } else {
                        // 原始标题还在视野内，隐藏粘性标题
                        stickyHeader.style.display = 'none';
                    }
                }
            } else {
                // 没有找到活跃步骤，隐藏粘性标题
                stickyHeader.style.display = 'none';
            }
        };

        // 防抖函数
        let scrollTimeout;
        const debouncedHandleScroll = () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(handleScroll, 10);
        };

        // 绑定滚动事件
        logWrapper.addEventListener('scroll', debouncedHandleScroll);
        
        // 初始检查
        setTimeout(handleScroll, 100);
        
        // 当窗口大小改变时重新检查
        let resizeTimeout;
        const debouncedHandleResize = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(handleScroll, 100);
        };
        window.addEventListener('resize', debouncedHandleResize);
    }

    // 绑定粘性标题点击事件
    bindStickyHeaderClick(stickyHeader, originalStepGroup) {
        // 移除之前的事件监听器
        const oldHandler = stickyHeader._clickHandler;
        if (oldHandler) {
            stickyHeader.removeEventListener('click', oldHandler);
        }

        // 创建新的点击处理器
        const clickHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // 检查是否点击的是切换按钮
            if (e.target.classList.contains('step-toggle') || e.target.closest('.step-toggle')) {
                // 如果点击的是切换按钮，不执行滚动，而是折叠步骤
                const stepId = originalStepGroup.querySelector('.log-test-step-header').getAttribute('onclick').match(/'([^']+)'/)[1];
                this.toggleStep(stepId);
                return;
            }
            
            // 滚动到原始步骤的顶部
            const logWrapper = document.querySelector('.log-content-wrapper');
            const stepRect = originalStepGroup.getBoundingClientRect();
            const wrapperRect = logWrapper.getBoundingClientRect();
            
            // 计算目标滚动位置，让步骤标题显示在顶部
            const targetScrollTop = logWrapper.scrollTop + (stepRect.top - wrapperRect.top) - 10; // 10px的边距
            
            logWrapper.scrollTo({
                top: Math.max(0, targetScrollTop),
                behavior: 'smooth'
            });
        };

        // 绑定新的事件监听器
        stickyHeader.addEventListener('click', clickHandler);
        stickyHeader._clickHandler = clickHandler;
    }

    // 切换测试步骤展开/收缩
    toggleStep(stepId) {
        const content = document.getElementById(`${stepId}-content`);
        const toggle = document.getElementById(`${stepId}-toggle`);
        
        if (!content || !toggle) return;

        if (content.classList.contains('expanded')) {
            content.classList.remove('expanded');
            toggle.classList.remove('expanded');
        } else {
            content.classList.add('expanded');
            toggle.classList.add('expanded');
        }
        
        // 步骤状态改变后，重新检查粘性标题
        setTimeout(() => {
            const stickyHeader = document.getElementById('sticky-step-header');
            if (stickyHeader) {
                // 如果当前显示的步骤被折叠了，隐藏粘性标题
                const logWrapper = document.querySelector('.log-content-wrapper');
                if (logWrapper) {
                    logWrapper.dispatchEvent(new Event('scroll'));
                }
            }
        }, 100);
    }

    // 切换测试方法标签
    switchMethodTab(stepId, methodName, clickedTab) {
        // 移除所有活动状态
        const stepContent = document.getElementById(`${stepId}-content`);
        if (!stepContent) return;

        const allTabs = stepContent.querySelectorAll('.log-test-method-tab');
        const allPanels = stepContent.querySelectorAll('.log-test-method-panel');

        allTabs.forEach(tab => tab.classList.remove('active'));
        allPanels.forEach(panel => panel.classList.remove('active'));

        // 激活点击的标签
        clickedTab.classList.add('active');

        // 激活对应的面板
        const targetPanel = stepContent.querySelector(`[data-method="${methodName}"]`);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }
    }



    // 查看截图
    viewScreenshot(imagePath) {
        // 创建图片查看模态框
        const modal = document.createElement('div');
        modal.className = 'screenshot-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            cursor: pointer;
        `;

        const img = document.createElement('img');
        img.src = imagePath;
        img.style.cssText = `
            max-width: 90%;
            max-height: 90%;
            object-fit: contain;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
            position: absolute;
            top: 20px;
            right: 30px;
            background: rgba(255, 255, 255, 0.8);
            border: none;
            font-size: 2rem;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        modal.appendChild(img);
        modal.appendChild(closeBtn);
        document.body.appendChild(modal);

        // 点击关闭
        const closeModal = () => {
            document.body.removeChild(modal);
        };

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        closeBtn.addEventListener('click', closeModal);

        // ESC键关闭
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);

        // 图片加载错误处理
        img.onerror = () => {
            img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzM3NDE1MSIvPgogIDx0ZXh0IHg9IjEwMCIgeT0iMTAwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj7miaveWTvJpL/JvcEK8/C3IC8+Cjwvc3ZnPgo=';
            img.alt = '图片加载失败';
        };
    }

}

// 创建全局实例
let automationManagement = null;

// 初始化函数
async function initAutomationManagement() {
    // 如果已存在实例，先销毁
    if (automationManagement) {
        automationManagement.destroy();
    }
    
    // 创建新实例
    automationManagement = new AutomationManagement();
    
    // 更新全局引用
    window.automationManagement = automationManagement;
    
    await automationManagement.render();
}

// 全局函数，供HTML调用
window.initAutomationManagement = initAutomationManagement; 

// 调试函数（开发阶段使用）
window.debugAutomationButtons = function() {
    if (window.automationManagement) {
        return window.automationManagement.manualDebugButtons();
    } else {
        console.warn('⚠️ automationManagement 实例不存在');
        return 'automationManagement 实例不存在';
    }
};

// 确保automationManagement对象在全局作用域中可用
window.automationManagement = null; 