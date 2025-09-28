import time
from datetime import datetime
from os import path


class BasePage:
    def __init__(self, page):
        self.page = page

    async def goto(self, url):
        return await self.page.goto(url)

    def locator_element(self, element):
        return self.page.locator(element)

    async def elem_click(self, element):
        return await self.locator_element(element).click()

    async def elem_double_click(self, element):
        return await self.locator_element(element).dblclick()

    async def elem_fill(self, element, value):
        return await self.locator_element(element).fill(value)

    async def page_screenshot(self, funcname):
        return await self.page.screenshot(path=path.join(path.dirname(path.dirname(__file__)), 'IMG_LOGS',
                                                   f'{funcname}_{datetime.fromtimestamp(time.time()).strftime("%Y_%m_%d_%H_%M_%S")}.png'))

    async def page_mouse_scroll(self,delta_x=0, delta_y=1100):
        return await self.page.mouse.wheel(delta_x, delta_y)

    async def context_text(self):
        return await self.page.content()

    async def get_page_cookies(self):
        return await self.page.cookies()
    
    async def is_page_closed(self):
        """检查页面是否已关闭"""
        try:
            # 尝试获取页面标题来检测页面是否还存在
            await self.page.title()
            return False
        except Exception:
            # 如果抛出异常，说明页面已关闭
            return True
    
    async def is_browser_closed(self):
        """检查浏览器是否已关闭"""
        try:
            # 尝试访问页面的基本属性
            self.page.url
            return False
        except Exception:
            # 如果抛出异常，说明浏览器已关闭
            return True
