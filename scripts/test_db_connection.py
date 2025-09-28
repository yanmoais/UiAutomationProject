#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库连接测试脚本
测试数据库连接是否正常
"""

import os
import sys
import time

# 添加项目根目录到Python路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.database_config import get_current_db_config, get_database_path, get_database_url

def test_sqlite_connection():
    """测试SQLite连接"""
    print("测试SQLite连接...")
    
    try:
        import sqlite3
        
        db_path = get_database_path()
        if not db_path:
            print("❌ 错误：无法获取SQLite数据库路径")
            return False
        
        print(f"数据库路径: {db_path}")
        
        # 测试连接
        start_time = time.time()
        conn = sqlite3.connect(db_path)
        connect_time = (time.time() - start_time) * 1000
        
        print(f"✅ 连接成功！连接时间: {connect_time:.2f}ms")
        
        # 测试查询
        cursor = conn.cursor()
        start_time = time.time()
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        query_time = (time.time() - start_time) * 1000
        
        table_count = cursor.fetchone()[0]
        print(f"✅ 查询成功！表数量: {table_count}, 查询时间: {query_time:.2f}ms")
        
        # 测试表列表
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        print("数据库表列表:")
        for table in tables:
            print(f"  - {table[0]}")
        
        conn.close()
        return True
        
    except ImportError:
        print("❌ 错误：未安装sqlite3模块")
        return False
    except Exception as e:
        print(f"❌ SQLite连接测试失败: {e}")
        return False

def test_mysql_connection():
    """测试MySQL连接"""
    print("测试MySQL连接...")
    
    try:
        import pymysql
        
        config = get_current_db_config()
        if config['type'] != 'mysql':
            print("❌ 错误：当前配置不是MySQL模式")
            return False
        
        mysql_config = config['config']
        print(f"主机: {mysql_config['host']}")
        print(f"端口: {mysql_config['port']}")
        print(f"数据库: {mysql_config['database']}")
        print(f"用户: {mysql_config['user']}")
        
        # 测试连接
        start_time = time.time()
        conn = pymysql.connect(
            host=mysql_config['host'],
            port=mysql_config['port'],
            user=mysql_config['user'],
            password=mysql_config['password'],
            database=mysql_config['database'],
            charset=mysql_config['charset']
        )
        connect_time = (time.time() - start_time) * 1000
        
        print(f"✅ 连接成功！连接时间: {connect_time:.2f}ms")
        
        # 测试查询
        cursor = conn.cursor()
        start_time = time.time()
        cursor.execute("SHOW TABLES")
        query_time = (time.time() - start_time) * 1000
        
        tables = cursor.fetchall()
        print(f"✅ 查询成功！表数量: {len(tables)}, 查询时间: {query_time:.2f}ms")
        
        # 测试表列表
        print("数据库表列表:")
        for table in tables:
            print(f"  - {table[0]}")
        
        # 测试版本信息
        cursor.execute("SELECT VERSION()")
        version = cursor.fetchone()[0]
        print(f"MySQL版本: {version}")
        
        conn.close()
        return True
        
    except ImportError:
        print("❌ 错误：未安装pymysql，请运行: pip install pymysql")
        return False
    except Exception as e:
        print(f"❌ MySQL连接测试失败: {e}")
        return False

def test_database_operations():
    """测试数据库基本操作"""
    print("测试数据库基本操作...")
    
    config = get_current_db_config()
    
    if config['type'] == 'sqlite':
        return test_sqlite_operations()
    elif config['type'] == 'mysql':
        return test_mysql_operations()
    else:
        print(f"❌ 未知的数据库类型: {config['type']}")
        return False

def test_sqlite_operations():
    """测试SQLite基本操作"""
    try:
        import sqlite3
        
        db_path = get_database_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 测试插入
        print("  测试插入操作...")
        cursor.execute("""
            INSERT OR IGNORE INTO enum_values (field_name, field_value, created_at)
            VALUES (?, ?, ?)
        """, ('test_field', 'test_value', '2025-01-01 00:00:00'))
        
        # 测试查询
        print("  测试查询操作...")
        cursor.execute("SELECT COUNT(*) FROM enum_values WHERE field_name = ?", ('test_field',))
        count = cursor.fetchone()[0]
        print(f"    查询结果: {count} 条记录")
        
        # 测试更新
        print("  测试更新操作...")
        cursor.execute("""
            UPDATE enum_values SET field_value = ? WHERE field_name = ? AND field_value = ?
        """, ('updated_value', 'test_field', 'test_value'))
        
        # 测试删除
        print("  测试删除操作...")
        cursor.execute("DELETE FROM enum_values WHERE field_name = ? AND field_value = ?", 
                      ('test_field', 'updated_value'))
        
        conn.commit()
        conn.close()
        
        print("  ✅ SQLite基本操作测试通过")
        return True
        
    except Exception as e:
        print(f"  ❌ SQLite基本操作测试失败: {e}")
        return False

def test_mysql_operations():
    """测试MySQL基本操作"""
    try:
        import pymysql
        
        config = get_current_db_config()
        mysql_config = config['config']
        
        conn = pymysql.connect(
            host=mysql_config['host'],
            port=mysql_config['port'],
            user=mysql_config['user'],
            password=mysql_config['password'],
            database=mysql_config['database'],
            charset=mysql_config['charset']
        )
        cursor = conn.cursor()
        
        # 测试插入
        print("  测试插入操作...")
        cursor.execute("""
            INSERT IGNORE INTO enum_values (field_name, field_value, created_at)
            VALUES (%s, %s, %s)
        """, ('test_field', 'test_value', '2025-01-01 00:00:00'))
        
        # 测试查询
        print("  测试查询操作...")
        cursor.execute("SELECT COUNT(*) FROM enum_values WHERE field_name = %s", ('test_field',))
        count = cursor.fetchone()[0]
        print(f"    查询结果: {count} 条记录")
        
        # 测试更新
        print("  测试更新操作...")
        cursor.execute("""
            UPDATE enum_values SET field_value = %s WHERE field_name = %s AND field_value = %s
        """, ('updated_value', 'test_field', 'test_value'))
        
        # 测试删除
        print("  测试删除操作...")
        cursor.execute("DELETE FROM enum_values WHERE field_name = %s AND field_value = %s", 
                      ('test_field', 'updated_value'))
        
        conn.commit()
        conn.close()
        
        print("  ✅ MySQL基本操作测试通过")
        return True
        
    except Exception as e:
        print(f"  ❌ MySQL基本操作测试失败: {e}")
        return False

def main():
    """主函数"""
    print("=" * 60)
    print("数据库连接测试工具")
    print("=" * 60)
    
    # 获取当前配置
    config = get_current_db_config()
    print(f"当前数据库类型: {config['type']}")
    print(f"连接URL: {get_database_url()}")
    print()
    
    # 测试连接
    if config['type'] == 'sqlite':
        connection_success = test_sqlite_connection()
    elif config['type'] == 'mysql':
        connection_success = test_mysql_connection()
    else:
        print(f"❌ 未知的数据库类型: {config['type']}")
        return
    
    print()
    
    # 测试基本操作
    if connection_success:
        operations_success = test_database_operations()
    else:
        operations_success = False
    
    print()
    print("=" * 60)
    if connection_success and operations_success:
        print("✅ 所有测试通过！数据库配置正确。")
    else:
        print("❌ 部分测试失败，请检查数据库配置。")
    print("=" * 60)

if __name__ == '__main__':
    main() 