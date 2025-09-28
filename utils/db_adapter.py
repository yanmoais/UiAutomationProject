"""
数据库适配器模块
处理MySQL和SQLite之间的差异
"""
from config.database import get_current_db_config

def get_placeholder():
    """根据数据库类型返回占位符"""
    config = get_current_db_config()
    return '%s' if config['type'] == 'mysql' else '?'

def execute_query(conn, query, params=None):
    """执行查询并返回结果"""
    cursor = conn.cursor()
    if params:
        cursor.execute(query, params)
    else:
        cursor.execute(query)
    return cursor

def execute_query_with_results(conn, query, params=None):
    """执行查询并返回fetchall结果"""
    cursor = execute_query(conn, query, params)
    return cursor.fetchall()

def execute_single_result(conn, query, params=None):
    """执行查询并返回单个结果"""
    cursor = execute_query(conn, query, params)
    return cursor.fetchone()

def adapt_query_placeholders(query):
    """将SQLite占位符转换为当前数据库类型的占位符"""
    config = get_current_db_config()
    if config['type'] == 'mysql':
        # 将 ? 替换为 %s
        return query.replace('?', '%s')
    return query

def format_insert_ignore(table_name, columns, values_placeholder):
    """格式化INSERT IGNORE语句"""
    config = get_current_db_config()
    columns_str = ', '.join(columns)
    
    if config['type'] == 'mysql':
        return f"INSERT IGNORE INTO {table_name} ({columns_str}) VALUES ({values_placeholder})"
    else:
        return f"INSERT OR IGNORE INTO {table_name} ({columns_str}) VALUES ({values_placeholder})"

def get_limit_clause(limit, offset=None):
    """获取LIMIT子句"""
    if offset is not None:
        return f"LIMIT {limit} OFFSET {offset}"
    else:
        return f"LIMIT {limit}"

def adapt_query_result(row, columns):
    """将查询结果适配为字典格式
    
    Args:
        row: 查询结果行（MySQL是tuple，SQLite是Row对象）
        columns: 列名列表
    
    Returns:
        dict: 字典格式的结果
    """
    if row is None:
        return None
    
    config = get_current_db_config()
    
    if config['type'] == 'mysql':
        # MySQL返回tuple，需要转换为字典
        if isinstance(row, (list, tuple)):
            return dict(zip(columns, row))
        else:
            # 可能已经是字典格式
            return row
    else:
        # SQLite Row对象可以直接当字典使用
        if hasattr(row, 'keys'):
            return dict(row)
        else:
            # 如果是tuple，转换为字典
            return dict(zip(columns, row)) 