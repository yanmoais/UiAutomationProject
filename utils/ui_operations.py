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
            'max_retry_attempts': 5,
            'retry_delay': 3.0,  # 增加到3秒，给页面更多加载时间（特别是处理长时间动画/滚动的场景）
            'tab_switch_delay': 0.5,  # 标签页切换延迟
            'tab_operation_timeout': 30,  # 标签页操作超时时间
            # 页面稳定性检测阈值（秒）
            'min_quiet_seconds': 1.2,
            'network_quiet_seconds': 0.8,
            'dom_quiet_seconds': 0.8,
            'visual_checks_required': 3,
            # 点击效果验证相关
            'click_effect_timeout': 2,  # 点击后效果验证超时（秒）
            'dom_recent_ms_threshold': 250,  # 认为DOM有变更的"最近时间"阈值（毫秒）
            'visual_hash_distance_threshold': 4,  # ROI视觉变化的最小汉明距离
            'roi_side': 96,  # ROI正方形边长（像素）
            'template_move_min_distance': 16  # 模板被点击后至少移动的像素距离（CSS）
        }
        log_info(f"创建UIOperations实例: {self.task_id}")

        # 网络活动统计（基于Playwright事件）
        self._inflight_requests = 0
        self._last_network_activity = time.time()
        self._network_listeners_attached = False
        try:
            self._setup_network_listeners()
        except Exception as e:
            log_info(f"[{self.task_id}] 初始化网络监听失败: {e}")

    def _setup_network_listeners(self):
        if getattr(self, '_network_listeners_attached', False):
            return

        def _on_req(req):
            try:
                rt = getattr(req, 'resource_type', lambda: None)
                rt_val = rt() if callable(rt) else rt
                # 统计主要会影响页面稳定的资源类型
                interested = {'document', 'xhr', 'fetch', 'script', 'stylesheet'}
                if rt_val in interested or rt_val is None:
                    self._inflight_requests += 1
                    self._last_network_activity = time.time()
            except Exception:
                pass

        def _on_req_done(_req):
            try:
                self._inflight_requests = max(0, self._inflight_requests - 1)
                self._last_network_activity = time.time()
            except Exception:
                pass

        try:
            self.page.on("request", _on_req)
            self.page.on("requestfinished", _on_req_done)
            self.page.on("requestfailed", _on_req_done)
            self._network_listeners_attached = True
        except Exception as e:
            log_info(f"[{self.task_id}] 绑定网络事件失败: {e}")

    async def _install_stability_observers(self):
        try:
            await self.page.evaluate(
                """
                () => {
                  if (!window.__ui_auto_stability) {
                    const state = {
                      lastMutationTs: performance.now(),
                      domContentLoadedTs: (document.readyState === 'loading' ? 0 : performance.now()),
                      loadTs: 0
                    };
                    try {
                      const mo = new MutationObserver(() => {
                        state.lastMutationTs = performance.now();
                      });
                      mo.observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
                    } catch (e) {}
                    try {
                      document.addEventListener('DOMContentLoaded', () => { state.domContentLoadedTs = state.domContentLoadedTs || performance.now(); }, { once: true });
                      window.addEventListener('load', () => { state.loadTs = performance.now(); }, { once: true });
                    } catch (e) {}
                    window.__ui_auto_stability = state;
                  }
                  return {
                    readyState: document.readyState,
                    now: performance.now(),
                    lastMutationTs: window.__ui_auto_stability.lastMutationTs,
                    domContentLoadedTs: window.__ui_auto_stability.domContentLoadedTs,
                    loadTs: window.__ui_auto_stability.loadTs
                  };
                }
                """
            )
        except Exception as e:
            log_info(f"[{self.task_id}] 安装DOM稳定性观察器失败: {e}")

    async def _get_dom_state(self):
        try:
            return await self.page.evaluate(
                """
                () => {
                  const s = window.__ui_auto_stability;
                  const now = performance.now();
                  return {
                    domQuietMs: s ? (now - s.lastMutationTs) : 0,
                    readyState: document.readyState
                  };
                }
                """
            )
        except Exception as e:
            log_info(f"[{self.task_id}] 读取DOM状态失败: {e}")
            return {'domQuietMs': 0, 'readyState': 'unknown'}

    async def _capture_roi_hash(self, x_css: int, y_css: int, side: int = None):
        try:
            if side is None:
                side = int(self.config.get('roi_side', 96))
            # 防止截图区域越界
            viewport = await self.page.evaluate(
                "() => ({ w: window.innerWidth, h: window.innerHeight })"
            )
            vw = int(viewport.get('w', 0) or 0)
            vh = int(viewport.get('h', 0) or 0)
            half = max(16, side // 2)
            left = max(0, min(int(x_css - half), max(0, vw - side)))
            top = max(0, min(int(y_css - half), max(0, vh - side)))

            clip = { 'x': left, 'y': top, 'width': side, 'height': side }
            roi_bytes = await self.page.screenshot(clip=clip, type='png')
            roi_img = Image.open(io.BytesIO(roi_bytes)).convert('L').resize((8, 8))
            arr = np.array(roi_img, dtype=np.float32)
            avg = float(arr.mean())
            return (arr > avg).astype(np.uint8).flatten()
        except Exception as e:
            log_info(f"[{self.task_id}] 获取ROI哈希失败: {e}")
            return None

    async def _verify_click_effect(self, x_css: int, y_css: int, pre_hash, pre_inflight: int,
                                   pre_last_net: float, effect_timeout: float = None,
                                   template_path: Optional[str] = None) -> bool:
        if effect_timeout is None:
            effect_timeout = float(self.config.get('click_effect_timeout', 2.5))
        start = time.time()
        seen_net = False
        seen_dom = False
        seen_vis = False
        # 模板验证辅助
        template_disappeared = False
        template_moved = False
        last_presence_check = 0.0
        while time.time() - start < effect_timeout:
            try:
                inflight = int(self._inflight_requests)
                last_net = float(self._last_network_activity)
                if inflight > pre_inflight or last_net > pre_last_net:
                    seen_net = True
            except Exception:
                pass

            try:
                dom_state = await self._get_dom_state()
                dom_recent_ms = float(self.config.get('dom_recent_ms_threshold', 250))
                if dom_state.get('domQuietMs', 0) < dom_recent_ms:  # 近期内有DOM变更
                    seen_dom = True
            except Exception:
                pass

            try:
                curr_hash = await self._capture_roi_hash(x_css, y_css)
                if pre_hash is not None and curr_hash is not None:
                    dist = int(np.sum(curr_hash != pre_hash))
                    visual_th = int(self.config.get('visual_hash_distance_threshold', 4))
                    if dist >= visual_th:  # ROI明显变化
                        seen_vis = True
            except Exception:
                pass

            # 轻量模板存在性复检（每0.4s）
            if template_path and (time.time() - last_presence_check) >= 0.4:
                last_presence_check = time.time()
                try:
                    strict_conf = max(0.7, float(getattr(self.image_manager.image_recognition, 'absolute_min_confidence', 0.6)))
                    pos = await self.image_manager.image_recognition.quick_check_presence(
                        self.page, template_path, confidence=strict_conf, scales=[1.0, 0.9]
                    )
                    if pos is None:
                        template_disappeared = True
                    else:
                        dx = float(pos[0] - x_css)
                        dy = float(pos[1] - y_css)
                        move_dist = (dx * dx + dy * dy) ** 0.5
                        if move_dist >= float(self.config.get('template_move_min_distance', 16)):
                            template_moved = True
                except Exception:
                    pass

            # 成功条件严化：DOM+视觉 或 视觉+时间 或 模板消失/明显位移
            if (seen_dom and seen_vis) or (seen_vis and (time.time() - start) > 0.4) or template_disappeared or template_moved:
                if template_disappeared:
                    reason = 'template_disappeared'
                elif template_moved:
                    reason = 'template_moved'
                else:
                    reason = 'dom+visual' if (seen_dom and seen_vis) else 'visual+time'
                log_info(f"[{self.task_id}] 点击效果验证通过: 原因={reason} 网络={seen_net} DOM={seen_dom} 视觉={seen_vis}")
                return True

            await asyncio.sleep(0.2)

        log_info(f"[{self.task_id}] 点击效果验证失败: 在{effect_timeout}s内未检测到有效变化")
        return False

    async def wait_for_page_stable(self, timeout: int = 10, check_interval: float = 2, *, strict: bool = True) -> bool:
        """
        等待页面稳定（融合多信号：网络空闲 + DOM静止 + 视觉稳定）

        Args:
            timeout: 最大等待时间（秒）
            check_interval: 检查间隔（秒）
            strict: 严格模式；为True时要求视觉连续多次稳定且网络/DOM同时满足，
                    为False时放宽到两项满足即可，避免永远等待

        Returns:
            bool: 页面是否稳定
        """
        try:
            log_info(f"[{self.task_id}] 开始等待页面稳定，超时时间: {timeout}秒 严格模式:{strict}")
            start_time = time.time()

            # 安装DOM观察器（一次性）
            await self._install_stability_observers()

            # 尝试短暂等待浏览器层面的空闲（软等待，不抛异常）
            try:
                await self.page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass

            min_quiet = float(self.config.get('min_quiet_seconds', 1.2))
            net_quiet = float(self.config.get('network_quiet_seconds', 0.8))
            dom_quiet = float(self.config.get('dom_quiet_seconds', 0.8))
            visual_required = int(self.config.get('visual_checks_required', 3))

            visual_stable_count = 0
            stalled_ticks = 0  # 卡死检测：连续若干次无网络/DOM/视觉变化则认为停滞
            last_dist = None
            prev_hash = None

            while time.time() - start_time < timeout:
                now_py = time.time()

                # 读取页面状态（readyState/DOM静止时间戳）
                page_state = None
                try:
                    page_state = await self.page.evaluate(
                        """
                        () => {
                          const s = window.__ui_auto_stability;
                          const now = performance.now();
                          return {
                            readyState: document.readyState,
                            domQuietMs: s ? (now - s.lastMutationTs) : 0,
                            domContentLoaded: s ? (s.domContentLoadedTs > 0) : (document.readyState !== 'loading'),
                            loadFired: s ? (s.loadTs > 0) : (document.readyState === 'complete')
                          };
                        }
                        """
                    )
                except Exception as e:
                    log_info(f"[{self.task_id}] 读取页面状态失败: {e}")
                    page_state = {'readyState': 'unknown', 'domQuietMs': 0, 'domContentLoaded': False, 'loadFired': False}

                # 网络空闲判断（基于Playwright事件）
                inflight = int(self._inflight_requests)
                net_quiet_ok = (inflight == 0) and ((now_py - self._last_network_activity) >= net_quiet)

                # DOM静止判断
                dom_quiet_ok = (page_state.get('domQuietMs', 0) >= dom_quiet * 1000.0)

                # 视觉稳定判断（使用感知哈希，抗轻微像素抖动）
                try:
                    screenshot_bytes = await self.page.screenshot(type='png')
                    img = Image.open(io.BytesIO(screenshot_bytes)).convert('L').resize((8, 8))
                    arr = np.array(img, dtype=np.float32)
                    avg = float(arr.mean())
                    curr_hash = (arr > avg).astype(np.uint8).flatten()
                    if prev_hash is not None:
                        # 汉明距离
                        dist = int(np.sum(curr_hash != prev_hash))
                        # 小于等于2位差异认为视觉稳定
                        if dist <= 2:
                            visual_stable_count += 1
                        else:
                            visual_stable_count = 0
                        last_dist = dist
                        log_info(f"[{self.task_id}] 稳定性检查 - 网络空闲:{net_quiet_ok} DOM静止:{dom_quiet_ok} 视觉稳定:{visual_stable_count}/{visual_required} (hash距: {dist}) inflight:{inflight}")
                    prev_hash = curr_hash
                except Exception as e:
                    log_info(f"[{self.task_id}] 截图或视觉稳定计算失败: {e}")
                    visual_stable_count = 0

                # 卡死保护：若长时间既无网络请求、DOM也未变化、视觉差异也极小，则不再继续等待
                if not net_quiet_ok and not dom_quiet_ok and (last_dist is None or last_dist > 2):
                    stalled_ticks = 0
                else:
                    if net_quiet_ok and dom_quiet_ok and (visual_stable_count == 0 or (last_dist is not None and last_dist <= 2)):
                        stalled_ticks += 1
                    else:
                        stalled_ticks = 0

                if stalled_ticks >= max(3, int(2.0 / max(0.1, check_interval))):
                    log_info(f"[{self.task_id}] 检测到页面可能停滞（网络/DOM/视觉均无显著变化），提前结束等待")
                    return False

                # 组合判定：至少达到最小静默时间 + 根据strict决定判定标准
                elapsed = time.time() - start_time
                if elapsed >= min_quiet:
                    stable_ok = False
                    if strict:
                        stable_ok = net_quiet_ok and dom_quiet_ok and visual_stable_count >= visual_required
                    else:
                        # 放宽：三项满足其二，且至少一次视觉稳定
                        satisfied = int(net_quiet_ok) + int(dom_quiet_ok) + int(visual_stable_count >= 1)
                        stable_ok = satisfied >= 2

                    if stable_ok:
                    # 额外保障：尽量等到load事件或readyState complete（如果迟迟不到也不强制）
                        if page_state.get('loadFired') or page_state.get('readyState') == 'complete':
                            log_info(f"[{self.task_id}] 页面已稳定（含load/complete），用时: {elapsed:.1f}秒")
                            return True
                        else:
                            # 再确认一次短暂停顿
                            await asyncio.sleep(max(0.2, check_interval))
                            log_info(f"[{self.task_id}] 页面已稳定（无load），用时: {elapsed:.1f}秒")
                            return True

                await asyncio.sleep(check_interval)

            log_info(f"[{self.task_id}] 页面稳定性检测超时，继续执行")
            return False
        except Exception as e:
            log_info(f"[{self.task_id}] 页面稳定性检测失败: {e}")
            return False

    async def find_image(self, image_path: str, confidence: float = None,
                         timeout: int = None) -> Optional[Tuple[int, int]]:
        """查找图片"""
        return await self.image_manager.find_image(
            self.page, image_path, confidence, timeout
        )

    async def click_image_with_fallback(self, image_path: str, confidence: float = None,
                                        timeout: int = None, max_retries: int = None, 
                                        wait_page_stable: bool = True, 
                                        min_confidence_threshold: float = 0.5,
                                        stable_first_attempt_only: bool = True,
                                        is_open: bool = False) -> bool:
        """
        查找并点击图片，支持混合识别和重试机制

        Args:
            image_path: 图片路径
            confidence: 匹配置信度
            timeout: 超时时间
            max_retries: 最大重试次数
            wait_page_stable: 是否在识别前等待页面稳定
            min_confidence_threshold: 最低置信度阈值，低于此值视为误匹配

        Returns:
            bool: 是否成功点击
        """
        # 进来先短暂等待，让页面有初始渲染机会
        try:
            await asyncio.sleep(1)
        except Exception:
            pass
        if max_retries is None:
            max_retries = self.config.get('max_retry_attempts', 5)

        # 开始前先尝试处理常见遮挡（小心避免死循环，限定轮次）
        try:
            if is_open:
                await self._resolve_blockers_if_present(max_rounds=self.image_manager.config.get('blocker_max_rounds', 1))
                log_info(f"[{self.task_id}] 当前处理遮挡物")
            else:
                log_info(f"[{self.task_id}] 当前不处理遮挡物")
                pass
        except Exception:
            pass

        for attempt in range(max_retries):
            try:
                log_info(f"[{self.task_id}] 第{attempt + 1}次尝试查找并点击图片: {image_path}")

                # 首次或按需等待页面稳定（严格模式，若检测到停滞会快速返回）
                if wait_page_stable and (attempt == 0 or not stable_first_attempt_only):
                    log_info(f"[{self.task_id}] 等待页面稳定后再进行图片识别...")
                    await self.wait_for_page_stable(timeout=8, check_interval=0.5, strict=True)
                # 使用图片识别管理器，并获取实际置信度
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
                    # 点击前采集ROI与网络基线
                    pre_hash = await self._capture_roi_hash(x_css, y_css)
                    pre_inflight = int(self._inflight_requests)
                    pre_last_net = float(self._last_network_activity)
                    
                    try:
                        # 方式1: 标准Playwright点击
                        await self.page.mouse.click(x_css, y_css)
                        log_info(f"[{self.task_id}] Playwright点击完成: ({x_css}, {y_css})")
                        click_success = await self._verify_click_effect(
                            x_css, y_css, pre_hash, pre_inflight, pre_last_net, template_path=image_path
                        )
                        
                    except Exception as e:
                        log_info(f"[{self.task_id}] Playwright点击失败: {e}")
                    
                    # 方式2: 如果标准点击失败，尝试带选项的点击
                    if not click_success:
                        try:
                            await self.page.mouse.click(x_css, y_css, button='left', click_count=1)
                            log_info(f"[{self.task_id}] 带选项的Playwright点击完成: ({x_css}, {y_css})")
                            click_success = await self._verify_click_effect(
                                x_css, y_css, pre_hash, pre_inflight, pre_last_net, template_path=image_path
                            )
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
                            click_success = await self._verify_click_effect(
                                x_css, y_css, pre_hash, pre_inflight, pre_last_net, template_path=image_path
                            )
                        except Exception as e:
                            log_info(f"[{self.task_id}] 分步点击失败: {e}")

                    # 方式3.5: DOM elementFromPoint 兜底
                    if not click_success:
                        try:
                            clicked = await self.page.evaluate(
                                "(x, y) => { const el = document.elementFromPoint(x, y); if (!el) return false; try { el.click(); return true; } catch(e) { try { el.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true})); return true; } catch(e2) { return false; } } }",
                                x_css, y_css
                            )
                        except Exception:
                            clicked = False
                        if clicked:
                            click_success = await self._verify_click_effect(
                                x_css, y_css, pre_hash, pre_inflight, pre_last_net, template_path=image_path
                            )
                    
                    # 方式4: 最后备用方案 - 使用PyAutoGUI重新查找并点击（限定到当前窗口区域）
                    if not click_success:
                        try:
                            log_info(f"[{self.task_id}] 尝试PyAutoGUI备用点击方案")
                            # 规范化图片路径为绝对路径，修复路径分隔符问题
                            import os
                            abs_image_path = os.path.abspath(image_path)
                            abs_image_path = os.path.normpath(abs_image_path)
                            log_info(f"[{self.task_id}] PyAutoGUI使用规范化路径: {abs_image_path}")
                            
                            # 使用pyautogui重新查找图片位置
                            base_conf = self.image_manager.config.get('confidence', 0.5)
                            py_conf = (confidence if confidence is not None else base_conf) * 0.8
                            # clamp到(0,1]
                            if py_conf <= 0 or py_conf > 1:
                                py_conf = max(0.1, min(py_conf, 1.0))
                            region = await self._get_window_region()
                            if region:
                                pyautogui_pos = pyautogui.locateCenterOnScreen(abs_image_path, confidence=py_conf, region=region)
                            else:
                                pyautogui_pos = pyautogui.locateCenterOnScreen(abs_image_path, confidence=py_conf)
                            if pyautogui_pos:
                                pyautogui.click(pyautogui_pos.x, pyautogui_pos.y)
                                log_info(f"[{self.task_id}] PyAutoGUI点击完成: ({pyautogui_pos.x}, {pyautogui_pos.y})")
                                click_success = await self._verify_click_effect(
                                    x_css, y_css, pre_hash, pre_inflight, pre_last_net, template_path=image_path
                                )
                            else:
                                log_info(f"[{self.task_id}] PyAutoGUI也未找到图片")
                        except Exception as e:
                            log_info(f"[{self.task_id}] PyAutoGUI点击失败: {e}")
                    
                    if click_success:
                        log_info(f"[{self.task_id}] 图片点击成功（已验证页面效果）: {image_path}, 点击坐标(CSS): ({x_css}, {y_css})")
                        return True
                    else:
                        log_info(f"[{self.task_id}] 所有点击方式都失败了: {image_path}")
                        continue
                else:
                    log_info(f"[{self.task_id}] 第{attempt + 1}次尝试：没有找到图片 {image_path}")

                    # 如果还有重试机会，等待后重试（退避延迟，避免长时间空等）
                    if attempt < max_retries - 1:
                        base_delay = float(self.config.get('retry_delay', 3.0))
                        retry_delay = max(0.5, min(6.0, base_delay * (1 + 0.5 * attempt)))
                        log_info(f"[{self.task_id}] 等待{retry_delay}秒后重试（给页面更多加载时间）...")
                        await asyncio.sleep(retry_delay)
                    else:
                        log_info(f"[{self.task_id}] 所有{max_retries}次尝试都失败，无法找到图片")

            except Exception as e:
                log_info(f"[{self.task_id}] 第{attempt + 1}次图片定位失败: {e}")

                # 如果还有重试机会，等待后重试（退避延迟）
                if attempt < max_retries - 1:
                    base_delay = float(self.config.get('retry_delay', 3.0))
                    retry_delay = max(0.5, min(6.0, base_delay * (1 + 0.5 * attempt)))
                    log_info(f"[{self.task_id}] 等待{retry_delay}秒后重试（给页面更多加载时间）...")
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

    async def _resolve_blockers_if_present(self, max_rounds: int = None) -> bool:
        """检测并处理常见遮挡物（如Got it/Close等），返回是否有处理动作。
        """
        try:
            # 读取配置文件中的遮挡模板
            blockers = self.image_manager.config.get('blockers', [])
            if not blockers:
                return False
            if max_rounds is None:
                max_rounds = int(self.image_manager.config.get('blocker_max_rounds', 1))

            any_resolved = False
            for _round in range(max(1, max_rounds)):
                resolved_this_round = False
                for blk in blockers:
                    try:
                        blk_path = str(blk.get('path') or '').strip()
                        if not blk_path:
                            continue
                        blk_conf = float(blk.get('confidence', 0.75))
                        pos = await self.image_manager.image_recognition.quick_check_presence(
                            self.page, blk_path, confidence=blk_conf, scales=[1.0, 0.9]
                        )
                        if not pos:
                            continue

                        x, y = pos
                        try:
                            dpr = await self.page.evaluate('window.devicePixelRatio')
                        except Exception:
                            dpr = 1.0
                        x_css = int(x / (dpr if dpr else 1.0))
                        y_css = int(y / (dpr if dpr else 1.0))
                        pre_hash = await self._capture_roi_hash(x_css, y_css)
                        pre_inflight = int(self._inflight_requests)
                        pre_last_net = float(self._last_network_activity)

                        # 先尝试标准点击
                        try:
                            await self.page.mouse.click(x_css, y_css)
                        except Exception:
                            pass
                        ok = await self._verify_click_effect(x_css, y_css, pre_hash, pre_inflight, pre_last_net, template_path=blk_path)
                        if not ok:
                            # 使用 elementFromPoint 兜底
                            try:
                                clicked = await self.page.evaluate(
                                    "(x, y) => { const el = document.elementFromPoint(x, y); if (!el) return false; try { el.click(); return true; } catch(e) { try { el.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true})); return true; } catch(e2) { return false; } } }",
                                    x_css, y_css
                                )
                            except Exception:
                                clicked = False
                            if clicked:
                                ok = await self._verify_click_effect(x_css, y_css, pre_hash, pre_inflight, pre_last_net, template_path=blk_path)

                        if ok:
                            log_info(f"[{self.task_id}] 已处理遮挡: {blk_path}")
                            any_resolved = True
                            resolved_this_round = True
                            # 小憩，等待UI收起
                            try:
                                await asyncio.sleep(0.3)
                            except Exception:
                                pass
                    except Exception as e:
                        log_info(f"[{self.task_id}] 处理遮挡时出错: {e}")

                if not resolved_this_round:
                    break
            return any_resolved
        except Exception as e:
            log_info(f"[{self.task_id}] 遮挡处理流程异常: {e}")
            return False

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
            try:
                await asyncio.sleep(3)
            except Exception:
                pass
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
