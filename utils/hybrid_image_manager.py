import pyautogui
import time
import asyncio
from typing import Optional, Tuple, Dict, Any
from config.ui_config import UIConfig
from config.logger import log_info
from utils.image_recognition import ImageRecognition
from Base_ENV.config import BASE_DIR
import os

class HybridImageManager:
    """混合图片识别管理器 - 结合Playwright截图识别和pyautogui，支持任务隔离"""
    
    def __init__(self, task_id: str = None):
        self.config = UIConfig.get_image_recognition_config()
        # 为每个实例创建独立的图片识别器，传递任务ID
        self.image_recognition = ImageRecognition(task_id=task_id)
        # 为每个实例创建独立的统计状态
        self.task_id = task_id or f"task_{id(self)}"
        self.stats = {
            'screenshot_success': 0, 
            'pyautogui_success': 0, 
            'total_attempts': 0,
            'screenshot_failures': 0,
            'pyautogui_failures': 0,
            'total_failures': 0,
            'task_id': self.task_id
        }
        # 为每个实例创建独立的锁，避免并发冲突
        self._lock = asyncio.Lock()
        log_info(f"创建HybridImageManager实例: {self.task_id}")
    
    async def find_image(self, page, image_path: str, confidence: float = None, 
                        timeout: int = None, use_hybrid: bool = True) -> Optional[Tuple[int, int]]:
        """
        混合图片识别 - 优先使用截图识别，失败时回退到pyautogui
        使用任务隔离和锁机制确保并发安全，支持重试机制
        
        Args:
            page: Playwright页面对象
            image_path: 图片路径
            confidence: 匹配置信度
            timeout: 超时时间
            use_hybrid: 是否使用混合模式
            
        Returns:
            Optional[Tuple[int, int]]: 图片中心坐标 (x, y)，未找到返回None
        """
        if confidence is None:
            confidence = self.config['confidence']
        if timeout is None:
            timeout = self.config['timeout']
        
        max_attempts = self.config.get('max_retry_attempts', 3)
        retry_delay = self.config.get('retry_delay', 1.0)
        
        # 使用锁机制确保并发安全
        async with self._lock:
            for attempt in range(max_attempts):
                try:
                    log_info(f"[{self.task_id}] 第{attempt + 1}次混合图片识别尝试: {image_path}")
                    self.stats['total_attempts'] += 1
                    
                    # 方法1: 优先使用截图识别
                    if self.config['use_screenshot'] and self.config['screenshot_first']:
                        try:
                            position = await self.image_recognition.find_image(
                                page, image_path, confidence, timeout
                            )
                            if position:
                                self.stats['screenshot_success'] += 1
                                log_info(f"[{self.task_id}] 截图识别成功: {image_path}, 位置: {position}")
                                return position
                        except Exception as e:
                            log_info(f"[{self.task_id}] 截图识别失败: {e}")
                            self.stats['screenshot_failures'] += 1
                    
                    # 方法2: 使用pyautogui作为备选（限定到当前页面窗口区域）
                    if self.config['use_pyautogui_fallback']:
                        try:
                            # 统一构建图片路径，避免相对路径在pyautogui下查找失败
                            img_path_full = self._build_image_path(image_path)
                            region = await self._get_window_region(page)
                            position = self._find_with_pyautogui(img_path_full, confidence, region)
                            if position:
                                self.stats['pyautogui_success'] += 1
                                log_info(f"[{self.task_id}] pyautogui识别成功: {image_path}, 位置: {position}")
                                return position
                        except Exception as e:
                            log_info(f"[{self.task_id}] pyautogui识别失败: {e}")
                            self.stats['pyautogui_failures'] += 1
                    
                    # 方法3: 如果截图优先但失败，尝试pyautogui
                    if (self.config['use_screenshot'] and not self.config['screenshot_first'] and 
                        self.config['use_pyautogui_fallback']):
                        try:
                            position = await self.image_recognition.find_image(
                                page, image_path, confidence, timeout
                            )
                            if position:
                                self.stats['screenshot_success'] += 1
                                log_info(f"[{self.task_id}] 截图识别成功: {image_path}, 位置: {position}")
                                return position
                        except Exception as e:
                            log_info(f"[{self.task_id}] 截图识别失败: {e}")
                            self.stats['screenshot_failures'] += 1
                    
                    # 如果还有重试机会，等待后重试
                    if attempt < max_attempts - 1:
                        log_info(f"[{self.task_id}] 第{attempt + 1}次尝试失败，等待{retry_delay}秒后重试")
                        await asyncio.sleep(retry_delay)
                        # 清除缓存，强制重新识别
                        self.image_recognition.clear_cache()
                    else:
                        log_info(f"[{self.task_id}] 所有{max_attempts}次尝试都失败，无法找到图片: {image_path}")
                        self.stats['total_failures'] += 1
                        
                except Exception as e:
                    log_info(f"[{self.task_id}] 第{attempt + 1}次混合识别时发生错误: {e}")
                    if attempt < max_attempts - 1:
                        await asyncio.sleep(retry_delay)
                        continue
                    else:
                        log_info(f"[{self.task_id}] 所有重试都失败，返回None")
                        self.stats['total_failures'] += 1
                        return None
            
            return None
    
    async def click_image(self, page, image_path: str, confidence: float = None, 
                         timeout: int = None) -> bool:
        """点击图片，使用任务隔离确保并发安全"""
        position = await self.find_image(page, image_path, confidence, timeout)
        if position:
            try:
                # 使用锁机制确保点击操作的原子性
                async with self._lock:
                    await page.mouse.click(position[0], position[1])
                    log_info(f"[{self.task_id}] 点击图片成功: {image_path} at {position}")
                    return True
            except Exception as e:
                log_info(f"[{self.task_id}] 点击图片失败: {image_path}, 错误: {e}")
                return False
        return False
    
    def get_image_stats(self) -> Dict[str, Any]:
        """获取图片识别统计信息，包含任务ID"""
        total_attempts = self.stats['total_attempts']
        if total_attempts == 0:
            success_rate = 0.0
        else:
            total_success = self.stats['screenshot_success'] + self.stats['pyautogui_success']
            success_rate = total_success / total_attempts
        
        return {
            'task_id': self.task_id,
            'screenshot_success': self.stats['screenshot_success'],
            'pyautogui_success': self.stats['pyautogui_success'],
            'total_attempts': total_attempts,
            'success_rate': success_rate
        }
    
    def reset_stats(self):
        """重置统计信息"""
        self.stats = {
            'screenshot_success': 0, 
            'pyautogui_success': 0, 
            'total_attempts': 0,
            'screenshot_failures': 0,
            'pyautogui_failures': 0,
            'total_failures': 0,
            'task_id': self.task_id
        }
        log_info(f"[{self.task_id}] 统计信息已重置")
    
    async def _find_with_screenshot(self, page, image_path: str, confidence: float, 
                                  timeout: int) -> Optional[Tuple[int, int]]:
        """使用截图识别查找图片"""
        try:
            return await self.screenshot_recognition.find_image(
                page, image_path, confidence, timeout
            )
        except Exception as e:
            log_info(f"[{self.task_id}] 截图识别发生错误: {e}")
            return None
    
    def _find_with_pyautogui(self, image_path: str, confidence: float, region: Optional[Tuple[int, int, int, int]] = None) -> Optional[Tuple[int, int]]:
        """使用pyautogui查找图片（可限定区域）"""
        try:
            # 使用任务特定的日志标识
            log_info(f"[{self.task_id}] 使用pyautogui查找图片: {image_path}, 区域: {region}")
            if region:
                position = pyautogui.locateCenterOnScreen(image_path, confidence=confidence, region=region)
            else:
                position = pyautogui.locateCenterOnScreen(image_path, confidence=confidence)
            if position:
                log_info(f"[{self.task_id}] pyautogui找到图片: {image_path} at {position}")
                return (position.x, position.y)
            else:
                log_info(f"[{self.task_id}] pyautogui未找到图片: {image_path}")
                return None
        except Exception as e:
            log_info(f"[{self.task_id}] pyautogui查找图片时发生错误: {e}")
            return None
    
    def _build_image_path(self, image_path: str) -> str:
        """构建完整的图片路径"""
        if image_path.startswith('/') or ':' in image_path:
            return image_path
        return os.path.join(BASE_DIR, image_path)
    
    async def _get_window_region(self, page) -> Optional[Tuple[int, int, int, int]]:
        """获取当前页面窗口在屏幕坐标系下的区域，用于限定pyautogui搜索范围"""
        try:
            metrics = await page.evaluate("""
                () => ({
                    x: (window.screenX !== undefined ? window.screenX : (window.screenLeft || 0)),
                    y: (window.screenY !== undefined ? window.screenY : (window.screenTop || 0)),
                    width: (window.outerWidth || document.documentElement.clientWidth || window.innerWidth),
                    height: (window.outerHeight || document.documentElement.clientHeight || window.innerHeight)
                })
            """)
            margin = getattr(UIConfig, 'WINDOW_MARGIN', 50) or 0
            left = max(0, int(metrics['x']) + margin)
            top = max(0, int(metrics['y']) + margin)
            width = max(1, int(metrics['width']) - 2 * margin)
            height = max(1, int(metrics['height']) - 2 * margin)
            region = (left, top, width, height)
            log_info(f"[{self.task_id}] 计算窗口区域: {region}")
            return region
        except Exception as e:
            log_info(f"[{self.task_id}] 获取窗口区域失败，降级为全屏: {e}")
            return None 