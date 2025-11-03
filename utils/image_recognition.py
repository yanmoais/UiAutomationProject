import cv2
import numpy as np
from PIL import Image
import io
import time
import asyncio
from typing import Optional, Tuple, Dict, Any, List
from config.ui_config import UIConfig
from config.logger import log_info

class ImageRecognition:
    """图片识别核心模块 - 基于Playwright截图的图片识别，支持任务隔离和多尺度匹配"""
    
    def __init__(self, task_id: str = None):
        self.task_id = task_id or f"img_rec_{id(self)}"
        # 为每个实例创建独立的缓存
        self.template_cache = {}
        self.screenshot_cache = {}
        self.last_screenshot_time = 0
        self.config = UIConfig.get_image_recognition_config()
        # 为每个实例创建独立的锁，避免并发冲突
        self._lock = asyncio.Lock()
        
        # 多尺度匹配配置
        # 优先使用配置中的多尺度参数；默认不放大，避免多实例时模板大于分屏截图
        self.scale_factors = getattr(UIConfig, 'SCALE_FACTORS', [1.0, 0.9, 0.8, 0.7, 0.6, 0.5])
        self.confidence_levels = getattr(UIConfig, 'CONFIDENCE_LEVELS', [0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2])
        self.absolute_min_confidence = getattr(UIConfig, 'MIN_ABSOLUTE_CONFIDENCE', 0.6)
        # 最近一次匹配信息（用于点击后再验证是否消失/移动）
        self.last_match_info: Dict[str, Any] = {
            'path': None,
            'position': None,
            'score': None,
            'scale': None,
            'threshold': None,
            'ts': 0.0,
        }
        
        log_info(f"创建ImageRecognition实例: {self.task_id}")
    
    async def find_image(self, page, template_path: str, confidence: float = None, 
                        timeout: int = None, use_cache: bool = True) -> Optional[Tuple[int, int]]:
        """
        在页面中查找图片，支持多尺度匹配和动态置信度调整
        
        Args:
            page: Playwright页面对象
            template_path: 模板图片路径
            confidence: 匹配置信度，如果为None则使用配置中的默认值
            timeout: 超时时间，如果为None则使用配置中的默认值
            use_cache: 是否使用缓存
            
        Returns:
            Optional[Tuple[int, int]]: 图片中心坐标 (x, y)，未找到返回None
        """
        if confidence is None:
            confidence = self.config['confidence']
        if timeout is None:
            timeout = self.config['timeout']
        
        max_attempts = self.config.get('max_retry_attempts', 5)
        retry_delay = self.config.get('retry_delay', 3.0)
        
        # 使用锁机制确保并发安全
        async with self._lock:
            for attempt in range(max_attempts):
                try:
                    log_info(f"[{self.task_id}] 第{attempt + 1}次尝试查找图片: {template_path}")
                    
                    # 获取页面截图
                    screenshot = await self._get_page_screenshot(page, use_cache)
                    if screenshot is None:
                        log_info(f"[{self.task_id}] 获取页面截图失败，尝试重试")
                        if attempt < max_attempts - 1:
                            await asyncio.sleep(retry_delay)
                            continue
                        return None
                    
                    # 智能多尺度匹配
                    position = self._smart_template_matching(screenshot, template_path, confidence, attempt)
                    if position:
                        log_info(f"[{self.task_id}] 图片查找成功: {template_path}, 位置: {position}")
                        return position
                    
                    # 如果还有重试机会，等待后重试
                    if attempt < max_attempts - 1:
                        log_info(f"[{self.task_id}] 第{attempt + 1}次尝试失败，等待{retry_delay}秒后重试")
                        await asyncio.sleep(retry_delay)
                        # 清除截图缓存，强制获取新截图
                        self.screenshot_cache.clear()
                        self.last_screenshot_time = 0
                    else:
                        log_info(f"[{self.task_id}] 所有{max_attempts}次尝试都失败，无法找到图片: {template_path}")
                        
                except Exception as e:
                    log_info(f"[{self.task_id}] 第{attempt + 1}次尝试时发生错误: {e}")
                    if attempt < max_attempts - 1:
                        await asyncio.sleep(retry_delay)
                        continue
                    else:
                        log_info(f"[{self.task_id}] 所有重试都失败，返回None")
                        return None
            
            return None

    async def quick_check_presence(self, page, template_path: str, confidence: float = None,
                                   scales: Optional[List[float]] = None) -> Optional[Tuple[int, int]]:
        """
        快速检测模板是否存在：单次截图，少量尺度，严格阈值。
        仅用于点击后验证/遮挡物检测，避免重试和复杂退避。
        """
        try:
            if confidence is None:
                confidence = self.config.get('confidence', 0.6)
            confidence = max(float(confidence), float(self.absolute_min_confidence))

            screenshot = await self._get_page_screenshot(page, use_cache=False)
            if screenshot is None:
                return None
            template = self._load_template(template_path)
            if template is None:
                return None
            template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
            screenshot_gray = cv2.cvtColor(screenshot, cv2.COLOR_BGR2GRAY)

            if not scales:
                scales = [1.0, 0.9, 0.8]

            for scale_factor in scales:
                # 尺度调整
                if scale_factor != 1.0:
                    h, w = template_gray.shape[:2]
                    new_h, new_w = int(h * scale_factor), int(w * scale_factor)
                    if new_h < 10 or new_w < 10:
                        continue
                    scaled_template = cv2.resize(template_gray, (new_w, new_h))
                else:
                    scaled_template = template_gray

                # 模板尺寸校验
                img_h, img_w = screenshot_gray.shape[:2]
                tpl_h, tpl_w = scaled_template.shape[:2]
                if tpl_h > img_h or tpl_w > img_w:
                    continue

                result = cv2.matchTemplate(screenshot_gray, scaled_template, cv2.TM_CCOEFF_NORMED)
                _min_val, max_val, _min_loc, max_loc = cv2.minMaxLoc(result)
                if max_val >= confidence:
                    center_x = max_loc[0] + tpl_w // 2
                    center_y = max_loc[1] + tpl_h // 2
                    return (int(center_x), int(center_y))
            return None
        except Exception as e:
            log_info(f"[{self.task_id}] 快速存在性检测失败: {e}")
            return None
    
    async def _get_page_screenshot(self, page, use_cache: bool = True) -> Optional[np.ndarray]:
        """获取页面截图，使用任务隔离的缓存"""
        try:
            current_time = time.time()
            
            # 检查缓存
            if use_cache and current_time - self.last_screenshot_time < self.config['screenshot_cache_timeout']:
                if 'last_screenshot' in self.screenshot_cache:
                    log_info(f"[{self.task_id}] 使用缓存的截图")
                    return self.screenshot_cache['last_screenshot']
            
            # 获取新截图
            log_info(f"[{self.task_id}] 获取新的页面截图")
            screenshot_bytes = await page.screenshot()
            screenshot_array = np.array(Image.open(io.BytesIO(screenshot_bytes)))
            screenshot_cv = cv2.cvtColor(screenshot_array, cv2.COLOR_RGB2BGR)
            
            # 更新缓存
            if use_cache:
                self.screenshot_cache['last_screenshot'] = screenshot_cv
                self.last_screenshot_time = current_time
                log_info(f"[{self.task_id}] 截图已缓存")
            
            return screenshot_cv
            
        except Exception as e:
            log_info(f"[{self.task_id}] 获取页面截图失败: {e}")
            return None
    
    def _smart_template_matching(self, screenshot: np.ndarray, template_path: str, 
                                base_confidence: float, attempt: int) -> Optional[Tuple[int, int]]:
        """
        智能模板匹配 - 结合多尺度匹配和动态置信度调整
        
        Args:
            screenshot: 页面截图
            template_path: 模板图片路径
            base_confidence: 基础置信度
            attempt: 当前尝试次数
            
        Returns:
            Optional[Tuple[int, int]]: 匹配位置，未找到返回None
        """
        try:
            # 加载模板图片
            template = self._load_template(template_path)
            if template is None:
                return None
            # 转灰度，增强跨分辨率鲁棒性
            template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
            
            # 根据尝试次数调整置信度策略，并与绝对最小置信度对齐
            confidence_strategy = [c for c in self._get_confidence_strategy(base_confidence, attempt) if c >= self.absolute_min_confidence]
            if not confidence_strategy:
                confidence_strategy = [self.absolute_min_confidence]
            
            # 多尺度匹配
            for scale_factor in self.scale_factors:
                # 缩放模板
                if scale_factor != 1.0:
                    h, w = template_gray.shape[:2]
                    new_h, new_w = int(h * scale_factor), int(w * scale_factor)
                    if new_h < 10 or new_w < 10:  # 避免模板过小
                        continue
                    scaled_template = cv2.resize(template_gray, (new_w, new_h))
                else:
                    scaled_template = template_gray
                
                # 使用不同置信度级别进行匹配
                for confidence_level in confidence_strategy:
                    position = self._find_template_at_scale(screenshot, scaled_template, 
                                                         template_path, confidence_level, scale_factor)
                    if position:
                        return position
            
            return None
            
        except Exception as e:
            log_info(f"[{self.task_id}] 智能模板匹配过程中发生错误: {e}")
            return None
    
    def _get_confidence_strategy(self, base_confidence: float, attempt: int) -> List[float]:
        """
        根据尝试次数获取置信度策略
        
        Args:
            base_confidence: 基础置信度
            attempt: 当前尝试次数
            
        Returns:
            List[float]: 置信度级别列表
        """
        if attempt == 0:
            # 第一次尝试：从高置信度开始，逐步降低，但不低于0.3
            return [base_confidence, max(0.3, base_confidence - 0.1), 
                   max(0.3, base_confidence - 0.2)]
        elif attempt == 1:
            # 第二次尝试：进一步降低置信度，但不低于0.3
            return [max(0.3, base_confidence - 0.2), max(0.3, base_confidence - 0.25),
                   max(0.3, base_confidence - 0.3)]
        else:
            # 后续尝试：使用最低置信度0.3，避免误报
            return [0.3]
    
    def _find_template_at_scale(self, screenshot: np.ndarray, template: np.ndarray, 
                               template_path: str, confidence: float, scale_factor: float) -> Optional[Tuple[int, int]]:
        """
        在指定尺度下查找模板
        
        Args:
            screenshot: 页面截图
            template: 模板图片
            template_path: 模板路径（用于日志）
            confidence: 匹配置信度
            scale_factor: 缩放因子
            
        Returns:
            Optional[Tuple[int, int]]: 匹配位置，未找到返回None
        """
        try:
            # 统一转灰度
            screenshot_gray = cv2.cvtColor(screenshot, cv2.COLOR_BGR2GRAY)
            # 在调用模板匹配前进行尺寸校验，模板必须不大于截图
            img_h, img_w = screenshot_gray.shape[:2]
            tpl_h, tpl_w = template.shape[:2]
            if tpl_h > img_h or tpl_w > img_w:
                scale_info = f" (缩放: {scale_factor:.1f})" if scale_factor != 1.0 else ""
                log_info(f"[{self.task_id}] 跳过该尺度，模板尺寸大于截图: 模板=({tpl_w}x{tpl_h}), 截图=({img_w}x{img_h}){scale_info}")
                return None
            # 模板匹配
            result = cv2.matchTemplate(screenshot_gray, template, cv2.TM_CCOEFF_NORMED)
            min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
            
            # 绝对最小置信度保护
            if max_val >= max(confidence, self.absolute_min_confidence):
                # 计算中心位置
                h, w = template.shape[:2]
                center_x = max_loc[0] + w // 2
                center_y = max_loc[1] + h // 2
                
                scale_info = f" (缩放: {scale_factor:.1f})" if scale_factor != 1.0 else ""
                
                # 置信度安全检查：如果置信度过低，发出警告
                if max_val < max(0.65, self.absolute_min_confidence):
                    log_info(f"[{self.task_id}] ⚠️ 警告：置信度较低可能误匹配！{template_path}, 置信度: {max_val:.3f}, 阈值: {confidence}{scale_info}")
                else:
                    log_info(f"[{self.task_id}] 模板匹配成功: {template_path}, 置信度: {max_val:.3f}, 阈值: {confidence}{scale_info}")
                
                # 记录最近一次匹配信息
                self.last_match_info.update({
                    'path': template_path,
                    'position': (int(center_x), int(center_y)),
                    'score': float(max_val),
                    'scale': float(scale_factor),
                    'threshold': float(confidence),
                    'ts': time.time(),
                })
                return (int(center_x), int(center_y))
            else:
                scale_info = f" (缩放: {scale_factor:.1f})" if scale_factor != 1.0 else ""
                log_info(f"[{self.task_id}] 模板匹配失败: {template_path}, 置信度: {max_val:.3f}, 阈值: {confidence}{scale_info}")
                return None
                
        except Exception as e:
            log_info(f"[{self.task_id}] 指定尺度模板匹配过程中发生错误: {e}")
            return None
    
    def _load_template(self, template_path: str) -> Optional[np.ndarray]:
        """加载模板图片，使用任务隔离的缓存"""
        try:
            # 规范化路径，避免路径分隔符混用导致cv2.imread失败
            import os
            normalized_path = os.path.normpath(template_path)
            
            # 检查缓存（使用规范化路径作为key）
            if normalized_path in self.template_cache:
                log_info(f"[{self.task_id}] 使用缓存的模板: {normalized_path}")
                return self.template_cache[normalized_path]
            
            # 加载新模板
            log_info(f"[{self.task_id}] 加载新模板: {normalized_path}")
            template = cv2.imread(normalized_path)
            if template is not None:
                self.template_cache[normalized_path] = template
                log_info(f"[{self.task_id}] 模板已缓存: {normalized_path}")
                return template
            else:
                log_info(f"[{self.task_id}] 无法加载模板: {normalized_path}")
                return None
                
        except Exception as e:
            log_info(f"[{self.task_id}] 加载模板时发生错误: {e}")
            return None
    
    def clear_cache(self):
        """清理缓存"""
        self.template_cache.clear()
        self.screenshot_cache.clear()
        self.last_screenshot_time = 0
        log_info(f"[{self.task_id}] 缓存已清理")
    
    def get_cache_info(self) -> Dict[str, Any]:
        """获取缓存信息"""
        return {
            'task_id': self.task_id,
            'template_cache_size': len(self.template_cache),
            'screenshot_cache_size': len(self.screenshot_cache),
            'last_screenshot_time': self.last_screenshot_time
        } 