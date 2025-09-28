import pytest
import asyncio
from playwright.async_api import async_playwright
# ============================================================================
# 重要说明：
#
# 对于需要真正独立浏览器实例的测试，建议使用以下方式：
#
# 1. 在测试方法内部直接创建浏览器实例：
#    async with async_playwright() as p:
#        browser = await p.chromium.launch(headless=False, args=["--start-maximized"])
#        context = await browser.new_context(no_viewport=True)
#        page = await context.new_page()
#        # 执行测试...
#        await page.close()
#        await context.close()
#        await browser.close()
# 这样可以确保每个测试都有完全独立的浏览器进程，避免相互干扰
# ============================================================================


@pytest.fixture(scope="function")
def event_loop():
    """创建事件循环"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# 保留page fixture用于简单的单页面测试
@pytest.fixture(scope="function")
async def page():
    """
    创建单个页面实例
    注意：此方法会存在多个页面的cookie不一致的问题，仅用于简单测试
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, args=["--start-maximized"])
        context = await browser.new_context(no_viewport=True)
        page = await context.new_page()
        yield page
        await page.close()
        await context.close()
        await browser.close()

