// 产品管理模块

class ProductManagement {
    constructor() {
        this.projects = [];
        this.currentProject = null;
        this.editingProject = null; // 编辑中的项目数据副本
        this.uploadedImageUrl = '';
        this.enumValues = {
            system_type: [],
            product_type: []
        };
        // 分页相关属性
        this.currentPage = 1;
        this.pageSize = 10;
        this.totalPages = 1;
        this.totalItems = 0;
        this.init();
    }

    init() {
        this.bindEvents();
        // 不在这里自动加载项目，由主应用控制
    }

    // 绑定事件
    bindEvents() {
        // 图片上传事件
        const imageInput = document.getElementById('productImageInput');
        if (imageInput) {
            imageInput.addEventListener('change', this.handleImageUpload.bind(this));
        }

        // 表单提交事件
        const projectForm = document.getElementById('projectForm');
        if (projectForm) {
            projectForm.addEventListener('submit', this.handleFormSubmit.bind(this));
        }

        // 点击模态框外部关闭
        const modal = document.getElementById('projectModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }

        // 备注字符计数
        const remarksTextarea = document.getElementById('remarks');
        if (remarksTextarea) {
            remarksTextarea.addEventListener('input', this.updateCharCount.bind(this));
        }
    }

    // 渲染产品管理页面
    render() {
        const contentArea = document.getElementById('content-area');
        if (!contentArea) {
            console.error('content-area 元素未找到');
            return;
        }
        
        console.log('开始渲染产品管理页面...');
        
        const productManagementHtml = `
            <div class="product-management">
                <div class="page-header">
                    <h1 class="page-title">
                        <i class="fas fa-code-branch"></i>
                        产品管理
                    </h1>
                    <button class="btn btn-primary" id="addProjectBtn">
                        <i class="fas fa-plus"></i>
                        添加项目
                    </button>
                </div>
                <div class="projects-table">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>产品ID</th>
                                <th>产品包名</th>
                                <th>产品地址</th>
                                <th>系统</th>
                                <th>产品类型</th>
                                <th>环境</th>
                                <th>是否自动化</th>
                                <th>版本号</th>
                                <th>备注</th>
                                <th>历史记录</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody id="projects-tbody">
                            <!-- 项目列表将在这里动态加载 -->
                        </tbody>
                    </table>
                </div>
                <div class="pagination-container" id="pagination-container">
                    <!-- 分页控件将在这里动态加载 -->
                </div>
            </div>
        `;
        contentArea.innerHTML = productManagementHtml;
        
        // 绑定添加项目按钮事件
        const addProjectBtn = document.getElementById('addProjectBtn');
        if (addProjectBtn) {
            addProjectBtn.addEventListener('click', () => {
                this.openAddProjectModal();
            });
        }
        
        console.log('产品管理页面渲染完成，开始加载项目...');
        this.loadProjects();
    }

    // 加载项目列表
    async loadProjects() {
        const tbody = document.getElementById('projects-tbody');
        if (!tbody) return;

        try {
            showLoading(tbody);
            const response = await VersionAPI.getProjects();
            
            if (response.success) {
                this.projects = response.data;
                this.renderProjectsList();
            } else {
                showToast(response.message || '获取项目列表失败', 'error');
                this.renderEmptyState();
            }
        } catch (error) {
            handleApiError(error, '获取项目列表失败');
            this.renderEmptyState();
        }
    }

    // 渲染项目列表
    renderProjectsList() {
        const tbody = document.getElementById('projects-tbody');
        if (!tbody) return;

        if (this.projects.length === 0) {
            this.renderEmptyState();
            this.renderPagination();
            return;
        }

        // 计算分页
        this.totalItems = this.projects.length;
        this.totalPages = Math.ceil(this.totalItems / this.pageSize);
        
        // 确保当前页在有效范围内
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages || 1;
        }
        
        // 获取当前页的数据
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        const currentPageProjects = this.projects.slice(startIndex, endIndex);

        const projectsHtml = currentPageProjects.map(project => {
            const productImageHtml = project.product_image ? 
                `<img src="${project.product_image}" alt="${project.product_package_name}" class="product-image">` : '';
            
            const automationBadge = project.is_automated === '是' ? 
                `<span class="automation-badge automation-yes">是</span>` :
                `<span class="automation-badge automation-no">否</span>`;

            return `
                <tr data-project-id="${project.id}">
                    <td>${escapeHtml(project.product_id || '')}</td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            ${productImageHtml}
                            <span>${escapeHtml(project.product_package_name)}</span>
                        </div>
                    </td>
                    <td>
                        ${this.renderProductAddresses(project.product_address)}
                    </td>
                    <td>${escapeHtml(project.system_type || '')}</td>
                    <td>${escapeHtml(project.product_type || '')}</td>
                    <td>${escapeHtml(project.environment || '')}</td>
                    <td>${automationBadge}</td>
                    <td>${escapeHtml(project.version_number || '')}</td>
                    <td>
                        <div style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(project.remarks || '')}">
                            ${escapeHtml(project.remarks || '')}
                        </div>
                    </td>
                    <td>
                        <button class="btn btn-secondary" onclick="showProjectHistory(${project.id})">
                            <i class="fas fa-history"></i>
                            查看历史
                        </button>
                    </td>
                    <td>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn btn-secondary" onclick="openEditProjectModal(${project.id})" title="编辑">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-secondary" onclick="deleteProject(${project.id})" title="删除" style="background: #fed7d7; color: #e53e3e;">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = projectsHtml;
        
        // 渲染分页控件
        this.renderPagination();
    }

    // 渲染空状态
    renderEmptyState() {
        const tbody = document.getElementById('projects-tbody');
        if (!tbody) return;

        tbody.innerHTML = `
            <tr>
                <td colspan="11">
                    <div class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <h3>暂无项目</h3>
                        <p>点击上方"添加项目"按钮创建第一个项目</p>
                    </div>
                </td>
            </tr>
        `;
    }

    // 打开添加项目弹窗
    async openAddProjectModal() {
        this.currentProject = null;
        this.editingProject = null; // 添加项目时不需要编辑副本
        this.uploadedImageUrl = '';
        this.resetForm();
        await this.loadEnumValues();
        this.initCustomSelects();
        this.showModal();
    }

    // 打开编辑项目弹窗
    async openEditProjectModal(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        this.currentProject = project;
        // 创建项目数据的副本，避免直接修改原始数据
        this.editingProject = JSON.parse(JSON.stringify(project));
        this.uploadedImageUrl = this.editingProject.product_image || '';
        await this.loadEnumValues();
        this.populateForm(this.editingProject);
        this.initCustomSelects();
        this.showModal();
    }

    // 显示弹窗
    showModal() {
        const modal = document.getElementById('projectModal');
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        
        // 如果是新增模式且地址输入框为空，初始化一个空的输入框
        if (!this.currentProject) {
            const container = document.getElementById('multiAddressContainer');
            if (!container.hasChildNodes()) {
                this.populateAddressInputs('');
            }
        }
    }

    // 关闭弹窗
    closeModal() {
        const modal = document.getElementById('projectModal');
        modal.classList.remove('show');
        document.body.style.overflow = '';
        this.resetForm();
        // 清理编辑状态
        this.editingProject = null;
    }

    // 重置表单
    resetForm() {
        const form = document.getElementById('projectForm');
        if (form) {
            form.reset();
        }
        
        const imagePreview = document.getElementById('imagePreview');
        if (imagePreview) {
            imagePreview.innerHTML = '';
        }
        
        // 重置多地址输入框
        this.populateAddressInputs('');
        
        this.uploadedImageUrl = '';
    }

    // 填充表单（编辑时使用）
    populateForm(project) {
        document.getElementById('productPackageName').value = project.product_package_name || '';
        document.getElementById('productId').value = project.product_id || '';
        document.getElementById('isAutomated').value = project.is_automated || '';
        document.getElementById('versionNumber').value = project.version_number || '';
        document.getElementById('systemType').value = project.system_type || '';
        document.getElementById('productType').value = project.product_type || '';
        document.getElementById('environment').value = project.environment || '';
        document.getElementById('remarks').value = project.remarks || '';

        // 填充多地址输入
        this.populateAddressInputs(project.product_address || '');

        // 更新备注字符计数
        this.updateCharCount();

        // 显示现有图片并同步uploadedImageUrl
        if (project.product_image) {
            this.uploadedImageUrl = project.product_image; // 同步uploadedImageUrl
            this.displayImagePreview(project.product_image);
        } else {
            this.uploadedImageUrl = ''; // 确保同步
        }
    }

    // 处理图片上传
    async handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            showToast('请选择图片文件', 'error');
            return;
        }

        // 验证文件大小（最大2MB）
        if (file.size > 2 * 1024 * 1024) {
            showToast('图片大小不能超过2MB', 'error');
            return;
        }

        try {
            showToast('正在上传图片...', 'warning');
            const response = await VersionAPI.uploadImage(file);
            
            if (response.success) {
                this.uploadedImageUrl = response.data.url;
                // 如果是编辑模式，同时更新编辑中的项目数据
                if (this.editingProject) {
                    this.editingProject.product_image = this.uploadedImageUrl;
                }
                this.displayImagePreview(this.uploadedImageUrl);
                showToast('图片上传成功', 'success');
            } else {
                showToast(response.message || '图片上传失败', 'error');
            }
        } catch (error) {
            handleApiError(error, '图片上传失败');
        }
    }

    // 显示图片预览
    displayImagePreview(imageUrl) {
        const imagePreview = document.getElementById('imagePreview');
        if (!imagePreview) return;

        imagePreview.innerHTML = `
            <div class="product-image-preview">
            <img src="${imageUrl}" alt="产品图片预览">
                <button type="button" class="remove-product-image" onclick="removeImage()" title="删除图片">
                <i class="fas fa-times"></i>
            </button>
            </div>
        `;
    }

    // 删除图片
    removeImage() {
        this.uploadedImageUrl = '';
        // 如果是编辑模式，同时更新编辑中的项目数据
        if (this.editingProject) {
            this.editingProject.product_image = '';
        }
        
        const imagePreview = document.getElementById('imagePreview');
        if (imagePreview) {
            imagePreview.innerHTML = '';
        }
        
        const imageInput = document.getElementById('productImageInput');
        if (imageInput) {
            imageInput.value = '';
        }
    }

    // 处理表单提交
    async handleFormSubmit(event) {
        event.preventDefault();

        // 在编辑模式下，优先使用编辑中的数据，否则使用uploadedImageUrl
        const imageUrl = this.editingProject ? this.editingProject.product_image : this.uploadedImageUrl;
        
        // 收集所有地址输入
        const addresses = this.collectAddresses();
        
        const formData = {
            product_package_name: document.getElementById('productPackageName').value.trim(),
            product_address: addresses,
            product_id: document.getElementById('productId').value.trim(),
            is_automated: document.getElementById('isAutomated').value,
            version_number: document.getElementById('versionNumber').value.trim(),
            product_image: imageUrl,
            system_type: document.getElementById('systemType').value.trim(),
            product_type: document.getElementById('productType').value.trim(),
            environment: document.getElementById('environment').value,
            remarks: document.getElementById('remarks').value.trim()
        };

        // 验证表单
        const errors = validateForm(formData);
        if (errors.length > 0) {
            showToast(errors[0], 'error');
            return;
        }

        try {
            let response;
            if (this.currentProject) {
                // 更新项目
                response = await VersionAPI.updateProject(this.currentProject.id, formData);
            } else {
                // 创建项目
                response = await VersionAPI.createProject(formData);
            }

            if (response.success) {
                showToast(response.message || '项目保存成功', 'success');
                this.closeModal();
                this.loadProjects();
            } else {
                showToast(response.message || '项目保存失败', 'error');
            }
        } catch (error) {
            handleApiError(error, '项目保存失败');
        }
    }

    // 删除项目
    async deleteProject(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        // 显示自定义确认删除对话框
        showCustomConfirm({
            title: '删除产品项目',
            message: `确定要删除项目"${project.product_package_name}"吗？`,
            details: [
                '删除项目的所有配置信息',
                '删除项目的所有版本记录',
                '此操作不可恢复'
            ],
            warningText: '请谨慎操作！',
            type: 'danger',
            confirmText: '确定删除',
            cancelText: '取消',
            onConfirm: async () => {
        try {
            const response = await VersionAPI.deleteProject(projectId);
            
            if (response.success) {
                showToast('项目删除成功', 'success');
                this.loadProjects();
            } else {
                showToast(response.message || '项目删除失败', 'error');
            }
        } catch (error) {
            handleApiError(error, '项目删除失败');
        }
            }
        });
    }

    // 显示历史记录
    showHistory(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        // 这里可以实现历史记录功能
        showToast(`查看"${project.product_package_name}"的历史记录功能待实现`, 'warning');
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
                // 更新环境下拉选择框
                this.updateEnvironmentSelect();
            }
        } catch (error) {
            console.error('加载枚举值失败:', error);
        }
    }

    // 更新环境选择框
    updateEnvironmentSelect() {
        const environmentSelect = document.getElementById('environment');
        if (!environmentSelect) return;
        
        // 保存当前选中的值
        const currentValue = environmentSelect.value;
        
        // 清空现有选项（除了默认选项）
        environmentSelect.innerHTML = '<option value="">请选择环境</option>';
        
        // 添加从数据库获取的选项
        this.enumValues.environment.forEach(env => {
            const option = document.createElement('option');
            option.value = env;
            option.textContent = env;
            environmentSelect.appendChild(option);
        });
        
        // 恢复之前选中的值
        if (currentValue) {
            environmentSelect.value = currentValue;
        }
    }

    // 初始化自定义下拉选择框
    initCustomSelects() {
        this.initCustomSelect('systemType', 'system_type');
        this.initCustomSelect('productType', 'product_type');
    }

    // 初始化单个自定义下拉选择框
    initCustomSelect(inputId, enumKey) {
        const input = document.getElementById(inputId);
        const dropdown = document.getElementById(inputId + 'Dropdown');
        
        if (!input || !dropdown) return;

        // 清除之前的事件监听器
        input.removeEventListener('focus', this.showDropdown);
        input.removeEventListener('input', this.filterOptions);
        document.removeEventListener('click', this.hideDropdowns);

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
            addOptionDiv.innerHTML = `<i class="fas fa-plus"></i> 添加 "${currentValue}"`;
            
            addOptionDiv.addEventListener('click', async () => {
                const fieldName = dropdown.id.replace('Dropdown', '').replace('Type', '_type');
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

    // 更新备注字符计数
    updateCharCount() {
        const textarea = document.getElementById('remarks');
        const countSpan = document.getElementById('remarksCount');
        const charCountDiv = countSpan?.parentElement;
        
        if (!textarea || !countSpan) return;

        const currentLength = textarea.value.length;
        const maxLength = 200;
        
        countSpan.textContent = currentLength;
        
        // 根据字符数量改变颜色
        if (charCountDiv) {
            charCountDiv.className = 'char-count';
            if (currentLength > maxLength * 0.9) {
                charCountDiv.classList.add('warning');
            }
            if (currentLength >= maxLength) {
                charCountDiv.classList.add('error');
            }
        }
    }

    // 渲染分页控件 - 有数据时候才显示
    renderPagination() {
        const paginationContainer = document.getElementById('pagination-container');
        if (!paginationContainer) return;

        //如果没有数据，不显示分页控件
        if (this.totalItems === 0) {
            paginationContainer.style.display = 'none';
            return;
        }

        // 有数据时候才显示分页控件，即使只有一页
        paginationContainer.style.display = 'block';

        const startItem = (this.currentPage - 1) * this.pageSize + 1;
        const endItem = Math.min(this.currentPage * this.pageSize, this.totalItems);

        const paginationHtml = `
            <div class="pagination-info">
                <span>显示第 ${startItem}-${endItem} 条，共 ${this.totalItems} 条记录</span>
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
                this.renderProjectsList();
            });
        }
    }

    // 跳转到指定页
    goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) {
            return;
        }
        
        this.currentPage = page;
        this.renderProjectsList();
        
        // 滚动到表格顶部
        const table = document.querySelector('.projects-table');
        if (table) {
            table.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // 添加地址输入框
    addAddressInput() {
        const container = document.getElementById('multiAddressContainer');
        const inputGroups = container.querySelectorAll('.address-input-group');
        const newIndex = inputGroups.length;
        
        const newGroup = document.createElement('div');
        newGroup.className = 'address-input-group';
        newGroup.innerHTML = `
            <button type="button" class="remove-address-btn" 
                    onclick="removeAddressInput(${newIndex})" 
                    title="删除此地址">
                <i class="fas fa-minus"></i>
            </button>
            <input type="url" class="address-input" data-index="${newIndex}" 
                   placeholder="请输入产品地址">
        `;
        
        container.appendChild(newGroup);
        
        // 聚焦到新添加的输入框
        const newInput = newGroup.querySelector('.address-input');
        newInput.focus();
        
        this.updateAddButtons();
    }
    
    // 删除地址输入框
    removeAddressInput(index) {
        const container = document.getElementById('multiAddressContainer');
        const inputGroups = container.querySelectorAll('.address-input-group');
        
        if (inputGroups.length <= 1) {
            showToast('至少需要保留一个地址输入框', 'warning');
            return;
        }
        
        const targetGroup = Array.from(inputGroups).find(group => {
            const input = group.querySelector('.address-input');
            return input && input.dataset.index === index.toString();
        });
        
        if (targetGroup) {
            targetGroup.classList.add('removing');
            setTimeout(() => {
                targetGroup.remove();
                this.updateAddButtons();
                this.reindexAddressInputs();
            }, 300);
        }
    }
    
    // 重新索引地址输入框
    reindexAddressInputs() {
        const container = document.getElementById('multiAddressContainer');
        const inputGroups = container.querySelectorAll('.address-input-group');
        
        inputGroups.forEach((group, index) => {
            const input = group.querySelector('.address-input');
            const removeBtn = group.querySelector('.remove-address-btn');
            
            if (input) {
                input.dataset.index = index;
            }
            if (removeBtn) {
                removeBtn.setAttribute('onclick', `productManagement.removeAddressInput(${index})`);
            }
        });
    }
    
    // 更新添加按钮的显示（现在"+"按钮固定在第一个输入框，不需要动态更新）
    updateAddButtons() {
        // 由于"+"按钮现在固定在第一个输入框，这个函数暂时保留但不执行任何操作
        // 以防止其他地方的调用出错
    }
    
    // 收集所有地址
    collectAddresses() {
        const container = document.getElementById('multiAddressContainer');
        const inputs = container.querySelectorAll('.address-input');
        const addresses = [];
        
        inputs.forEach(input => {
            const value = input.value.trim();
            if (value) {
                addresses.push(value);
            }
        });
        
        // 如果只有一个地址，直接返回字符串；多个地址返回JSON数组
        if (addresses.length === 0) {
            return '';
        } else if (addresses.length === 1) {
            return addresses[0];
        } else {
            return JSON.stringify(addresses);
        }
    }
    
    // 填充地址输入框
    populateAddressInputs(addressData) {
        const container = document.getElementById('multiAddressContainer');
        
        // 清空现有输入框
        container.innerHTML = '';
        
        let addresses = [];
        
        // 解析地址数据
        if (addressData) {
            try {
                // 尝试解析为JSON数组
                const parsed = JSON.parse(addressData);
                if (Array.isArray(parsed)) {
                    addresses = parsed;
                } else {
                    addresses = [addressData];
                }
            } catch (e) {
                // 如果不是JSON，当作单个地址处理
                addresses = [addressData];
            }
        }
        
        // 如果没有地址，至少创建一个空的输入框
        if (addresses.length === 0) {
            addresses = [''];
        }
        
        // 创建输入框
        addresses.forEach((address, index) => {
            const group = document.createElement('div');
            group.className = 'address-input-group';
            
            const isFirst = index === 0;
            const required = isFirst ? 'required' : '';
            
            group.innerHTML = `
                ${isFirst ? `
                    <button type="button" class="add-address-btn" 
                            onclick="addAddressInput()" 
                            title="添加更多地址">
                        <i class="fas fa-plus"></i>
                    </button>
                ` : `
                    <button type="button" class="remove-address-btn" 
                            onclick="removeAddressInput(${index})" 
                            title="删除此地址">
                        <i class="fas fa-minus"></i>
                    </button>
                `}
                <input type="url" class="address-input" data-index="${index}" 
                       placeholder="请输入产品地址" value="${address}" ${required}>
            `;
            
            container.appendChild(group);
        });
        
        // 更新添加按钮
        this.updateAddButtons();
    }

    // 渲染产品地址列表（支持多地址展示）
    renderProductAddresses(addressData) {
        if (!addressData) {
            return '<span class="text-muted">无地址</span>';
        }

        let addresses = [];
        
        // 解析地址数据
        try {
            const parsed = JSON.parse(addressData);
            if (Array.isArray(parsed)) {
                addresses = parsed.filter(addr => addr && addr.trim());
            } else {
                addresses = [addressData];
            }
        } catch (e) {
            // 如果不是JSON，当作单个地址处理
            addresses = [addressData];
        }

        if (addresses.length === 0) {
            return '<span class="text-muted">无地址</span>';
        }

        // 如果只有一个地址，直接显示
        if (addresses.length === 1) {
            return `<a href="${addresses[0]}" target="_blank" class="product-address-link">
                        ${escapeHtml(addresses[0])}
                    </a>`;
        }

        // 多个地址的情况
        const maxVisible = 3;
        let html = '<div class="product-addresses">';
        
        // 显示前3个地址
        for (let i = 0; i < Math.min(addresses.length, maxVisible); i++) {
            html += `<a href="${addresses[i]}" target="_blank" class="product-address-link">
                        ${escapeHtml(addresses[i])}
                     </a>`;
        }
        
        // 如果有超过3个地址，显示"......"和提示
        if (addresses.length > maxVisible) {
            const remainingAddresses = addresses.slice(maxVisible);
            const tooltipContent = remainingAddresses.map(addr => 
                `<a href="${addr}" target="_blank" style="color: #90cdf4; display: block; margin: 0.25rem 0;">${escapeHtml(addr)}</a>`
            ).join('');
            
            html += `<div class="addresses-more">
                        ......
                        <div class="addresses-tooltip">
                            <div style="margin-bottom: 0.5rem; font-weight: bold;">其他地址：</div>
                            ${tooltipContent}
                        </div>
                     </div>`;
        }
        
        html += '</div>';
        return html;
    }
}

