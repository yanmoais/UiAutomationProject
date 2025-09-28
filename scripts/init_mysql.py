#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MySQL数据库初始化脚本
创建所有必要的表结构
"""

import sys
import os
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

def check_mysql_package():
    """检查MySQL包是否已安装"""
    try:
        import pymysql
        print("✅ pymysql 包已安装")
        return True
    except ImportError:
        print("❌ pymysql 包未安装")
        print("请运行: pip install pymysql")
        return False

def create_mysql_connection():
    """创建MySQL连接"""
    try:
        import pymysql
        from config.database_config import MYSQL_CONFIG
        
        print(f"🔌 连接到MySQL数据库...")
        print(f"   主机: {MYSQL_CONFIG['host']}:{MYSQL_CONFIG['port']}")
        print(f"   用户: {MYSQL_CONFIG['user']}")
        print(f"   数据库: {MYSQL_CONFIG['database']}")
        
        # 首先连接到MySQL服务器（不指定数据库）
        connection = pymysql.connect(
            host=MYSQL_CONFIG['host'],
            port=MYSQL_CONFIG['port'],
            user=MYSQL_CONFIG['user'],
            password=MYSQL_CONFIG['password'],
            charset=MYSQL_CONFIG['charset']
        )
        
        cursor = connection.cursor()
        
        # 创建数据库（如果不存在）
        database_name = MYSQL_CONFIG['database']
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{database_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        print(f"✅ 数据库 '{database_name}' 已准备就绪")
        
        # 选择数据库
        cursor.execute(f"USE `{database_name}`")
        
        connection.close()
        
        # 重新连接到指定的数据库
        connection = pymysql.connect(
            host=MYSQL_CONFIG['host'],
            port=MYSQL_CONFIG['port'],
            user=MYSQL_CONFIG['user'],
            password=MYSQL_CONFIG['password'],
            database=MYSQL_CONFIG['database'],
            charset=MYSQL_CONFIG['charset']
        )
        
        print("✅ MySQL连接成功")
        return connection
        
    except Exception as e:
        print(f"❌ MySQL连接失败: {e}")
        return None

def create_mysql_tables(connection):
    """创建MySQL表结构"""
    cursor = connection.cursor()
    
    try:
        print("📋 创建数据库表结构...")
        
        # 1. 创建用户表
        print("   创建 users 表...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP NULL,
                is_active BOOLEAN DEFAULT TRUE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')
        
        # 2. 创建项目表
        print("   创建 projects 表...")
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')
        
        # 3. 创建枚举值管理表
        print("   创建 enum_values 表...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS enum_values (
                id INT AUTO_INCREMENT PRIMARY KEY,
                field_name VARCHAR(100) NOT NULL,
                field_value VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_field_value (field_name, field_value)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')
        
        # 4. 创建自动化项目表
        print("   创建 automation_projects 表...")
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')
        
        # 5. 创建项目文件映射表
        print("   创建 project_files 表...")
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')
        
        # 6. 创建自动化执行记录表
        print("   创建 automation_executions 表...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS automation_executions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                automation_project_id INT NOT NULL,
                execution_status VARCHAR(50) DEFAULT '执行中',
                start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP NULL,
                execution_log TEXT,
                error_message TEXT,
                success_count INT DEFAULT 0,
                failure_count INT DEFAULT 0,
                created_by VARCHAR(100) DEFAULT 'admin',
                FOREIGN KEY (automation_project_id) REFERENCES automation_projects (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')
        
        # 7. 创建浏览器管理表
        print("   创建 browser_management 表...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS browser_management (
                id INT AUTO_INCREMENT PRIMARY KEY,
                browser_type VARCHAR(50) NOT NULL,
                browser_version VARCHAR(100),
                driver_version VARCHAR(100),
                driver_path TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')
        
        # 提交事务
        connection.commit()
        print("✅ 所有表创建成功!")
        
        # 显示已创建的表
        cursor.execute("SHOW TABLES")
        tables = cursor.fetchall()
        print(f"\n📊 数据库中的表 (共 {len(tables)} 个):")
        for table in tables:
            print(f"   - {table[0]}")
            
        return True
        
    except Exception as e:
        print(f"❌ 创建表失败: {e}")
        connection.rollback()
        return False

def insert_default_data(connection):
    """插入默认数据"""
    cursor = connection.cursor()
    
    try:
        print("\n🔧 插入默认数据...")
        
        # 插入默认用户 (如果不存在)
        cursor.execute("SELECT COUNT(*) FROM users WHERE username = 'admin'")
        if cursor.fetchone()[0] == 0:
            cursor.execute('''
                INSERT INTO users (username, email, password_hash, is_active)
                VALUES ('admin', 'admin@example.com', 'admin_hash', TRUE)
            ''')
            print("   - 创建默认管理员用户")
        
        # 插入默认枚举值 (如果不存在)
        default_enums = [
            ('system_type', 'Windows'),
            ('system_type', 'Linux'),
            ('system_type', 'macOS'),
            ('product_type', 'Web应用'),
            ('product_type', '桌面应用'),
            ('product_type', '移动应用'),
            ('environment', '开发环境'),
            ('environment', '测试环境'),
            ('environment', '生产环境'),
        ]
        
        for field_name, field_value in default_enums:
            cursor.execute('''
                INSERT IGNORE INTO enum_values (field_name, field_value)
                VALUES (%s, %s)
            ''', (field_name, field_value))
        
        print("   - 插入默认枚举值")
        
        connection.commit()
        print("✅ 默认数据插入成功!")
        return True
        
    except Exception as e:
        print(f"❌ 插入默认数据失败: {e}")
        connection.rollback()
        return False

def main():
    """主函数"""
    print("🚀 MySQL数据库初始化工具")
    print("=" * 50)
    
    # 检查依赖包
    if not check_mysql_package():
        return False
    
    # 创建连接
    connection = create_mysql_connection()
    if not connection:
        return False
    
    try:
        # 创建表结构
        if not create_mysql_tables(connection):
            return False
        
        # 插入默认数据
        if not insert_default_data(connection):
            return False
        
        print("\n" + "=" * 50)
        print("🎉 MySQL数据库初始化完成!")
        print("现在可以使用以下命令切换到MySQL模式:")
        print("python scripts/switch_database.py mysql")
        
        return True
        
    finally:
        connection.close()

if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1) 