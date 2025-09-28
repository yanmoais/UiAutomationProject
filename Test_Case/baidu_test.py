import time
import pyautogui
import asyncio
from conftest import *
from Base_Page.Base_Pages import BasePage
from Base_ENV.config import *
from config.logger import log_info
from utils.ui_operations import UIOperations


async def test_baidu_searcher(page, **elem):
    base_page = BasePage(page)

    # 从参数获取配置值
    website_url = elem.get('website_url', "https://letsgogogold.com/")
    start_button_xpath = elem.get('start_button_xpath', "//*[@type='button' and text()='START']")
    accept_button_xpath = elem.get('accept_button_xpath', "//*[text()='Accept']")
    game_img_path = elem.get('game_img_path', r"\Game_Img\MoonlitWolf\main_game_MoonlitWolf.png")

    await base_page.goto(website_url)
    # 点击开始按钮
    await base_page.elem_click(start_button_xpath)
    # 点击同意按钮
    await base_page.elem_click(accept_button_xpath)
    await asyncio.sleep(3)
    await base_page.page_mouse_scroll()
    await asyncio.sleep(3)
    # 游戏图片匹配操作 - 使用改进的UIOperations
    ui_ops = UIOperations(page)
    try:
        # 使用改进的图片点击功能
        full_image_path = BASE_DIR + game_img_path
        log_info(f"尝试点击图片: {full_image_path}")
        
        click_result = await ui_ops.click_image(full_image_path, confidence=0.7, timeout=10)
        if click_result:
            log_info("图片点击成功！")
        else:
            log_info("图片点击失败 - 没有找到该图片！")
    except Exception as e:
        log_info(f"图片点击过程中发生错误: {e}")

    await asyncio.sleep(3)
    await base_page.page_screenshot('baidu_test')
    await asyncio.sleep(10)  # 减少等待时间用于测试
