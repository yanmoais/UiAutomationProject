import sqlite3
import os
import time
from contextlib import contextmanager
from typing import Optional

# 数据库配置
from .database_config import get_database_path, get_current_db_config, DATABASE_TYPE, MYSQL_CONFIG

# 获取数据库路径（SQLite用）
DATABASE_PATH = get_database_path() or 'automation.db'

def get_mysql_connection():
    """获取MySQL数据库连接"""
    try:
        import pymysql
        
        # 创建连接
        conn = pymysql.connect(
            host=MYSQL_CONFIG['host'],
            port=MYSQL_CONFIG['port'],
            user=MYSQL_CONFIG['user'],
            password=MYSQL_CONFIG['password'],
            database=MYSQL_CONFIG['database'],
            charset=MYSQL_CONFIG['charset'],
            autocommit=MYSQL_CONFIG['autocommit']
        )
        return conn
    except ImportError:
        raise ImportError("pymysql未安装，请运行: pip install pymysql")
    except Exception as e:
        raise Exception(f"MySQL连接失败: {e}")

def get_sqlite_connection():
    """获取SQLite数据库连接"""
    conn = sqlite3.connect(DATABASE_PATH, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    # 启用WAL模式以提高并发性能
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA cache_size=10000')
    conn.execute('PRAGMA temp_store=MEMORY')
    return conn

def get_db_connection():
    """获取数据库连接（自动选择MySQL或SQLite）"""
    config = get_current_db_config()
    
    if config['type'] == 'mysql':
        return get_mysql_connection()
    else:
        return get_sqlite_connection()

@contextmanager
def get_db_connection_with_retry(max_retries=3, retry_delay=1):
    """
    带重试机制的数据库连接上下文管理器（仅在获取连接时重试）
    
    Args:
        max_retries: 最大重试次数
        retry_delay: 重试间隔（秒）
    
    Yields:
        数据库连接对象
    """
    config = get_current_db_config()
    last_exception = None
    conn = None
    
    # 仅在获取连接阶段进行重试
    for attempt in range(max_retries):
        try:
            conn = get_db_connection()
            break
        except Exception as e:
            last_exception = e
            if config['type'] == 'sqlite' and "database is locked" in str(e).lower():
                print(f"SQLite数据库被锁定，尝试重连... (尝试 {attempt + 1}/{max_retries})")
            elif config['type'] == 'mysql' and ("connection" in str(e).lower() or "timeout" in str(e).lower()):
                print(f"MySQL连接错误，尝试重连... (尝试 {attempt + 1}/{max_retries})")
            else:
                print(f"数据库连接错误: {e} (尝试 {attempt + 1}/{max_retries})")
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
            else:
                raise
    if conn is None:
        raise Exception("无法获取数据库连接")
    if last_exception:
        raise last_exception

    try:
        yield conn
        # 正常结束时提交（SQLite需要提交，MySQL通常autocommit）
        if config['type'] != 'mysql':
            conn.commit()
    except Exception:
        # 发生异常时尽量回滚（SQLite有事务）
        try:
            if config['type'] != 'mysql':
                conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass

def init_mysql_database():
    """初始化MySQL数据库和表结构"""
    try:
        import pymysql
        
        # 首先连接到MySQL服务器（不指定数据库）
        temp_conn = pymysql.connect(
            host=MYSQL_CONFIG['host'],
            port=MYSQL_CONFIG['port'],
            user=MYSQL_CONFIG['user'],
            password=MYSQL_CONFIG['password'],
            charset=MYSQL_CONFIG['charset']
        )
        
        cursor = temp_conn.cursor()
        
        # 创建数据库（如果不存在）
        database_name = MYSQL_CONFIG['database']
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{database_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        print(f"✅ MySQL数据库 '{database_name}' 已准备就绪")
        
        temp_conn.close()
        
        # 连接到指定数据库并创建表
        conn = get_mysql_connection()
        cursor = conn.cursor()
        
        print("📋 创建MySQL数据库表结构...")
        
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
                product_package_names TEXT,
                test_steps LONGTEXT,
                tab_switch_config TEXT,
                assertion_config TEXT,
                screenshot_config TEXT,
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
                file_path VARCHAR(500) NOT NULL,
                file_type VARCHAR(20) DEFAULT 'py',
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
                detailed_log LONGTEXT,
                executed_by VARCHAR(100) DEFAULT 'admin',
                cancel_type VARCHAR(50) DEFAULT NULL,
                FOREIGN KEY (project_id) REFERENCES automation_projects (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')
        
        # 初始化默认枚举值
        print("   初始化默认枚举值...")
        default_enums = [
            ('system_type', 'Android'),
            ('system_type', 'IOS'),
            ('system_type', 'Web'),
            ('product_type', 'web'),
            ('product_type', 'app'),
            ('environment', 'release'),
            ('environment', 'test')
        ]
        
        for field_name, field_value in default_enums:
            cursor.execute('''
                INSERT IGNORE INTO enum_values (field_name, field_value)
                VALUES (%s, %s)
            ''', (field_name, field_value))
        
        conn.close()
        print("✅ MySQL数据库初始化完成")
        
    except ImportError:
        raise ImportError("pymysql未安装，请运行: pip install pymysql")
    except Exception as e:
        print(f"❌ MySQL数据库初始化失败: {e}")
        raise

def init_sqlite_database():
    """初始化SQLite数据库和表结构"""
    # 确保数据库目录存在（如果路径包含目录）
    db_dir = os.path.dirname(DATABASE_PATH)
    if db_dir:  # 只有当目录不为空时才创建
        os.makedirs(db_dir, exist_ok=True)
    
    conn = get_sqlite_connection()
    try:
        # 创建用户表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                is_active BOOLEAN DEFAULT 1
            )
        ''')
        
        # 检查是否需要迁移旧数据
        # 检查旧表是否存在
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
        table_exists = cursor.fetchone() is not None
        
        if table_exists:
            # 检查是否有旧字段
            cursor = conn.execute("PRAGMA table_info(projects)")
            columns = [column[1] for column in cursor.fetchall()]
            
            if 'game_name' in columns or 'system_type' not in columns:
                # 需要迁移数据或添加新字段
                print("检测到需要更新数据库结构，正在迁移数据...")
                
                # 创建新表
                conn.execute('''
                    CREATE TABLE IF NOT EXISTS projects_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        product_package_name TEXT NOT NULL,
                        product_address TEXT NOT NULL,
                        product_id TEXT,
                        is_automated TEXT NOT NULL,
                        version_number TEXT,
                        product_image TEXT,
                        system_type TEXT,
                        product_type TEXT,
                        environment TEXT,
                        remarks TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                # 检查是否有旧字段名
                if 'game_name' in columns:
                    # 从旧结构迁移
                    conn.execute('''
                        INSERT INTO projects_new 
                        (id, product_package_name, product_address, product_id, is_automated, version_number, product_image, system_type, product_type, environment, remarks, created_at, updated_at)
                        SELECT id, game_name, game_address, group_name, is_automated, version_number, game_image, '', '', '', '', created_at, updated_at
                        FROM projects
                    ''')
                else:
                    # 从新结构迁移，但缺少新字段
                    conn.execute('''
                        INSERT INTO projects_new 
                        (id, product_package_name, product_address, product_id, is_automated, version_number, product_image, system_type, product_type, environment, remarks, created_at, updated_at)
                        SELECT id, product_package_name, product_address, product_id, is_automated, version_number, product_image, 
                               COALESCE(system_type, ''), COALESCE(product_type, ''), COALESCE(environment, ''), COALESCE(remarks, ''), 
                               created_at, updated_at
                        FROM projects
                    ''')
                
                # 删除旧表，重命名新表
                conn.execute('DROP TABLE projects')
                conn.execute('ALTER TABLE projects_new RENAME TO projects')
                print("数据迁移完成")
            else:
                print("数据库结构已是最新版本")
        else:
            # 创建新表
            conn.execute('''
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_package_name TEXT NOT NULL,
                    product_address TEXT NOT NULL,
                    product_id TEXT,
                    is_automated TEXT NOT NULL,
                    version_number TEXT,
                    product_image TEXT,
                    system_type TEXT,
                    product_type TEXT,
                    environment TEXT,
                    remarks TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            print("创建新数据库表完成")
    
    except Exception as e:
        print(f"数据库初始化出错: {e}")
        # 如果出错，创建基本表结构
        conn.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_package_name TEXT NOT NULL,
                product_address TEXT NOT NULL,
                product_id TEXT,
                is_automated TEXT NOT NULL,
                version_number TEXT,
                product_image TEXT,
                system_type TEXT,
                product_type TEXT,
                environment TEXT,
                remarks TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    
    # 创建枚举值管理表
    conn.execute('''
        CREATE TABLE IF NOT EXISTS enum_values (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_name TEXT NOT NULL,
            field_value TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(field_name, field_value)
        )
    ''')
    
    # 创建自动化项目表
    conn.execute('''
        CREATE TABLE IF NOT EXISTS automation_projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            process_name TEXT NOT NULL,
            product_ids TEXT NOT NULL,
            system TEXT,
            product_type TEXT,
            environment TEXT,
            product_address TEXT,
            project_id INTEGER,
            product_package_names TEXT,
            test_steps TEXT,
            tab_switch_config TEXT,
            assertion_config TEXT,
            screenshot_config TEXT,
            status TEXT DEFAULT '待执行',
            created_by TEXT DEFAULT 'admin',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 创建项目文件映射表 - 新增表，用于精确管理项目文件
    conn.execute('''
        CREATE TABLE IF NOT EXISTS project_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            project_name TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT DEFAULT 'py',
            is_active BOOLEAN DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES automation_projects (id) ON DELETE CASCADE,
            UNIQUE(project_id, file_name)
        )
    ''')
    
    # 创建自动化执行记录表
    conn.execute('''
        CREATE TABLE IF NOT EXISTS automation_executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            process_name TEXT NOT NULL,
            product_ids TEXT NOT NULL,
            system TEXT,
            product_type TEXT,
            environment TEXT,
            product_address TEXT,
            status TEXT NOT NULL,
            start_time TIMESTAMP,
            end_time TIMESTAMP,
            log_message TEXT,
            detailed_log TEXT,
            executed_by TEXT DEFAULT 'admin',
            cancel_type TEXT DEFAULT NULL,
            FOREIGN KEY (project_id) REFERENCES automation_projects (id)
        )
    ''')
    
    # 检查是否需要迁移automation_executions表
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(automation_executions)")
    columns = [column[1] for column in cursor.fetchall()]
    
    # 如果表存在但缺少新字段，则进行迁移
    if columns and 'process_name' not in columns:
        print("检测到automation_executions表需要迁移，正在更新表结构...")
        
        # 备份原表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS automation_executions_backup AS 
            SELECT * FROM automation_executions
        ''')
        
        # 删除原表
        conn.execute('DROP TABLE automation_executions')
        
        # 创建新表
        conn.execute('''
            CREATE TABLE automation_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                process_name TEXT NOT NULL DEFAULT '',
                product_ids TEXT NOT NULL DEFAULT '',
                system TEXT DEFAULT '',
                product_type TEXT DEFAULT '',
                environment TEXT DEFAULT '',
                product_address TEXT DEFAULT '',
                status TEXT NOT NULL,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                log_message TEXT,
                detailed_log TEXT,
                executed_by TEXT DEFAULT 'admin',
                cancel_type TEXT DEFAULT NULL,
                FOREIGN KEY (project_id) REFERENCES automation_projects (id)
            )
        ''')
        
        # 从备份表恢复数据，并从项目表补充缺失字段
        conn.execute('''
            INSERT INTO automation_executions 
            (id, project_id, process_name, product_ids, system, product_type, environment, product_address, 
             status, start_time, end_time, log_message, detailed_log, executed_by)
            SELECT 
                b.id, 
                b.project_id,
                COALESCE(p.process_name, '未知流程') as process_name,
                COALESCE(p.product_ids, '未知产品') as product_ids,
                COALESCE(p.system, '未知系统') as system,
                COALESCE(p.product_type, '未知类型') as product_type,
                COALESCE(p.environment, '未知环境') as environment,
                COALESCE(p.product_address, '未知地址') as product_address,
                b.status,
                b.start_time,
                b.end_time,
                b.log_message,
                NULL as detailed_log,
                b.executed_by
            FROM automation_executions_backup b
            LEFT JOIN automation_projects p ON b.project_id = p.id
        ''')
        
        # 删除备份表
        conn.execute('DROP TABLE automation_executions_backup')
        print("表结构迁移完成")
    
            # 检查是否需要添加detailed_log字段
        if columns and 'detailed_log' not in columns:
            print("检测到需要添加detailed_log字段，正在更新表结构...")
            conn.execute('ALTER TABLE automation_executions ADD COLUMN detailed_log TEXT')
            print("detailed_log字段添加完成")
        
        # 检查是否需要添加cancel_type字段
        if columns and 'cancel_type' not in columns:
            print("检测到需要添加cancel_type字段，正在更新表结构...")
            conn.execute('ALTER TABLE automation_executions ADD COLUMN cancel_type TEXT DEFAULT NULL')
            print("cancel_type字段添加完成")
    
    # 初始化默认枚举值
    default_enums = [
        ('system_type', 'Android'),
        ('system_type', 'IOS'),
        ('system_type', 'Web'),
        ('product_type', 'web'),
        ('product_type', 'app'),
        ('environment', 'release'),
        ('environment', 'test')
    ]
    
    for field_name, field_value in default_enums:
        conn.execute('''
            INSERT OR IGNORE INTO enum_values (field_name, field_value)
            VALUES (?, ?)
        ''', (field_name, field_value))
    
    print("SQLite数据库初始化完成")
    conn.commit()
    conn.close()

def init_db():
    """初始化数据库，创建必要的表（自动选择MySQL或SQLite）"""
    config = get_current_db_config()
    
    print(f"🔧 正在初始化 {config['type'].upper()} 数据库...")
    
    if config['type'] == 'mysql':
        init_mysql_database()
    else:
        init_sqlite_database()
    
    print("✅ 数据库初始化完成")

def get_enum_values(field_name: str) -> list:
    """获取指定字段的枚举值"""
    with get_db_connection_with_retry() as conn:
        query = adapt_query_placeholders('SELECT field_value FROM enum_values WHERE field_name = ? ORDER BY field_value')
        results = _execute_query_with_results_internal(conn, query, (field_name,))
        return [row[0] for row in results]

def add_enum_value(field_name: str, field_value: str) -> bool:
    """添加枚举值"""
    with get_db_connection_with_retry() as conn:
        try:
            query = adapt_query_placeholders('INSERT INTO enum_values (field_name, field_value) VALUES (?, ?)')
            execute_query_without_results(conn, query, (field_name, field_value))
            return True
        except Exception:
            # 值已存在或其他错误
            return False 

def adapt_query_placeholders(query):
    """将?占位符转换为MySQL或SQLite对应的占位符"""
    config = get_current_db_config()
    if config['type'] == 'mysql':
        return query.replace('?', '%s')
    return query

def execute_query_with_results(query, params=None):
    """执行查询并返回结果（自动获取连接）"""
    with get_db_connection_with_retry() as conn:
        return _execute_query_with_results_internal(conn, query, params)

def _execute_query_with_results_internal(conn, query, params=None):
    """内部函数：执行查询并返回结果"""
    config = get_current_db_config()
    
    if config['type'] == 'mysql':
        cursor = conn.cursor()
        cursor.execute(query, params or ())
        results = cursor.fetchall()
        cursor.close()
        return results
    else:
        cursor = conn.execute(query, params or ())
        return cursor.fetchall()

def execute_single_result(conn, query, params=None):
    """执行查询并返回单个结果"""
    config = get_current_db_config()
    
    if config['type'] == 'mysql':
        cursor = conn.cursor()
        cursor.execute(query, params or ())
        result = cursor.fetchone()
        cursor.close()
        return result
    else:
        cursor = conn.execute(query, params or ())
        return cursor.fetchone()

def execute_insert_query(conn, query, params=None):
    """执行插入查询并返回插入的ID"""
    config = get_current_db_config()
    
    if config['type'] == 'mysql':
        cursor = conn.cursor()
        cursor.execute(query, params or ())
        insert_id = cursor.lastrowid
        cursor.close()
        return insert_id
    else:
        cursor = conn.execute(query, params or ())
        return cursor.lastrowid

def execute_query_without_results(conn, query, params=None):
    """执行更新/删除/插入查询，不返回结果"""
    config = get_current_db_config()
    
    if config['type'] == 'mysql':
        cursor = conn.cursor()
        cursor.execute(query, params or ())
        cursor.close()
    else:
        conn.execute(query, params or ())

# 自动管理连接的版本
def execute_single_result_auto(query, params=None):
    """执行查询并返回单个结果（自动获取连接）"""
    with get_db_connection_with_retry() as conn:
        return execute_single_result(conn, query, params)

def execute_insert_query_auto(query, params=None):
    """执行插入查询并返回插入的ID（自动获取连接）"""
    with get_db_connection_with_retry() as conn:
        return execute_insert_query(conn, query, params)

def execute_query_without_results_auto(query, params=None):
    """执行更新/删除/插入查询，不返回结果（自动获取连接）"""
    with get_db_connection_with_retry() as conn:
        execute_query_without_results(conn, query, params)

def execute_query_with_results_auto(query, params=None):
    """执行查询并返回结果列表（自动获取连接）"""
    with get_db_connection_with_retry() as conn:
        return execute_query_with_results(conn, query, params) 