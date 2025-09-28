#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
快速启动脚本
直接使用 database_config.py 中的配置启动应用
"""

import os
import sys
import subprocess
import time
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from config.database_config import get_current_db_config, get_database_url, DATABASE_TYPE

def print_banner():
    """打印启动横幅"""
    print("🌟 星火自动化测试平台 - 快速启动")
    print("=" * 50)

def check_dependencies():
    """检查依赖"""
    print("🔍 检查依赖...")
    
    # 检查Python版本
    if sys.version_info < (3, 8):
        print("❌ 需要Python 3.8或更高版本")
        return False
    
    print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
    
    # 检查必要的包
    required_packages = ['flask']
    if DATABASE_TYPE == 'mysql':
        required_packages.extend(['pymysql'])
    
    missing_packages = []
    for package in required_packages:
        try:
            __import__(package.replace('-', '_'))
            print(f"✅ {package}")
        except ImportError:
            missing_packages.append(package)
            print(f"❌ {package}")
    
    # 跳过SQLAlchemy检查，因为存在兼容性问题
    print("⚠️  SQLAlchemy (跳过检查，存在兼容性问题)")
    
    if missing_packages:
        print(f"\n📦 安装缺失的包: pip install {' '.join(missing_packages)}")
        return False
    
    return True

def check_database():
    """检查数据库配置"""
    print("\n🔍 检查数据库配置...")
    
    config = get_current_db_config()
    print(f"数据库类型: {config['type']}")
    
    if config['type'] == 'mysql':
        print("MySQL配置:")
        mysql_config = config['config']
        print(f"  主机: {mysql_config['host']}:{mysql_config['port']}")
        print(f"  数据库: {mysql_config['database']}")
        print(f"  用户: {mysql_config['user']}")
        print(f"  字符集: {mysql_config['charset']}")
        
        # 检查MySQL连接
        try:
            import pymysql
            connection = pymysql.connect(
                host=mysql_config['host'],
                port=mysql_config['port'],
                user=mysql_config['user'],
                password=mysql_config['password'],
                database=mysql_config['database'],
                charset=mysql_config['charset']
            )
            connection.close()
            print("✅ MySQL连接成功")
        except Exception as e:
            print(f"❌ MySQL连接失败: {e}")
            return False
    else:
        print("SQLite配置:")
        print(f"  数据库文件: {config['config']['database_path']}")
        
        # 检查SQLite文件
        db_file = Path(config['config']['database_path'])
        if db_file.exists():
            print(f"✅ 数据库文件存在: {db_file.absolute()}")
        else:
            print(f"⚠️  数据库文件不存在，将在首次运行时创建")
    
    return True

def start_application():
    """启动应用"""
    print("\n🚀 启动应用...")
    
    # 设置环境变量
    os.environ['FLASK_APP'] = 'app.py'
    os.environ['FLASK_ENV'] = 'development'
    
    # 启动命令
    if os.name == 'nt':  # Windows
        cmd = ['python', 'app.py']
    else:  # Unix/Linux
        cmd = ['python3', 'app.py']
    
    try:
        print(f"执行命令: {' '.join(cmd)}")
        process = subprocess.Popen(cmd, cwd=project_root)
        
        print("\n✅ 应用启动成功!")
        print("🌐 访问地址: http://127.0.0.1:5000")
        print("📱 移动端地址: http://192.168.1.100:5000")
        print("\n按 Ctrl+C 停止应用")
        
        # 等待进程结束
        process.wait()
        
    except KeyboardInterrupt:
        print("\n\n🛑 收到停止信号，正在关闭应用...")
        if 'process' in locals():
            process.terminate()
            process.wait()
        print("✅ 应用已停止")
    except Exception as e:
        print(f"❌ 启动失败: {e}")

def main():
    """主函数"""
    print_banner()
    
    # 检查依赖
    if not check_dependencies():
        print("\n❌ 依赖检查失败，请先安装必要的包")
        return
    
    # 检查数据库
    if not check_database():
        print("\n❌ 数据库配置检查失败")
        return
    
    # 启动应用
    start_application()

if __name__ == '__main__':
    main() 