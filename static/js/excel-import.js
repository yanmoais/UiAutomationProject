// Excel导入管理器
class ExcelImportManager {
    constructor() {
        this.selectedFile = null;
        this.parsedData = null;
        this.validationResults = null;
        this.setupEventListeners();
    }

    // 设置事件监听器
    setupEventListeners() {
        // 文件输入事件
        const fileInput = document.getElementById('excelFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        // 拖拽事件
        const uploadArea = document.querySelector('.excel-import-upload-area');
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });

            uploadArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
            });

            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleFileSelect({ target: { files: files } });
                }
            });

            uploadArea.addEventListener('click', (e) => {
                // 只有当点击的不是按钮时才触发文件选择
                if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
                    fileInput.click();
                }
            });
        }

        // 模态框关闭事件
        const modal = document.getElementById('excelImportModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }
    }

    // 处理文件选择
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) {
            // 用户取消了文件选择，清空input值避免重复触发
            event.target.value = '';
            return;
        }

        // 验证文件类型
        if (!this.isValidExcelFile(file)) {
            this.showError('请选择有效的Excel文件（.xlsx 或 .xls）');
            event.target.value = ''; // 清空input值
            return;
        }

        // 验证文件大小（限制为10MB）
        if (file.size > 10 * 1024 * 1024) {
            this.showError('文件大小不能超过10MB');
            event.target.value = ''; // 清空input值
            return;
        }

        this.selectedFile = file;
        this.displayFileInfo(file);
        
        // 显示加载状态
        this.showLoading('正在解析Excel文件...');
        
        try {
            // 解析Excel文件
            this.parsedData = await this.parseExcelFile(file);
            
            // 验证数据
            this.validationResults = this.validateData(this.parsedData);
            
            // 显示预览
            this.displayPreview();
            
        } catch (error) {
            this.showError('解析Excel文件失败：' + error.message);
            event.target.value = ''; // 清空input值
        } finally {
            this.hideLoading();
        }
    }

    // 验证是否为有效的Excel文件
    isValidExcelFile(file) {
        const validTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel' // .xls
        ];
        const validExtensions = ['.xlsx', '.xls'];
        
        return validTypes.includes(file.type) || 
               validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    }

    // 显示文件信息
    displayFileInfo(file) {
        const fileInfoContainer = document.querySelector('.excel-import-file-info');
        if (!fileInfoContainer) return;

        const fileSizeKB = (file.size / 1024).toFixed(2);
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
        const displaySize = file.size > 1024 * 1024 ? `${fileSizeMB} MB` : `${fileSizeKB} KB`;

        fileInfoContainer.innerHTML = `
            <div class="excel-import-file-details">
                <i class="fas fa-file-excel excel-import-file-icon"></i>
                <div class="excel-import-file-text">
                    <div class="excel-import-file-name">${file.name}</div>
                    <div class="excel-import-file-size">文件大小: ${displaySize}</div>
                </div>
                <button class="btn btn-sm btn-outline-secondary" onclick="window.excelImportManager.clearSelectedFile()">
                    <i class="fas fa-times"></i> 清除
                </button>
            </div>
        `;
        fileInfoContainer.style.display = 'block';
    }

    // 解析Excel文件
    async parseExcelFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    // 获取第一个工作表
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    
                    // 转换为JSON格式
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
                        header: 1,
                        defval: '' // 空单元格默认值
                    });
                    
                    // 移除空行
                    const filteredData = jsonData.filter(row => 
                        row.some(cell => cell !== null && cell !== undefined && cell !== '')
                    );
                    
                    if (filteredData.length < 2) {
                        reject(new Error('Excel文件至少需要包含标题行和一行数据'));
                        return;
                    }
                    
                    resolve(filteredData);
                    
                } catch (error) {
                    reject(new Error('Excel文件格式不正确或已损坏'));
                }
            };
            
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsArrayBuffer(file);
        });
    }

    // 验证数据
    validateData(data) {
        if (!data || data.length < 2) {
            throw new Error('Excel文件数据不足');
        }

        const headers = data[0];
        const rows = data.slice(1);
        
        // 预期的列映射
        const expectedColumns = {
            '步骤名称': 0, '操作类型': 1, '操作事件': 2, '输入值': 3, '操作参数': 4,
            '操作次数': 5, '暂停时间': 6, '断言启用': 7, '断言类型': 8, '断言方法': 9,
            '断言参数': 10, '截图启用': 11, '截图时机': 12, '截图格式': 13, '截图质量': 14
        };

        // 验证标题行
        const columnMapping = this.validateHeaders(headers, expectedColumns);
        
        // 验证数据行
        const results = rows.map((row, index) => {
            return this.validateRow(row, columnMapping, index + 2); // +2 因为Excel从1开始，且跳过标题行
        });

        return {
            columnMapping,
            validationResults: results,
            validCount: results.filter(r => r.isValid).length,
            invalidCount: results.filter(r => !r.isValid).length,
            totalCount: results.length
        };
    }

    // 验证标题行
    validateHeaders(headers, expectedColumns) {
        const mapping = {};
        const missingColumns = [];
        
        for (const [expectedHeader, expectedIndex] of Object.entries(expectedColumns)) {
            const foundIndex = headers.findIndex(header => 
                header && header.toString().trim() === expectedHeader
            );
            
            if (foundIndex !== -1) {
                mapping[expectedHeader] = foundIndex;
            } else {
                missingColumns.push(expectedHeader);
            }
        }

        // 可选列（允许缺失）
        const optionalColumns = ['截图格式', '截图质量'];
        const requiredMissing = missingColumns.filter(col => !optionalColumns.includes(col));

        if (requiredMissing.length > 0) {
            throw new Error(`Excel文件缺少必要的列：${requiredMissing.join(', ')}`);
        }

        return mapping;
    }

    // 验证单行数据
    validateRow(row, columnMapping, rowNumber) {
        const errors = [];
        const warnings = [];
        
        // 获取各字段值（原始值）
        const stepName = this.getCellValue(row, columnMapping['步骤名称']);
        const rawActionType = this.getCellValue(row, columnMapping['操作类型']);
        const rawActionEvent = this.getCellValue(row, columnMapping['操作事件']);
        const inputValue = this.getCellValue(row, columnMapping['输入值']);
        const actionParams = this.getCellValue(row, columnMapping['操作参数']);
        const actionCount = this.getCellValue(row, columnMapping['操作次数']);
        const pauseTime = this.getCellValue(row, columnMapping['暂停时间']);
        const assertEnabled = this.getCellValue(row, columnMapping['断言启用']);
        const rawAssertType = this.getCellValue(row, columnMapping['断言类型']);
        const rawAssertMethod = this.getCellValue(row, columnMapping['断言方法']);
        const assertParams = this.getCellValue(row, columnMapping['断言参数']);
        const screenshotEnabled = this.getCellValue(row, columnMapping['截图启用']);
        const rawScreenshotTiming = this.getCellValue(row, columnMapping['截图时机']);
        const screenshotFormat = columnMapping['截图格式'] !== undefined ? this.getCellValue(row, columnMapping['截图格式']) : '';
        const screenshotQuality = columnMapping['截图质量'] !== undefined ? this.getCellValue(row, columnMapping['截图质量']) : '';

        // 规范化值
        const actionType = this.normalizeActionType(rawActionType);
        const actionEvent = this.normalizeActionEvent(rawActionEvent, actionType);
        const assertType = this.normalizeAssertType(rawAssertType);
        const assertMethod = this.normalizeAssertMethod(rawAssertMethod);
        const screenshotTiming = this.normalizeScreenshotTiming(rawScreenshotTiming);
        const normalizedAssertEnabled = this.normalizeBooleanValue(assertEnabled) || 'no';
        const normalizedScreenshotEnabled = this.normalizeBooleanValue(screenshotEnabled) || 'no';

        // 验证必填字段
        if (!stepName) {
            errors.push('步骤名称不能为空');
        }

        // 验证操作类型
        if (!actionType) {
            errors.push('操作类型不能为空');
        } else if (!['web', 'game'].includes(actionType)) {
            errors.push('操作类型必须是 web 或 game');
        }

        // 验证操作事件
        if (!actionEvent) {
            errors.push('操作事件不能为空');
        } else {
            const validWebEvents = ['click', 'double_click', 'input', 'hover', 'check', 'uncheck', 'select_option', 'drag_and_drop', 'press_key', 'login', 'register'];
            if (actionType === 'web' && !validWebEvents.includes(actionEvent)) {
                errors.push(`无效的Web操作事件: ${actionEvent}`);
            }
        }

        // 验证数值字段
        if (actionCount && (!Number.isInteger(Number(actionCount)) || Number(actionCount) < 1)) {
            errors.push('操作次数必须是大于0的整数');
        }

        if (pauseTime && (isNaN(Number(pauseTime)) || Number(pauseTime) < 0)) {
            errors.push('暂停时间必须是大于等于0的数字');
        }

        // 验证布尔值字段
        const boolFields = [
            { name: '断言启用', value: assertEnabled },
            { name: '截图启用', value: screenshotEnabled }
        ];

        boolFields.forEach(field => {
            if (field.value && !this.isValidBooleanValue(field.value)) {
                errors.push(`${field.name}必须是 yes/no 或 是/否`);
            }
        });

        // 验证枚举字段
        if (assertType && !['ui', 'api'].includes(assertType)) {
            errors.push('断言类型必须是 ui 或 api');
        }

        if (screenshotTiming && !['before', 'after'].includes(screenshotTiming)) {
            errors.push('截图时机必须是 before 或 after');
        }

        if (screenshotFormat && !['png', 'jpg', 'jpeg'].includes(screenshotFormat.toLowerCase())) {
            errors.push('截图格式必须是 png 或 jpg');
        }

        if (screenshotQuality && (isNaN(Number(screenshotQuality)) || Number(screenshotQuality) < 1 || Number(screenshotQuality) > 100)) {
            warnings.push('截图质量应该是1-100之间的数字');
        }

        return {
            rowNumber,
            isValid: errors.length === 0,
            errors,
            warnings,
            data: {
                stepName,
                actionType,
                actionEvent,
                inputValue,
                actionParams,
                actionCount: actionCount || '1',
                pauseTime: pauseTime || '1',
                assertEnabled: normalizedAssertEnabled,
                assertType: assertType || 'ui',
                assertMethod: assertMethod || '',
                assertParams: assertParams || '',
                screenshotEnabled: normalizedScreenshotEnabled,
                screenshotTiming: screenshotTiming || 'after',
                screenshotFormat: (screenshotFormat || 'png').toLowerCase(),
                screenshotQuality: screenshotQuality || '90'
            }
        };
    }

    // 获取单元格值
    getCellValue(row, columnIndex) {
        if (columnIndex === undefined || columnIndex >= row.length) {
            return '';
        }
        const value = row[columnIndex];
        return value !== null && value !== undefined ? value.toString().trim() : '';
    }

    // 验证布尔值
    isValidBooleanValue(value) {
        if (!value) return true;
        const strValue = value.toString().toLowerCase().trim();
        return ['yes', 'no', 'true', 'false', '是', '否', '1', '0'].includes(strValue);
    }

    // 标准化布尔值
    normalizeBooleanValue(value) {
        if (!value) return 'no';
        const strValue = value.toString().toLowerCase().trim();
        const yesValues = ['yes', 'true', '是', '1'];
        return yesValues.includes(strValue) ? 'yes' : 'no';
    }

    // 规范化操作类型（支持中英文）
    normalizeActionType(value) {
        if (!value) return '';
        const v = value.toString().trim().toLowerCase();
        const map = {
            'web': 'web',
            '网页': 'web',
            'game': 'game',
            '游戏': 'game'
        };
        return map[v] || v;
    }

    // 规范化操作事件（支持中英文、同义词）
    normalizeActionEvent(value, actionType) {
        if (!value) return '';
        const v = value.toString().trim().toLowerCase();
        const map = {
            'click': 'click',
            '单击': 'click',
            '点击': 'click',
            'double_click': 'double_click',
            'double-click': 'double_click',
            '双击': 'double_click',
            'input': 'input',
            '输入': 'input',
            'hover': 'hover',
            '悬停': 'hover',
            'check': 'check',
            '勾选': 'check',
            'uncheck': 'uncheck',
            '取消勾选': 'uncheck',
            'select_option': 'select_option',
            'select-option': 'select_option',
            '选择': 'select_option',
            'drag_and_drop': 'drag_and_drop',
            'drag-and-drop': 'drag_and_drop',
            '拖拽': 'drag_and_drop',
            'press_key': 'press_key',
            'press-key': 'press_key',
            '按键': 'press_key',
            'login': 'login',
            '登录': 'login',
            'register': 'register',
            '注册': 'register'
        };
        const normalized = map[v] || v.replace(/\s+/g, '_');
        return normalized;
    }

    // 规范化断言类型
    normalizeAssertType(value) {
        if (!value) return '';
        const v = value.toString().trim().toLowerCase();
        const map = {
            'ui': 'ui',
            '界面': 'ui',
            'api': 'api',
            '接口': 'api'
        };
        return map[v] || v;
    }

    // 规范化断言方法
    normalizeAssertMethod(value) {
        if (!value) return '';
        const v = value.toString().trim().toLowerCase();
        const map = {
            '元素存在': 'element_exists',
            '元素可见': 'element_visible',
            'element_exists': 'element_exists',
            'element-visible': 'element_visible',
            'element_visible': 'element_visible'
        };
        return map[v] || v.replace(/\s+/g, '_');
    }

    // 规范化截图时机
    normalizeScreenshotTiming(value) {
        if (!value) return '';
        const v = value.toString().trim().toLowerCase();
        const map = {
            'before': 'before',
            '步骤前': 'before',
            '前': 'before',
            'after': 'after',
            '步骤后': 'after',
            '后': 'after'
        };
        return map[v] || v;
    }

    // 显示预览
    displayPreview() {
        const previewContainer = document.querySelector('.excel-import-preview');
        if (!previewContainer) return;

        const { validationResults, validCount, invalidCount, totalCount } = this.validationResults;

        let tableHTML = `
            <h4><i class="fas fa-eye"></i> 数据预览</h4>
            <div class="excel-import-stats">
                <div class="excel-import-stats-item">
                    <i class="fas fa-list"></i>
                    <span>总计: ${totalCount}</span>
                </div>
                <div class="excel-import-stats-item">
                    <i class="fas fa-check-circle"></i>
                    <span>有效: ${validCount}</span>
                </div>
                <div class="excel-import-stats-item">
                    <i class="fas fa-exclamation-circle"></i>
                    <span>异常: ${invalidCount}</span>
                </div>
            </div>
            <div class="excel-import-preview-table-container">
                <table class="excel-import-preview-table">
                    <thead>
                        <tr>
                            <th>状态</th>
                            <th>行号</th>
                            <th>步骤名称</th>
                            <th>操作类型</th>
                            <th>操作事件</th>
                            <th>输入值</th>
                            <th>操作参数</th>
                            <th>问题说明</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        validationResults.forEach(result => {
            const statusIcon = result.isValid ? 
                '<span class="excel-import-status-indicator excel-import-status-valid">✓</span>' : 
                '<span class="excel-import-status-indicator excel-import-status-invalid">✗</span>';
            
            const issues = [...result.errors, ...result.warnings].join('; ');
            
            tableHTML += `
                <tr>
                    <td class="excel-import-status-cell">${statusIcon}</td>
                    <td>${result.rowNumber}</td>
                    <td>${result.data.stepName}</td>
                    <td>${result.data.actionType}</td>
                    <td>${result.data.actionEvent}</td>
                    <td>${result.data.inputValue}</td>
                    <td>${result.data.actionParams}</td>
                    <td title="${issues}">${issues || '正常'}</td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;

        // 更新底部导入按钮状态
        const importBtn = document.getElementById('importExcelBtn');
        if (importBtn) {
            importBtn.disabled = validCount === 0;
            importBtn.innerHTML = validCount > 0
                ? '<i class="fas fa-file-import"></i> 导入数据 (' + validCount + '条)'
                : '<i class="fas fa-file-import"></i> 导入数据';
        }

        previewContainer.innerHTML = tableHTML;
        previewContainer.style.display = 'block';
    }

    // 导入数据
    async importData() {
        if (!this.validationResults) {
            this.showError('没有可导入的数据');
            return;
        }

        const validData = this.validationResults.validationResults.filter(r => r.isValid);
        if (validData.length === 0) {
            this.showError('没有有效的数据可以导入');
            return;
        }

        this.showLoading('正在导入数据...');

        try {
            // 转换为测试步骤格式
            const steps = validData.map(item => this.convertToTestStep(item.data));
            
            // 添加到测试步骤列表
            if (window.automationManagement) {
                const am = window.automationManagement;
                if (typeof am.addStep !== 'function' && typeof window.__installExcelImportAddStepShim === 'function') {
                    try { window.__installExcelImportAddStepShim(am); } catch (e) { console.warn('[excel-import] 尝试安装 addStep 兼容层失败', e); }
                }
                if (typeof am.addStep === 'function') {
                    for (const step of steps) {
                        am.addStep(step);
                    }
                } else {
                    // 兜底：直接写入列表并触发渲染
                    if (!Array.isArray(am.testSteps)) am.testSteps = [];
                    for (const step of steps) {
                        const sysStep = (step && step.step_name !== undefined) ? step : {
                            step_name: (step.name || '').toString(),
                            operation_type: (step.action && step.action.type) || 'web',
                            operation_event: (step.action && step.action.event) || 'click',
                            input_value: (step.action && step.action.input_value) || '',
                            operation_params: (step.action && step.action.action_param) || '',
                            operation_count: (step.action && parseInt(step.action.action_count)) || 1,
                            pause_time: (step.action && parseFloat(step.action.pause_time)) || 1,
                            assertion_enabled: (step.assertion && step.assertion.enabled) ? 'yes' : 'no',
                            assertion_type: (step.assertion && step.assertion.type) || 'ui',
                            assertion_method: (step.assertion && step.assertion.method) || 'pytest-selenium',
                            assertion_params: (step.assertion && step.assertion.assertion_param) || '',
                            assertion_config: { ui_assertions: [], image_assertions: [], custom_assertions: [] },
                            screenshot_enabled: (step.screenshot && step.screenshot.enabled) ? 'yes' : 'no',
                            screenshot_config: {
                                timing: (step.screenshot && step.screenshot.timing) || 'after',
                                format: (step.screenshot && step.screenshot.format) || 'png',
                                quality: (step.screenshot && parseInt(step.screenshot.quality)) || 90,
                                prefix: 'screenshot_step',
                                full_page: false,
                                path: 'screenshots/'
                            },
                            auth_regen_on_open: false,
                            auth_temp_credentials_list: []
                        };
                        am.testSteps.push(sysStep);
                        if (am.isEditing && Array.isArray(am.editingTestSteps)) {
                            am.editingTestSteps.push(JSON.parse(JSON.stringify(sysStep)));
                        }
                    }
                    if (typeof am.renderTestSteps === 'function') am.renderTestSteps();
                    if (typeof am.recalculateStepTabIndexes === 'function') am.recalculateStepTabIndexes();
                }
                showToast(`成功导入 ${steps.length} 个测试步骤`, 'success');
                this.closeModal();
            } else {
                throw new Error('自动化管理器未初始化');
            }

        } catch (error) {
            this.showError('导入数据失败：' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    // 转换为测试步骤格式
    convertToTestStep(data) {
        return {
            name: data.stepName,
            action: {
                type: data.actionType,
                event: data.actionEvent,
                input_value: data.inputValue,
                action_param: data.actionParams,
                action_count: parseInt(data.actionCount) || 1,
                pause_time: parseFloat(data.pauseTime) || 1
            },
            assertion: {
                enabled: data.assertEnabled === 'yes',
                type: data.assertType,
                method: data.assertMethod,
                assertion_param: data.assertParams
            },
            screenshot: {
                enabled: data.screenshotEnabled === 'yes',
                timing: data.screenshotTiming,
                format: data.screenshotFormat,
                quality: parseInt(data.screenshotQuality) || 90
            }
        };
    }

    // 清除选择的文件
    clearSelectedFile() {
        this.selectedFile = null;
        this.parsedData = null;
        this.validationResults = null;

        // 清除文件输入
        const fileInput = document.getElementById('excelFileInput');
        if (fileInput) {
            fileInput.value = '';
        }

        // 隐藏文件信息和预览
        const fileInfo = document.querySelector('.excel-import-file-info');
        const preview = document.querySelector('.excel-import-preview');
        
        if (fileInfo) fileInfo.style.display = 'none';
        if (preview) preview.style.display = 'none';

        // 重置底部导入按钮
        const importBtn = document.getElementById('importExcelBtn');
        if (importBtn) {
            importBtn.disabled = true;
            importBtn.innerHTML = '<i class="fas fa-file-import"></i> 导入数据';
        }

        this.clearMessages();
    }

    // 关闭模态框
    closeModal() {
        const modal = document.getElementById('excelImportModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
        this.clearSelectedFile();
    }

    // 显示错误信息
    showError(message) {
        this.clearMessages();
        const container = document.querySelector('.excel-import-container');
        if (container) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'excel-import-error';
            errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
            container.insertBefore(errorDiv, container.firstChild);
        }
    }

    // 显示警告信息
    showWarning(message) {
        this.clearMessages();
        const container = document.querySelector('.excel-import-container');
        if (container) {
            const warningDiv = document.createElement('div');
            warningDiv.className = 'excel-import-warning';
            warningDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${message}`;
            container.insertBefore(warningDiv, container.firstChild);
        }
    }

    // 清除消息
    clearMessages() {
        const container = document.querySelector('.excel-import-container');
        if (container) {
            const messages = container.querySelectorAll('.excel-import-error, .excel-import-warning');
            messages.forEach(msg => msg.remove());
        }
    }

    // 显示加载状态
    showLoading(message = '处理中...') {
        this.hideLoading(); // 先清除之前的加载状态
        
        const container = document.querySelector('.excel-import-container');
        if (container) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'excel-import-loading-overlay';
            loadingDiv.innerHTML = `
                <div class="excel-import-loading-spinner"></div>
                <div class="excel-import-loading-text">${message}</div>
            `;
            container.style.position = 'relative';
            container.appendChild(loadingDiv);
        }
    }

    // 隐藏加载状态
    hideLoading() {
        const loadingOverlay = document.querySelector('.excel-import-loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.remove();
        }
    }
}

// 创建全局实例
window.excelImportManager = new ExcelImportManager();

// 兼容层：如果 automationManagement 没有 addStep，则提供一个用于从 Excel 导入的转换方法
(function setupAddStepShimWatcher(){
	function installAddStep(am){
		if (!am || typeof am !== 'object') return;
		if (typeof am.addStep === 'function') return;
		am.addStep = function(stepLike) {
			let step = null;
			if (stepLike && stepLike.step_name !== undefined) {
				step = JSON.parse(JSON.stringify(stepLike));
			} else {
				const name = (stepLike && stepLike.name) || '';
				const action = (stepLike && stepLike.action) || {};
				const assertion = (stepLike && stepLike.assertion) || {};
				const screenshot = (stepLike && stepLike.screenshot) || {};
				step = {
					step_name: extractStepNameShim(name, (this.testSteps || []).length),
					operation_type: (action.type || '').toString().trim().toLowerCase() || 'web',
					operation_event: (action.event || '').toString().trim().toLowerCase() || 'click',
					input_value: action.input_value || '',
					operation_params: action.action_param || '',
					operation_count: parseInt(action.action_count) || 1,
					pause_time: parseFloat(action.pause_time) || 1,
					assertion_enabled: assertion.enabled ? 'yes' : 'no',
					assertion_type: (assertion.type || 'ui').toString().trim().toLowerCase(),
					assertion_method: assertion.method || 'pytest-selenium',
					assertion_params: assertion.assertion_param || '',
					assertion_config: { ui_assertions: [], image_assertions: [], custom_assertions: [] },
					screenshot_enabled: screenshot.enabled ? 'yes' : 'no',
					screenshot_config: {
						timing: (screenshot.timing || 'after').toString().trim().toLowerCase(),
						format: (screenshot.format || 'png').toString().trim().toLowerCase(),
						quality: parseInt(screenshot.quality) || 90,
						prefix: 'screenshot_step',
						full_page: false,
						path: 'screenshots/'
					},
					auth_regen_on_open: false,
					auth_temp_credentials_list: []
				};
				if (step.assertion_enabled === 'yes' && step.assertion_type === 'ui') {
					const method = (assertion.method || '').toString().toLowerCase();
					const target = (assertion.assertion_param || '').toString().trim();
					if (target) {
						let type = 'exists';
						if (method.includes('visible') || method.includes('可见')) type = 'visible';
						if (method.includes('exist') || method.includes('存在')) type = 'exists';
						step.assertion_config.ui_assertions.push({
							type,
							id: Date.now().toString(),
							target_element: target,
							name: `${type === 'exists' ? '元素存在' : '元素可见'}: ${target}`,
							description: `验证元素 ${target} ${type === 'exists' ? '存在' : '可见'}`
						});
					}
				}
			}
			if (!Array.isArray(this.testSteps)) this.testSteps = [];
			this.testSteps.push(step);
			if (this.isEditing && Array.isArray(this.editingTestSteps)) {
				this.editingTestSteps.push(JSON.parse(JSON.stringify(step)));
			}
			if (typeof this.renderTestSteps === 'function') this.renderTestSteps();
			if (typeof this.recalculateStepTabIndexes === 'function') this.recalculateStepTabIndexes();
		};
		function extractStepNameShim(rawName, index) {
			const fallback = `测试步骤 ${index + 1}`;
			if (!rawName) return fallback;
			const str = rawName.toString().trim();
			const match = str.match(/^\s*步骤\s*(\d+)\s*[\-—:：]\s*(.+)$/);
			if (match && match[2]) return match[2].trim() || fallback;
			return str;
		}
	}
	// 立即尝试安装
	installAddStep(window.automationManagement);
	// 暴露安装方法，供需要时手动调用
	window.__installExcelImportAddStepShim = installAddStep;
	// 拦截后续对 window.automationManagement 的赋值，自动安装
	try {
		let __amCurrent = window.automationManagement;
		Object.defineProperty(window, 'automationManagement', {
			configurable: true,
			enumerable: true,
			get() { return __amCurrent; },
			set(v) {
				__amCurrent = v;
				try { installAddStep(v); } catch (e) { console.error('[excel-import] 安装 addStep 兼容层失败', e); }
			}
		});
	} catch (e) {
		// 如果浏览器不允许重定义属性，则退化为轮询一次
		const timer = setInterval(function(){
			if (window.automationManagement) {
				try { installAddStep(window.automationManagement); } finally { clearInterval(timer); }
			}
		}, 200);
		setTimeout(function(){ clearInterval(timer); }, 10000);
	}
})(); 