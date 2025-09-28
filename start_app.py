#!/usr/bin/env python3
"""
星火自动化测试平台启动脚本
使用最新的配置系统和启动方式
"""

import os
import sys
import subprocess
import time
from config.logger import setup_logger, log_info, log_error, log_warning

def check_python_version():
    """检查Python版本"""
    if sys.version_info < (3, 8):
        log_error("需要Python 3.8或更高版本")
        log_error(f"当前版本: {sys.version}")
        return False
    log_info(f"Python版本检查通过: {sys.version.split()[0]}")
    return True

def check_dependencies():
    """检查依赖包是否已安装
    返回: (ok: bool, missing_packages: list[str])
    """
    log_info("检查依赖包...")
    
    try:
        # 检查requirements.txt是否存在
        if not os.path.exists('requirements.txt'):
            log_warning("requirements.txt文件不存在，跳过依赖检查")
            return True, []
        
        # 读取requirements.txt中的依赖
        with open('requirements.txt', 'r', encoding='utf-8') as f:
            requirements = [line.strip() for line in f if line.strip() and not line.startswith('#')]
        
        if not requirements:
            log_warning("requirements.txt为空，跳过依赖检查")
            return True, []
        
        # 检查已安装的包（基于import名的最佳努力检查）
        missing_packages = []
        for req in requirements:
            # 处理版本号，只取包名
            package_name = req.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0].split('!=')[0]
            package_name = package_name.strip()
            
            # import名与包名可能不一致，此处做简单替换，作为"尽力而为"检查
            import_name = package_name.replace('-', '_')
            try:
                __import__(import_name)
            except ImportError:
                missing_packages.append(package_name)
        
        if missing_packages:
            return False, missing_packages
        else:
            log_info("所有依赖包已安装")
            return True, []
            
    except Exception as e:
        log_error(f"检查依赖时出错: {e}")
        # 出错时不阻塞启动，交由后续模块在运行时自行报错
        return True, []

def install_dependencies():
    """安装依赖包（保留函数以便手动使用，启动流程不再调用）"""
    log_info("安装依赖包...")
    
    try:
        # 检查requirements.txt是否存在
        if not os.path.exists('requirements.txt'):
            log_error("requirements.txt文件不存在")
            return False
        
        # 提示
        log_info("即将安装依赖包，这可能需要一些时间...")
        
        # 安装依赖
        result = subprocess.run([
            sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements.txt'
        ], capture_output=True, text=True)
        
        if result.returncode == 0:
            log_info("依赖包安装成功")
            return True
        else:
            log_error(f"依赖包安装失败: {result.stderr}")
            return False
            
    except Exception as e:
        log_error(f"安装依赖时出错: {e}")
        return False

def setup_mysql_environment():
    """设置MySQL环境变量"""
    log_info("设置MySQL数据库环境变量...")
    
    # 设置为MySQL模式，使用本地数据库
    os.environ['DATABASE_TYPE'] = 'mysql'
    os.environ['MYSQL_HOST'] = 'localhost'
    os.environ['MYSQL_PORT'] = '3306'
    os.environ['MYSQL_USER'] = 'root'
    os.environ['MYSQL_PASSWORD'] = '123456'
    os.environ['MYSQL_DATABASE'] = 'automation'
    
    log_info("✅ MySQL环境变量已设置")
    log_info("   数据库类型: MySQL")
    log_info("   主机: localhost:3306")
    log_info("   用户: root")
    log_info("   数据库: automation")

def check_database():
    """检查数据库配置"""
    log_info("检查数据库配置...")
    
    try:
        from config.database_config import get_current_db_config, get_database_path
        
        config = get_current_db_config()
        if config['type'] == 'mysql':
            log_info(f"MySQL数据库配置: {config['config']['host']}:{config['config']['port']}")
            log_info(f"数据库名称: {config['config']['database']}")
            
            # 测试MySQL连接
            try:
                from config.database import get_db_connection_with_retry
                with get_db_connection_with_retry() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT VERSION()")
                    version = cursor.fetchone()[0]
                    log_info(f"✅ MySQL连接成功！版本: {version}")
                    
                    # 检查表是否存在
                    cursor.execute("SHOW TABLES")
                    tables = cursor.fetchall()
                    log_info(f"✅ 发现 {len(tables)} 个数据库表")
                    
            except Exception as e:
                log_error(f"❌ MySQL连接失败: {e}")
                log_error("请检查:")
                log_error("1. MySQL服务是否启动")
                log_error("2. 数据库是否已初始化（运行 python init_mysql_database.py）")
                return False
        else:
            db_file = get_database_path() or 'automation.db'
            if os.path.exists(db_file):
                log_info(f"SQLite数据库文件已存在: {db_file}")
            else:
                log_info(f"SQLite数据库文件将在首次运行时自动创建: {db_file}")
        
        return True
        
    except Exception as e:
        log_error(f"检查数据库配置时出错: {e}")
        return False

def start_application():
    """启动应用"""
    log_info("启动星火自动化测试平台...")
    
    try:
        # 使用最新的启动方式
        result = subprocess.run([
            sys.executable, 'scripts/quick_start.py'
        ], capture_output=False)
        
        if result.returncode != 0:
            log_error("应用启动失败")
            return False
            
    except KeyboardInterrupt:
        log_info("应用已停止")
        return True
    except Exception as e:
        log_error(f"启动应用时出错: {e}")
        return False

def show_info():
    """显示应用信息"""
    log_info("=" * 60)
    log_info("🌟 星火自动化测试平台")
    log_info("=" * 60)
    log_info("📋 功能特性:")
    log_info("   • 用户认证系统 (注册/登录/登出)")
    log_info("   • 产品版本管理")
    log_info("   • 自动化测试管理")
    log_info("   • 实时状态监控")
    log_info("   • 响应式Web界面")
    log_info("   • 多数据库支持 (SQLite/MySQL)")
    log_info("")
    log_info("🌐 访问地址:")
    log_info("   • 主页面: http://localhost:5000")
    log_info("   • 登录页面: http://localhost:5000/login")
    log_info("   • 注册页面: http://localhost:5000/register")
    log_info("")
    log_info("🔧 配置管理:")
    log_info("   • 数据库切换: python scripts/switch_database.py")
    log_info("   • 快速启动: python scripts/quick_start.py")
    log_info("=" * 60)

def main():
    """主函数"""
    # 设置日志记录器
    setup_logger('StartApp')
    
    show_info()
    
    # 检查Python版本
    if not check_python_version():
        return
    
    # 设置MySQL环境变量（将MySQL设为默认）
    setup_mysql_environment()
    
    # 检查依赖（不阻塞启动，不再尝试安装）
    deps_ok, missing_packages = check_dependencies()
    if not deps_ok:
        if missing_packages:
            log_warning(f"发现缺失的依赖包: {', '.join(missing_packages)}")
        log_warning("将继续启动应用。如需安装依赖，请手动执行: pip install -r requirements.txt")
    
    # 检查数据库
    if not check_database():
        log_error("数据库检查失败，请运行: python init_mysql_database.py")
        return
    
    # 启动应用
    log_info("🎉 准备就绪！正在启动应用...")
    log_info("💡 提示: 按 Ctrl+C 停止应用")
    log_info("-" * 60)
    
    start_application()

if __name__ == "__main__":
    main() 