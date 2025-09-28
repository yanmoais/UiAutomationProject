"""
UI断言功能测试套件
测试各种断言方法的正确性和可靠性
"""
import pytest
import asyncio
import os
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright, Page
from PIL import Image, ImageDraw
import numpy as np

from utils.ui_operations import UIOperations
from config.logger import log_info


class TestUIAssertions:
    """UI断言功能测试类"""
    
    @pytest.fixture
    async def browser_page(self):
        """浏览器页面fixture"""
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            yield page
            await browser.close()
    
    @pytest.fixture
    def ui_operations(self, browser_page):
        """UI操作实例fixture"""
        return UIOperations(browser_page, task_id="test_assertions")
    
    @pytest.fixture
    def temp_dir(self):
        """临时目录fixture"""
        with tempfile.TemporaryDirectory() as tmp_dir:
            yield Path(tmp_dir)
    
    def create_test_image(self, width=200, height=200, color=(255, 0, 0)):
        """创建测试图片"""
        image = Image.new('RGB', (width, height), color)
        draw = ImageDraw.Draw(image)
        # 添加一些图形使图片更有特征
        draw.rectangle([50, 50, 150, 150], fill=(0, 255, 0))
        draw.ellipse([75, 75, 125, 125], fill=(0, 0, 255))
        return image
    
    @pytest.mark.asyncio
    async def test_text_assertion_success(self, browser_page, ui_operations):
        """测试文本断言成功情况"""
        # 创建包含特定文本的HTML页面
        html_content = """
        <html>
            <body>
                <h1>Test Page</h1>
                <p>This is a test paragraph with specific content.</p>
                <div id="target">Expected Text Content</div>
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        
        # 测试文本断言
        result = await ui_operations.text_assert("Expected Text Content")
        assert result is True
        
        # 测试选择器文本断言
        result = await ui_operations.text_assert("Expected Text Content", selector="#target")
        assert result is True
    
    @pytest.mark.asyncio
    async def test_text_assertion_failure(self, browser_page, ui_operations):
        """测试文本断言失败情况"""
        html_content = """
        <html>
            <body>
                <h1>Test Page</h1>
                <p>This is a test paragraph.</p>
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        
        # 测试不存在的文本应该抛出断言错误
        with pytest.raises(AssertionError):
            await ui_operations.text_assert("Non-existent Text")
    
    @pytest.mark.asyncio
    async def test_element_assertion_success(self, browser_page, ui_operations):
        """测试元素存在断言成功情况"""
        html_content = """
        <html>
            <body>
                <h1 id="title">Test Page</h1>
                <button class="btn">Click Me</button>
                <input type="text" name="username" />
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        
        # 测试各种选择器
        assert await ui_operations.element_assert("#title") is True
        assert await ui_operations.element_assert(".btn") is True
        assert await ui_operations.element_assert("input[name='username']") is True
        assert await ui_operations.element_assert("h1") is True
    
    @pytest.mark.asyncio
    async def test_element_assertion_failure(self, browser_page, ui_operations):
        """测试元素存在断言失败情况"""
        html_content = "<html><body><p>Simple page</p></body></html>"
        await browser_page.set_content(html_content)
        
        # 测试不存在的元素应该抛出断言错误
        with pytest.raises(AssertionError):
            await ui_operations.element_assert("#non-existent")
    
    @pytest.mark.asyncio
    async def test_url_assertion_success(self, browser_page, ui_operations):
        """测试URL断言成功情况"""
        await browser_page.goto("https://example.com")
        
        # 测试完整URL匹配
        assert await ui_operations.url_assert("https://example.com/") is True
        
        # 测试URL包含匹配
        assert await ui_operations.url_assert("example.com", match_type="contains") is True
        
        # 测试正则表达式匹配
        assert await ui_operations.url_assert(r"https://.*\.com/?", match_type="regex") is True
    
    @pytest.mark.asyncio
    async def test_url_assertion_failure(self, browser_page, ui_operations):
        """测试URL断言失败情况"""
        await browser_page.goto("https://example.com")
        
        # 测试不匹配的URL应该抛出断言错误
        with pytest.raises(AssertionError):
            await ui_operations.url_assert("https://google.com")
    
    @pytest.mark.asyncio
    async def test_image_ssim_assertion_success(self, browser_page, ui_operations, temp_dir):
        """测试SSIM图片断言成功情况"""
        # 创建简单的HTML页面
        html_content = """
        <html>
            <body style="background-color: #f0f0f0;">
                <h1 style="color: #333;">Test Page for Image Assertion</h1>
                <div style="width: 200px; height: 100px; background-color: #4CAF50; margin: 20px;">
                    Green Box
                </div>
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        await browser_page.wait_for_load_state("networkidle")
        
        # 创建参考图片
        reference_path = temp_dir / "reference.png"
        await browser_page.screenshot(path=str(reference_path))
        
        # 测试SSIM断言（应该成功，因为是同一个页面）
        result = await ui_operations.image_assert_ssim(
            reference_image_path=str(reference_path),
            threshold=0.95
        )
        assert result is True
    
    @pytest.mark.asyncio
    async def test_image_ssim_assertion_failure(self, browser_page, ui_operations, temp_dir):
        """测试SSIM图片断言失败情况"""
        # 创建第一个页面并截图
        html_content1 = """
        <html>
            <body style="background-color: #f0f0f0;">
                <h1>Original Page</h1>
            </body>
        </html>
        """
        await browser_page.set_content(html_content1)
        reference_path = temp_dir / "reference.png"
        await browser_page.screenshot(path=str(reference_path))
        
        # 创建不同的页面
        html_content2 = """
        <html>
            <body style="background-color: #000;">
                <h1 style="color: white;">Different Page</h1>
            </body>
        </html>
        """
        await browser_page.set_content(html_content2)
        
        # 测试SSIM断言（应该失败，因为页面不同）
        with pytest.raises(AssertionError):
            await ui_operations.image_assert_ssim(
                reference_image_path=str(reference_path),
                threshold=0.8
            )
    
    @pytest.mark.asyncio
    async def test_image_template_match_assertion(self, browser_page, ui_operations, temp_dir):
        """测试模板匹配断言"""
        # 创建包含特定元素的页面
        html_content = """
        <html>
            <body>
                <div style="width: 100px; height: 100px; background-color: red; margin: 50px;">
                    Red Box
                </div>
                <div style="width: 100px; height: 100px; background-color: blue; margin: 50px;">
                    Blue Box
                </div>
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        
        # 截取红色方块作为模板
        red_box = await browser_page.locator("div").first.bounding_box()
        if red_box:
            template_path = temp_dir / "red_box_template.png"
            await browser_page.screenshot(
                path=str(template_path),
                clip=red_box
            )
            
            # 测试模板匹配（应该能找到红色方块）
            result = await ui_operations.image_assert_template_match(
                template_path=str(template_path),
                confidence=0.7
            )
            assert result is True
    
    @pytest.mark.asyncio
    async def test_attribute_assertion_success(self, browser_page, ui_operations):
        """测试属性断言成功情况"""
        html_content = """
        <html>
            <body>
                <input id="username" type="text" value="test_user" placeholder="Enter username" />
                <button class="primary-btn" data-action="submit">Submit</button>
                <div title="Tooltip text">Hover me</div>
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        
        # 测试各种属性断言
        assert await ui_operations.attribute_assert("#username", "type", "text") is True
        assert await ui_operations.attribute_assert("#username", "value", "test_user") is True
        assert await ui_operations.attribute_assert("button", "class", "primary-btn") is True
        assert await ui_operations.attribute_assert("button", "data-action", "submit") is True
        assert await ui_operations.attribute_assert("div[title]", "title", "Tooltip text") is True
    
    @pytest.mark.asyncio
    async def test_attribute_assertion_failure(self, browser_page, ui_operations):
        """测试属性断言失败情况"""
        html_content = """
        <html>
            <body>
                <input id="username" type="text" value="test_user" />
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        
        # 测试错误的属性值应该抛出断言错误
        with pytest.raises(AssertionError):
            await ui_operations.attribute_assert("#username", "type", "password")
        
        # 测试不存在的属性应该抛出断言错误
        with pytest.raises(AssertionError):
            await ui_operations.attribute_assert("#username", "non-existent", "value")
    
    @pytest.mark.asyncio
    async def test_css_assertion_success(self, browser_page, ui_operations):
        """测试CSS属性断言成功情况"""
        html_content = """
        <html>
            <head>
                <style>
                    .red-text { color: rgb(255, 0, 0); }
                    .large-font { font-size: 20px; }
                    .hidden { display: none; }
                </style>
            </head>
            <body>
                <p class="red-text">Red text</p>
                <h1 class="large-font">Large heading</h1>
                <div class="hidden">Hidden content</div>
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        
        # 测试CSS属性断言
        assert await ui_operations.css_assert(".red-text", "color", "rgb(255, 0, 0)") is True
        assert await ui_operations.css_assert(".large-font", "font-size", "20px") is True
        assert await ui_operations.css_assert(".hidden", "display", "none") is True
    
    @pytest.mark.asyncio
    async def test_css_assertion_failure(self, browser_page, ui_operations):
        """测试CSS属性断言失败情况"""
        html_content = """
        <html>
            <head>
                <style>
                    .red-text { color: rgb(255, 0, 0); }
                </style>
            </head>
            <body>
                <p class="red-text">Red text</p>
            </body>
        </html>
        """
        await browser_page.set_content(html_content)
        
        # 测试错误的CSS值应该抛出断言错误
        with pytest.raises(AssertionError):
            await ui_operations.css_assert(".red-text", "color", "rgb(0, 255, 0)")


# 运行测试的辅助函数
async def run_all_tests():
    """运行所有测试"""
    log_info("开始运行UI断言功能测试...")
    
    # 这里可以添加更多的测试运行逻辑
    # 实际使用时建议使用 pytest 命令行工具
    
    log_info("所有测试完成")


if __name__ == "__main__":
    # 运行测试
    print("运行UI断言功能测试...")
    print("请使用以下命令运行测试:")
    print("pytest tests/test_ui_assertions.py -v")
    print("或者:")
    print("python -m pytest tests/test_ui_assertions.py -v --tb=short") 