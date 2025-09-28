#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库配置检查脚本
验证数据库配置是否正确
"""

import os
import sys
import sqlite3

# 添加项目根目录到Python路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.database_config import get_current_db_config, get_database_path, get_database_url

def check_sqlite_database():
    """检查SQLite数据库"""
    print("检查SQLite数据库...")
    
    db_path = get_database_path()
    if not db_path:
        print("❌ 错误：无法获取SQLite数据库路径")
        return False
    
    print(f"数据库路径: {db_path}")
    
    # 检查文件是否存在
    if not os.path.exists(db_path):
        print(f"❌ 错误：数据库文件不存在: {db_path}")
        return False
    
    print(f"✅ 数据库文件存在: {db_path}")
    
    # 检查文件大小
    file_size = os.path.getsize(db_path)
    print(f"数据库文件大小: {file_size / (1024*1024):.2f} MB")
    
    # 尝试连接数据库
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 检查表结构
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        print(f"✅ 数据库连接成功，发现 {len(tables)} 个表:")
        for table in tables:
            print(f"  - {table[0]}")
        
        # 检查主要表的数据
        if tables:
            for table_name in ['users', 'projects', 'automation_projects', 'automation_executions']:
                if any(table[0] == table_name for table in tables):
                    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                    count = cursor.fetchone()[0]
                    print(f"  - {table_name}: {count} 条记录")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ 数据库连接失败: {e}")
        return False

def check_mysql_database():
    """检查MySQL数据库"""
    print("检查MySQL数据库...")
    
    try:
        import pymysql
        config = get_current_db_config()
        mysql_config = config['config']
        
        print(f"主机: {mysql_config['host']}")
        print(f"端口: {mysql_config['port']}")
        print(f"数据库: {mysql_config['database']}")
        print(f"用户: {mysql_config['user']}")
        
        # 尝试连接
        conn = pymysql.connect(
            host=mysql_config['host'],
            port=mysql_config['port'],
            user=mysql_config['user'],
            password=mysql_config['password'],
            database=mysql_config['database'],
            charset=mysql_config['charset']
        )
        
        cursor = conn.cursor()
        
        # 检查表结构
        cursor.execute("SHOW TABLES")
        tables = cursor.fetchall()
        
        print(f"✅ MySQL连接成功，发现 {len(tables)} 个表:")
        for table in tables:
            print(f"  - {table[0]}")
        
        # 检查主要表的数据
        if tables:
            for table_name in ['users', 'projects', 'automation_projects', 'automation_executions']:
                if any(table[0] == table_name for table in tables):
                    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                    count = cursor.fetchone()[0]
                    print(f"  - {table_name}: {count} 条记录")
        
        conn.close()
        return True
        
    except ImportError:
        print("❌ 错误：未安装pymysql，请运行: pip install pymysql")
        return False
    except Exception as e:
        print(f"❌ MySQL连接失败: {e}")
        return False

def check_environment_variables():
    """检查环境变量配置"""
    print("检查环境变量配置...")
    
    env_vars = [
        'DATABASE_TYPE',
        'MYSQL_HOST',
        'MYSQL_PORT',
        'MYSQL_USER',
        'MYSQL_PASSWORD',
        'MYSQL_DATABASE'
    ]
    
    for var in env_vars:
        value = os.getenv(var)
        if value:
            if 'PASSWORD' in var:
                print(f"  {var}: {'*' * len(value)}")
            else:
                print(f"  {var}: {value}")
        else:
            print(f"  {var}: 未设置")
    
    return True

def main():
    """主函数"""
    print("=" * 60)
    print("数据库配置检查工具")
    print("=" * 60)
    
    # 检查环境变量
    check_environment_variables()
    print()
    
    # 获取当前配置
    config = get_current_db_config()
    print(f"当前数据库类型: {config['type']}")
    print(f"连接URL: {get_database_url()}")
    print()
    
    # 根据类型检查数据库
    if config['type'] == 'sqlite':
        success = check_sqlite_database()
    elif config['type'] == 'mysql':
        success = check_mysql_database()
    else:
        print(f"❌ 未知的数据库类型: {config['type']}")
        success = False
    
    print()
    print("=" * 60)
    if success:
        print("✅ 数据库配置检查通过！")
    else:
        print("❌ 数据库配置检查失败！")
    print("=" * 60)

if __name__ == '__main__':
    main() 