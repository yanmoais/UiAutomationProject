# -*- coding: utf-8 -*-
"""
日志配置模块
提供统一的日志功能，支持控制台和文件输出
"""

import logging
import os
import threading
import time
from datetime import datetime
from logging.handlers import RotatingFileHandler

# 日志级别配置
LOG_LEVEL = logging.INFO
LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
LOG_DATE_FORMAT = '%Y-%m-%d %H:%M:%S'

# 日志文件配置
LOG_DIR = 'Logs'
LOG_FILE = os.path.join(LOG_DIR, 'app.log')
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB
BACKUP_COUNT = 5

# 全局变量，用于存储当前执行ID
current_execution_id = None
# 线程锁，用于保护数据库写入操作
db_write_lock = threading.Lock()
# 文件处理器锁，用于保护文件操作
file_handler_lock = threading.Lock()

class ThreadSafeRotatingFileHandler(RotatingFileHandler):
    """线程安全的轮转文件处理器"""
    
    def __init__(self, filename, mode='a', maxBytes=MAX_LOG_SIZE, backupCount=BACKUP_COUNT, encoding=None, delay=False, errors=None):
        super().__init__(filename, mode, maxBytes, backupCount, encoding, delay, errors)
        self._lock = threading.Lock()
    
    def emit(self, record):
        """线程安全地发送日志记录"""
        with self._lock:
            try:
                super().emit(record)
            except (PermissionError, OSError) as e:
                # 如果轮转失败，尝试延迟重试
                if "另一个程序正在使用此文件" in str(e) or "进程无法访问" in str(e):
                    time.sleep(0.1)  # 短暂延迟
                    try:
                        super().emit(record)
                    except:
                        # 如果还是失败，输出到控制台
                        print(f"日志写入失败，输出到控制台: {self.format(record)}")
                else:
                    raise
    
    def doRollover(self):
        """线程安全地执行文件轮转"""
        with self._lock:
            try:
                super().doRollover()
            except (PermissionError, OSError) as e:
                # 如果轮转失败，记录错误但不中断日志记录
                print(f"日志文件轮转失败: {e}")
                # 尝试清理可能损坏的备份文件
                try:
                    for i in range(self.backupCount, 0, -1):
                        sfn = f"{self.baseFilename}.{i}"
                        if os.path.exists(sfn):
                            try:
                                os.remove(sfn)
                            except:
                                pass
                except:
                    pass

class DatabaseLogHandler(logging.Handler):
    """自定义数据库日志处理器，用于实时写入日志到数据库"""
    
    def __init__(self, level=logging.NOTSET):
        super().__init__(level)
        self.execution_id = None
    
    def set_execution_id(self, execution_id):
        """设置当前执行ID"""
        self.execution_id = execution_id
    
    def emit(self, record):
        """发送日志记录到数据库"""
        if not self.execution_id:
            return
        
        # 使用线程锁保护数据库写入操作
        with db_write_lock:
            try:
                # 格式化日志消息
                log_entry = self.format(record)
                
                # 导入数据库工具函数（避免循环导入）
                from config.database import (
                    get_db_connection_with_retry,
                    adapt_query_placeholders,
                    execute_single_result,
                    execute_query_without_results,
                )
                
                # 统一采用 读取-拼接-更新 的方式，兼容SQLite与MySQL
                with get_db_connection_with_retry() as conn:
                    select_sql = adapt_query_placeholders('''
                        SELECT detailed_log FROM automation_executions 
                        WHERE id = ?
                    ''')
                    row = execute_single_result(conn, select_sql, (self.execution_id,))
                    existing_log = (row[0] if row else '') or ''
                    updated_log = existing_log + log_entry + "\n"
                    
                    update_sql = adapt_query_placeholders('''
                        UPDATE automation_executions 
                        SET detailed_log = ?
                        WHERE id = ?
                    ''')
                    execute_query_without_results(conn, update_sql, (updated_log, self.execution_id))
            except Exception as e:
                # 避免在日志处理中产生新的日志循环
                print(f"数据库日志处理器错误: {e}")

