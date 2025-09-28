// API接口封装

const API_BASE_URL = (window.API_BASE_URL || (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || `${window.location.origin}/api`).replace(/\/+$/, '');

// 通用请求函数
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include', // 包含cookies
    };

    const config = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers,
        },
    };

    try {
        const response = await fetch(`${API_BASE_URL}${url}`, config);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API请求失败:', error);
        throw error;
    }
}

// 版本管理API
const VersionAPI = {
    // 获取所有项目
    async getProjects() {
        return await apiRequest('/version/projects', {
            method: 'GET'
        });
    },

    // 创建项目
    async createProject(projectData) {
        return await apiRequest('/version/projects', {
            method: 'POST',
            body: JSON.stringify(projectData)
        });
    },

    // 更新项目
    async updateProject(projectId, projectData) {
        return await apiRequest(`/version/projects/${projectId}`, {
            method: 'PUT',
            body: JSON.stringify(projectData)
        });
    },

    // 删除项目
    async deleteProject(projectId) {
        return await apiRequest(`/version/projects/${projectId}`, {
            method: 'DELETE'
        });
    },

    // 上传图片
    async uploadImage(file) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API_BASE_URL}/version/upload-image`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('图片上传失败:', error);
            throw error;
        }
    },

    // 获取枚举值
    async getEnumValues(fieldName) {
        return await apiRequest(`/version/enum-values/${fieldName}`, {
            method: 'GET'
        });
    },

    // 添加枚举值
    async addEnumValue(fieldName, fieldValue) {
        return await apiRequest('/version/enum-values', {
            method: 'POST',
            body: JSON.stringify({
                field_name: fieldName,
                field_value: fieldValue
            })
        });
    }
};

// 自动化管理API
const AutomationAPI = {
    // 获取自动化项目列表
    async getProjects() {
        return await apiRequest('/automation/projects', {
            method: 'GET'
        });
    },

    // 删除自动化项目
    async deleteProject(projectId) {
        return await apiRequest(`/automation/projects/${projectId}`, {
            method: 'DELETE'
        });
    },

    // 测试连接
    async testConnection(projectId) {
        return await apiRequest(`/automation/projects/${projectId}/test-connection`, {
            method: 'POST'
        });
    },

    // 执行测试
    async executeTest(projectId) {
        return await apiRequest(`/automation/projects/${projectId}/execute`, {
            method: 'POST'
        });
    },

    // 取消测试
    async cancelTest(projectId) {
        return await apiRequest(`/automation/projects/${projectId}/cancel`, {
            method: 'POST'
        });
    },

    // 获取执行历史
    async getExecutionHistory(projectId) {
        return await apiRequest(`/automation/projects/${projectId}/executions`, {
            method: 'GET'
        });
    }
};

// 错误处理
function handleApiError(error, defaultMessage = '操作失败') {
    let message = defaultMessage;
    
    if (error.message) {
        message = error.message;
    }
    
    // 如果是网络错误
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
        message = '网络连接失败，请检查服务器是否正常运行';
    }
    
    showToast(message, 'error');
    return message;
}

// 请求拦截器（可以在这里添加loading状态等）
function addRequestInterceptor() {
    // 可以在这里添加全局的请求拦截逻辑
    // 比如显示loading，添加认证token等
}

// 响应拦截器
function addResponseInterceptor() {
    // 可以在这里添加全局的响应拦截逻辑
    // 比如处理认证失败，统一错误处理等
}

// 导出API对象
window.VersionAPI = VersionAPI;
window.AutomationAPI = AutomationAPI;
window.handleApiError = handleApiError; 