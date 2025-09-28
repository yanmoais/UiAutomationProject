import time
import os
import sys
import json
import pyautogui
import numpy
import re

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
sys.path.insert(0, project_root)

try:
    from conftest import *
    from Base_Page.Base_Pages import BasePage
    from Base_ENV.config import *
    from config.logger import log_info
except ImportError as e:
    log_info(f"导入模块失败: {e}")
    # 如果导入失败，继续执行连接测试


def _extract_and_normalize_urls(product_addresses, fallback_if_invalid=False):
    urls = []
    # 提取地址
    for item in product_addresses:
        addr = None
        if isinstance(item, (list, tuple)):
            if len(item) >= 2:
                addr = item[1]
            elif len(item) == 1:
                addr = item[0]
        elif isinstance(item, dict):
            for key in ('url', 'address', 'link', 'addr'):
                if key in item and item[key]:
                    addr = item[key]
                    break
            if addr is None and item:
                # 兜底取第一个值
                try:
                    addr = next(iter(item.values()))
                except StopIteration:
                    addr = None
        elif isinstance(item, str):
            addr = item
        
        if not addr:
            continue
        
        u = str(addr).strip()
        # 规范化URL：补全协议
        if u.startswith('//'):
            u = 'https:' + u
        elif re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', u):
            pass
        else:
            # 常见域名/IP/localhost/端口形式，没有协议前缀时补http
            u = 'http://' + u
        urls.append(u)
    return urls


def test_web_connection(*urls):
    """Web连接测试函数，用于独立运行"""
    try:
        log_info("开始Web连接测试...")
        
        # 获取环境变量
        project_id = os.environ.get('PROJECT_ID', 'unknown')
        system = os.environ.get('SYSTEM', 'web')
        product_type = os.environ.get('PRODUCT_TYPE', 'unknown')
        environment = os.environ.get('ENVIRONMENT', 'test')
        
        # 获取产品地址列表
        product_addresses_str = os.environ.get('PRODUCT_ADDRESSES', '')
        product_addresses = []
        
        if product_addresses_str:
            try:
                product_addresses = json.loads(product_addresses_str)
                log_info(f"获取到产品地址列表: {product_addresses}")
            except (json.JSONDecodeError, TypeError) as e:
                log_info(f"解析产品地址失败: {e}")
                product_addresses = []
        
        log_info(f"项目ID: {project_id}")
        log_info(f"系统类型: {system}")
        log_info(f"产品类型: {product_type}")
        log_info(f"环境: {environment}")
        log_info(f"产品地址数量: {len(product_addresses)}")
        
        # 确定测试URL列表
        if urls:
            # 如果传入了URL参数，使用传入的URL
            test_urls = []
            for u in urls:
                if isinstance(u, (list, tuple)):
                    test_urls.extend(_extract_and_normalize_urls([u]))
                else:
                    test_urls.extend(_extract_and_normalize_urls([(None, u)] if not isinstance(u, str) else [[None, u]]))
            log_info(f"使用传入的URL进行测试: {test_urls}")
        elif product_addresses:
            # 如果有产品地址，使用产品地址进行测试
            # product_addresses 格式: [(product_id, address), ...] 或 其它
            test_urls = _extract_and_normalize_urls(product_addresses)
            if not test_urls:
                # 如果没有有效URL，回退到默认
                test_urls = [
                    "https://www.baidu.com",
                    "https://www.qq.com",
                    "https://www.163.com"
                ]
                log_info("未发现有效产品地址，使用默认URL进行测试")
            else:
                log_info(f"使用产品地址进行测试: {test_urls}")
        else:
            # 默认使用国内可访问的网站进行测试
            test_urls = [
                "https://www.baidu.com",
                "https://www.qq.com",
                "https://www.163.com"
            ]
            log_info(f"使用默认URL进行测试: {test_urls}")
        
        success_count = 0
        total_count = len(test_urls)
        
        # 使用playwright进行连接测试
        from playwright.sync_api import sync_playwright
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            
            for url in test_urls:
                success = False
                max_retries = 2  # 最多重试2次
                
                for attempt in range(max_retries + 1):
                    page = None
                    try:
                        if attempt > 0:
                            log_info(f"重试连接 ({attempt}/{max_retries}): {url}")
                        else:
                            log_info(f"测试连接: {url}")
                        
                        page = browser.new_page()
                        
                        # 设置更长的超时时间和更宽松的等待策略
                        page.set_default_timeout(30000)  # 30秒超时
                        
                        # 使用domcontentloaded而不是load，更快更可靠
                        response = page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        
                        if response and (response.status == 200 or 200 <= response.status < 400):
                            log_info(f"[SUCCESS] {url} 连接成功 (状态码: {response.status})")
                            success = True
                            success_count += 1
                            page.close()
                            break
                        else:
                            log_info(f"[FAILED] {url} 连接失败，状态码: {response.status if response else 'N/A'}")
                        
                        page.close()
                        
                    except Exception as e:
                        if page:
                            try:
                                page.close()
                            except:
                                pass
                        
                        error_msg = str(e)
                        if "Timeout" in error_msg:
                            log_info(f"[TIMEOUT] {url} 连接超时 (尝试 {attempt + 1}/{max_retries + 1}): {error_msg}")
                        else:
                            log_info(f"[ERROR] {url} 连接异常 (尝试 {attempt + 1}/{max_retries + 1}): {error_msg}")
                        
                        # 如果是最后一次尝试，记录最终失败
                        if attempt == max_retries:
                            log_info(f"[FAILED] {url} 所有重试均失败")
                            break
                        
                        # 重试前等待1秒
                        import time
                        time.sleep(1)
            
            browser.close()
        
        # 输出测试结果
        log_info(f"\n连接测试结果:")
        log_info(f"成功: {success_count}/{total_count}")
        
        if success_count >= 1:  # 至少1个网站连接成功就算通过
            log_info("[SUCCESS] Web连接测试通过")
            return True
        else:
            log_info("[FAILED] Web连接测试失败")
            return False
            
    except Exception as e:
        log_info(f"[ERROR] Web连接测试异常: {str(e)}")
        return False

if __name__ == "__main__":
    """当作为独立脚本运行时，执行连接测试"""
    success = test_web_connection()
    sys.exit(0 if success else 1)