#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库管理工具
简化数据库切换和初始化操作
"""

import os
import sys
from pathlib import Path

def print_header():
    """打印标题"""
    print("🗄️  数据库管理工具")
    print("=" * 60)
    print("支持 SQLite 和 MySQL 数据库的快速切换和管理")
    print("=" * 60)

def show_current_status():
    """显示当前数据库状态"""
    print("\n📊 当前数据库状态:")
    
    # 检查环境变量
    db_type = os.getenv('DATABASE_TYPE', 'sqlite').lower()
    
    if db_type == 'mysql':
        print("   🔹 当前模式: MySQL")
        print(f"   🔹 主机: {os.getenv('MYSQL_HOST', 'localhost')}")
        print(f"   🔹 端口: {os.getenv('MYSQL_PORT', '3306')}")
        print(f"   🔹 数据库: {os.getenv('MYSQL_DATABASE', 'automation')}")
        print(f"   🔹 用户: {os.getenv('MYSQL_USER', 'root')}")
    else:
        print("   🔹 当前模式: SQLite")
        print("   🔹 数据库文件: automation.db")

def use_sqlite():
    """切换到SQLite模式"""
    print("\n🔧 切换到SQLite模式...")
    
    # 清除MySQL环境变量
    mysql_vars = ['DATABASE_TYPE', 'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']
    for var in mysql_vars:
        if var in os.environ:
            del os.environ[var]
    
    print("✅ 已切换到SQLite模式")
    print("   📁 数据库文件: automation.db")
    print("   📝 SQLite数据库会在首次运行时自动创建")

def use_mysql():
    """切换到MySQL模式"""
    print("\n🔧 切换到MySQL模式...")
    
    # 设置MySQL环境变量（使用本地数据库配置）
    os.environ['DATABASE_TYPE'] = 'mysql'
    os.environ['MYSQL_HOST'] = 'localhost'
    os.environ['MYSQL_PORT'] = '3306'
    os.environ['MYSQL_USER'] = 'root'
    os.environ['MYSQL_PASSWORD'] = '123456'
    os.environ['MYSQL_DATABASE'] = 'automation'
    
    print("✅ 已切换到MySQL模式")
    print("   🔹 主机: localhost:3306")
    print("   🔹 数据库: automation")
    print("   🔹 用户: root")
    print("\n💡 提示: 请确保MySQL服务器已启动并且可以连接")

def init_mysql():
    """初始化MySQL数据库"""
    print("\n🚀 初始化MySQL数据库...")
    
    try:
        # 首先切换到MySQL模式
        use_mysql()
        
        # 运行MySQL初始化脚本
        import subprocess
        result = subprocess.run([sys.executable, "scripts/init_mysql.py"], 
                              capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ MySQL数据库初始化成功!")
            print(result.stdout)
        else:
            print("❌ MySQL数据库初始化失败!")
            print(result.stderr)
            return False
            
    except Exception as e:
        print(f"❌ 初始化过程中出错: {e}")
        return False
    
    return True

def test_connection():
    """测试当前数据库连接"""
    print("\n🔍 测试数据库连接...")
    
    try:
        import subprocess
        result = subprocess.run([sys.executable, "scripts/test_db_connection.py"], 
                              capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ 数据库连接测试成功!")
            print(result.stdout)
        else:
            print("❌ 数据库连接测试失败!")
            print(result.stderr)
            
    except Exception as e:
        print(f"❌ 测试过程中出错: {e}")

def show_menu():
    """显示菜单"""
    print("\n📋 可用操作:")
    print("   1. 使用 SQLite 数据库")
    print("   2. 使用 MySQL 数据库")
    print("   3. 初始化 MySQL 数据库")
    print("   4. 测试数据库连接")
    print("   5. 显示当前状态")
    print("   0. 退出")
    print("-" * 40)

def main():
    """主函数"""
    print_header()
    show_current_status()
    
    while True:
        show_menu()
        choice = input("请选择操作 [0-5]: ").strip()
        
        if choice == '1':
            use_sqlite()
        elif choice == '2':
            use_mysql()
        elif choice == '3':
            init_mysql()
        elif choice == '4':
            test_connection()
        elif choice == '5':
            show_current_status()
        elif choice == '0':
            print("\n👋 退出数据库管理工具")
            break
        else:
            print("❌ 无效选择，请输入 0-5 之间的数字")
        
        input("\n按 Enter 键继续...")

if __name__ == '__main__':
    main() 