def setup_logger(name='UiAutomationProject', level=LOG_LEVEL):
    """
    设置日志记录器
    
    Args:
        name: 日志记录器名称
        level: 日志级别
        
    Returns:
        配置好的日志记录器
    """
    # 确保日志目录存在
    os.makedirs(LOG_DIR, exist_ok=True)
    
    # 创建日志记录器
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    # 避免重复添加处理器
    if logger.handlers:
        return logger
    
    # 创建格式化器
    formatter = logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT)
    
    # 控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # 文件处理器（使用线程安全版本）
    with file_handler_lock:
        try:
            file_handler = ThreadSafeRotatingFileHandler(
                LOG_FILE, 
                maxBytes=MAX_LOG_SIZE, 
                backupCount=BACKUP_COUNT,
                encoding='utf-8'
            )
            file_handler.setLevel(level)
            file_handler.setFormatter(formatter)
            logger.addHandler(file_handler)
        except Exception as e:
            print(f"创建文件日志处理器失败: {e}")
            # 如果文件处理器创建失败，只使用控制台处理器
    
    # 数据库处理器
    db_handler = DatabaseLogHandler(level)
    db_handler.setFormatter(formatter)
    logger.addHandler(db_handler)
    
    return logger

def get_logger(name='UiAutomationProject'):
    """
    获取日志记录器
    
    Args:
        name: 日志记录器名称
        
    Returns:
        日志记录器实例
    """
    return logging.getLogger(name)

# 创建默认日志记录器
default_logger = setup_logger()

def log_info(message):
    """记录信息日志"""
    default_logger.info(message)

def log_error(message):
    """记录错误日志"""
    default_logger.error(message)

def log_warning(message):
    """记录警告日志"""
    default_logger.warning(message)

def log_debug(message):
    """记录调试日志"""
    default_logger.debug(message)

def log_critical(message):
    """记录严重错误日志"""
    default_logger.critical(message)

def set_current_execution_id(execution_id):
    """设置当前执行ID，用于数据库日志记录"""
    global current_execution_id
    current_execution_id = execution_id
    
    # 为所有处理器设置执行ID
    logger = get_logger()
    for handler in logger.handlers:
        if isinstance(handler, DatabaseLogHandler):
            handler.set_execution_id(execution_id)

def get_current_execution_id():
    """获取当前执行ID"""
    return current_execution_id

def clear_current_execution_id():
    """清除当前执行ID"""
    global current_execution_id
    current_execution_id = None
    
    # 清除所有处理器的执行ID
    logger = get_logger()
    for handler in logger.handlers:
        if isinstance(handler, DatabaseLogHandler):
            handler.set_execution_id(None) 

