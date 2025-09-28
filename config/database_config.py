# -*- coding: utf-8 -*-
"""
数据库配置文件
统一管理数据库连接配置，支持SQLite和MySQL
"""

import os
from typing import Dict, Any

# 数据库类型配置 - 默认改为MySQL
DATABASE_TYPE = os.getenv('DATABASE_TYPE', 'mysql').lower()

# SQLite配置（保留作为备选）
SQLITE_CONFIG = {
    'database_path': 'automation.db',
    'timeout': 30.0,
    'check_same_thread': False,
    'pragmas': {
        'journal_mode': 'WAL',
        'synchronous': 'NORMAL',
        'cache_size': 10000,
        'temp_store': 'MEMORY'
    }
}

# MySQL配置 - 使用用户指定的本地数据库信息
MYSQL_CONFIG = {
    'host': os.getenv('MYSQL_HOST', 'localhost'),
    'port': int(os.getenv('MYSQL_PORT', 3306)),
    'user': os.getenv('MYSQL_USER', 'root'),
    'password': os.getenv('MYSQL_PASSWORD', '123456'),
    'database': os.getenv('MYSQL_DATABASE', 'automation'),
    'charset': 'utf8mb4',
    'autocommit': True,
    'pool_size': 10,
    'max_overflow': 20
}

# 当前数据库配置
def get_current_db_config() -> Dict[str, Any]:
    """获取当前数据库配置"""
    if DATABASE_TYPE == 'mysql':
        return {
            'type': 'mysql',
            'config': MYSQL_CONFIG
        }
    else:
        return {
            'type': 'sqlite',
            'config': SQLITE_CONFIG
        }

# 数据库连接字符串
def get_database_url() -> str:
    """获取数据库连接字符串"""
    if DATABASE_TYPE == 'mysql':
        config = MYSQL_CONFIG
        return f"mysql+pymysql://{config['user']}:{config['password']}@{config['host']}:{config['port']}/{config['database']}?charset={config['charset']}"
    else:
        return f"sqlite:///{SQLITE_CONFIG['database_path']}"

# 数据库文件路径
def get_database_path() -> str:
    """获取数据库文件路径（仅SQLite）"""
    if DATABASE_TYPE == 'sqlite':
        return SQLITE_CONFIG['database_path']
    else:
        return None

# 环境变量配置说明
ENV_VARS_HELP = """
数据库环境变量配置说明：

SQLite模式（默认）:
- DATABASE_TYPE=sqlite (或不设置)
- 数据库文件: automation.db

MySQL模式:
- DATABASE_TYPE=mysql
- MYSQL_HOST=数据库主机地址
- MYSQL_PORT=数据库端口 (默认: 3306)
- MYSQL_USER=数据库用户名
- MYSQL_PASSWORD=数据库密码
- MYSQL_DATABASE=数据库名称

示例:
export DATABASE_TYPE=mysql
export MYSQL_HOST=192.168.1.100
export MYSQL_USER=automation_user
export MYSQL_PASSWORD=your_password
export MYSQL_DATABASE=automation_db
"""

if __name__ == '__main__':
    print("当前数据库配置:")
    config = get_current_db_config()
    print(f"类型: {config['type']}")
    print(f"配置: {config['config']}")
    print(f"连接URL: {get_database_url()}")
    print("\n" + ENV_VARS_HELP) 