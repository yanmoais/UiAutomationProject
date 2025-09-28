# UI自动化项目

这是一个功能完整的Web UI自动化测试项目，基于Playwright和OpenCV技术，提供了丰富的UI断言和图片识别功能。

## 🚀 主要特性

### 🎯 全面的断言功能
- **文本断言**: 验证页面文本内容，支持精确匹配、包含匹配和正则表达式
- **元素断言**: 验证页面元素存在性和数量
- **URL断言**: 验证页面URL，支持多种匹配模式
- **属性断言**: 验证元素属性值
- **CSS断言**: 验证元素样式属性
- **图片断言**: 基于SSIM和模板匹配的视觉验证

### 🖼️ 先进的图片识别
- **SSIM相似度计算**: 使用OpenCV实现的结构相似性指数算法
- **模板匹配**: 在页面中查找特定UI组件
- **混合识别策略**: 结合多种算法提高识别准确率
- **缓存机制**: 优化性能，避免重复计算

### 🔄 智能重试机制
- **自动重试**: 操作失败时自动重试
- **指数退避**: 智能等待策略
- **可配置**: 灵活的重试次数和间隔设置

### 📊 完整的日志系统
- **详细日志**: 记录所有操作和结果
- **分级日志**: 支持不同级别的日志输出
- **任务追踪**: 每个任务都有唯一ID便于追踪

## 📁 项目结构

```
UiAutomationProject/
├── api/                          # API接口
│   └── automation_management.py  # 自动化管理API
├── config/                       # 配置文件
│   ├── logger.py                 # 日志配置
│   └── settings.py               # 项目设置
├── utils/                        # 核心工具类
│   ├── ui_operations.py          # UI操作和断言
│   ├── image_recognition.py      # 图片识别
│   ├── hybrid_image_manager.py   # 混合图片管理
│   └── retry_mechanism.py        # 重试机制
├── tests/                        # 测试文件
│   └── test_ui_assertions.py     # 断言功能测试
├── examples/                     # 示例代码
│   └── image_assertion_demo.py   # 图片断言演示
├── docs/                         # 文档
│   └── assertion_guide.md        # 断言功能使用指南
├── requirements.txt              # 项目依赖
└── README.md                     # 项目说明
```

## 🛠️ 安装和配置

### 环境要求
- Python 3.8+
- Windows/Linux/macOS

### 安装步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd UiAutomationProject
   ```

2. **安装依赖**
   ```bash
   pip install -r requirements.txt
   ```

3. **安装Playwright浏览器**
   ```bash
   playwright install
   ```

4. **验证安装**
   ```bash
   python -c "import cv2, numpy as np, PIL; print('所有必需的包都已正确安装')"
   ```

## 🎮 快速开始

### 基本使用示例

```python
import asyncio
from playwright.async_api import async_playwright
from utils.ui_operations import UIOperations

async def basic_example():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        # 创建UI操作实例
        ui_ops = UIOperations(page, task_id="basic_test")
        
        try:
            # 访问页面
            await page.goto("https://example.com")
            
            # 文本断言
            await ui_ops.text_assert("Example Domain")
            
            # 元素断言
            await ui_ops.element_assert("h1")
            
            # URL断言
            await ui_ops.url_assert("example.com", match_type="contains")
            
            print("✅ 所有断言通过")
            
        except AssertionError as e:
            print(f"❌ 断言失败: {e}")
            
        finally:
            await browser.close()

# 运行示例
asyncio.run(basic_example())
```

### 图片断言示例

```python
async def image_assertion_example():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        ui_ops = UIOperations(page, task_id="image_test")
        
        try:
            await page.goto("https://example.com")
            
            # 保存参考图片
            await page.screenshot(path="reference.png")
            
            # SSIM图片断言
            await ui_ops.image_assert_ssim(
                reference_image_path="reference.png",
                threshold=0.9
            )
            
            print("✅ 图片断言通过")
            
        except AssertionError as e:
            print(f"❌ 图片断言失败: {e}")
            
        finally:
            await browser.close()
```

## 🧪 运行测试

### 运行演示程序
```bash
# 设置Python路径（Windows PowerShell）
$env:PYTHONPATH = $PWD
python examples/image_assertion_demo.py
```

### 运行单元测试
```bash
# 安装pytest
pip install pytest pytest-asyncio

# 运行测试
pytest tests/test_ui_assertions.py -v
```

## 📖 详细文档

- [断言功能使用指南](docs/assertion_guide.md) - 详细的API文档和使用示例

## 🔧 核心功能详解

### 1. 文本断言
```python
# 基本文本断言
await ui_ops.text_assert("登录成功")

# 指定选择器
await ui_ops.text_assert("提交", selector="button")

# 正则表达式匹配
await ui_ops.text_assert(r"\d{4}-\d{2}-\d{2}", match_type="regex")
```

### 2. 图片断言
```python
# SSIM相似度断言
await ui_ops.image_assert_ssim(
    reference_image_path="expected.png",
    threshold=0.85
)

# 模板匹配断言
await ui_ops.image_assert_template_match(
    template_path="button.png",
    confidence=0.8
)
```

### 3. 元素和属性断言
```python
# 元素存在断言
await ui_ops.element_assert("#login-form")

# 属性断言
await ui_ops.attribute_assert("#username", "type", "text")

# CSS断言
await ui_ops.css_assert(".error", "color", "rgb(255, 0, 0)")
```

## 🎯 使用场景

### Web应用测试
- 登录流程验证
- 表单提交测试
- 页面导航验证
- UI组件测试

### 视觉回归测试
- 页面布局验证
- UI组件一致性检查
- 响应式设计测试
- 主题和样式验证

### 自动化监控
- 网站健康检查
- 功能可用性监控
- 性能基准测试
- 用户体验验证

## ⚠️ 注意事项

1. **图片断言阈值**: 建议根据实际情况调整SSIM阈值，通常0.8-0.95为合适范围
2. **浏览器兼容性**: 项目基于Chromium，确保目标网站兼容
3. **网络依赖**: 某些测试需要网络连接，建议在稳定网络环境下运行
4. **资源清理**: 测试完成后及时关闭浏览器实例

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进项目！

### 开发环境设置
1. Fork项目
2. 创建功能分支
3. 编写测试
4. 提交代码
5. 创建Pull Request

## 📄 许可证

本项目采用MIT许可证，详情请查看LICENSE文件。

## 🆘 支持和帮助

如果遇到问题或需要帮助：
1. 查看[使用指南](docs/assertion_guide.md)
2. 运行示例程序了解功能
3. 查看测试文件获取更多用法示例
4. 提交Issue描述问题

---

**快速开始**: 运行 `python examples/image_assertion_demo.py` 体验完整功能！ 