def read_log_lines(start_line: int, end_line: int, log_file: str = None) -> str:
    """
    读取指定行数范围的日志内容
    
    Args:
        start_line: 开始行号（从1开始）
        end_line: 结束行号（包含）
        log_file: 日志文件路径，默认为配置的LOG_FILE
        
    Returns:
        指定行数范围的日志内容
    """
    if log_file is None:
        log_file = LOG_FILE
    
    try:
        if not os.path.exists(log_file):
            return f"日志文件不存在: {log_file}"
        
        with open(log_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # 调整行号范围（确保在有效范围内）
        total_lines = len(lines)
        start_line = max(1, min(start_line, total_lines))
        end_line = max(start_line, min(end_line, total_lines))
        
        # 提取指定行数范围的内容
        selected_lines = lines[start_line - 1:end_line]
        return ''.join(selected_lines)
        
    except Exception as e:
        return f"读取日志文件失败: {str(e)}"

def read_test_execution_logs(start_line: int, end_line: int, log_file: str = None) -> str:
    """
    读取测试执行相关的日志内容，过滤掉系统管理日志
    
    Args:
        start_line: 开始行号（从1开始）
        end_line: 结束行号（包含）
        log_file: 日志文件路径，默认为配置的LOG_FILE
        
    Returns:
        过滤后的测试执行日志内容
    """
    if log_file is None:
        log_file = LOG_FILE
    
    try:
        if not os.path.exists(log_file):
            return f"日志文件不存在: {log_file}"
        
        with open(log_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # 调整行号范围（确保在有效范围内）
        total_lines = len(lines)
        start_line = max(1, min(start_line, total_lines))
        end_line = max(start_line, min(end_line, total_lines))
        
        # 提取指定行数范围的内容
        selected_lines = lines[start_line - 1:end_line]
        
        # 过滤系统管理日志，只保留测试执行相关的日志
        # 放宽过滤范围：在超时/失败场景下保留清理、超时等关键信息
        filtered_lines = []
        system_keywords = [
            # 系统管理相关，需要过滤
            '执行记录已创建',
            '执行记录已更新',
            '测试开始，当前日志文件行数',
            '测试文件分析结果',
            '检测到多个测试方法',
            '执行pytest命令',
            '进程已添加到running_tests',
            # 以下关键词在问题定位时有价值，保留（不加入过滤列表）
            # '准备更新项目',
            # '项目状态已更新为',
            # '项目已从运行列表中移除',
            '进程正常结束',
            # '详细日志已更新',
            # '详细日志已存储到执行记录',
            '监控线程已启动',
            '星火自动化测试平台启动中',
            '正在创建Flask应用',
            '上传目录已创建',
            'Game_Img目录已创建',
            '正在初始化数据库',
            '数据库初始化完成',
            '所有蓝图已注册完成',
            'Flask应用创建完成',
            '应用启动成功',
            '按 Ctrl+C 停止应用'
        ]
        
        for line in selected_lines:
            # 检查是否包含系统管理关键词
            is_system_log = any(keyword in line for keyword in system_keywords)
            
            # 保留不包含系统关键词的日志行
            if not is_system_log:
                filtered_lines.append(line)
        
        return ''.join(filtered_lines)
        
    except Exception as e:
        return f"读取测试执行日志失败: {str(e)}"

def get_log_file_line_count(log_file: str = None) -> int:
    """
    获取日志文件的总行数
    
    Args:
        log_file: 日志文件路径，默认为配置的LOG_FILE
        
    Returns:
        日志文件的总行数
    """
    if log_file is None:
        log_file = LOG_FILE
    
    try:
        if not os.path.exists(log_file):
            return 0
        
        with open(log_file, 'r', encoding='utf-8') as f:
            return sum(1 for _ in f)
            
    except Exception as e:
        print(f"获取日志文件行数失败: {e}")
        return 0

def cleanup_log_files():
    """
    清理和修复日志文件，解决权限冲突问题
    """
    try:
        # 检查主日志文件
        if os.path.exists(LOG_FILE):
            try:
                # 尝试重命名主日志文件
                backup_name = f"{LOG_FILE}.backup_{int(time.time())}"
                os.rename(LOG_FILE, backup_name)
                print(f"主日志文件已备份为: {backup_name}")
            except (PermissionError, OSError) as e:
                print(f"无法备份主日志文件: {e}")
        
        # 清理可能损坏的备份文件
        for i in range(1, BACKUP_COUNT + 1):
            backup_file = f"{LOG_FILE}.{i}"
            if os.path.exists(backup_file):
                try:
                    os.remove(backup_file)
                    print(f"已清理损坏的备份文件: {backup_file}")
                except:
                    pass
        
        # 创建新的日志文件
        try:
            with open(LOG_FILE, 'w', encoding='utf-8') as f:
                f.write(f"日志文件重新创建于: {datetime.now()}\n")
            print("已创建新的日志文件")
        except Exception as e:
            print(f"创建新日志文件失败: {e}")
            
    except Exception as e:
        print(f"清理日志文件时发生错误: {e}")

def reset_logger():
    """
    重置日志记录器，解决文件处理器问题
    """
    try:
        logger = get_logger()
        
        # 移除所有现有的处理器
        for handler in logger.handlers[:]:
            logger.removeHandler(handler)
            if hasattr(handler, 'close'):
                try:
                    handler.close()
                except:
                    pass
        
        # 重新设置日志记录器
        return setup_logger()
        
    except Exception as e:
        print(f"重置日志记录器失败: {e}")
        return None 