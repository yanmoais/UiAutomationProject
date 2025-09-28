/**
 * 图片断言上传管理模块
 * 专门处理图片断言相关的文件上传和管理
 */
class ImageAssertionUpload {
    constructor() {
        this.baseUrl = '/api/automation';
        this.supportedFormats = ['image/png', 'image/jpeg', 'image/jpg'];
        this.maxFileSize = 5 * 1024 * 1024; // 5MB
    }

    /**
     * 上传图片文件到断言目录
     * @param {File} file - 图片文件对象
     * @param {string} assertionId - 断言ID
     * @param {string} method - 断言方法 (ssim, template_match等)
     * @returns {Promise<Object>} 上传结果
     */
    async uploadImageFile(file, assertionId, method) {
        try {
            // 验证文件
            const validation = this.validateImageFile(file);
            if (!validation.valid) {
                throw new Error(validation.message);
            }

            // 准备FormData
            const formData = new FormData();
            formData.append('file', file);
            formData.append('assertion_id', assertionId);
            formData.append('method', method);

            // 发送上传请求
            const response = await fetch(`${this.baseUrl}/upload-assertion-image`, {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            
            if (result.success) {
                console.log('图片上传成功:', result.file_path);
                return {
                    success: true,
                    filePath: result.file_path,
                    message: result.message
                };
            } else {
                throw new Error(result.message);
            }

        } catch (error) {
            console.error('上传图片文件失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * 通过base64数据上传图片
     * @param {string} base64Data - base64编码的图片数据
     * @param {string} assertionId - 断言ID
     * @param {string} method - 断言方法
     * @returns {Promise<Object>} 上传结果
     */
    async uploadImageBase64(base64Data, assertionId, method) {
        try {
            const payload = {
                image_data: base64Data,
                assertion_id: assertionId,
                method: method
            };

            const response = await fetch(`${this.baseUrl}/upload-assertion-image-base64`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            
            if (result.success) {
                console.log('Base64图片上传成功:', result.file_path);
                return {
                    success: true,
                    filePath: result.file_path,
                    message: result.message
                };
            } else {
                throw new Error(result.message);
            }

        } catch (error) {
            console.error('上传Base64图片失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * 将Blob URL转换为base64并上传
     * @param {string} blobUrl - Blob URL
     * @param {string} assertionId - 断言ID
     * @param {string} method - 断言方法
     * @returns {Promise<Object>} 上传结果
     */
    async uploadFromBlobUrl(blobUrl, assertionId, method) {
        try {
            // 检查是否有缓存的文件对象
            if (window.automationManager && window.automationManager.uploadedImages) {
                // 尝试从缓存中找到对应的文件对象
                for (let [key, value] of window.automationManager.uploadedImages.entries()) {
                    if (value === blobUrl && key.endsWith('_file')) {
                        const file = window.automationManager.uploadedImages.get(key);
                        if (file instanceof File) {
                            return await this.uploadImageFile(file, assertionId, method);
                        }
                    }
                }
            }
            
            // 如果找不到缓存的文件，尝试从blob URL获取数据
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            
            // 转换为base64
            const base64Data = await this.blobToBase64(blob);
            
            // 上传base64数据
            return await this.uploadImageBase64(base64Data, assertionId, method);

        } catch (error) {
            console.error('从Blob URL上传失败:', error);
            return {
                success: false,
                message: `上传失败: ${error.message}`
            };
        }
    }

    /**
     * 将Blob转换为base64字符串
     * @param {Blob} blob - Blob对象
     * @returns {Promise<string>} base64字符串
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * 验证图片文件
     * @param {File} file - 图片文件
     * @returns {Object} 验证结果
     */
    validateImageFile(file) {
        // 检查文件类型
        if (!this.supportedFormats.includes(file.type)) {
            return {
                valid: false,
                message: `不支持的文件格式。支持的格式: ${this.supportedFormats.join(', ')}`
            };
        }

        // 检查文件大小
        if (file.size > this.maxFileSize) {
            return {
                valid: false,
                message: `文件大小超过限制。最大允许: ${this.maxFileSize / 1024 / 1024}MB`
            };
        }

        return { valid: true };
    }

    /**
     * 清理旧的断言图片文件
     * @param {number} days - 保留天数
     * @returns {Promise<Object>} 清理结果
     */
    async cleanOldAssertionImages(days = 30) {
        try {
            const response = await fetch(`${this.baseUrl}/clean-assertion-images`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ days: days })
            });

            const result = await response.json();
            return result;

        } catch (error) {
            console.error('清理旧文件失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * 处理图片断言数据，自动上传图片文件
     * @param {Object} assertionData - 断言数据
     * @returns {Promise<Object>} 处理后的断言数据
     */
    async processImageAssertionData(assertionData) {
        try {
            const processedData = { ...assertionData };
            
            // 检查是否有需要上传的图片
            if (assertionData.image_file && assertionData.image_file instanceof File) {
                // 上传文件对象
                const uploadResult = await this.uploadImageFile(
                    assertionData.image_file,
                    assertionData.id,
                    assertionData.method
                );
                
                if (uploadResult.success) {
                    processedData.image_path = uploadResult.filePath;
                    delete processedData.image_file; // 移除文件对象
                } else {
                    throw new Error(uploadResult.message);
                }
                
            } else if (assertionData.image_path && assertionData.image_path.startsWith('blob:')) {
                // 上传blob URL
                const uploadResult = await this.uploadFromBlobUrl(
                    assertionData.image_path,
                    assertionData.id,
                    assertionData.method
                );
                
                if (uploadResult.success) {
                    processedData.image_path = uploadResult.filePath;
                } else {
                    throw new Error(uploadResult.message);
                }
            }

            return {
                success: true,
                data: processedData
            };

        } catch (error) {
            console.error('处理图片断言数据失败:', error);
            return {
                success: false,
                message: error.message,
                data: assertionData
            };
        }
    }

    /**
     * 创建图片预览元素
     * @param {string} imagePath - 图片路径
     * @param {string} containerId - 容器ID
     */
    createImagePreview(imagePath, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // 清除现有预览
        container.innerHTML = '';

        // 创建预览图片
        const img = document.createElement('img');
        img.src = imagePath;
        img.style.maxWidth = '200px';
        img.style.maxHeight = '200px';
        img.style.border = '1px solid #ddd';
        img.style.borderRadius = '4px';
        img.alt = '图片断言预览';

        // 创建文件信息
        const info = document.createElement('div');
        info.style.marginTop = '8px';
        info.style.fontSize = '12px';
        info.style.color = '#666';
        info.textContent = `路径: ${imagePath}`;

        container.appendChild(img);
        container.appendChild(info);
    }

    /**
     * 显示上传进度
     * @param {string} containerId - 进度容器ID
     * @param {number} progress - 进度百分比
     */
    showUploadProgress(containerId, progress) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let progressBar = container.querySelector('.upload-progress');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.className = 'upload-progress';
            progressBar.style.width = '100%';
            progressBar.style.height = '4px';
            progressBar.style.backgroundColor = '#f0f0f0';
            progressBar.style.borderRadius = '2px';
            progressBar.style.overflow = 'hidden';
            
            const progressFill = document.createElement('div');
            progressFill.className = 'upload-progress-fill';
            progressFill.style.height = '100%';
            progressFill.style.backgroundColor = '#4CAF50';
            progressFill.style.transition = 'width 0.3s ease';
            progressFill.style.width = '0%';
            
            progressBar.appendChild(progressFill);
            container.appendChild(progressBar);
        }

        const progressFill = progressBar.querySelector('.upload-progress-fill');
        progressFill.style.width = `${progress}%`;

        if (progress >= 100) {
            setTimeout(() => {
                progressBar.remove();
            }, 1000);
        }
    }
}

// 创建全局实例
const imageAssertionUpload = new ImageAssertionUpload();

// 使用示例函数
function exampleUsage() {
    // 示例1: 处理文件输入
    document.getElementById('image-file-input').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            const result = await imageAssertionUpload.uploadImageFile(
                file,
                'assertion_123',
                'ssim'
            );
            
            if (result.success) {
                console.log('上传成功，文件路径:', result.filePath);
                // 更新断言配置中的图片路径
            } else {
                console.error('上传失败:', result.message);
            }
        }
    });

    // 示例2: 处理拖放上传
    const dropZone = document.getElementById('image-drop-zone');
    dropZone.addEventListener('drop', async (event) => {
        event.preventDefault();
        const files = event.dataTransfer.files;
        
        if (files.length > 0) {
            const file = files[0];
            imageAssertionUpload.showUploadProgress('upload-progress-container', 0);
            
            const result = await imageAssertionUpload.uploadImageFile(
                file,
                Date.now().toString(),
                'template_match'
            );
            
            imageAssertionUpload.showUploadProgress('upload-progress-container', 100);
            
            if (result.success) {
                imageAssertionUpload.createImagePreview(
                    result.filePath,
                    'image-preview-container'
                );
            }
        }
    });

    // 示例3: 处理完整的断言数据
    async function processAssertionWithImage(assertionData) {
        const result = await imageAssertionUpload.processImageAssertionData(assertionData);
        
        if (result.success) {
            // 使用处理后的数据提交到后端
            return result.data;
        } else {
            throw new Error(result.message);
        }
    }
}

// 导出模块
window.ImageAssertionUpload = ImageAssertionUpload;
window.imageAssertionUpload = imageAssertionUpload; 