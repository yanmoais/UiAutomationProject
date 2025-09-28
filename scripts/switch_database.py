#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库切换脚本
快速在SQLite和MySQL之间切换
"""

import os
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

def print_banner():
    """打印横幅"""
    print("🔄 数据库切换工具")
    print("=" * 30)

def set_sqlite_mode():
    """设置SQLite模式"""
    print("🔧 切换到SQLite模式...")
    
    # 清除MySQL相关环境变量
    env_vars_to_clear = [
        'DATABASE_TYPE',
        'MYSQL_HOST',
        'MYSQL_PORT',
        'MYSQL_USER',
        'MYSQL_PASSWORD',
        'MYSQL_DATABASE'
    ]
    
    for var in env_vars_to_clear:
        if var in os.environ:
            del os.environ[var]
    
    print("✅ 已切换到SQLite模式")
    print("   数据库文件: automation.db")
    return True

def set_mysql_mode(host='localhost', port='3306', user='root', password='your_password', database='automation'):
    """设置MySQL模式"""
    print("🔧 切换到MySQL模式...")
    
    os.environ['DATABASE_TYPE'] = 'mysql'
    os.environ['MYSQL_HOST'] = host
    os.environ['MYSQL_PORT'] = port
    os.environ['MYSQL_USER'] = user
    os.environ['MYSQL_PASSWORD'] = password
    os.environ['MYSQL_DATABASE'] = database
    
    print("✅ 已切换到MySQL模式")
    print(f"   主机: {host}:{port}")
    print(f"   数据库: {database}")
    print(f"   用户: {user}")
    return True

def show_current_config():
    """显示当前配置"""
    print("\n📋 当前数据库配置:")
    
    if 'DATABASE_TYPE' in os.environ and os.environ['DATABASE_TYPE'] == 'mysql':
        print("   类型: MySQL")
        print(f"   主机: {os.environ.get('MYSQL_HOST', 'localhost')}")
        print(f"   端口: {os.environ.get('MYSQL_PORT', '3306')}")
        print(f"   数据库: {os.environ.get('MYSQL_DATABASE', 'automation')}")
        print(f"   用户: {os.environ.get('MYSQL_USER', 'root')}")
    else:
        print("   类型: SQLite")
        print("   数据库文件: automation.db")
    
    print(f"\n环境变量文件: {project_root / '.env'}")

def test_connection():
    """测试数据库连接"""
    print("\n🔍 测试数据库连接...")
    
    try:
        from config.database_config import get_current_db_config
        
        config = get_current_db_config()
        
        if config['type'] == 'mysql':
            print("测试MySQL连接...")
            import pymysql
            mysql_config = config['config']
            
            connection = pymysql.connect(
                host=mysql_config['host'],
                port=mysql_config['port'],
                user=mysql_config['user'],
                password=mysql_config['password'],
                database=mysql_config['database'],
                charset=mysql_config['charset']
            )
            
            cursor = connection.cursor()
            cursor.execute("SHOW TABLES")
            tables = cursor.fetchall()
            connection.close()
            
            print(f"✅ MySQL连接成功，发现 {len(tables)} 个表")
            return True
            
        else:
            print("测试SQLite连接...")
            import sqlite3
            
            db_path = config['config']['database_path']
            if os.path.exists(db_path):
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
                table_count = cursor.fetchone()[0]
                conn.close()
                print(f"✅ SQLite连接成功，发现 {table_count} 个表")
                return True
            else:
                print("⚠️  SQLite数据库文件不存在，将在首次运行时创建")
                return True
                
    except ImportError as e:
        print(f"❌ 缺少必要的包: {e}")
        if 'pymysql' in str(e):
            print("   请运行: pip install pymysql")
        return False
    except Exception as e:
        print(f"❌ 连接测试失败: {e}")
        return False

def main():
    """主函数"""
    print_banner()
    
    if len(sys.argv) < 2:
        print("用法:")
        print("  python switch_database.py sqlite                    # 切换到SQLite")
        print("  python switch_database.py mysql                     # 切换到MySQL (使用默认配置)")
        print("  python switch_database.py mysql host user pass db   # 切换到MySQL (自定义配置)")
        print("  python switch_database.py show                      # 显示当前配置")
        print("  python switch_database.py test                      # 测试当前配置")
        print()
        show_current_config()
        return
    
    command = sys.argv[1].lower()
    
    if command == 'sqlite':
        set_sqlite_mode()
        show_current_config()
        
    elif command == 'mysql':
        if len(sys.argv) == 2:
            # 使用默认配置
            set_mysql_mode()
        elif len(sys.argv) == 6:
            # 使用自定义配置
            host = sys.argv[2]
            user = sys.argv[3]
            password = sys.argv[4]
            database = sys.argv[5]
            set_mysql_mode(host, '3306', user, password, database)
        else:
            print("❌ MySQL参数错误")
            print("用法: python switch_database.py mysql [host] [user] [password] [database]")
            return
        
        show_current_config()
        
    elif command == 'show':
        show_current_config()
        
    elif command == 'test':
        test_connection()
        
    else:
        print(f"❌ 未知命令: {command}")
        print("可用命令: sqlite, mysql, show, test")

if __name__ == '__main__':
    main() 