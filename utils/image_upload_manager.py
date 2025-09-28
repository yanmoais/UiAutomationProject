"""
图片上传管理器
专门处理图片断言相关的图片上传、存储和管理功能
"""
import os
import shutil
import uuid
import base64
from pathlib import Path
from typing import Optional, Dict, Any
from config.logger import log_info, log_error


class ImageUploadManager:
    """图片上传管理器"""
    
    def __init__(self):
        """初始化图片上传管理器"""
        self.base_dir = Path("IMG_LOGS/IMA_ASSERT")
        self.base_dir.mkdir(parents=True, exist_ok=True)
        
    def save_image_assertion_file(self, image_data: Any, filename: Optional[str] = None) -> Optional[str]:
        """
        保存图片断言文件到指定目录
        
        Args:
            image_data: 图片数据（可以是文件对象、base64字符串、blob URL等）
            filename: 可选的文件名，如果不提供则自动生成
            
        Returns:
            保存后的文件路径，如果保存失败则返回None
        """
        try:
            # 生成唯一的文件名
            if not filename:
                unique_id = str(uuid.uuid4())[:8]
                filename = f"assertion_image_{unique_id}.png"
            
            # 确保文件名以.png结尾
            if not filename.lower().endswith(('.png', '.jpg', '.jpeg')):
                filename += '.png'
            
            file_path = self.base_dir / filename
            
            # 处理不同类型的图片数据
            if isinstance(image_data, str):
                if image_data.startswith('data:image'):
                    # Base64编码的图片数据
                    self._save_base64_image(image_data, file_path)
                elif image_data.startswith('blob:'):
                    # Blob URL - 这种情况需要前端先转换为base64
                    log_error(f"无法直接处理blob URL: {image_data}")
                    return None
                else:
                    # 假设是文件路径
                    if os.path.exists(image_data):
                        shutil.copy2(image_data, file_path)
                    else:
                        log_error(f"图片文件不存在: {image_data}")
                        return None
            else:
                # 假设是文件对象
                with open(file_path, 'wb') as f:
                    if hasattr(image_data, 'read'):
                        f.write(image_data.read())
                    else:
                        f.write(image_data)
            
            log_info(f"图片断言文件保存成功: {file_path}")
            # 返回绝对路径（以/开头），确保从任何页面都能正确访问
            # 确保使用绝对路径进行相对路径计算
            absolute_file_path = file_path.resolve()
            current_dir = Path.cwd()
            relative_path = absolute_file_path.relative_to(current_dir)
            return f"/{str(relative_path).replace(os.sep, '/')}"
            
        except Exception as e:
            log_error(f"保存图片断言文件失败: {e}")
            return None
    
    def _save_base64_image(self, base64_data: str, file_path: Path):
        """保存base64编码的图片"""
        try:
            # 移除data:image前缀
            if ',' in base64_data:
                base64_data = base64_data.split(',')[1]
            
            # 解码并保存
            image_bytes = base64.b64decode(base64_data)
            with open(file_path, 'wb') as f:
                f.write(image_bytes)
                
        except Exception as e:
            raise Exception(f"保存base64图片失败: {e}")
    
    def process_image_assertion_data(self, assertion_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        处理图片断言数据，将图片保存到本地并更新路径
        
        Args:
            assertion_data: 图片断言配置数据
            
        Returns:
            处理后的断言数据
        """
        try:
            processed_data = assertion_data.copy()
            
            # 检查是否有图片文件需要处理
            image_file = assertion_data.get('image_file')
            image_path = assertion_data.get('image_path', '')
            
            if image_file or (image_path and image_path.startswith('blob:')):
                # 生成文件名
                assertion_id = assertion_data.get('id', str(uuid.uuid4())[:8])
                method = assertion_data.get('method', 'unknown')
                filename = f"assertion_{assertion_id}_{method}.png"
                
                # 保存图片文件
                if image_file:
                    saved_path = self.save_image_assertion_file(image_file, filename)
                else:
                    # 对于blob URL，需要前端先转换为base64或文件对象
                    log_info(f"检测到blob URL，需要前端处理: {image_path}")
                    saved_path = None
                
                if saved_path:
                    processed_data['image_path'] = saved_path
                    log_info(f"图片断言文件处理完成: {saved_path}")
                else:
                    log_error("图片断言文件处理失败")
            
            return processed_data
            
        except Exception as e:
            log_error(f"处理图片断言数据失败: {e}")
            return assertion_data
    
    def clean_old_assertion_images(self, days: int = 30):
        """
        清理旧的断言图片文件
        
        Args:
            days: 保留天数，超过此天数的文件将被删除
        """
        try:
            import time
            current_time = time.time()
            cutoff_time = current_time - (days * 24 * 60 * 60)
            
            deleted_count = 0
            for file_path in self.base_dir.glob("*"):
                if file_path.is_file():
                    file_mtime = file_path.stat().st_mtime
                    if file_mtime < cutoff_time:
                        file_path.unlink()
                        deleted_count += 1
            
            log_info(f"清理完成，删除了 {deleted_count} 个旧的断言图片文件")
            
        except Exception as e:
            log_error(f"清理旧断言图片文件失败: {e}")
    
    def get_assertion_image_info(self, image_path: str) -> Optional[Dict[str, Any]]:
        """
        获取断言图片的信息
        
        Args:
            image_path: 图片路径
            
        Returns:
            图片信息字典，包含文件大小、修改时间等
        """
        try:
            if not os.path.exists(image_path):
                return None
            
            file_path = Path(image_path)
            stat = file_path.stat()
            
            return {
                'path': str(file_path),
                'size': stat.st_size,
                'modified_time': stat.st_mtime,
                'exists': True
            }
            
        except Exception as e:
            log_error(f"获取图片信息失败: {e}")
            return None


# 全局实例
image_upload_manager = ImageUploadManager() 