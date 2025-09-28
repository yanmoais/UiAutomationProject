import asyncio
import time
import cv2
import numpy as np
from PIL import Image
import io
from datetime import datetime
from os import path
import uuid
import json
import re
import pyautogui
from typing import List, Dict, Any, Optional, Tuple
from playwright.async_api import Page, Browser, Locator
from playwright.async_api import expect
from config.logger import log_info
from utils.hybrid_image_manager import HybridImageManager
# 注释掉 scikit-image 导入，使用 OpenCV 替代
# from skimage.metrics import structural_similarity as ssim


class UIOperations:
    """UI操作封装 - 提供简洁的UI操作方法接口，支持任务隔离"""

    def __init__(self, page, task_id: str = None, hybrid_image_manager: HybridImageManager = None):
        self.page = page
        self.task_id = task_id or f"ui_task_{id(self)}"
        # 为每个实例创建独立的图片管理器
        self.image_manager = hybrid_image_manager or HybridImageManager(task_id=self.task_id)
        # 添加操作超时设置
        self.default_timeout = 30  # 默认30秒超时
        self.element_timeout = 30  # 元素操作超时10秒
        # 配置参数
        self.config = {
            'max_retry_attempts': 3,
            'retry_delay': 1.0,
            'tab_switch_delay': 0.5,  # 标签页切换延迟
            'tab_operation_timeout': 30  # 标签页操作超时时间
        }
        log_info(f"创建UIOperations实例: {self.task_id}")

    async def find_image(self, image_path: str, confidence: float = None,
                         timeout: int = None) -> Optional[Tuple[int, int]]:
        """查找图片"""
        return await self.image_manager.find_image(
            self.page, image_path, confidence, timeout
        )

    # async def wait_for_image(self, image_path: str, timeout: int = None,
    #                          confidence: float = None) -> Optional[Tuple[int, int]]:
    #     """等待图片出现"""
    #     return await self.image_manager.wait_for_image(
    #         self.page, image_path, timeout, confidence
    #     )

    async def click_image(self, image_path: str, confidence: float = None,
                          timeout: int = None) -> bool:
        """点击图片"""
        return await self.image_manager.click_image(
            self.page, image_path, confidence, timeout
        )

    async def click_image_with_fallback(self, image_path: str, confidence: float = None,
                                        timeout: int = None, max_retries: int = None) -> bool:
        """
        查找并点击图片，支持混合识别和重试机制

        Args:
            image_path: 图片路径
            confidence: 匹配置信度
            timeout: 超时时间
            max_retries: 最大重试次数

        Returns:
            bool: 是否成功点击
        """
        if max_retries is None:
            max_retries = self.config.get('max_retry_attempts', 3)

        for attempt in range(max_retries):
            try:
                log_info(f"[{self.task_id}] 第{attempt + 1}次尝试查找并点击图片: {image_path}")

                # 使用图片识别管理器
                position = await self.image_manager.find_image(
                    self.page, image_path, confidence, timeout
                )

                if position:
                    # 找到图片，执行点击
                    x, y = position
                    # 适配DPI/缩放：Playwright点击使用CSS像素，截图坐标为设备像素，需要按devicePixelRatio换算
                    try:
                        dpr = await self.page.evaluate('window.devicePixelRatio')
                    except Exception:
                        dpr = 1.0
                    x_css = int(x / (dpr if dpr else 1.0))
                    y_css = int(y / (dpr if dpr else 1.0))
                    log_info(f"[{self.task_id}] 准备点击图片: {image_path}, 截图坐标: ({x}, {y}), DPR: {dpr}, 点击坐标(CSS): ({x_css}, {y_css})")
                    
                    # 确保标签页在最前并获得焦点
                    try:
                        await self.page.bring_to_front()
                        await asyncio.sleep(0.05)
                    except Exception:
                        pass
                    
                    # 尝试多种点击方式
                    click_success = False
                    
                    try:
                        # 方式1: 标准Playwright点击
                        await self.page.mouse.click(x_css, y_css)
                        log_info(f"[{self.task_id}] Playwright点击完成: ({x_css}, {y_css})")
                        click_success = True
                        
                        # 等待一下，看是否有页面变化
                        await asyncio.sleep(0.5)
                        
                    except Exception as e:
                        log_info(f"[{self.task_id}] Playwright点击失败: {e}")
                    
                    # 方式2: 如果标准点击失败，尝试带选项的点击
                    if not click_success:
                        try:
                            await self.page.mouse.click(x_css, y_css, button='left', click_count=1)
                            log_info(f"[{self.task_id}] 带选项的Playwright点击完成: ({x_css}, {y_css})")
                            click_success = True
                            await asyncio.sleep(0.5)
                        except Exception as e:
                            log_info(f"[{self.task_id}] 带选项的Playwright点击失败: {e}")
                    
                    # 方式3: 尝试先移动鼠标再点击
                    if not click_success:
                        try:
                            await self.page.mouse.move(x_css, y_css)
                            await asyncio.sleep(0.1)
                            await self.page.mouse.down()
                            await asyncio.sleep(0.1)
                            await self.page.mouse.up()
                            log_info(f"[{self.task_id}] 分步点击完成: ({x_css}, {y_css})")
                            click_success = True
                            await asyncio.sleep(0.5)
                        except Exception as e:
                            log_info(f"[{self.task_id}] 分步点击失败: {e}")
                    
                    # 方式4: 最后备用方案 - 使用PyAutoGUI重新查找并点击（限定到当前窗口区域）
                    if not click_success:
                        try:
                            log_info(f"[{self.task_id}] 尝试PyAutoGUI备用点击方案")
                            # 使用pyautogui重新查找图片位置
                            base_conf = self.image_manager.config.get('confidence', 0.5)
                            py_conf = (confidence if confidence is not None else base_conf) * 0.8
                            # clamp到(0,1]
                            if py_conf <= 0 or py_conf > 1:
                                py_conf = max(0.1, min(py_conf, 1.0))
                            region = await self._get_window_region()
                            if region:
                                pyautogui_pos = pyautogui.locateCenterOnScreen(image_path, confidence=py_conf, region=region)
                            else:
                                pyautogui_pos = pyautogui.locateCenterOnScreen(image_path, confidence=py_conf)
                            if pyautogui_pos:
                                pyautogui.click(pyautogui_pos.x, pyautogui_pos.y)
                                log_info(f"[{self.task_id}] PyAutoGUI点击完成: ({pyautogui_pos.x}, {pyautogui_pos.y})")
                                click_success = True
                                await asyncio.sleep(0.5)
                            else:
                                log_info(f"[{self.task_id}] PyAutoGUI也未找到图片")
                        except Exception as e:
                            log_info(f"[{self.task_id}] PyAutoGUI点击失败: {e}")
                    
                    if click_success:
                        log_info(f"[{self.task_id}] 图片点击成功: {image_path}, 点击坐标(CSS): ({x_css}, {y_css})")
                        return True
                    else:
                        log_info(f"[{self.task_id}] 所有点击方式都失败了: {image_path}")
                        continue
                else:
                    log_info(f"[{self.task_id}] 第{attempt + 1}次尝试：没有找到图片 {image_path}")

                    # 如果还有重试机会，等待后重试
                    if attempt < max_retries - 1:
                        retry_delay = self.config.get('retry_delay', 1.0)
                        log_info(f"[{self.task_id}] 等待{retry_delay}秒后重试...")
                        await asyncio.sleep(retry_delay)
                    else:
                        log_info(f"[{self.task_id}] 所有{max_retries}次尝试都失败，无法找到图片")

            except Exception as e:
                log_info(f"[{self.task_id}] 第{attempt + 1}次图片定位失败: {e}")

                # 如果还有重试机会，等待后重试
                if attempt < max_retries - 1:
                    retry_delay = self.config.get('retry_delay', 1.0)
                    log_info(f"[{self.task_id}] 等待{retry_delay}秒后重试...")
                    await asyncio.sleep(retry_delay)
                else:
                    log_info(f"[{self.task_id}] 所有{max_retries}次尝试都失败")
                    raise Exception(f"图片定位失败：无法找到图片 {image_path}")

        return False

    def get_image_stats(self):
        """获取图片识别统计信息，包含任务ID"""
        return self.image_manager.get_image_stats()

    def reset_image_stats(self):
        """重置图片识别统计信息"""
        self.image_manager.reset_stats()

    async def type_text(self, text: str):
        """输入文本"""
        await self.page.keyboard.type(text)
        log_info(f"[{self.task_id}] 输入文本: {text}")

    async def press_key(self, key: str):
        """按键"""
        await self.page.keyboard.press(key)
        log_info(f"[{self.task_id}] 按键: {key}")

    async def click_element(self, selector: str):
        """点击元素"""
        await self.page.click(selector)
        log_info(f"[{self.task_id}] 点击元素: {selector}")

    async def navigate_to(self, url: str, timeout: int = 90000, max_retries: int = 3):
        """导航到URL，带重试机制"""
        last_error = None
        
        for attempt in range(max_retries):
            try:
                await self.page.goto(url, timeout=timeout, wait_until="domcontentloaded")
                log_info(f"[{self.task_id}] 导航到: {url} (尝试 {attempt + 1}/{max_retries} 成功), 超时时间: {timeout}ms")
                return  # 成功则直接返回
                
            except Exception as e:
                last_error = e
                error_msg = str(e)
                log_info(f"[{self.task_id}] 导航失败 (尝试 {attempt + 1}/{max_retries}): {error_msg}")
                
                # 检查是否是超时或网络错误
                is_timeout_error = any(keyword in error_msg.lower() for keyword in [
                    'timeout', 'timed_out', 'net::err_timed_out', 'net::err_connection_refused',
                    'net::err_name_not_resolved', 'net::err_internet_disconnected'
                ])
                
                if is_timeout_error and attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 2  # 递增等待时间: 2s, 4s, 6s
                    log_info(f"[{self.task_id}] 检测到网络超时错误，{wait_time}秒后进行第 {attempt + 2} 次重试")
                    await asyncio.sleep(wait_time)
                elif attempt < max_retries - 1:
                    log_info(f"[{self.task_id}] 1秒后进行第 {attempt + 2} 次重试")
                    await asyncio.sleep(1)
                else:
                    raise last_error

    # 计算当前页面窗口的屏幕区域（用于PyAutoGUI限定搜索）
    async def _get_window_region(self) -> Optional[Tuple[int, int, int, int]]:
        try:
            metrics = await self.page.evaluate(
                """
                () => ({
                    x: (window.screenX !== undefined ? window.screenX : (window.screenLeft || 0)),
                    y: (window.screenY !== undefined ? window.screenY : (window.screenTop || 0)),
                    width: (window.outerWidth || document.documentElement.clientWidth || window.innerWidth),
                    height: (window.outerHeight || document.documentElement.clientHeight || window.innerHeight)
                })
                """
            )
            margin = 50
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

    async def scroll_page(self, delta_x: int = 0, delta_y: int = 0):
        """滚动页面"""
        await self.page.mouse.wheel(delta_x, delta_y)
        log_info(f"[{self.task_id}] 页面滚动: delta_x={delta_x}, delta_y={delta_y}")

    def locator_element(self, element):
        return self.page.locator(element)

    async def elem_click(self, element):
        try:
            # 设置超时时间，防止无限等待
            return await asyncio.wait_for(
                self.locator_element(element).click(timeout=self.element_timeout * 1000),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素点击超时 ({self.element_timeout}秒): {element}")
            raise Exception(f"ELEMENT_CLICK_TIMEOUT: {element}")
        except Exception as e:
            # 检查是否是浏览器关闭导致的异常
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素点击失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_double_click(self, element):
        try:
            return await asyncio.wait_for(
                self.locator_element(element).dblclick(timeout=self.element_timeout * 1000),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素双击超时 ({self.element_timeout}秒): {element}")
            raise Exception(f"ELEMENT_DOUBLE_CLICK_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素双击失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_input(self, element, value):
        try:
            return await asyncio.wait_for(
                self.locator_element(element).fill(value, timeout=self.element_timeout * 1000),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素填充超时 ({self.element_timeout}秒): {element}")
            raise Exception(f"ELEMENT_FILL_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素填充失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_hover(self, element):
        try:
            return await asyncio.wait_for(
                self.locator_element(element).hover(timeout=self.element_timeout * 1000),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素悬停超时 ({self.element_timeout}秒): {element}")
            raise Exception(f"ELEMENT_HOVER_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素悬停失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_check(self, element):
        try:
            return await asyncio.wait_for(
                self.locator_element(element).check(timeout=self.element_timeout * 1000),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素勾选超时 ({self.element_timeout}秒): {element}")
            raise Exception(f"ELEMENT_CHECK_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素勾选失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_uncheck(self, element):
        try:
            return await asyncio.wait_for(
                self.locator_element(element).uncheck(timeout=self.element_timeout * 1000),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素取消勾选超时 ({self.element_timeout}秒): {element}")
            raise Exception(f"ELEMENT_UNCHECK_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素取消勾选失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_select_option(self, element, option):
        try:
            # 支持三种格式：value=xxx | label=xxx | index=2
            kwargs = {}
            if isinstance(option, str):
                opt = option.strip()
                if opt.startswith('value='):
                    kwargs['value'] = opt.split('=', 1)[1]
                elif opt.startswith('label='):
                    kwargs['label'] = opt.split('=', 1)[1]
                elif opt.startswith('index='):
                    try:
                        kwargs['index'] = int(opt.split('=', 1)[1])
                    except:
                        kwargs['index'] = 0
                else:
                    kwargs['label'] = opt
            else:
                kwargs['label'] = str(option)

            return await asyncio.wait_for(
                self.locator_element(element).select_option(**kwargs, timeout=self.element_timeout * 1000),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 选择下拉项超时 ({self.element_timeout}秒): {element} -> {option}")
            raise Exception(f"ELEMENT_SELECT_OPTION_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，选择下拉项失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_drag_and_drop(self, source_element, target_selector):
        try:
            source = self.locator_element(source_element)
            target = self.locator_element(target_selector)
            return await asyncio.wait_for(
                source.drag_to(target, timeout=self.element_timeout * 1000),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素拖拽超时 ({self.element_timeout}秒): {source_element} -> {target_selector}")
            raise Exception(f"ELEMENT_DRAG_AND_DROP_TIMEOUT: {source_element} -> {target_selector}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素拖拽失败: {source_element} -> {target_selector}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_press_key(self, element, key):
        try:
            # 如果提供了元素，先聚焦
            if element and element.strip():
                await asyncio.wait_for(
                    self.locator_element(element).focus(timeout=self.element_timeout * 1000),
                    timeout=self.element_timeout
                )
            # 兼容类似 "Control+S" 的组合键
            return await asyncio.wait_for(
                self.page.keyboard.press(key),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 按键操作超时 ({self.element_timeout}秒): {key}")
            raise Exception(f"PRESS_KEY_TIMEOUT: {key}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，按键操作失败: {key}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_login(self, email_selector, password_selector,submit_selector,email,password):
        try:
            # 解析传入参数：支持 JSON 字符串或 dict
            # 断言并依次填入
            if email_selector:
                await self.elem_assert_exists(email_selector)
                await self.elem_input(email_selector, email)
            if password_selector:
                await self.elem_assert_exists(password_selector)
                await self.elem_input(password_selector, password)
            if submit_selector:
                await self.elem_assert_exists(submit_selector)
                await self.elem_click(submit_selector)

            # 可选：提交后等待短暂稳定
            try:
                await asyncio.sleep(1)
            except Exception:
                pass

        except asyncio.TimeoutError:
            raise
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，登录流程失败")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def elem_register(self, email_selector=None, password_selector=None, repeat_password_selector=None, submit_selector=None, email=None, password=None):
        try:
            if email_selector:
                await self.elem_assert_exists(email_selector)
                await self.elem_input(email_selector, email)
            if password_selector:
                await self.elem_assert_exists(password_selector)
                await self.elem_input(password_selector, password)
            if repeat_password_selector:
                await self.elem_assert_exists(repeat_password_selector)
                await self.elem_input(repeat_password_selector, password)
            elif repeat_password_selector == "":
                pass
            if submit_selector:
                await self.elem_assert_exists(submit_selector)
                await self.elem_click(submit_selector)
            try:
                await asyncio.sleep(1)
            except Exception:
                pass
        except asyncio.TimeoutError:
            raise
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，注册流程失败")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def page_mouse_scroll(self,delta_x=0, delta_y=1100):
        try:
            return await asyncio.wait_for(
                self.page.mouse.wheel(delta_x, delta_y),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 页面滚动超时 ({self.element_timeout}秒)")
            raise Exception("PAGE_SCROLL_TIMEOUT")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，页面滚动失败")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    async def context_text(self):
        try:
            return await asyncio.wait_for(
                self.page.content(),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 获取页面内容超时 ({self.element_timeout}秒)")
            raise Exception("GET_CONTENT_TIMEOUT")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，获取页面内容失败")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e
    
    # 元素是否存在
    async def elem_assert_exists(self, element, timeout=30000):
        try:
            time.sleep(3)
            await asyncio.wait_for(
                expect(self.locator_element(element)).to_be_visible(timeout=timeout),
                timeout=timeout/1000 + 5  # 比playwright的超时多5秒
            )
            log_info(f"[{self.task_id}] 元素是否存在断言成功: {element}")
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素是否存在断言超时: {element}")
            raise Exception(f"ELEMENT_ASSERT_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素断言失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            log_info(f"[{self.task_id}] 元素是否存在断言失败: {element},请检查元素格式！")
            raise e
    
    # URL是否存在
    async def url_assert_exists(self, url, timeout=30000):
        try:
            await asyncio.wait_for(
                expect(self.page).to_have_url(url, timeout=timeout),
                timeout=timeout/1000 + 5
            )
            log_info(f"[{self.task_id}] URL是否存在断言成功: {url}")
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] URL是否存在断言超时: {url}")
            raise Exception(f"URL_ASSERT_TIMEOUT: {url}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，URL断言失败: {url}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            log_info(f"[{self.task_id}] URL是否存在断言失败: {url},请检查URL格式！")
            raise e

    # 元素是否可见
    async def elem_assert_visible(self, element, timeout=30000):
        try:
            await asyncio.wait_for(
                expect(self.locator_element(element)).to_be_visible(timeout=timeout),
                timeout=timeout/1000 + 2
            )
            log_info(f"[{self.task_id}] 元素可见断言成功: {element}")
            return True
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素可见断言超时: {element}")
            raise Exception(f"ELEMENT_VISIBLE_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素可见断言失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            log_info(f"[{self.task_id}] 元素可见断言失败: {element},请检查元素格式！")
            raise e

    # 文本包含
    async def elem_assert_text_contains(self, element, text, timeout=30000):
        try:
            # 获取元素文本内容
            element_text = await asyncio.wait_for(
                self.locator_element(element).text_content(),
                timeout=timeout/1000 + 2
            )
            
            # 检查文本是否包含指定内容
            if element_text and text in element_text:
                log_info(f"[{self.task_id}] 文本包含断言成功")
                return True
            else:
                log_info(f"[{self.task_id}] 文本包含断言失败: 元素 {element} 文本 '{element_text}' 不包含 '{text}'")
                raise Exception(f"TEXT_CONTAINS_FAILED: 元素 {element} 不包含文本 '{text}'")
                
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 文本包含超时: {element}")
            raise Exception(f"TEXT_CONTAINS_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，文本包含失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e
    
    # 属性匹配
    async def elem_assert_attribute_match(self, element, attributevalue, timeout=30000):
        try:
            # 解析属性名和预期值 (格式: "属性名:预期值")
            if ':' not in attributevalue:
                raise Exception(f"属性验证格式错误，应为'属性名:预期值'，实际: {attributevalue}")
            
            attr_name, expected_value = attributevalue.split(':', 1)
            
            # 获取元素的属性值
            actual_value = await asyncio.wait_for(
                self.locator_element(element).get_attribute(attr_name),
                timeout=timeout/1000 + 2
            )
            
            # 检查属性值是否匹配
            if actual_value == expected_value:
                log_info(f"[{self.task_id}] 属性匹配断言成功: 元素 {element} 属性 {attr_name} = '{actual_value}'")
                return True
            else:
                log_info(f"[{self.task_id}] 属性匹配断言失败: 元素 {element} 属性 {attr_name} 实际值 '{actual_value}' 不等于预期值 '{expected_value}'")
                raise Exception(f"ATTRIBUTE_MATCH_FAILED: 元素 {element} 属性 {attr_name} 不匹配")
                
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 属性匹配超时: {element}")
            raise Exception(f"ATTRIBUTE_MATCH_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，属性匹配失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e
    
    # 元素数量
    async def elem_assert_count(self, element, elm_count, timeout=30000):
        try:
            # 获取元素数量
            actual_count = await asyncio.wait_for(
                self.locator_element(element).count(),
                timeout=timeout/1000 + 2
            )
            
            # 检查数量是否匹配
            if actual_count == elm_count:
                log_info(f"[{self.task_id}] 元素数量断言成功: 元素 {element} 数量 = {actual_count}")
                return True
            else:
                log_info(f"[{self.task_id}] 元素数量断言失败: 元素 {element} 实际数量 {actual_count} 不等于预期数量 {elm_count}")
                raise Exception(f"ELEMENT_COUNT_FAILED: 元素 {element} 数量不匹配，实际: {actual_count}, 预期: {elm_count}")
                
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 元素数量超时: {element}")
            raise Exception(f"ELEMENT_COUNT_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，元素数量失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e
    
    # 获取元素文本
    async def get_element_text(self, element):
        try:
            return await asyncio.wait_for(
                self.locator_element(element).text_content(),
                timeout=self.element_timeout
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 获取元素文本超时 ({self.element_timeout}秒): {element}")
            raise Exception(f"GET_TEXT_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，获取元素文本失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e
    
    # 等待元素
    async def wait_for_element(self, element, timeout=30000):
        try:
            return await asyncio.wait_for(
                self.locator_element(element).wait_for(timeout=timeout),
                timeout=timeout/1000 + 2
            )
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 等待元素超时: {element}")
            raise Exception(f"WAIT_ELEMENT_TIMEOUT: {element}")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 检测到浏览器连接异常，等待元素失败: {element}")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e
    
    # 浏览器是否关闭
    async def is_browser_closed(self):
        try:
            # 检查页面是否关闭
            if self.page.is_closed():
                return True

            # 尝试获取页面URL，如果浏览器关闭会抛出异常
            await asyncio.wait_for(self.page.url, timeout=1)
            return False
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                return True
            return False
    
    # 确保浏览器连接正常
    async def ensure_browser_connection(self):
        """确保浏览器连接正常"""
        try:
            if await self.is_browser_closed():
                raise Exception("BROWSER_CLOSED_BY_USER")

            # 快速检查浏览器响应性
            await asyncio.wait_for(self.page.url, timeout=2)
        except asyncio.TimeoutError:
            log_info(f"[{self.task_id}] 浏览器连接检查超时，可能已断开")
            raise Exception("BROWSER_CLOSED_BY_USER")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 浏览器连接已断开")
                raise Exception("BROWSER_CLOSED_BY_USER")
            raise e

    # 页面截图
    async def page_screenshot(self, func_name, test_step):
        try:
            # 检查浏览器是否关闭
            if await self.is_browser_closed():
                log_info(f"[{self.task_id}] 浏览器已关闭，无法进行截图")
                raise Exception("BROWSER_CLOSED_BY_USER")
            
            screenshot_path = path.join(path.dirname(path.dirname(__file__)), 'IMG_LOGS',
                                      f'{func_name}_{test_step}_{datetime.fromtimestamp(time.time()).strftime("%Y_%m_%d_%H_%M_%S")}.png')
            
            await self.page.screenshot(path=screenshot_path)
            log_info(f"[{self.task_id}] 测试步骤_{test_step}_截图成功保存: {screenshot_path}")
            return screenshot_path
            
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                log_info(f"[{self.task_id}] 截图失败: 浏览器连接已断开")
                raise Exception("BROWSER_CLOSED_BY_USER")
            else:
                log_info(f"[{self.task_id}] 截图失败: {e}")
                raise e 

    # 打开新标签页并导航到指定URL
    async def open_new_tab_and_navigate(self, url: str, timeout: int = 90000, max_retries: int = 3):
        """打开新标签页并导航到指定URL - 并发安全版本，带重试机制"""
        new_page = None
        last_error = None
        
        for attempt in range(max_retries):
            try:
                # 获取浏览器上下文
                context = self.page.context

                # 如果不是第一次尝试，且之前创建的页面存在，先关闭它
                if new_page is not None:
                    try:
                        await new_page.close()
                        log_info(f"[{self.task_id}] 关闭之前失败的标签页")
                    except:
                        pass

                # 创建新标签页
                new_page = await context.new_page()
                log_info(f"[{self.task_id}] 创建新标签页 (尝试 {attempt + 1}/{max_retries})")

                # 导航到目标URL
                await new_page.goto(url, timeout=timeout, wait_until="domcontentloaded")
                log_info(f"[{self.task_id}] 新标签页导航到: {url} (尝试 {attempt + 1}/{max_retries} 成功)")

                # 等待页面完全加载
                try:
                    await new_page.wait_for_load_state("networkidle", timeout=15000)
                    log_info(f"[{self.task_id}] 新标签页页面加载完成")
                except:
                    log_info(f"[{self.task_id}] 新标签页网络空闲等待超时，继续执行")

                # 等待页面切换稳定
                await asyncio.sleep(self.config['tab_switch_delay'])

                # 切换到新标签页（更新当前页面引用）
                self.page = new_page
                log_info(f"[{self.task_id}] 已切换到新标签页: {url}")
                return new_page

            except Exception as e:
                last_error = e
                error_msg = str(e)
                log_info(f"[{self.task_id}] 打开新标签页失败 (尝试 {attempt + 1}/{max_retries}): {error_msg}")
                
                # 检查是否是超时或网络错误
                is_timeout_error = any(keyword in error_msg.lower() for keyword in [
                    'timeout', 'timed_out', 'net::err_timed_out', 'net::err_connection_refused',
                    'net::err_name_not_resolved', 'net::err_internet_disconnected'
                ])
                
                if is_timeout_error and attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 2  # 递增等待时间: 2s, 4s, 6s
                    log_info(f"[{self.task_id}] 检测到网络超时错误，{wait_time}秒后进行第 {attempt + 2} 次重试")
                    await asyncio.sleep(wait_time)
                elif attempt < max_retries - 1:
                    log_info(f"[{self.task_id}] 1秒后进行第 {attempt + 2} 次重试")
                    await asyncio.sleep(1)
                else:
                    # 最后一次尝试失败，清理资源并抛出异常
                    if new_page is not None:
                        try:
                            await new_page.close()
                        except:
                            pass
                    log_info(f"[{self.task_id}] 所有重试尝试均失败，放弃打开新标签页")
                    raise last_error
        
        # 如果所有重试都失败了，抛出最后一个错误
        raise last_error

    # 根据URL切换到指定标签页
    async def switch_to_tab_by_url(self, target_url: str):
        """根据URL切换到指定标签页 - 并发安全版本"""
        try:
            context = self.page.context
            pages = context.pages

            # 添加超时机制
            start_time = time.time()
            timeout = self.config['tab_operation_timeout']

            while time.time() - start_time < timeout:
                for page in pages:
                    try:
                        # 检查页面是否仍然有效
                        if page.is_closed():
                             continue

                        if target_url in page.url:
                            # 安全地切换到目标页面
                            await page.bring_to_front()
                            await asyncio.sleep(self.config['tab_switch_delay'])

                            # 验证切换是否成功
                            current_url = page.url
                            if target_url in current_url:
                                self.page = page
                                log_info(f"[{self.task_id}] 切换到标签页: {page.url}")
                                return page
                    except Exception as page_error:
                        log_info(f"[{self.task_id}] 检查页面时出错: {page_error}")
                        continue

                # 如果没找到，等待一段时间后重试
                await asyncio.sleep(0.5)
                # 刷新页面列表
                pages = context.pages

            log_info(f"[{self.task_id}] 超时：未找到包含URL的标签页: {target_url}")
            return None

        except Exception as e:
            log_info(f"[{self.task_id}] 切换标签页失败: {e}")
            raise e

    # 获取所有标签页信息
    async def get_all_tabs(self):
        """获取所有标签页信息 - 并发安全版本"""
        try:
            context = self.page.context
            pages = context.pages

            tabs_info = []
            for i, page in enumerate(pages):
                try:
                    if not page.is_closed():
                        tabs_info.append({
                            'index': i,
                            'url': page.url,
                            'title': await page.title()
                        })
                except Exception as page_error:
                    log_info(f"[{self.task_id}] 获取页面信息时出错: {page_error}")
                    continue

            log_info(f"[{self.task_id}] 当前共有 {len(tabs_info)} 个标签页")
            return tabs_info

        except Exception as e:
            log_info(f"[{self.task_id}] 获取标签页信息失败: {e}")
            return []

    # =============================================================================
    # 图片断言方法
    # =============================================================================
    
    async def image_assert_exists(self, image_path: str, confidence: float = 0.8, 
                                  timeout: int = 10) -> bool:
        """
        图片断言：检查图片是否存在于当前页面
        
        Args:
            image_path: 模板图片路径
            confidence: 匹配置信度 (0-1)
            timeout: 超时时间（秒）
            
        Returns:
            bool: 图片是否存在
            
        Raises:
            AssertionError: 图片不存在时抛出断言错误
        """
        try:
            log_info(f"[{self.task_id}] 图片断言 - 检查图片是否存在: {image_path}")
            position = await self.find_image(image_path, confidence, timeout)
            
            if position:
                log_info(f"[{self.task_id}] 图片断言成功 - 图片存在: {image_path}, 位置: {position}")
                return True
            else:
                error_msg = f"图片断言失败 - 图片不存在: {image_path}"
                log_info(f"[{self.task_id}] {error_msg}")
                raise AssertionError(error_msg)
                
        except Exception as e:
            if isinstance(e, AssertionError):
                raise
            error_msg = f"图片断言执行失败: {image_path}, 错误: {e}"
            log_info(f"[{self.task_id}] {error_msg}")
            raise AssertionError(error_msg)
    
    async def image_assert_mse(self, reference_image_path: str, threshold: float = 100.0,
                               screenshot_area: dict = None) -> bool:
        """
        图片断言：使用均方误差(MSE)比较当前页面截图与参考图片
        
        Args:
            reference_image_path: 参考图片路径
            threshold: MSE阈值，低于此值认为图片相似
            screenshot_area: 截图区域 {"x": 0, "y": 0, "width": 800, "height": 600}
            
        Returns:
            bool: 图片是否相似
            
        Raises:
            AssertionError: 图片差异超过阈值时抛出断言错误
        """
        try:
            
            log_info(f"[{self.task_id}] 图片断言 - MSE比较: {reference_image_path}, 阈值: {threshold}")
            
            # 获取页面截图
            if screenshot_area:
                screenshot_bytes = await self.page.screenshot(
                    clip=screenshot_area,
                    type='png'
                )
            else:
                screenshot_bytes = await self.page.screenshot(type='png')
            
            # 转换截图为OpenCV格式
            screenshot_image = Image.open(io.BytesIO(screenshot_bytes))
            screenshot_cv = cv2.cvtColor(np.array(screenshot_image), cv2.COLOR_RGB2BGR)
            
            # 读取参考图片
            reference_cv = cv2.imread(reference_image_path)
            if reference_cv is None:
                raise FileNotFoundError(f"无法读取参考图片: {reference_image_path}")
            
            # 调整图片尺寸使其一致
            height, width = reference_cv.shape[:2]
            screenshot_cv = cv2.resize(screenshot_cv, (width, height))
            
            # 计算MSE
            mse = np.mean((screenshot_cv - reference_cv) ** 2)
            
            if mse <= threshold:
                log_info(f"[{self.task_id}] 图片断言成功 - MSE: {mse:.2f} <= {threshold}")
                return True
            else:
                error_msg = f"图片断言失败 - MSE: {mse:.2f} > {threshold}"
                log_info(f"[{self.task_id}] {error_msg}")
                raise AssertionError(error_msg)
                
        except Exception as e:
            if isinstance(e, AssertionError):
                raise
            error_msg = f"图片MSE断言执行失败: {reference_image_path}, 错误: {e}"
            log_info(f"[{self.task_id}] {error_msg}")
            raise AssertionError(error_msg)
    
    async def image_assert_ssim(self, reference_image_path: str, threshold: float = 0.8,
                                screenshot_area: dict = None) -> bool:
        """
        图片断言：使用结构相似性指数(SSIM)比较当前页面截图与参考图片
        使用OpenCV实现SSIM计算，避免依赖scikit-image
        
        Args:
            reference_image_path: 参考图片路径
            threshold: SSIM阈值，高于此值认为图片相似
            screenshot_area: 截图区域
            
        Returns:
            bool: 图片是否相似
            
        Raises:
            AssertionError: 图片相似度低于阈值时抛出断言错误
        """
        try:
            log_info(f"[{self.task_id}] 图片断言 - SSIM比较: {reference_image_path}, 阈值: {threshold}")
            
            def calculate_ssim(img1, img2):
                """使用OpenCV计算SSIM"""
                # 计算均值
                mu1 = cv2.GaussianBlur(img1.astype(np.float64), (11, 11), 1.5)
                mu2 = cv2.GaussianBlur(img2.astype(np.float64), (11, 11), 1.5)
                
                mu1_sq = mu1 * mu1
                mu2_sq = mu2 * mu2
                mu1_mu2 = mu1 * mu2
                
                # 计算方差和协方差
                sigma1_sq = cv2.GaussianBlur(img1.astype(np.float64) * img1.astype(np.float64), (11, 11), 1.5) - mu1_sq
                sigma2_sq = cv2.GaussianBlur(img2.astype(np.float64) * img2.astype(np.float64), (11, 11), 1.5) - mu2_sq
                sigma12 = cv2.GaussianBlur(img1.astype(np.float64) * img2.astype(np.float64), (11, 11), 1.5) - mu1_mu2
                
                # SSIM常数
                C1 = (0.01 * 255) ** 2
                C2 = (0.03 * 255) ** 2
                
                # 计算SSIM
                ssim_map = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))
                
                return np.mean(ssim_map)
            
            # 获取页面截图
            if screenshot_area:
                screenshot_bytes = await self.page.screenshot(
                    clip=screenshot_area,
                    type='png'
                )
            else:
                screenshot_bytes = await self.page.screenshot(type='png')
            
            # 转换截图为OpenCV格式
            screenshot_image = Image.open(io.BytesIO(screenshot_bytes))
            screenshot_cv = cv2.cvtColor(np.array(screenshot_image), cv2.COLOR_RGB2BGR)
            screenshot_gray = cv2.cvtColor(screenshot_cv, cv2.COLOR_BGR2GRAY)
            
            # 读取参考图片
            reference_cv = cv2.imread(reference_image_path)
            if reference_cv is None:
                raise FileNotFoundError(f"无法读取参考图片: {reference_image_path}")
            
            reference_gray = cv2.cvtColor(reference_cv, cv2.COLOR_BGR2GRAY)
            
            # 调整图片尺寸使其一致
            height, width = reference_gray.shape
            screenshot_gray = cv2.resize(screenshot_gray, (width, height))
            
            # 计算SSIM
            ssim_value = calculate_ssim(screenshot_gray, reference_gray)
            
            if ssim_value >= threshold:
                log_info(f"[{self.task_id}] 图片断言成功 - SSIM: {ssim_value:.4f} >= {threshold}")
                return True
            else:
                error_msg = f"图片断言失败 - SSIM: {ssim_value:.4f} < {threshold}"
                log_info(f"[{self.task_id}] {error_msg}")
                raise AssertionError(error_msg)
                
        except Exception as e:
            if isinstance(e, AssertionError):
                raise
            error_msg = f"图片SSIM断言执行失败: {reference_image_path}, 错误: {e}"
            log_info(f"[{self.task_id}] {error_msg}")
            raise AssertionError(error_msg)
    
    async def image_assert_perceptual_hash(self, reference_image_path: str, threshold: float = 10.0,
                                           screenshot_area: dict = None) -> bool:
        """
        图片断言：使用感知哈希比较当前页面截图与参考图片
        
        Args:
            reference_image_path: 参考图片路径
            threshold: 哈希距离阈值，低于此值认为图片相似
            screenshot_area: 截图区域
            
        Returns:
            bool: 图片是否相似
            
        Raises:
            AssertionError: 哈希距离超过阈值时抛出断言错误
        """
        try:
            
            log_info(f"[{self.task_id}] 图片断言 - 感知哈希比较: {reference_image_path}, 阈值: {threshold}")
            
            def calculate_perceptual_hash(image):
                """计算图片的感知哈希值"""
                # 转换为灰度图
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                # 缩放到8x8
                resized = cv2.resize(gray, (8, 8))
                # 计算平均值
                avg = resized.mean()
                # 生成哈希
                hash_bits = (resized > avg).astype(np.uint8)
                return hash_bits.flatten()
            
            def hamming_distance(hash1, hash2):
                """计算汉明距离"""
                return np.sum(hash1 != hash2)
            
            # 获取页面截图
            if screenshot_area:
                screenshot_bytes = await self.page.screenshot(
                    clip=screenshot_area,
                    type='png'
                )
            else:
                screenshot_bytes = await self.page.screenshot(type='png')
            
            # 转换截图为OpenCV格式
            screenshot_image = Image.open(io.BytesIO(screenshot_bytes))
            screenshot_cv = cv2.cvtColor(np.array(screenshot_image), cv2.COLOR_RGB2BGR)
            
            # 读取参考图片
            reference_cv = cv2.imread(reference_image_path)
            if reference_cv is None:
                raise FileNotFoundError(f"无法读取参考图片: {reference_image_path}")
            
            # 计算感知哈希
            screenshot_hash = calculate_perceptual_hash(screenshot_cv)
            reference_hash = calculate_perceptual_hash(reference_cv)
            
            # 计算汉明距离
            distance = hamming_distance(screenshot_hash, reference_hash)
            
            if distance <= threshold:
                log_info(f"[{self.task_id}] 图片断言成功 - 哈希距离: {distance} <= {threshold}")
                return True
            else:
                error_msg = f"图片断言失败 - 哈希距离: {distance} > {threshold}"
                log_info(f"[{self.task_id}] {error_msg}")
                raise AssertionError(error_msg)
                
        except Exception as e:
            if isinstance(e, AssertionError):
                raise
            error_msg = f"图片感知哈希断言执行失败: {reference_image_path}, 错误: {e}"
            log_info(f"[{self.task_id}] {error_msg}")
            raise AssertionError(error_msg)
    
    async def image_assert_template_match(self, template_path: str, confidence: float = 0.8,
                                          timeout: int = 10) -> bool:
        """
        图片断言：使用模板匹配检查图片是否存在（复用现有的click_image_with_fallback逻辑）
        
        Args:
            template_path: 模板图片路径
            confidence: 匹配置信度
            timeout: 超时时间
            
        Returns:
            bool: 模板是否匹配
            
        Raises:
            AssertionError: 模板不匹配时抛出断言错误
        """
        try:
            log_info(f"[{self.task_id}] 图片断言 - 模板匹配: {template_path}, 置信度: {confidence}")
            
            # 复用现有的图片查找逻辑
            position = await self.find_image(template_path, confidence, timeout)
            
            if position:
                log_info(f"[{self.task_id}] 图片断言成功 - 模板匹配: {template_path}, 位置: {position}")
                return True
            else:
                error_msg = f"图片断言失败 - 模板不匹配: {template_path}"
                log_info(f"[{self.task_id}] {error_msg}")
                raise AssertionError(error_msg)
                
        except Exception as e:
            if isinstance(e, AssertionError):
                raise
            error_msg = f"图片模板匹配断言执行失败: {template_path}, 错误: {e}"
            log_info(f"[{self.task_id}] {error_msg}")
            raise AssertionError(error_msg)

    # 自定义断言，如果是有目标元素、预期结果，则直接断言格式为 assert 目标元素.text == 预期结果
    async def elem_custom_assert(self, element, expected_text):
        """
        自定义断言：检查元素文本是否与预期文本匹配
        
        Args:
            element: 目标元素选择器
            expected_text: 预期文本
            
        Returns:
            bool: 是否匹配
            
        Raises:
            AssertionError: 文本不匹配时抛出断言错误
        """
        try:
            log_info(f"[{self.task_id}] 自定义断言: 检查元素文本是否与预期文本匹配: {element}, 预期文本: {expected_text}")
            # 获取元素文本
            element_text = await self.get_element_text(element)
            # 断言元素文本是否与预期文本匹配
            if element_text == expected_text:
                log_info(f"[{self.task_id}] 自定义断言成功: 元素文本与预期文本匹配: {element_text} == {expected_text}")
                return True
            else:
                error_msg = f"自定义断言失败: 元素文本与预期文本不匹配: {element_text} != {expected_text}"
                log_info(f"[{self.task_id}] {error_msg}")
                raise AssertionError(error_msg)
        except Exception as e:
            if isinstance(e, AssertionError):
                raise
            error_msg = f"自定义断言执行失败: {element}, 错误: {e}"
            log_info(f"[{self.task_id}] {error_msg}")
            raise AssertionError(error_msg)