// 创建全局实例
let productManagement = null;

// 初始化函数
function initProductManagement() {
    console.log('initProductManagement 被调用');
    
    if (!productManagement) {
        console.log('创建新的 ProductManagement 实例');
        productManagement = new ProductManagement();
        // 更新全局引用
        window.productManagement = productManagement;
    }
    
    console.log('调用 render 方法');
    productManagement.render();
}

// 全局函数，供HTML调用
window.closeModal = () => productManagement?.closeModal();

// 额外的全局函数，确保HTML可以直接调用
window.addAddressInput = () => {
    if (productManagement) {
        productManagement.addAddressInput();
    } else {
        console.warn('productManagement not initialized yet');
    }
};

window.removeAddressInput = (index) => {
    if (productManagement) {
        productManagement.removeAddressInput(index);
    } else {
        console.warn('productManagement not initialized yet');
    }
};

window.showProjectHistory = (projectId) => {
    if (productManagement) {
        productManagement.showHistory(projectId);
    } else {
        console.warn('productManagement not initialized yet');
    }
};

window.openEditProjectModal = (projectId) => {
    if (productManagement) {
        productManagement.openEditProjectModal(projectId);
    } else {
        console.warn('productManagement not initialized yet');
    }
};

window.deleteProject = (projectId) => {
    if (productManagement) {
        productManagement.deleteProject(projectId);
    } else {
        console.warn('productManagement not initialized yet');
    }
};

window.removeImage = () => {
    if (productManagement) {
        productManagement.removeImage();
    } else {
        console.warn('productManagement not initialized yet');
    }
};
window.initProductManagement = initProductManagement; 