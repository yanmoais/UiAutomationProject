# -*- coding: utf-8 -*-
"""
自动化项目数据模型
"""

import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from config.database import (
    get_db_connection_with_retry, 
    execute_insert_query_auto as execute_insert_query, 
    execute_query_with_results_auto as execute_query_with_results, 
    execute_query_without_results_auto as execute_query_without_results,
    execute_single_result_auto as execute_single_result,
    adapt_query_placeholders
)
from utils.db_adapter import adapt_query_result

class AutomationProject:
    """自动化项目模型"""
    
    def __init__(self):
        """初始化项目模型"""
        pass
    
    def create_project(self, project_data: Dict[str, Any]) -> int:
        """创建自动化项目"""
        try:
            query = adapt_query_placeholders('''
                INSERT INTO automation_projects 
                (process_name, product_ids, system, product_type, environment, 
                 product_address, test_steps, tab_switch_config, assertion_config, 
                 screenshot_config, project_id, status, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''')
            
            params = (
                project_data['process_name'],
                json.dumps(project_data['product_ids'], ensure_ascii=False),
                project_data['system'],
                project_data['product_type'],
                project_data['environment'],
                project_data['product_address'],
                json.dumps(project_data['test_steps'], ensure_ascii=False),
                json.dumps(project_data.get('tab_switch_config', {}), ensure_ascii=False),
                json.dumps(project_data.get('assertion_config', {}), ensure_ascii=False),
                json.dumps(project_data.get('screenshot_config', {}), ensure_ascii=False),
                project_data.get('project_id'),
                '待执行',
                project_data.get('created_by', 'admin'),
                datetime.now().isoformat(),
                datetime.now().isoformat()
            )
            
            return execute_insert_query(query, params)
            
        except Exception as e:
            raise e
    
    def get_projects(self) -> List[Dict[str, Any]]:
        """获取所有自动化项目"""
        try:
            query = adapt_query_placeholders('''
                SELECT id, process_name, product_ids, system, product_type, environment, 
                       product_address, test_steps, tab_switch_config, assertion_config, 
                       screenshot_config, project_id, status, created_by, created_at, updated_at
                FROM automation_projects 
                ORDER BY created_at DESC
            ''')
            
            rows = execute_query_with_results(query)
            
            columns = ['id', 'process_name', 'product_ids', 'system', 'product_type', 'environment', 
                      'product_address', 'test_steps', 'tab_switch_config', 'assertion_config', 
                      'screenshot_config', 'project_id', 'status', 'created_by', 'created_at', 'updated_at']
            
            projects = []
            for row in rows:
                project_dict = adapt_query_result(row, columns)
                
                # 解析JSON字段
                for json_field in ['product_ids', 'test_steps', 'tab_switch_config', 'assertion_config', 'screenshot_config']:
                    if project_dict.get(json_field):
                        try:
                            project_dict[json_field] = json.loads(project_dict[json_field])
                        except json.JSONDecodeError:
                            project_dict[json_field] = {}
                
                projects.append(project_dict)
            
            return projects
            
        except Exception as e:
            raise e
    
    def get_project(self, project_id: int) -> Optional[Dict[str, Any]]:
        """根据ID获取项目"""
        try:
            query = adapt_query_placeholders('''
                SELECT id, process_name, product_ids, system, product_type, environment, 
                       product_address, test_steps, tab_switch_config, assertion_config, 
                       screenshot_config, project_id, status, created_by, created_at, updated_at
                FROM automation_projects 
                WHERE id = ?
            ''')
            
            row = execute_single_result(query, (project_id,))
            
            if not row:
                return None
            
            columns = ['id', 'process_name', 'product_ids', 'system', 'product_type', 'environment', 
                      'product_address', 'test_steps', 'tab_switch_config', 'assertion_config', 
                      'screenshot_config', 'project_id', 'status', 'created_by', 'created_at', 'updated_at']
            
            project_dict = adapt_query_result(row, columns)
            
            # 解析JSON字段
            for json_field in ['product_ids', 'test_steps', 'tab_switch_config', 'assertion_config', 'screenshot_config']:
                if project_dict.get(json_field):
                    try:
                        project_dict[json_field] = json.loads(project_dict[json_field])
                    except json.JSONDecodeError:
                        project_dict[json_field] = {}
            
            return project_dict
            
        except Exception as e:
            raise e
    
    def update_project(self, project_id: int, project_data: Dict[str, Any]) -> bool:
        """更新自动化项目"""
        try:
            query = adapt_query_placeholders('''
                UPDATE automation_projects 
                SET process_name = ?, product_ids = ?, system = ?, product_type = ?, environment = ?, 
                    product_address = ?, test_steps = ?, tab_switch_config = ?, assertion_config = ?, 
                    screenshot_config = ?, project_id = ?, updated_at = ?
                WHERE id = ?
            ''')
            
            params = (
                project_data['process_name'],
                json.dumps(project_data['product_ids'], ensure_ascii=False),
                project_data['system'],
                project_data['product_type'],
                project_data['environment'],
                project_data['product_address'],
                json.dumps(project_data['test_steps'], ensure_ascii=False),
                json.dumps(project_data.get('tab_switch_config', {}), ensure_ascii=False),
                json.dumps(project_data.get('assertion_config', {}), ensure_ascii=False),
                json.dumps(project_data.get('screenshot_config', {}), ensure_ascii=False),
                project_data.get('project_id'),
                datetime.now().isoformat(),
                project_id
            )
            
            execute_query_without_results(query, params)
            return True
            
        except Exception as e:
            raise e
    
    def update_status(self, project_id: int, status: str) -> bool:
        """更新项目状态"""
        try:
            query = adapt_query_placeholders('''
                UPDATE automation_projects 
                SET status = ?, updated_at = ?
                WHERE id = ?
            ''')
            
            execute_query_without_results(query, (status, datetime.now().isoformat(), project_id))
            return True
            
        except Exception as e:
            raise e
    
    def delete_project(self, project_id: int) -> bool:
        """删除自动化项目"""
        try:
            # 先删除相关的执行记录
            query1 = adapt_query_placeholders('DELETE FROM automation_executions WHERE project_id = ?')
            execute_query_without_results(query1, (project_id,))
            
            # 再删除项目
            query2 = adapt_query_placeholders('DELETE FROM automation_projects WHERE id = ?')
            execute_query_without_results(query2, (project_id,))
            
            return True
            
        except Exception as e:
            raise e


