# UI断言功能使用指南

本项目提供了全面的UI自动化断言功能，包括文本断言、元素断言、图片断言等多种类型。

## 功能概览

### 1. 文本断言 (Text Assertion)
验证页面中是否包含指定的文本内容。

```python
from utils.ui_operations import UIOperations

# 创建UI操作实例
ui_ops = UIOperations(page, task_id="test")

# 在整个页面中查找文本
await ui_ops.text_assert("欢迎登录")

# 在指定元素中查找文本
await ui_ops.text_assert("提交", selector="button#submit")

# 使用正则表达式匹配
await ui_ops.text_assert(r"\d{4}-\d{2}-\d{2}", match_type="regex")
```

### 2. 元素存在断言 (Element Assertion)
验证页面中是否存在指定的元素。

```python
# 验证元素是否存在
await ui_ops.element_assert("#login-form")
await ui_ops.element_assert(".error-message")
await ui_ops.element_assert("input[name='username']")

# 验证元素数量
await ui_ops.element_assert("li.menu-item", count=5)
```

### 3. URL断言 (URL Assertion)
验证当前页面的URL是否符合预期。

```python
# 精确匹配URL
await ui_ops.url_assert("https://example.com/login")

# URL包含匹配
await ui_ops.url_assert("login", match_type="contains")

# 正则表达式匹配
await ui_ops.url_assert(r"https://.*\.com/user/\d+", match_type="regex")
```

### 4. 属性断言 (Attribute Assertion)
验证元素的属性值是否符合预期。

```python
# 验证输入框的类型
await ui_ops.attribute_assert("#password", "type", "password")

# 验证按钮的class属性
await ui_ops.attribute_assert("button", "class", "btn btn-primary")

# 验证链接的href属性
await ui_ops.attribute_assert("a.download", "href", "/download/file.pdf")
```

### 5. CSS属性断言 (CSS Assertion)
验证元素的CSS样式属性。

```python
# 验证元素颜色
await ui_ops.css_assert(".error", "color", "rgb(255, 0, 0)")

# 验证元素显示状态
await ui_ops.css_assert(".modal", "display", "block")

# 验证字体大小
await ui_ops.css_assert("h1", "font-size", "24px")
```

### 6. 图片断言 (Image Assertion)

#### 6.1 SSIM图片相似度断言
使用结构相似性指数(SSIM)比较页面截图与参考图片。

```python
# 全页面SSIM断言
await ui_ops.image_assert_ssim(
    reference_image_path="reference/login_page.png",
    threshold=0.9
)

# 区域SSIM断言
screenshot_area = {"x": 0, "y": 0, "width": 800, "height": 600}
await ui_ops.image_assert_ssim(
    reference_image_path="reference/header.png",
    threshold=0.85,
    screenshot_area=screenshot_area
)
```

#### 6.2 模板匹配断言
在页面中查找指定的图片模板。

```python
# 模板匹配断言
await ui_ops.image_assert_template_match(
    template_path="templates/login_button.png",
    confidence=0.8
)

# 在指定区域进行模板匹配
search_area = {"x": 100, "y": 100, "width": 500, "height": 400}
await ui_ops.image_assert_template_match(
    template_path="templates/icon.png",
    confidence=0.7,
    search_area=search_area
)
```

## 实际使用示例

### 登录页面测试
```python
import asyncio
from playwright.async_api import async_playwright
from utils.ui_operations import UIOperations

async def test_login_page():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        ui_ops = UIOperations(page, task_id="login_test")
        
        try:
            # 访问登录页面
            await page.goto("https://example.com/login")
            
            # 验证页面URL
            await ui_ops.url_assert("/login", match_type="contains")
            
            # 验证页面标题
            await ui_ops.text_assert("用户登录")
            
            # 验证登录表单元素存在
            await ui_ops.element_assert("#username")
            await ui_ops.element_assert("#password")
            await ui_ops.element_assert("button[type='submit']")
            
            # 验证输入框属性
            await ui_ops.attribute_assert("#username", "type", "text")
            await ui_ops.attribute_assert("#password", "type", "password")
            
            # 验证页面整体布局（图片断言）
            await ui_ops.image_assert_ssim(
                reference_image_path="test_data/login_page_expected.png",
                threshold=0.8
            )
            
            print("✅ 登录页面测试通过")
            
        except AssertionError as e:
            print(f"❌ 登录页面测试失败: {e}")
            
        finally:
            await browser.close()

# 运行测试
asyncio.run(test_login_page())
```

### 表单提交测试
```python
async def test_form_submission():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        ui_ops = UIOperations(page, task_id="form_test")
        
        try:
            await page.goto("https://example.com/contact")
            
            # 填写表单
            await page.fill("#name", "测试用户")
            await page.fill("#email", "test@example.com")
            await page.fill("#message", "这是一条测试消息")
            
            # 提交表单
            await page.click("button[type='submit']")
            await page.wait_for_load_state("networkidle")
            
            # 验证成功页面
            await ui_ops.text_assert("提交成功")
            await ui_ops.element_assert(".success-message")
            
            # 验证成功消息的样式
            await ui_ops.css_assert(".success-message", "color", "rgb(0, 128, 0)")
            
            print("✅ 表单提交测试通过")
            
        except AssertionError as e:
            print(f"❌ 表单提交测试失败: {e}")
            
        finally:
            await browser.close()
```

## 最佳实践

### 1. 选择合适的断言类型
- **文本断言**: 验证页面内容和消息
- **元素断言**: 验证页面结构和组件存在性
- **URL断言**: 验证页面导航和路由
- **属性断言**: 验证表单字段和元素配置
- **CSS断言**: 验证样式和视觉效果
- **图片断言**: 验证整体布局和视觉一致性

### 2. 图片断言使用建议
- **SSIM断言**: 适用于整体页面布局验证，阈值建议0.8-0.95
- **模板匹配**: 适用于特定UI组件验证，阈值建议0.7-0.9
- 保持参考图片更新，避免因环境差异导致误报

### 3. 错误处理
所有断言方法在失败时都会抛出`AssertionError`，建议使用try-catch结构处理：

```python
try:
    await ui_ops.text_assert("预期文本")
    print("✅ 断言通过")
except AssertionError as e:
    print(f"❌ 断言失败: {e}")
    # 可以在这里添加错误处理逻辑，如截图保存
    await page.screenshot(path="error_screenshot.png")
```

### 4. 调试技巧
- 使用较低的阈值进行初步测试
- 保存失败时的截图用于分析
- 使用日志记录详细的断言过程
- 结合浏览器开发者工具进行元素定位

## 配置选项

### 日志配置
断言功能会自动记录执行过程，可以通过修改`config/logger.py`调整日志级别和格式。

### 超时设置
大部分断言操作都有默认的超时设置，可以在调用时通过参数调整：

```python
# 设置较长的等待时间
await ui_ops.element_assert("#slow-loading-element", timeout=10000)
```

## 故障排除

### 常见问题
1. **图片断言失败**: 检查参考图片路径和阈值设置
2. **元素找不到**: 确认选择器语法和元素加载状态
3. **文本匹配失败**: 检查文本内容和编码问题
4. **CSS属性不匹配**: 注意浏览器计算样式的格式差异

### 调试方法
1. 启用详细日志输出
2. 使用浏览器的可视化模式（headless=False）
3. 添加适当的等待时间
4. 保存调试截图和页面源码

通过合理使用这些断言功能，可以构建稳定可靠的UI自动化测试套件。 