# -*- coding: utf-8 -*-
"""
项目文件管理模块
用于精确管理自动化项目的文件映射关系
"""

import os
import json
import sqlite3
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from config.database import get_db_connection, get_db_connection_with_retry
from utils.db_adapter import adapt_query_placeholders, execute_query, execute_query_with_results
from config.logger import log_info


class ProjectFileManager:
    """项目文件管理器"""
    
    def __init__(self):
        self.test_case_dir = 'Test_Case'
        # 确保Test_Case目录存在
        os.makedirs(self.test_case_dir, exist_ok=True)
    
    def create_project_file_mapping(self, project_id: int, project_name: str, 
                                   product_ids: List[str], system: str, 
                                   environment: str = 'test') -> Dict[str, any]:
        """
        创建项目文件映射
        
        Args:
            project_id: 项目ID
            project_name: 项目名称
            product_ids: 产品ID列表
            system: 系统类型
            environment: 环境类型
            
        Returns:
            包含文件信息的字典
        """
        try:
            # 首先检查是否已存在文件映射
            existing_mapping = self.get_project_file_mapping(project_id)
            if existing_mapping:
                log_info(f"项目 {project_id} 已存在文件映射: {existing_mapping['file_name']}")
                return existing_mapping
            
            # 生成文件名 - 使用更简洁的命名方式
            if product_ids and len(product_ids) > 0:
                first_product_id = product_ids[0]
                # 清理产品ID，移除特殊字符
                clean_product_id = first_product_id.replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                
                # 生成基础文件名
                base_file_name = f"{clean_product_id}_{system}_test.py"
                
                # 检查文件是否已存在，如果存在则添加序号
                file_name = self._generate_unique_filename(base_file_name)
            else:
                file_name = f"project_{project_id}_{system}_test.py"
            
            # 生成文件路径
            file_path = os.path.join(self.test_case_dir, file_name)
            
            # 保存到数据库
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('''
                    INSERT INTO project_files 
                    (project_id, project_name, file_name, file_path, file_type, is_active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''')
                cursor = execute_query(conn, query, (
                    project_id,
                    project_name,
                    file_name,
                    file_path,
                    'py',
                    1,
                    datetime.now().isoformat(),
                    datetime.now().isoformat()
                ))
                
                file_mapping_id = cursor.lastrowid
                # 自动提交和关闭
            
            log_info(f"创建新的文件映射 - 项目ID: {project_id}, 文件名: {file_name}")
            
            return {
                'id': file_mapping_id,
                'project_id': project_id,
                'project_name': project_name,
                'file_name': file_name,
                'file_path': file_path,
                'file_type': 'py',
                'is_active': True
            }
            
        except Exception as e:
            log_info(f"创建项目文件映射失败: {str(e)}")
            raise e
    
    def _generate_unique_filename(self, base_file_name: str) -> str:
        """
        生成唯一的文件名
        
        Args:
            base_file_name: 基础文件名（如：SC_Web_test.py）
            
        Returns:
            唯一的文件名
        """
        # 如果基础文件名不存在，直接返回
        file_path = os.path.join(self.test_case_dir, base_file_name)
        if not os.path.exists(file_path):
            return base_file_name
        
        # 如果文件存在，查找下一个可用的序号
        name_without_ext = base_file_name.replace('.py', '')
        counter = 2
        
        while True:
            new_file_name = f"{name_without_ext}_{counter}.py"
            new_file_path = os.path.join(self.test_case_dir, new_file_name)
            
            if not os.path.exists(new_file_path):
                return new_file_name
            
            counter += 1
    
    def get_project_file_mapping(self, project_id: int) -> Optional[Dict[str, any]]:
        """
        获取项目的文件映射信息
        
        Args:
            project_id: 项目ID
            
        Returns:
            文件映射信息字典，如果不存在返回None
        """
        try:
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('''
                    SELECT id, project_id, project_name, file_name, file_path, file_type, is_active, created_at, updated_at
                    FROM project_files 
                    WHERE project_id = ? AND is_active = 1
                    ORDER BY created_at DESC
                    LIMIT 1
                ''')
                rows = execute_query_with_results(conn, query, (project_id,))
                
                result = rows[0] if rows else None
                
                if result:
                    # 正确地将元组转换为字典
                    columns = ['id', 'project_id', 'project_name', 'file_name', 'file_path', 'file_type', 'is_active', 'created_at', 'updated_at']
                    return dict(zip(columns, result))
                return None
                
        except Exception as e:
            log_info(f"获取项目文件映射失败: {str(e)}")
            return None
    
    def get_project_file_by_name(self, project_name: str) -> Optional[Dict[str, any]]:
        """
        根据项目名称获取文件映射信息
        
        Args:
            project_name: 项目名称
            
        Returns:
            文件映射信息字典，如果不存在返回None
        """
        try:
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('''
                    SELECT id, project_id, project_name, file_name, file_path, file_type, is_active, created_at, updated_at
                    FROM project_files 
                    WHERE project_name = ? AND is_active = 1
                    ORDER BY created_at DESC
                    LIMIT 1
                ''')
                rows = execute_query_with_results(conn, query, (project_name,))
                
                result = rows[0] if rows else None
                
                if result:
                    # 正确地将元组转换为字典
                    columns = ['id', 'project_id', 'project_name', 'file_name', 'file_path', 'file_type', 'is_active', 'created_at', 'updated_at']
                    return dict(zip(columns, result))
                return None
                
        except Exception as e:
            log_info(f"根据项目名称获取文件映射失败: {str(e)}")
            return None
    
    def update_project_file_mapping(self, project_id: int, file_name: str = None, 
                                   file_path: str = None) -> bool:
        """
        更新项目文件映射
        
        Args:
            project_id: 项目ID
            file_name: 新的文件名（可选）
            file_path: 新的文件路径（可选）
            
        Returns:
            更新是否成功
        """
        try:
            with get_db_connection_with_retry() as conn:
                # 构建更新字段
                update_fields = []
                update_values = []
                
                if file_name:
                    update_fields.append("file_name = ?")
                    update_values.append(file_name)
                
                if file_path:
                    update_fields.append("file_path = ?")
                    update_values.append(file_path)
                
                if update_fields:
                    update_fields.append("updated_at = ?")
                    update_values.append(datetime.now().isoformat())
                    update_values.append(project_id)
                    
                    query = f'''
                        UPDATE project_files 
                        SET {', '.join(update_fields)}
                        WHERE project_id = ? AND is_active = 1
                    '''
                    
                    query = adapt_query_placeholders(query)
                    execute_query(conn, query, update_values)
                    return True
                
                return False
                
        except Exception as e:
            log_info(f"更新项目文件映射失败: {str(e)}")
            return False
    
    def get_file_content(self, project_id: int) -> Tuple[Optional[str], Optional[str]]:
        """
        获取项目文件内容
        
        Args:
            project_id: 项目ID
            
        Returns:
            (文件内容, 文件名) 的元组，如果文件不存在返回 (None, None)
        """
        try:
            # 获取文件映射信息
            file_mapping = self.get_project_file_mapping(project_id)
            if not file_mapping:
                log_info(f"项目 {project_id} 没有文件映射信息")
                return None, None
            
            file_path = file_mapping['file_path']
            file_name = file_mapping['file_name']
            
            log_info(f"尝试读取文件 - 项目ID: {project_id}, 文件路径: {file_path}")
            
            # 检查文件是否存在
            if os.path.exists(file_path):
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                log_info(f"成功读取文件 - 项目ID: {project_id}, 文件大小: {len(content)} 字符")
                return content, file_name
            else:
                log_info(f"文件不存在: {file_path}")
                return None, file_name
                
        except Exception as e:
            log_info(f"获取文件内容失败: {str(e)}")
            return None, None
    
    def save_file_content(self, project_id: int, content: str) -> Tuple[bool, Optional[str]]:
        """
        保存项目文件内容
        
        Args:
            project_id: 项目ID
            content: 文件内容
            
        Returns:
            (是否成功, 文件路径) 的元组
        """
        try:
            # 获取文件映射信息
            file_mapping = self.get_project_file_mapping(project_id)
            if not file_mapping:
                log_info(f"项目 {project_id} 没有文件映射信息")
                return False, None
            
            file_path = file_mapping['file_path']
            file_name = file_mapping['file_name']
            
            log_info(f"开始保存文件 - 项目ID: {project_id}, 文件路径: {file_path}, 内容长度: {len(content)}")
            
            # 确保目录存在
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            
            # 保存文件
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # 验证文件是否成功保存
            if os.path.exists(file_path):
                with open(file_path, 'r', encoding='utf-8') as f:
                    saved_content = f.read()
                if saved_content == content:
                    log_info(f"文件保存成功 - 项目ID: {project_id}, 文件: {file_name}")
                    # 更新数据库中的更新时间
                    self.update_project_file_mapping(project_id)
                    return True, file_path
                else:
                    log_info(f"文件内容验证失败 - 项目ID: {project_id}")
                    return False, None
            else:
                log_info(f"文件保存后不存在 - 项目ID: {project_id}, 路径: {file_path}")
                return False, None
            
        except Exception as e:
            log_info(f"保存文件内容失败: {str(e)}")
            return False, None
    
    def delete_project_file_mapping(self, project_id: int) -> bool:
        """
        删除项目文件映射（软删除）
        
        Args:
            project_id: 项目ID
            
        Returns:
            删除是否成功
        """
        try:
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('''
                    UPDATE project_files 
                    SET is_active = 0, updated_at = ?
                    WHERE project_id = ?
                ''')
                execute_query(conn, query, (datetime.now().isoformat(), project_id))
            
            return True
            
        except Exception as e:
            log_info(f"删除项目文件映射失败: {str(e)}")
            return False
    
    def get_all_project_files(self) -> List[Dict[str, any]]:
        """
        获取所有活跃的项目文件映射
        
        Returns:
            文件映射信息列表
        """
        try:
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('''
                    SELECT id, project_id, project_name, file_name, file_path, file_type, is_active, created_at, updated_at
                    FROM project_files 
                    WHERE is_active = 1
                    ORDER BY created_at DESC
                ''')
                results = execute_query_with_results(conn, query)
            
            return [dict(row) for row in results]
            
        except Exception as e:
            log_info(f"获取所有项目文件映射失败: {str(e)}")
            return []
    
    def find_file_by_project_name(self, project_name: str) -> Optional[str]:
        """
        根据项目名称查找文件路径
        
        Args:
            project_name: 项目名称
            
        Returns:
            文件路径，如果不存在返回None
        """
        try:
            file_mapping = self.get_project_file_by_name(project_name)
            if file_mapping and os.path.exists(file_mapping['file_path']):
                return file_mapping['file_path']
            return None
            
        except Exception as e:
            log_info(f"根据项目名称查找文件失败: {str(e)}")
            return None
    
    def validate_file_exists(self, project_id: int) -> bool:
        """
        验证项目文件是否存在
        
        Args:
            project_id: 项目ID
            
        Returns:
            文件是否存在
        """
        try:
            file_mapping = self.get_project_file_mapping(project_id)
            if file_mapping:
                return os.path.exists(file_mapping['file_path'])
            return False
            
        except Exception as e:
            log_info(f"验证文件存在失败: {str(e)}")
            return False
    
    def update_project_file_mapping(self, project_id: int, file_name: str = None, 
                                   project_name: str = None) -> bool:
        """
        更新项目文件映射
        
        Args:
            project_id: 项目ID
            file_name: 新的文件名（可选）
            project_name: 新的项目名称（可选）
            
        Returns:
            更新是否成功
        """
        try:
            with get_db_connection_with_retry() as conn:
                # 构建更新字段
                update_fields = []
                update_values = []
                
                if file_name is not None:
                    update_fields.append('file_name = ?')
                    update_values.append(file_name)
                    
                    # 同时更新文件路径
                    file_path = os.path.join(self.test_case_dir, file_name)
                    update_fields.append('file_path = ?')
                    update_values.append(file_path)
                
                if project_name is not None:
                    update_fields.append('project_name = ?')
                    update_values.append(project_name)
                
                # 添加更新时间
                update_fields.append('updated_at = ?')
                update_values.append(datetime.now().isoformat())
                
                # 添加项目ID到值列表
                update_values.append(project_id)
                
                # 执行更新
                update_sql = f'''
                    UPDATE project_files 
                    SET {', '.join(update_fields)}
                    WHERE project_id = ?
                '''
                
                update_sql = adapt_query_placeholders(update_sql)
                execute_query(conn, update_sql, update_values)
                
                return True
                
        except Exception as e:
            log_info(f"更新项目文件映射失败: {str(e)}")
            return False


# 创建全局实例
file_manager = ProjectFileManager() 