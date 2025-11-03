class UIConfig:
    """UI自动化配置管理"""
    
    # 图片识别配置 - 针对多任务平分浏览器窗口优化
    SCREENSHOT_CONFIDENCE = 0.65  # 提高基础置信度到0.65，减少跨实例误匹配和误识别
    USE_SCREENSHOT_RECOGNITION = True
    PYTHONAUTOGUI_FALLBACK = True
    
    # 窗口管理配置
    WINDOW_MARGIN = 50
    MAX_CONCURRENT_BROWSERS = 4
    
    # 性能配置
    SCREENSHOT_CACHE_TIMEOUT = 1.0
    TEMPLATE_CACHE_ENABLED = True
    
    # 图片识别超时配置
    IMAGE_WAIT_TIMEOUT = 3  # 增加超时时间，给多尺度匹配更多时间
    IMAGE_CHECK_INTERVAL = 0.2  # 减少检查间隔，提高响应速度
    
    # 混合识别策略配置
    HYBRID_RECOGNITION_ENABLED = True
    SCREENSHOT_FIRST = True  # True: 优先使用截图识别, False: 优先使用pyautogui
    # 识别安全阈值
    MIN_ABSOLUTE_CONFIDENCE = 0.6  # 绝对最小置信度，低于该值一律视为不匹配，防止误点

    # 常见遮挡/弹窗拦截模板（可按需扩展）
    # 后续作为模板配置文件使用
    BLOCKER_TEMPLATES = [
        { 'name': 'nest', 'path': 'Game_Img/1761050313_nest.png', 'confidence': 0.7 },
        { 'name': 'close_guide', 'path': 'Game_Img/1760417593_close.png', 'confidence': 0.7 }]
    BLOCKER_MAX_ROUNDS = 2  # 单次操作中最多尝试两轮处理遮挡
    
    # 重试机制配置 - 针对多任务优化
    MAX_RETRY_ATTEMPTS = 6  # 进一步增加重试次数，提升复杂加载场景下的成功率
    RETRY_DELAY = 0.8  # 略增基础间隔，结合退避策略防抖
    
    # 多尺度匹配配置
    MULTI_SCALE_ENABLED = True  # 启用多尺度匹配
    SCALE_FACTORS = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5]  # 支持缩放到50%
    CONFIDENCE_LEVELS = [0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3]  # 限制最低到0.3，降低误报
    
    @classmethod
    def get_image_recognition_config(cls):
        """获取图片识别配置"""
        return {
            'confidence': cls.SCREENSHOT_CONFIDENCE,
            'timeout': cls.IMAGE_WAIT_TIMEOUT,
            'check_interval': cls.IMAGE_CHECK_INTERVAL,
            'use_screenshot': cls.USE_SCREENSHOT_RECOGNITION,
            'use_pyautogui_fallback': cls.PYTHONAUTOGUI_FALLBACK,
            'hybrid_enabled': cls.HYBRID_RECOGNITION_ENABLED,
            'screenshot_first': cls.SCREENSHOT_FIRST,
            'screenshot_cache_timeout': cls.SCREENSHOT_CACHE_TIMEOUT,
            'max_retry_attempts': cls.MAX_RETRY_ATTEMPTS,
            'retry_delay': cls.RETRY_DELAY,
            'multi_scale_enabled': cls.MULTI_SCALE_ENABLED,
            'scale_factors': cls.SCALE_FACTORS,
            'confidence_levels': cls.CONFIDENCE_LEVELS,
            'absolute_min_confidence': cls.MIN_ABSOLUTE_CONFIDENCE,
            'blockers': cls.BLOCKER_TEMPLATES,
            'blocker_max_rounds': cls.BLOCKER_MAX_ROUNDS,
        } 