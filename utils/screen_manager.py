import pyautogui
from typing import Tuple, List, Dict
import asyncio
import math
import platform
import ctypes

class ScreenManager:
    """屏幕管理器 - 负责检测显示器尺寸和分配浏览器位置"""
    
    def __init__(self):
        self.screen_width = 0
        self.screen_height = 0
        self.used_positions = []
        self.max_browsers = None  # 不再限制为固定数量，支持任意正整数
        self.margin = 0  # 网格模式下无间距
        # 额外的布局参数（用于多实例安全布局）
        self.gap_x = 0   # 水平间距（更紧凑）
        self.gap_y = 0   # 垂直间距（紧贴）
        self.edge_padding = 0  # 屏幕边缘留白（按需为0）
        # 典型的Windows窗口边框与标题栏补偿（像素），用于 --window-size
        self.frame_comp_width = 16
        self.frame_comp_height = 88
        # 额外安全缩减（用于极端DPI）：为0以保证网格无缝铺满
        self.shrink_safety = 0
        # 监视器信息
        self.monitors: List[Dict] = []
        self.primary_work_left = 0
        self.primary_work_top = 0
        self.primary_work_width = 0
        self.primary_work_height = 0
        self._init_screen_info()
        self._init_monitors()
        # 从系统度量自动计算真实边框与标题栏尺寸，避免行距
        self._update_frame_compensation_from_system_metrics()
        # 动态设置浏览器尺寸，基于实际屏幕分辨率
        self._calculate_browser_sizes()
    
    def _init_screen_info(self):
        """初始化屏幕信息"""
        try:
            # 使进程DPI感知，优先使用每显示器感知V2；失败则退化
            if platform.system() == 'Windows':
                try:
                    # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
                    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
                except Exception:
                    try:
                        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_DPI_AWARE
                    except Exception:
                        try:
                            ctypes.windll.user32.SetProcessDPIAware()
                        except Exception:
                            pass
            # 优先在Windows下使用主显示器的物理分辨率
            if platform.system() == 'Windows':
                user32 = ctypes.windll.user32
                MonitorFromPoint = user32.MonitorFromPoint
                GetMonitorInfoW = user32.GetMonitorInfoW
                MONITOR_DEFAULTTOPRIMARY = 1

                class RECT(ctypes.Structure):
                    _fields_ = [
                        ("left", ctypes.c_long),
                        ("top", ctypes.c_long),
                        ("right", ctypes.c_long),
                        ("bottom", ctypes.c_long),
                    ]

                class MONITORINFO(ctypes.Structure):
                    _fields_ = [
                        ("cbSize", ctypes.c_ulong),
                        ("rcMonitor", RECT),
                        ("rcWork", RECT),
                        ("dwFlags", ctypes.c_ulong),
                    ]

                monitor = MonitorFromPoint(0, 0, MONITOR_DEFAULTTOPRIMARY)
                mi = MONITORINFO()
                mi.cbSize = ctypes.sizeof(MONITORINFO)
                if GetMonitorInfoW(monitor, ctypes.byref(mi)):
                    self.screen_width = int(mi.rcMonitor.right - mi.rcMonitor.left)
                    self.screen_height = int(mi.rcMonitor.bottom - mi.rcMonitor.top)
                else:
                    # 回退到pyautogui
                    self.screen_width = pyautogui.size().width
                    self.screen_height = pyautogui.size().height
            else:
                # 非Windows平台使用pyautogui的主屏尺寸
                self.screen_width = pyautogui.size().width
                self.screen_height = pyautogui.size().height

            print(f"📺 检测到主显示器尺寸: {self.screen_width} x {self.screen_height}")
        except Exception as e:
            # 如果获取失败，使用默认值
            self.screen_width = 1920
            self.screen_height = 1200
            print(f"⚠️  无法获取显示器尺寸，使用默认值: {self.screen_width} x {self.screen_height}")
    
    def _init_monitors(self):
        """枚举所有显示器，并提取主显示器的工作区域（不含任务栏）。"""
        self.monitors = []
        if platform.system() != 'Windows':
            # 非Windows：仅使用单主屏的工作区等于全屏
            self.primary_work_left = 0
            self.primary_work_top = 0
            self.primary_work_width = self.screen_width
            self.primary_work_height = self.screen_height
            self.monitors.append({
                "left": 0,
                "top": 0,
                "right": self.screen_width,
                "bottom": self.screen_height,
                "work_left": 0,
                "work_top": 0,
                "work_right": self.screen_width,
                "work_bottom": self.screen_height,
                "is_primary": True,
            })
            return

        user32 = ctypes.windll.user32
        GetMonitorInfoW = user32.GetMonitorInfoW
        EnumDisplayMonitors = user32.EnumDisplayMonitors

        class RECT(ctypes.Structure):
            _fields_ = [
                ("left", ctypes.c_long),
                ("top", ctypes.c_long),
                ("right", ctypes.c_long),
                ("bottom", ctypes.c_long),
            ]

        class MONITORINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", ctypes.c_ulong),
                ("rcMonitor", RECT),
                ("rcWork", RECT),
                ("dwFlags", ctypes.c_ulong),
            ]

        monitors: List[Dict] = []

        @ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.POINTER(RECT), ctypes.c_double)
        def _monitor_enum_proc(hMonitor, hdcMonitor, lprcMonitor, dwData):
            mi = MONITORINFO()
            mi.cbSize = ctypes.sizeof(MONITORINFO)
            if GetMonitorInfoW(hMonitor, ctypes.byref(mi)):
                info = {
                    "left": int(mi.rcMonitor.left),
                    "top": int(mi.rcMonitor.top),
                    "right": int(mi.rcMonitor.right),
                    "bottom": int(mi.rcMonitor.bottom),
                    "work_left": int(mi.rcWork.left),
                    "work_top": int(mi.rcWork.top),
                    "work_right": int(mi.rcWork.right),
                    "work_bottom": int(mi.rcWork.bottom),
                    "is_primary": bool(mi.dwFlags & 1),  # MONITORINFOF_PRIMARY
                }
                monitors.append(info)
            return 1

        EnumDisplayMonitors(0, 0, _monitor_enum_proc, 0)
        self.monitors = monitors

        # 主显示器工作区域
        primary = next((m for m in monitors if m["is_primary"]), monitors[0] if monitors else None)
        if primary is None:
            # 回退
            self.primary_work_left = 0
            self.primary_work_top = 0
            self.primary_work_width = self.screen_width
            self.primary_work_height = self.screen_height
        else:
            self.primary_work_left = primary["work_left"]
            self.primary_work_top = primary["work_top"]
            self.primary_work_width = primary["work_right"] - primary["work_left"]
            self.primary_work_height = primary["work_bottom"] - primary["work_top"]

        print(f"🖥️  主显示器工作区: {self.primary_work_width} x {self.primary_work_height} at ({self.primary_work_left}, {self.primary_work_top})")
    
    def _update_frame_compensation_from_system_metrics(self):
        """通过系统度量自动推算窗口边框与标题栏占用像素，确保网格步长准确。仅在Windows生效。"""
        if platform.system() != 'Windows':
            return
        user32 = ctypes.windll.user32
        try:
            # 优先按当前系统DPI获取
            try:
                GetDpiForSystem = user32.GetDpiForSystem
                dpi = GetDpiForSystem()
                GetSystemMetricsForDpi = user32.GetSystemMetricsForDpi
                SM_CXSIZEFRAME = 32
                SM_CYSIZEFRAME = 33
                SM_CYCAPTION = 4
                SM_CXPADDEDBORDER = 92
                frame_x = int(GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi))
                frame_y = int(GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi))
                caption_h = int(GetSystemMetricsForDpi(SM_CYCAPTION, dpi))
                padded = int(GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi))
            except Exception:
                # 回退：不含DPI版本
                SM_CXFRAME = 32
                SM_CYFRAME = 33
                SM_CYCAPTION = 4
                SM_CXPADDEDBORDER = 92
                frame_x = int(user32.GetSystemMetrics(SM_CXFRAME))
                frame_y = int(user32.GetSystemMetrics(SM_CYFRAME))
                caption_h = int(user32.GetSystemMetrics(SM_CYCAPTION))
                try:
                    padded = int(user32.GetSystemMetrics(SM_CXPADDEDBORDER))
                except Exception:
                    padded = 0
            # 计算整体补偿
            total_border_x = 2 * (frame_x + padded)
            total_border_y = 2 * (frame_y + padded) + caption_h
            # 约束下限，避免奇异值
            self.frame_comp_width = max(8, total_border_x)
            self.frame_comp_height = max(40, total_border_y)
            print(f"🔧 自动边框补偿: width={self.frame_comp_width}, height={self.frame_comp_height}")
        except Exception as e:
            # 保持默认
            print("⚠️  无法从系统度量获取窗口边框信息，使用默认补偿。")
    
    def _calculate_browser_sizes(self):
        """根据实际屏幕尺寸计算浏览器窗口大小（满屏基线）"""
        # 满屏模式：使用主显示器工作区尺寸
        self.full_screen_width = self.primary_work_width or self.screen_width
        self.full_screen_height = self.primary_work_height or self.screen_height
        
        print(f"🖥️  浏览器尺寸设置:")
        print(f"    满屏模式: {self.full_screen_width} x {self.full_screen_height}")
    
    def _compute_grid_dimensions(self, browser_count: int) -> Tuple[int, int]:
        """根据数量计算合适的网格列数和行数（尽量接近正方形）。"""
        if browser_count <= 0:
            raise ValueError("浏览器数量必须为正整数")
        if browser_count == 1:
            return 1, 1
        # 先取接近平方根的列数，然后计算行数
        cols = int(math.ceil(math.sqrt(browser_count)))
        rows = int(math.ceil(browser_count / cols))
        return cols, rows
    
    def _get_outer_cell_size(self, cols: int, rows: int) -> Tuple[int, int]:
        """计算每格“外框”宽高，使其与间距一起正好填满工作区。"""
        work_width = self.primary_work_width or self.screen_width
        work_height = self.primary_work_height or self.screen_height
        available_w = work_width - (cols - 1) * self.gap_x - 2 * self.edge_padding
        available_h = work_height - (rows - 1) * self.gap_y - 2 * self.edge_padding
        outer_w = max(200 + self.frame_comp_width, available_w // cols)
        outer_h = max(150 + self.frame_comp_height, available_h // rows)
        return int(outer_w), int(outer_h)
    
    def _compute_safe_sizes(self, cols: int, rows: int) -> Tuple[int, int, int, int]:
        """基于外框尺寸计算用于启动参数的安全内外尺寸。返回: inner_w, inner_h, outer_w, outer_h"""
        outer_w, outer_h = self._get_outer_cell_size(cols, rows)
        inner_w = max(200, outer_w - self.frame_comp_width - self.shrink_safety)
        inner_h = max(150, outer_h - self.frame_comp_height - self.shrink_safety)
        # 实际外框（由浏览器创建）
        outer_w = inner_w + self.frame_comp_width
        outer_h = inner_h + self.frame_comp_height
        return inner_w, inner_h, int(outer_w), int(outer_h)
    
    def _clamp_position(self, x: int, y: int, width: int, height: int) -> Tuple[int, int]:
        """将窗口位置限制在主显示器工作区内。width/height 应使用外框尺寸。"""
        work_left = self.primary_work_left + self.edge_padding
        work_top = self.primary_work_top + self.edge_padding
        work_right = self.primary_work_left + self.primary_work_width - self.edge_padding
        work_bottom = self.primary_work_top + self.primary_work_height - self.edge_padding
        max_x = work_right - width
        max_y = work_bottom - height
        clamped_x = min(max(x, work_left), max_x)
        clamped_y = min(max(y, work_top), max_y)
        return int(clamped_x), int(clamped_y)
    
    def get_browser_positions(self, browser_count: int) -> List[Tuple[int, int]]:
        """
        根据浏览器数量获取位置列表
        单个浏览器满屏显示，多于1个时按动态网格均匀切分
        
        Args:
            browser_count: 浏览器数量 (>=1)
            
        Returns:
            List[Tuple[int, int]]: 位置列表，每个元素为 (x, y) 坐标
        """
        if browser_count <= 0:
            raise ValueError("浏览器数量必须为正整数")
        
        positions = []
        
        # 主显示器基准
        base_left = self.primary_work_left + self.edge_padding
        base_top = self.primary_work_top + self.edge_padding
        
        if browser_count == 1:
            # 单个浏览器：满屏显示
            positions.append((base_left, base_top))
            return positions
        
        cols, rows = self._compute_grid_dimensions(browser_count)
        _, _, outer_w, outer_h = self._compute_safe_sizes(cols, rows)
        
        # 逐行逐列填充位置（行优先），步长=外框尺寸+间距，确保无缝
        count = 0
        for row in range(rows):
            for col in range(cols):
                if count >= browser_count:
                    break
                x = base_left + col * (outer_w + self.gap_x)
                y = base_top + row * (outer_h + self.gap_y)
                x, y = self._clamp_position(int(x), int(y), outer_w, outer_h)
                positions.append((x, y))
                count += 1
        
        return positions
    
    def get_browser_args(self, position: Tuple[int, int], browser_count: int) -> List[str]:
        """
        根据位置和浏览器数量生成浏览器启动参数
        
        Args:
            position: (x, y) 坐标位置
            browser_count: 浏览器数量，用于确定窗口尺寸
            
        Returns:
            List[str]: 浏览器启动参数列表
        """
        x, y = position
        
        # 单实例使用最大化，避免在高DPI/多显示器下窗口外框导致的跨屏溢出
        common_args = [
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
            "--no-first-run",
            "--no-default-browser-check"
        ]
        if browser_count == 1:
            return [
                "--start-maximized",
                *common_args,
            ]
        else:
            cols, rows = self._compute_grid_dimensions(browser_count)
            inner_w, inner_h, outer_w, outer_h = self._compute_safe_sizes(cols, rows)
            # 重新按实际外框尺寸进行夹取，避免跨屏
            x, y = self._clamp_position(x, y, outer_w, outer_h)
            return [
                f"--window-position={x},{y}",
                f"--window-size={inner_w},{inner_h}",
                *common_args,
            ]
    
    def print_layout_info(self, browser_count: int):
        """打印布局信息"""
        positions = self.get_browser_positions(browser_count)
        print(f"\n📐 浏览器布局信息 (共 {browser_count} 个实例):")
        print("=" * 50)
        
        # 窗口尺寸（便于一致打印）
        if browser_count == 1:
            width = self.full_screen_width
            height = self.full_screen_height
            rows = 1
            cols = 1
        else:
            cols, rows = self._compute_grid_dimensions(browser_count)
            _, _, width, height = self._compute_safe_sizes(cols, rows)
        
        for i, pos in enumerate(positions, 1):
            print(f"浏览器 {i}: 位置 ({pos[0]}, {pos[1]})")
            if browser_count == 1:
                print(f"        外框尺寸: {width}x{height} (满屏)")
            else:
                print(f"        外框尺寸: {width}x{height} (网格 {rows}x{cols})")
            
            # 计算窗口边界
            right = pos[0] + width
            bottom = pos[1] + height
            print(f"        外框范围: ({pos[0]}, {pos[1]}) -> ({right}, {bottom})")
        
        print("=" * 50)
        
        # 检查是否有重叠
        self._check_overlap(positions, browser_count)
    
    def _check_overlap(self, positions: List[Tuple[int, int]], browser_count: int):
        """检查浏览器窗口是否重叠"""
        print("\n🔍 重叠检查:")
        has_overlap = False
        
        # 确定外框尺寸
        if browser_count == 1:
            width = self.full_screen_width
            height = self.full_screen_height
        else:
            cols, rows = self._compute_grid_dimensions(browser_count)
            _, _, width, height = self._compute_safe_sizes(cols, rows)
        
        for i in range(len(positions)):
            for j in range(i + 1, len(positions)):
                x1, y1 = positions[i]
                x2, y2 = positions[j]
                
                # 检查是否重叠
                if (x1 < x2 + width and 
                    x1 + width > x2 and
                    y1 < y2 + height and 
                    y1 + height > y2):
                    print(f"❌ 浏览器 {i+1} 和浏览器 {j+1} 重叠!")
                    has_overlap = True
        
        if not has_overlap:
            print("✅ 所有浏览器窗口位置正确，无重叠")

# 全局屏幕管理器实例
screen_manager = ScreenManager() 