class AutomationExecution:
    """自动化执行记录模型"""
    
    def __init__(self):
        """初始化执行记录模型"""
        pass
    
    def create_execution(self, execution_data: Dict[str, Any]) -> int:
        """创建执行记录"""
        try:
            query = adapt_query_placeholders('''
                INSERT INTO automation_executions 
                (project_id, process_name, product_ids, system, product_type, environment, 
                 product_address, status, start_time, end_time, log_message, executed_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''')
            
            params = (
                execution_data['project_id'],
                execution_data['process_name'],
                execution_data['product_ids'],
                execution_data.get('system', ''),
                execution_data.get('product_type', ''),
                execution_data.get('environment', ''),
                execution_data.get('product_address', ''),
                execution_data['status'],
                execution_data.get('start_time'),
                execution_data.get('end_time'),
                execution_data.get('log_message', ''),
                execution_data.get('executed_by', 'admin')
            )
            
            return execute_insert_query(query, params)
            
        except Exception as e:
            raise e
    
    def update_execution(self, execution_id: int, execution_data: Dict[str, Any]) -> bool:
        """更新执行记录"""
        try:
            # 构建更新字段和值
            update_fields = []
            params = []
            
            if 'status' in execution_data:
                update_fields.append('status = ?')
                params.append(execution_data['status'])
            
            if 'end_time' in execution_data:
                update_fields.append('end_time = ?')
                params.append(execution_data['end_time'])
            
            if 'log_message' in execution_data:
                update_fields.append('log_message = ?')
                params.append(execution_data['log_message'])
            
            if not update_fields:
                return False
            
            params.append(execution_id)
            
            query = adapt_query_placeholders(f'''
                UPDATE automation_executions 
                SET {', '.join(update_fields)}
                WHERE id = ?
            ''')
            
            execute_query_without_results(query, params)
            return True
            
        except Exception as e:
            raise e
    
    def get_executions(self, project_id: int) -> List[Dict[str, Any]]:
        """获取项目的执行记录"""
        try:
            query = adapt_query_placeholders('''
                SELECT id, project_id, process_name, product_ids, system, product_type, 
                       environment, product_address, status, start_time, end_time, 
                       log_message, executed_by
                FROM automation_executions 
                WHERE project_id = ?
                ORDER BY start_time DESC
            ''')
            
            rows = execute_query_with_results(query, (project_id,))
            
            columns = ['id', 'project_id', 'process_name', 'product_ids', 'system', 'product_type', 
                      'environment', 'product_address', 'status', 'start_time', 'end_time', 
                      'log_message', 'executed_by']
            
            executions = []
            for row in rows:
                execution_dict = adapt_query_result(row, columns)
                executions.append(execution_dict)
            
            return executions
            
        except Exception as e:
            raise e
    
    def get_latest_execution(self, project_id: int) -> Optional[Dict[str, Any]]:
        """获取项目的最新执行记录"""
        try:
            query = adapt_query_placeholders('''
                SELECT id, project_id, status, start_time, end_time, log_message, executed_by
                FROM automation_executions 
                WHERE project_id = ?
                ORDER BY start_time DESC
                LIMIT 1
            ''')
            
            row = execute_single_result(query, (project_id,))
            
            if not row:
                return None
            
            columns = ['id', 'project_id', 'status', 'start_time', 'end_time', 'log_message', 'executed_by']
            execution = adapt_query_result(row, columns)
            
            return execution
            
        except Exception as e:
            raise e