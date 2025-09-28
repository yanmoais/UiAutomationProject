#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库迁移脚本
支持从SQLite迁移到MySQL
"""

import os
import sys
import sqlite3
import json
from datetime import datetime

# 添加项目根目录到Python路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.database_config import get_current_db_config, get_database_path

def get_sqlite_connection():
    """获取SQLite数据库连接"""
    db_path = get_database_path()
    if not db_path or not os.path.exists(db_path):
        print(f"错误：SQLite数据库文件不存在: {db_path}")
        return None
    
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f"连接SQLite数据库失败: {e}")
        return None

def get_mysql_connection():
    """获取MySQL数据库连接"""
    try:
        import pymysql
        config = get_current_db_config()
        if config['type'] != 'mysql':
            print("错误：当前配置不是MySQL模式")
            return None
        
        mysql_config = config['config']
        conn = pymysql.connect(
            host=mysql_config['host'],
            port=mysql_config['port'],
            user=mysql_config['user'],
            password=mysql_config['password'],
            database=mysql_config['database'],
            charset=mysql_config['charset']
        )
        return conn
    except ImportError:
        print("错误：未安装pymysql，请运行: pip install pymysql")
        return None
    except Exception as e:
        print(f"连接MySQL数据库失败: {e}")
        return None

def create_mysql_tables(mysql_conn):
    """在MySQL中创建表结构"""
    cursor = mysql_conn.cursor()
    
    # 创建用户表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL,
            is_active BOOLEAN DEFAULT TRUE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    
    # 创建项目表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_package_name VARCHAR(255) NOT NULL,
            product_address TEXT NOT NULL,
            product_id VARCHAR(255),
            is_automated VARCHAR(10) NOT NULL,
            version_number VARCHAR(100),
            product_image TEXT,
            system_type VARCHAR(100),
            product_type VARCHAR(100),
            environment VARCHAR(100),
            remarks TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    
    # 创建枚举值管理表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS enum_values (
            id INT AUTO_INCREMENT PRIMARY KEY,
            field_name VARCHAR(100) NOT NULL,
            field_value VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_field_value (field_name, field_value)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    
    # 创建自动化项目表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS automation_projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            process_name VARCHAR(255) NOT NULL,
            product_ids TEXT NOT NULL,
            `system` VARCHAR(100),
            product_type VARCHAR(100),
            environment VARCHAR(100),
            product_address TEXT,
            project_id INT NULL,
            test_steps TEXT,
            status VARCHAR(50) DEFAULT '待执行',
            created_by VARCHAR(100) DEFAULT 'admin',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    
    # 创建项目文件映射表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            project_id INT NOT NULL,
            project_name VARCHAR(255) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            file_path TEXT NOT NULL,
            file_type VARCHAR(10) DEFAULT 'py',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES automation_projects (id) ON DELETE CASCADE,
            UNIQUE KEY unique_project_file (project_id, file_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    
    # 创建自动化执行记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS automation_executions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            project_id INT,
            process_name VARCHAR(255) NOT NULL,
            product_ids TEXT NOT NULL,
            `system` VARCHAR(100),
            product_type VARCHAR(100),
            environment VARCHAR(100),
            product_address TEXT,
            status VARCHAR(50) NOT NULL,
            start_time TIMESTAMP NULL,
            end_time TIMESTAMP NULL,
            log_message TEXT,
            detailed_log TEXT,
            executed_by VARCHAR(100) DEFAULT 'admin',
            FOREIGN KEY (project_id) REFERENCES automation_projects (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ''')
    
    mysql_conn.commit()
    print("MySQL表结构创建完成")

def migrate_data(sqlite_conn, mysql_conn):
    """迁移数据从SQLite到MySQL"""
    sqlite_cursor = sqlite_conn.cursor()
    mysql_cursor = mysql_conn.cursor()
    
    # 迁移用户数据
    print("迁移用户数据...")
    sqlite_cursor.execute('SELECT * FROM users')
    users = sqlite_cursor.fetchall()
    for user in users:
        try:
            mysql_cursor.execute('''
                INSERT INTO users (username, email, password_hash, created_at, last_login, is_active)
                VALUES (%s, %s, %s, %s, %s, %s)
            ''', (
                user['username'], user['email'], user['password_hash'],
                user['created_at'], user['last_login'], user['is_active']
            ))
        except Exception as e:
            print(f"迁移用户数据失败: {e}")
    
    # 迁移项目数据
    print("迁移项目数据...")
    sqlite_cursor.execute('SELECT * FROM projects')
    projects = sqlite_cursor.fetchall()
    for project in projects:
        try:
            mysql_cursor.execute('''
                INSERT INTO projects (product_package_name, product_address, product_id, is_automated,
                                   version_number, product_image, system_type, product_type,
                                   environment, remarks, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                project['product_package_name'], project['product_address'], project['product_id'],
                project['is_automated'], project['version_number'], project['product_image'],
                project['system_type'], project['product_type'], project['environment'],
                project['remarks'], project['created_at'], project['updated_at']
            ))
        except Exception as e:
            print(f"迁移项目数据失败: {e}")
    
    # 迁移自动化项目数据
    print("迁移自动化项目数据...")
    sqlite_cursor.execute('SELECT * FROM automation_projects')
    automation_projects = sqlite_cursor.fetchall()
    for project in automation_projects:
        try:
            mysql_cursor.execute('''
                INSERT INTO automation_projects (process_name, product_ids, system, product_type,
                                              environment, product_address, project_id, test_steps, status,
                                              created_by, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                project['process_name'], project['product_ids'], project['system'],
                project['product_type'], project['environment'], project['product_address'],
                project.get('project_id'), project['test_steps'], project['status'], project['created_by'],
                project['created_at'], project['updated_at']
            ))
        except Exception as e:
            print(f"迁移自动化项目数据失败: {e}")
    
    # 迁移枚举值数据
    print("迁移枚举值数据...")
    sqlite_cursor.execute('SELECT * FROM enum_values')
    enum_values = sqlite_cursor.fetchall()
    for enum_value in enum_values:
        try:
            mysql_cursor.execute('''
                INSERT INTO enum_values (field_name, field_value, created_at)
                VALUES (%s, %s, %s)
            ''', (
                enum_value['field_name'], enum_value['field_value'], enum_value['created_at']
            ))
        except Exception as e:
            print(f"迁移枚举值数据失败: {e}")
    
    mysql_conn.commit()
    print("数据迁移完成")

def main():
    """主函数"""
    print("=" * 60)
    print("数据库迁移工具")
    print("=" * 60)
    
    # 检查当前配置
    config = get_current_db_config()
    print(f"当前数据库类型: {config['type']}")
    
    if config['type'] != 'mysql':
        print("错误：当前配置不是MySQL模式，无法进行迁移")
        print("请先设置环境变量切换到MySQL模式")
        return
    
    # 获取数据库连接
    sqlite_conn = get_sqlite_connection()
    if not sqlite_conn:
        return
    
    mysql_conn = get_mysql_connection()
    if not mysql_conn:
        sqlite_conn.close()
        return
    
    try:
        # 创建MySQL表结构
        print("创建MySQL表结构...")
        create_mysql_tables(mysql_conn)
        
        # 迁移数据
        print("开始迁移数据...")
        migrate_data(sqlite_conn, mysql_conn)
        
        print("=" * 60)
        print("数据库迁移成功完成！")
        print("=" * 60)
        
    except Exception as e:
        print(f"迁移过程中出错: {e}")
        mysql_conn.rollback()
    finally:
        sqlite_conn.close()
        mysql_conn.close()

if __name__ == '__main__':
    main() 