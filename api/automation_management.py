from flask import Blueprint, request, jsonify, session
import sqlite3
import json
import os
import time
import subprocess
import threading
from datetime import datetime
from config.database import execute_insert_query, get_db_connection_with_retry
from config.database import execute_query_with_results as db_execute_query_with_results
from config.database import execute_query_without_results_auto
from config.database_config import get_current_db_config
from utils.db_adapter import *
import uuid
from flask import current_app
from werkzeug.utils import secure_filename
from config.logger import log_error, log_info
from utils.image_upload_manager import image_upload_manager
from utils.file_manager import file_manager
from utils.auth_accounts import read_accounts, write_accounts
from utils.auth_accounts import generate_unique_accounts_for_addresses, generate_unique_accounts_list_for_addresses
from utils.auth_accounts import read_accounts_list, read_accounts_slots, read_product_address_slots, read_accounts_by_addresses, lookup_accounts_for_addresses
from utils.auth_accounts import lookup_accounts_for_addresses

automation_bp = Blueprint('automation', __name__)

# 全局变量存储正在执行的测试任务
running_tests = {}
attempt = 0


@automation_bp.route('/upload-assertion-image', methods=['POST'])
def upload_assertion_image():
    """上传图片断言相关的图片文件"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': '没有上传文件'})
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'message': '没有选择文件'})
        
        # 获取可选的断言ID和方法
        assertion_id = request.form.get('assertion_id', str(uuid.uuid4())[:8])
        method = request.form.get('method', 'unknown')
        
        # 生成文件名
        filename = f"assertion_{assertion_id}_{method}.png"
        
        # 保存文件
        saved_path = image_upload_manager.save_image_assertion_file(file, filename)
        
        if saved_path:
            return jsonify({
                'success': True,
                'message': '图片上传成功',
                'file_path': saved_path
            })
        else:
            return jsonify({'success': False, 'message': '图片保存失败'})
            
    except Exception as e:
        log_error(f"上传图片断言文件失败: {e}")
        return jsonify({'success': False, 'message': f'上传失败: {str(e)}'})


@automation_bp.route('/upload-assertion-image-base64', methods=['POST'])
def upload_assertion_image_base64():
    """通过base64数据上传图片断言文件"""
    try:
        data = request.get_json()
        
        if not data or 'image_data' not in data:
            return jsonify({'success': False, 'message': '缺少图片数据'})
        
        image_data = data['image_data']
        assertion_id = data.get('assertion_id', str(uuid.uuid4())[:8])
        method = data.get('method', 'unknown')
        
        # 生成文件名
        filename = f"assertion_{assertion_id}_{method}.png"
        
        # 保存base64图片
        saved_path = image_upload_manager.save_image_assertion_file(image_data, filename)
        
        if saved_path:
            return jsonify({
                'success': True,
                'message': '图片上传成功',
                'file_path': saved_path
            })
        else:
            return jsonify({'success': False, 'message': '图片保存失败'})
            
    except Exception as e:
        log_error(f"上传base64图片断言文件失败: {e}")
        return jsonify({'success': False, 'message': f'上传失败: {str(e)}'})

@automation_bp.route('/clean-assertion-images', methods=['POST'])
def clean_assertion_images():
    """清理旧的图片断言文件"""
    try:
        data = request.get_json()
        days = data.get('days', 30) if data else 30
        
        image_upload_manager.clean_old_assertion_images(days)
        
        return jsonify({
            'success': True,
            'message': f'成功清理超过{days}天的图片断言文件'
        })
        
    except Exception as e:
        log_error(f"清理图片断言文件失败: {e}")
        return jsonify({'success': False, 'message': f'清理失败: {str(e)}'})

def get_current_user():
    """获取当前登录用户信息"""
    if 'username' in session:
        return session['username']
    return '未知用户'

def get_project_product_addresses(product_ids, product_address):
    """获取项目的产品地址列表，返回 [(product_id, address), ...] 格式
    优先使用自动化项目中的 `product_address` 字段；若为空或为占位值（如 test/uat/dev 等），
    则回退到 `projects` 表根据 `product_id` 查询真实地址。
    """
    try:
        # 解析产品ID列表
        if isinstance(product_ids, str):
            try:
                product_ids = json.loads(product_ids)
            except (json.JSONDecodeError, TypeError):
                product_ids = [product_ids]
        
        if not product_ids:
            return []
        
        # 占位值判定
        placeholder_tokens = {'test', 'uat', 'dev', 'sit', 'stage', 'staging', 'prod', 'production'}
        
        def is_valid_address(value: str) -> bool:
            if value is None:
                return False
            v = str(value).strip()
            if not v:
                return False
            return v.lower() not in placeholder_tokens
        
        # 先从自动化项目的 product_address 字段读取
        product_id_to_address = {}
        if product_address:
            try:
                address_map = json.loads(product_address)
                if isinstance(address_map, dict):
                    # 支持键为 product_id 或带序号的 product_id_n
                    for idx, pid in enumerate(product_ids, 1):
                        addr = None
                        if pid in address_map:
                            addr = address_map[pid]
                        elif f"{pid}_{idx}" in address_map:
                            addr = address_map[f"{pid}_{idx}"]
                        
                        if addr is not None and is_valid_address(addr):
                            product_id_to_address[pid] = addr
                    
                    # 若仍有缺失，按字典值顺序进行补齐
                    remaining = [pid for pid in product_ids if pid not in product_id_to_address]
                    if remaining:
                        values = list(address_map.values())
                        list_index = 0
                        for pid in remaining:
                            if list_index < len(values):
                                addr = values[list_index]
                                list_index += 1
                                if is_valid_address(addr):
                                    product_id_to_address[pid] = addr
                elif isinstance(address_map, list):
                    # 列表则按顺序分配
                    for idx, pid in enumerate(product_ids):
                        if idx < len(address_map):
                            addr = address_map[idx]
                            if is_valid_address(addr):
                                product_id_to_address[pid] = addr
                else:
                    # 单值仅当单产品
                    if len(product_ids) == 1 and is_valid_address(product_address):
                        product_id_to_address[product_ids[0]] = product_address
            except (json.JSONDecodeError, TypeError):
                # 非JSON，视为单个地址（仅当单产品且非占位值）
                if len(product_ids) == 1 and is_valid_address(product_address):
                    product_id_to_address[product_ids[0]] = product_address
        
        # 对于未获取到或被判定为占位值的产品，从 projects 表回退查询
        missing_product_ids = [pid for pid in product_ids if pid not in product_id_to_address]
        if missing_product_ids:
            with get_db_connection_with_retry() as conn:
                list_index = 0
                for pid in missing_product_ids:
                    query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                    result = execute_single_result(conn, query, (pid,))
                    if result and result[0]:
                        db_address = result[0]
                        # 解析：支持 JSON 列表或字典
                        try:
                            parsed = json.loads(db_address)
                            if isinstance(parsed, list):
                                if list_index < len(parsed):
                                    db_address = parsed[list_index]
                                    list_index += 1
                                else:
                                    db_address = parsed[-1]
                            elif isinstance(parsed, dict):
                                if pid in parsed:
                                    db_address = parsed[pid]
                                else:
                                    values = list(parsed.values())
                                    if list_index < len(values):
                                        db_address = values[list_index]
                                        list_index += 1
                                    elif values:
                                        db_address = values[-1]
                        except (json.JSONDecodeError, TypeError):
                            pass
                        
                        if is_valid_address(db_address):
                            product_id_to_address[pid] = db_address
                        else:
                            log_info(f"警告: 产品 {pid} 的地址为占位值，已忽略")
                    else:
                        log_info(f"警告: 未找到产品 {pid} 的地址信息")
        
        # 输出为 [(product_id, address), ...]，仅包含有效项
        result_list = [(pid, addr) for pid, addr in product_id_to_address.items() if is_valid_address(addr)]
        return result_list
        
    except Exception as e:
        log_info(f"获取项目产品地址失败: {e}")
        return []

def get_project_details(project_id: int) -> dict:
    """获取项目详细信息"""
    try:
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('''
                SELECT process_name, product_ids, `system`, product_type, environment, product_address
                FROM automation_projects 
                WHERE id = ?
            ''')
            
            row = execute_single_result(conn, query, (project_id,))
            if row:
                return {
                    'process_name': row[0],
                    'product_ids': row[1],
                    'system': row[2] or '',
                    'product_type': row[3] or '',
                    'environment': row[4] or '',
                    'product_address': row[5] or ''
                }
            else:
                return {
                    'process_name': '未知流程',
                    'product_ids': '未知产品',
                    'system': '',
                    'product_type': '',
                    'environment': '',
                    'product_address': ''
                }
    except Exception as e:
        log_info(f"获取项目详情失败: {e}")
        return {
            'process_name': '未知流程',
            'product_ids': '未知产品',
            'system': '',
            'product_type': '',
            'environment': '',
            'product_address': ''
        }

def create_execution_record(project_id: int, status: str, executed_by: str = None, 
                           log_message: str = '', start_time: str = None, end_time: str = None):
    """创建执行记录的通用函数"""
    try:
        # 获取项目详细信息
        project_details = get_project_details(project_id)
        
        # 如果没有指定执行者，使用当前登录用户
        if executed_by is None:
            executed_by = get_current_user()
            
        # 准备执行记录数据
        execution_data = {
            'project_id': project_id,
            'process_name': project_details['process_name'],
            'product_ids': project_details['product_ids'],
            'system': project_details['system'],
            'product_type': project_details['product_type'],
            'environment': project_details['environment'],
            'product_address': project_details['product_address'],
            'status': status,
            'start_time': start_time or datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'end_time': end_time,
            'log_message': log_message,
            'executed_by': executed_by
        }
        
        # 插入执行记录
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('''
                INSERT INTO automation_executions 
                (project_id, process_name, product_ids, `system`, product_type, environment, 
                 product_address, status, start_time, end_time, log_message, executed_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''')
            execution_id = execute_insert_query(conn, query, (
                execution_data['project_id'],
                execution_data['process_name'],
                execution_data['product_ids'],
                execution_data['system'],
                execution_data['product_type'],
                execution_data['environment'],
                execution_data['product_address'],
                execution_data['status'],
                execution_data['start_time'],
                execution_data['end_time'],
                execution_data['log_message'],
                execution_data['executed_by']
            ))
        
        log_info(f"执行记录已创建: ID={execution_id}, 项目ID={project_id}, 状态={status}, 流程={project_details['process_name']}")
        return execution_id
        
    except Exception as e:
        log_info(f"创建执行记录失败: {e}")
        return None

def update_execution_record(execution_id: int, status: str = None, end_time: str = None, 
                           log_message: str = None, executed_by: str = None):
    """更新执行记录"""
    try:
        # 构建更新语句
        update_fields = []
        update_values = []
        
        if status is not None:
            update_fields.append('status = ?')
            update_values.append(status)
            
        if end_time is not None:
            update_fields.append('end_time = ?')
            update_values.append(end_time)
            
        if log_message is not None:
            update_fields.append('log_message = ?')
            update_values.append(log_message)
            
        if executed_by is not None:
            update_fields.append('executed_by = ?')
            update_values.append(executed_by)
        
        if not update_fields:
            return False
        
        update_values.append(execution_id)
        
        # 执行更新
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders(f'''
                UPDATE automation_executions 
                SET {', '.join(update_fields)}
                WHERE id = ?
            ''')
            execute_insert_query(conn, query, update_values)
        
        log_info(f"执行记录已更新: ID={execution_id}, 状态={status}")
        return True
        
    except Exception as e:
        log_info(f"更新执行记录失败: {e}")
        return False

def update_execution_detailed_log(execution_id: int, detailed_log: str):
    """更新执行记录的详细日志"""
    try:
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('''
                UPDATE automation_executions 
                SET detailed_log = ?
                WHERE id = ?
            ''')
            execute_insert_query(conn, query, (detailed_log, execution_id))
        
        log_info(f"详细日志已更新: ID={execution_id}")
        return True
        
    except Exception as e:
        log_info(f"更新详细日志失败: {e}")
        return False

def allowed_file(filename):
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@automation_bp.route('/projects', methods=['GET'])
def get_automation_projects():
    """获取自动化项目列表"""
    try:
        # 获取分页参数
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 10, type=int)
        
        # 验证分页参数
        if page < 1:
            page = 1
        if page_size < 1:
            page_size = 10
        elif page_size > 100:  # 限制最大页面大小
            page_size = 100
        
        # 检查运行中的项目进程状态
        for project_id in list(running_tests.keys()):
            check_process_status(project_id)
        
        with get_db_connection_with_retry() as conn:
            # 首先获取总数
            total_count = execute_single_result(conn, 'SELECT COUNT(*) FROM automation_projects')[0]
            
            # 计算分页信息
            total_pages = (total_count + page_size - 1) // page_size
            offset = (page - 1) * page_size
            
            # 获取分页数据 - 简化查询以避免MySQL复杂性
            query = adapt_query_placeholders('''
                SELECT ap.id, ap.project_id, ap.process_name, ap.product_ids, ap.`system`, ap.product_type,
                       ap.environment, ap.product_address, ap.test_steps, ap.status,
                       ap.created_by, ap.created_at, ap.updated_at,
                       ap.product_package_names,
                       COUNT(ae.id) as execution_count,
                       MAX(ae.start_time) as last_start_time,
                       (SELECT status FROM automation_executions 
                        WHERE project_id = ap.id 
                        ORDER BY start_time DESC LIMIT 1) as last_status
                FROM automation_projects ap
                LEFT JOIN automation_executions ae ON ap.id = ae.project_id
                GROUP BY ap.id
                ORDER BY ap.updated_at DESC
                LIMIT ? OFFSET ?
            ''')
            results = execute_query_with_results(conn, query, (page_size, offset))
            
            projects = []
            for row in results:
                project = {
                    'id': row[0],
                    'project_id': row[1],
                    'process_name': row[2],
                    'product_ids': json.loads(row[3]) if row[3] else [],
                    'system': row[4],
                    'product_type': row[5],
                    'environment': row[6],
                    'product_address': row[7],
                    'test_steps': json.loads(row[8]) if row[8] else [],
                    'status': row[9],
                    'created_by': row[10],
                    'created_at': row[11],
                    'updated_at': row[12],
                    'product_package_names': json.loads(row[13]) if row[13] else [],
                    'execution_count': row[14],
                    'last_start_time': row[15],
                    'last_status': row[16]
                }
                projects.append(project)
        
        return jsonify({
            'success': True,
            'data': {
                'projects': projects,
                'pagination': {
                    'page': page,
                    'page_size': page_size,
                    'total_pages': total_pages,
                    'total_count': total_count
                }
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'获取自动化项目失败: {str(e)}'
        }), 500

@automation_bp.route('/projects', methods=['POST'])
def create_automation_project():
    """创建自动化项目"""
    try:
        data = request.get_json()
        
        # 验证必填字段
        required_fields = ['process_name', 'product_ids', 'system', 'test_steps']
        for field in required_fields:
            if not data.get(field):
                return jsonify({
                    'success': False,
                    'message': f'缺少必填字段: {field}'
                }), 400
        
        # 验证产品ID是否来自同一系统
        product_ids = data['product_ids']
        if len(product_ids) > 1:
            with get_db_connection_with_retry() as conn:
                placeholders = ','.join(['%s' if get_current_db_config()['type'] == 'mysql' else '?' for _ in product_ids])
                query = f'''
                    SELECT DISTINCT `system_type` FROM projects 
                    WHERE product_id IN ({placeholders})
                '''
                results = execute_query_with_results(conn, query, product_ids)
                systems = [row[0] for row in results]
                
                if len(systems) > 1:
                    return jsonify({
                        'success': False,
                        'message': '选择的产品ID必须来自同一系统'
                    }), 400
        
        # 获取产品包名信息（优先使用前端传递的包名，否则从数据库查询）
        product_package_names = data.get('product_package_names', [])
        if not product_package_names:
            # 回退：从数据库查询
            with get_db_connection_with_retry() as conn:
                for product_id in product_ids:
                    query = adapt_query_placeholders('''
                        SELECT product_package_name FROM projects 
                        WHERE product_id = ? 
                        ORDER BY product_package_name LIMIT 1
                    ''')
                    result = execute_single_result(conn, query, (product_id,))
                    if result:
                        product_package_names.append(result[0])
        
        # 已新增 project_id 字段，允许前端直接传递或在后端根据产品映射推导
        # 根据产品映射推导 projects.id 作为关联的 project_id（如果前端未传）
        derived_project_id = data.get('project_id')
        if not derived_project_id:
            try:
                with get_db_connection_with_retry() as conn:
                    ppns = product_package_names
                    unique_product_ids = list(dict.fromkeys(product_ids))
                    # 1) 优先使用 product_id + product_package_name + system_type（当两者等长时按成对匹配）
                    if ppns and len(ppns) == len(product_ids):
                        for pid, ppn in zip(product_ids, ppns):
                            query = adapt_query_placeholders('''
                                SELECT id FROM projects
                                WHERE product_id = ? AND product_package_name = ? AND system_type = ?
                                ORDER BY id DESC
                                LIMIT 1
                            ''')
                            result = execute_single_result(conn, query, (pid, ppn, data['system']))
                            if result:
                                derived_project_id = result[0]
                                break
                    # 1.1) 当长度不匹配但提供了包名时，优先按包名匹配（避免仅按 product_id 命中错误项目）
                    if not derived_project_id and ppns and len(ppns) != len(product_ids):
                        # a) 包名 + system_type + product_id(去重)
                        for ppn in ppns:
                            for pid in unique_product_ids:
                                query = adapt_query_placeholders('''
                                    SELECT id FROM projects
                                    WHERE product_id = ? AND product_package_name = ? AND system_type = ?
                                    ORDER BY id DESC
                                    LIMIT 1
                                ''')
                                result = execute_single_result(conn, query, (pid, ppn, data['system']))
                                if result:
                                    derived_project_id = result[0]
                                    break
                            if derived_project_id:
                                break
                        # b) 包名 + system_type
                        if not derived_project_id:
                            for ppn in ppns:
                                query = adapt_query_placeholders('''
                                    SELECT id FROM projects
                                    WHERE product_package_name = ? AND system_type = ?
                                    ORDER BY id DESC
                                    LIMIT 1
                                ''')
                                result = execute_single_result(conn, query, (ppn, data['system']))
                                if result:
                                    derived_project_id = result[0]
                                    break
                        # c) 仅包名
                        if not derived_project_id:
                            for ppn in ppns:
                                query = adapt_query_placeholders('''
                                    SELECT id FROM projects
                                    WHERE product_package_name = ?
                                    ORDER BY id DESC
                                    LIMIT 1
                                ''')
                                result = execute_single_result(conn, query, (ppn,))
                                if result:
                                    derived_project_id = result[0]
                                    break
                    # 2) 回退使用 product_id + product_package_name（当提供包名但未成对匹配时也尝试任意组合）
                    if not derived_project_id and ppns:
                        for pid in unique_product_ids:
                            for ppn in ppns:
                                query = adapt_query_placeholders('''
                                    SELECT id FROM projects
                                    WHERE product_id = ? AND product_package_name = ?
                                    ORDER BY id DESC
                                    LIMIT 1
                                ''')
                                result = execute_single_result(conn, query, (pid, ppn))
                                if result:
                                    derived_project_id = result[0]
                                    break
                            if derived_project_id:
                                break
                    # 3) 回退使用 product_id + system_type
                    if not derived_project_id:
                        for pid in unique_product_ids:
                            query = adapt_query_placeholders('''
                                SELECT id FROM projects
                                WHERE product_id = ? AND system_type = ?
                                ORDER BY id DESC
                                LIMIT 1
                            ''')
                            result = execute_single_result(conn, query, (pid, data['system']))
                            if result:
                                derived_project_id = result[0]
                                break
                    # 4) 最后回退仅使用 product_id
                    if not derived_project_id:
                        for pid in unique_product_ids:
                            query = adapt_query_placeholders('''
                                SELECT id FROM projects
                                WHERE product_id = ?
                                ORDER BY id DESC
                                LIMIT 1
                            ''')
                            result = execute_single_result(conn, query, (pid,))
                            if result:
                                derived_project_id = result[0]
                                break
            except Exception as e:
                log_info(f"根据产品映射推导 project_id 失败: {str(e)}")
        
        # 插入数据库
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('''
                INSERT INTO automation_projects 
                (process_name, product_ids, `system`, product_type, environment, 
                 product_address, test_steps, product_package_names, project_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''')
            automation_id = execute_insert_query(conn, query, (
                data['process_name'],
                json.dumps(data['product_ids'], ensure_ascii=False),
                data['system'],
                data.get('product_type', ''),
                data.get('environment', ''),
                data.get('product_address', ''),
                json.dumps(data['test_steps'], ensure_ascii=False),
                json.dumps(product_package_names, ensure_ascii=False),
                derived_project_id
            ))
        
        # 如果仍无法确定关联的业务项目ID，则回填为自动化项目自身的 id 作为占位
        if not derived_project_id:
            try:
                update_query = adapt_query_placeholders('UPDATE automation_projects SET project_id = ? WHERE id = ?')
                execute_query_without_results_auto(update_query, (automation_id, automation_id))
            except Exception as update_err:
                log_info(f"回填 project_id 失败: {str(update_err)}")
        
        # 创建项目文件映射并生成测试代码文件
        from utils.file_manager import file_manager
        
        try:
            # 创建文件映射
            file_mapping = file_manager.create_project_file_mapping(
                project_id=automation_id,
                project_name=data['process_name'],
                product_ids=data['product_ids'],
                system=data['system'],
                environment=data.get('environment', 'test')
            )
            
            # 生成测试代码文件
            generate_test_code(automation_id, data)
            
            # 新增：保存注册账号到YAML
            try:
                accounts_map = {}
                accounts_by_order = []
                # 收集每个步骤的结构以便按步骤写入
                per_step_payloads = []
                for idx, step in enumerate(data.get('test_steps', [])):
                    if step.get('operation_event') in ('register', 'login'):
                        cfg = step.get('auth_config', {})
                        local_map = {}
                        local_by_order = []
                        # 新结构：可能有 accounts（带 address）或 address_credentials_list（不带 address，只是列表）
                        for acc in cfg.get('accounts', []) or []:
                            addr = (acc.get('address') or '').strip()
                            if addr:
                                local_map[addr] = {
                                    'email': acc.get('email', ''),
                                    'password': acc.get('password', '')
                                }
                                local_by_order.append({
                                    'address': addr,
                                    'email': acc.get('email', ''),
                                    'password': acc.get('password', '')
                                })
                        # 兼容：address_credentials 映射
                        addr_map = cfg.get('address_credentials', {}) or {}
                        if isinstance(addr_map, dict):
                            for addr_key, info in addr_map.items():
                                if not addr_key:
                                    continue
                                local_map[addr_key] = {
                                    'email': (info or {}).get('email', ''),
                                    'password': (info or {}).get('password', '')
                                }
                        # 兼容：address_credentials_list 列表 + 当前产品地址的顺序
                        addr_list = cfg.get('address_credentials_list', []) or []
                        if isinstance(addr_list, list) and len(addr_list) > 0:
                            try:
                                addresses_data = data.get('product_address')
                                addresses_seq = []
                                if addresses_data:
                                    # 支持 dict/json 或 list/json
                                    decoded = json.loads(addresses_data)
                                    if isinstance(decoded, list):
                                        addresses_seq = [str(x).strip() for x in decoded]
                                    elif isinstance(decoded, dict):
                                        # 保持字典插入顺序遍历
                                        for _, value in decoded.items():
                                            addresses_seq.append(str(value).strip())
                                # 构建 by_order 列表（按地址顺序，数量取 min）
                                for i2, addr in enumerate(addresses_seq):
                                    if i2 >= len(addr_list):
                                        break
                                    info = addr_list[i2] or {}
                                    local_by_order.append({
                                        'address': addr,
                                        'email': info.get('email', ''),
                                        'password': info.get('password', '')
                                    })
                            except Exception:
                                pass
                        # 汇总到全局（保持现有行为覆盖 by_address / 按序 by_order）
                        for k, v in local_map.items():
                            accounts_map[k] = v
                        accounts_by_order.extend(local_by_order)
                        # 计算槽位映射
                        product_address_slots = {}
                        accounts_slots = {}
                        try:
                            decoded = json.loads(data.get('product_address') or '{}')
                            if isinstance(decoded, dict):
                                # 保持插入顺序
                                i3 = 0
                                for k, addr in decoded.items():
                                    slot_key = str(k)
                                    product_address_slots[slot_key] = str(addr).strip()
                                    if i3 < len(local_by_order):
                                        info = local_by_order[i3]
                                        accounts_slots[slot_key] = {
                                            'address': str(addr).strip(),
                                            'email': info.get('email', ''),
                                            'password': info.get('password', '')
                                        }
                                    i3 += 1
                        except Exception:
                            pass
                        per_step_payloads.append({
                            'idx': idx,
                            'step_name': step.get('step_name', f'step_{idx+1}'),
                            'operation_event': step.get('operation_event', ''),
                            'by_address': local_map,
                            'by_order': local_by_order,
                            'by_slot': accounts_slots,
                            'product_address_slots': product_address_slots
                        })
                # 先写整体聚合（保持兼容）
                if accounts_map or accounts_by_order:
                    # 构建全局槽位映射（与现有逻辑一致）
                    product_address_slots = {}
                    accounts_slots = {}
                    try:
                        decoded = json.loads(data.get('product_address') or '{}')
                        if isinstance(decoded, dict):
                            # 保持插入顺序
                            idx = 0
                            for k, addr in decoded.items():
                                slot_key = str(k)
                                product_address_slots[slot_key] = str(addr).strip()
                                # 来自 accounts_by_order 的第 idx 个
                                if idx < len(accounts_by_order):
                                    info = accounts_by_order[idx]
                                    accounts_slots[slot_key] = {
                                        'address': str(addr).strip(),
                                        'email': info.get('email', ''),
                                        'password': info.get('password', '')
                                    }
                                idx += 1
                    except Exception:
                        pass
                    write_accounts(
                        data['process_name'],
                        file_mapping['file_name'],
                        accounts_map,
                        accounts_by_order,
                        accounts_slots,
                        product_address_slots
                    )
                # 再按步骤追加写入
                if per_step_payloads:
                    from utils.auth_accounts import write_step_accounts
                    for payload in per_step_payloads:
                        write_step_accounts(
                            data['process_name'],
                            file_mapping['file_name'],
                            payload['idx'],
                            payload['step_name'],
                            payload['operation_event'],
                            payload['by_address'],
                            payload['by_order'],
                            payload['by_slot'],
                            payload['product_address_slots']
                        )
            except Exception as e:
                log_info(f"保存注册账号到YAML失败: {str(e)}")
            
            return jsonify({
                'success': True,
                'message': '自动化项目创建成功',
                'data': {
                    'id': automation_id,
                    'file_mapping': file_mapping
                }
            })
        except Exception as file_error:
            log_info(f"文件映射创建失败: {str(file_error)}")
            # 即使文件映射失败，项目创建仍然成功
            return jsonify({
                'success': True,
                'message': '自动化项目创建成功（文件映射失败）',
                'data': {'id': automation_id}
            })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'创建自动化项目失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>', methods=['GET'])
def get_automation_project(project_id):
    """获取单个自动化项目详情"""
    try:
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('''
                SELECT ap.id, ap.project_id, ap.process_name, ap.product_ids, ap.`system`, ap.product_type,
                       ap.environment, ap.product_address, ap.test_steps, ap.status,
                       ap.created_by, ap.created_at, ap.updated_at,
                       COUNT(ae.id) as execution_count,
                       MAX(ae.start_time) as last_start_time,
                       (SELECT status FROM automation_executions 
                        WHERE project_id = ap.id 
                        ORDER BY start_time DESC LIMIT 1) as last_status
                FROM automation_projects ap
                LEFT JOIN automation_executions ae ON ap.id = ae.project_id
                WHERE ap.id = ?
                GROUP BY ap.id
            ''')
            
            results = execute_query_with_results(conn, query, (project_id,))
            if not results:
                return jsonify({
                    'success': False,
                    'message': '项目不存在'
                }), 404
            
            row = results[0]
            project = {
                'id': row[0],
                'project_id': row[1],
                'process_name': row[2],
                'product_ids': json.loads(row[3]) if row[3] else [],
                'system': row[4],
                'product_type': row[5],
                'environment': row[6],
                'product_address': row[7],
                'test_steps': json.loads(row[8]) if row[8] else [],
                'status': row[9],
                'created_by': row[10],
                'created_at': row[11],
                'updated_at': row[12],
                'execution_count': row[13] or 0,
                'last_start_time': row[14],
                'last_status': row[15] or 'pending'
            }
            
            return jsonify({
                'success': True,
                'data': project
            })
            
    except Exception as e:
        log_info(f"获取自动化项目详情失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'获取自动化项目详情失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>', methods=['PUT'])
def update_automation_project(project_id):
    """更新自动化项目"""
    try:
        data = request.get_json()
        log_info(f"更新自动化项目: {data}")
        
        with get_db_connection_with_retry() as conn:
            # 根据 product_ids / product_package_names / system 推导关联的 projects.id
            product_ids = data.get('product_ids', []) or []
            product_package_names = data.get('product_package_names', []) or []
            derived_project_id = data.get('project_id')

            if not derived_project_id:
                unique_product_ids = list(dict.fromkeys(product_ids))
                # 1) product_id + product_package_name + system_type
                if product_package_names and len(product_package_names) == len(product_ids):
                    for pid, ppn in zip(product_ids, product_package_names):
                        query = adapt_query_placeholders('''
                            SELECT id FROM projects 
                            WHERE product_id = ? AND product_package_name = ? AND system_type = ?
                            ORDER BY id DESC
                            LIMIT 1
                        ''')
                        result = execute_single_result(conn, query, (pid, ppn, data['system']))
                        if result:
                            derived_project_id = result[0]
                            break
                # 1.1) 当长度不匹配但提供了包名时，优先按包名匹配
                if not derived_project_id and product_package_names and len(product_package_names) != len(product_ids):
                    # a) 包名 + system_type + product_id(去重)
                    for ppn in product_package_names:
                        for pid in unique_product_ids:
                            query = adapt_query_placeholders('''
                                SELECT id FROM projects 
                                WHERE product_id = ? AND product_package_name = ? AND system_type = ?
                                ORDER BY id DESC
                                LIMIT 1
                            ''')
                            result = execute_single_result(conn, query, (pid, ppn, data['system']))
                            if result:
                                derived_project_id = result[0]
                                break
                        if derived_project_id:
                            break
                    # b) 包名 + system_type
                    if not derived_project_id:
                        for ppn in product_package_names:
                            query = adapt_query_placeholders('''
                                SELECT id FROM projects 
                                WHERE product_package_name = ? AND system_type = ?
                                ORDER BY id DESC
                                LIMIT 1
                            ''')
                            result = execute_single_result(conn, query, (ppn, data['system']))
                            if result:
                                derived_project_id = result[0]
                                break
                    # c) 仅包名
                    if not derived_project_id:
                        for ppn in product_package_names:
                            query = adapt_query_placeholders('''
                                SELECT id FROM projects 
                                WHERE product_package_name = ?
                                ORDER BY id DESC
                                LIMIT 1
                            ''')
                            result = execute_single_result(conn, query, (ppn,))
                            if result:
                                derived_project_id = result[0]
                                break
                # 2) product_id + product_package_name（不要求等长，尝试任意组合）
                if not derived_project_id and product_package_names:
                    for pid in unique_product_ids:
                        for ppn in product_package_names:
                            query = adapt_query_placeholders('''
                                SELECT id FROM projects 
                                WHERE product_id = ? AND product_package_name = ?
                                ORDER BY id DESC
                                LIMIT 1
                            ''')
                            result = execute_single_result(conn, query, (pid, ppn))
                            if result:
                                derived_project_id = result[0]
                                break
                        if derived_project_id:
                            break
                # 3) product_id + system_type
                if not derived_project_id:
                    for pid in unique_product_ids:
                        query = adapt_query_placeholders('''
                            SELECT id FROM projects 
                            WHERE product_id = ? AND system_type = ?
                            ORDER BY id DESC
                            LIMIT 1
                        ''')
                        result = execute_single_result(conn, query, (pid, data['system']))
                        if result:
                            derived_project_id = result[0]
                            break
                # 4) 仅 product_id
                if not derived_project_id:
                    for pid in unique_product_ids:
                        query = adapt_query_placeholders('''
                            SELECT id FROM projects 
                            WHERE product_id = ?
                            ORDER BY id DESC
                            LIMIT 1
                        ''')
                        result = execute_single_result(conn, query, (pid,))
                        if result:
                            derived_project_id = result[0]
                            break
            
            # 更新数据库
            query = adapt_query_placeholders('''
                UPDATE automation_projects 
                SET process_name=?, product_ids=?, `system`=?, product_type=?, 
                    environment=?, product_address=?, product_package_names=?, test_steps=?, 
                    project_id=?, updated_at=NOW()
                WHERE id=?
            ''')
            execute_insert_query(conn, query, (
                data['process_name'],
                json.dumps(data['product_ids'], ensure_ascii=False),
                data['system'],
                data.get('product_type', ''),
                data.get('environment', ''),
                data.get('product_address', ''),
                json.dumps(data.get('product_package_names', []), ensure_ascii=False),
                json.dumps(data['test_steps'], ensure_ascii=False),
                derived_project_id,
                project_id
            ))
        
        # 更新项目文件映射并更新测试代码文件
        from utils.file_manager import file_manager
        
        try:
            # 更新文件映射（如果需要）
            file_mapping = file_manager.get_project_file_mapping(project_id)
            if file_mapping:
                # 如果文件映射存在，更新项目名称
                file_manager.update_project_file_mapping(
                    project_id=project_id,
                    project_name=data['process_name']  # 更新项目名称
                )
            
            # 新增：保存注册账号到YAML（更新时）
            try:
                accounts_map = {}
                accounts_by_order = []
                per_step_payloads = []
                for idx, step in enumerate(data.get('test_steps', [])):
                    if step.get('operation_event') in ('register', 'login'):
                        cfg = step.get('auth_config', {})
                        local_map = {}
                        local_by_order = []
                        for acc in cfg.get('accounts', []) or []:
                            addr = (acc.get('address') or '').strip()
                            if addr:
                                local_map[addr] = {
                                    'email': acc.get('email', ''),
                                    'password': acc.get('password', '')
                                }
                                local_by_order.append({
                                    'address': addr,
                                    'email': acc.get('email', ''),
                                    'password': acc.get('password', '')
                                })
                        addr_map = cfg.get('address_credentials', {}) or {}
                        if isinstance(addr_map, dict):
                            for addr_key, info in addr_map.items():
                                if not addr_key:
                                    continue
                                local_map[addr_key] = {
                                    'email': (info or {}).get('email', ''),
                                    'password': (info or {}).get('password', '')
                                }
                        addr_list = cfg.get('address_credentials_list', []) or []
                        if isinstance(addr_list, list) and len(addr_list) > 0:
                            try:
                                addresses_data = data.get('product_address')
                                addresses_seq = []
                                if addresses_data:
                                    decoded = json.loads(addresses_data)
                                    if isinstance(decoded, list):
                                        addresses_seq = [str(x).strip() for x in decoded]
                                    elif isinstance(decoded, dict):
                                        for _, value in decoded.items():
                                            addresses_seq.append(str(value).strip())
                                for i2, addr in enumerate(addresses_seq):
                                    if i2 >= len(addr_list):
                                        break
                                    info = addr_list[i2] or {}
                                    local_by_order.append({
                                        'address': addr,
                                        'email': info.get('email', ''),
                                        'password': info.get('password', '')
                                    })
                            except Exception:
                                pass
                        for k, v in local_map.items():
                            accounts_map[k] = v
                        accounts_by_order.extend(local_by_order)
                        product_address_slots = {}
                        accounts_slots = {}
                        try:
                            decoded = json.loads(data.get('product_address') or '{}')
                            if isinstance(decoded, dict):
                                i3 = 0
                                for k, addr in decoded.items():
                                    slot_key = str(k)
                                    product_address_slots[slot_key] = str(addr).strip()
                                    if i3 < len(local_by_order):
                                        info = local_by_order[i3]
                                        accounts_slots[slot_key] = {
                                            'address': str(addr).strip(),
                                            'email': info.get('email', ''),
                                            'password': info.get('password', '')
                                        }
                                    i3 += 1
                        except Exception:
                            pass
                        per_step_payloads.append({
                            'idx': idx,
                            'step_name': step.get('step_name', f'step_{idx+1}'),
                            'operation_event': step.get('operation_event', ''),
                            'by_address': local_map,
                            'by_order': local_by_order,
                            'by_slot': accounts_slots,
                            'product_address_slots': product_address_slots
                        })
                if (accounts_map or accounts_by_order) and file_mapping:
                    product_address_slots = {}
                    accounts_slots = {}
                    try:
                        decoded = json.loads(data.get('product_address') or '{}')
                        if isinstance(decoded, dict):
                            idx = 0
                            for k, addr in decoded.items():
                                slot_key = str(k)
                                product_address_slots[slot_key] = str(addr).strip()
                                if idx < len(accounts_by_order):
                                    info = accounts_by_order[idx]
                                    accounts_slots[slot_key] = {
                                        'address': str(addr).strip(),
                                        'email': info.get('email', ''),
                                        'password': info.get('password', '')
                                    }
                                idx += 1
                    except Exception:
                        pass
                    write_accounts(
                        data['process_name'],
                        file_mapping['file_name'],
                        accounts_map,
                        accounts_by_order,
                        accounts_slots,
                        product_address_slots
                    )
                if per_step_payloads and file_mapping:
                    from utils.auth_accounts import write_step_accounts
                    for payload in per_step_payloads:
                        write_step_accounts(
                            data['process_name'],
                            file_mapping['file_name'],
                            payload['idx'],
                            payload['step_name'],
                            payload['operation_event'],
                            payload['by_address'],
                            payload['by_order'],
                            payload['by_slot'],
                            payload['product_address_slots']
                        )
            except Exception as e:
                log_info(f"更新时保存注册账号到YAML失败: {str(e)}")
            
            # 更新现有测试代码文件，而不是重新生成
            update_test_code(project_id, data)
            
            return jsonify({
                'success': True,
                'message': '自动化项目更新成功'
            })
        except Exception as file_error:
            log_info(f"文件映射更新失败: {str(file_error)}")
            # 即使文件映射失败，项目更新仍然成功
            return jsonify({
                'success': True,
                'message': '自动化项目更新成功（文件映射更新失败）'
            })
        
    except Exception as e:
        log_info(f"更新自动化项目失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'更新自动化项目失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>/execute', methods=['POST'])
def execute_test(project_id):
    """执行测试"""
    try:
        # 检查是否已有测试在运行
        if project_id in running_tests:
            return jsonify({
                'success': False,
                'message': '该项目测试正在运行中'
            }), 400
        
        # 获取项目信息
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('SELECT id FROM automation_projects WHERE id=?')
            project_results = execute_query_with_results(conn, query, (project_id,))
            
            if not project_results:
                return jsonify({
                    'success': False,
                    'message': '项目不存在'
                }), 404
            
            # 更新项目状态为运行中
            update_query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
            execute_insert_query(conn, update_query, ('running', project_id))
        
        # 记录测试开始的执行记录
        start_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        current_user = get_current_user()
        execution_id = create_execution_record(project_id, 'running', 
                                             executed_by=current_user,
                                             log_message='测试开始执行', start_time=start_time)
        
        # 设置当前执行ID，用于实时日志记录
        from config.logger import set_current_execution_id
        set_current_execution_id(execution_id)
        
        # 在后台执行测试
        thread = threading.Thread(target=run_test_in_background, args=(project_id, start_time, execution_id, current_user))
        thread.daemon = True
        thread.start()
        
        running_tests[project_id] = {
            'thread': thread,
            'start_time': datetime.now(),
            'execution_id': execution_id
        }
        
        return jsonify({
            'success': True,
            'message': '测试已开始执行',
            'execution_id': execution_id
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'执行测试失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>/test-connection', methods=['POST'])
async def test_connection(project_id):
    """测试连接"""
    try:
        # 获取项目信息
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('SELECT id, product_ids, `system`, product_type, environment, product_address FROM automation_projects WHERE id=?')
            project_results = execute_query_with_results(conn, query, (project_id,))
        
        if not project_results:
            return jsonify({
                'success': False,
                'message': '项目不存在'
            }), 404
        
        project = project_results[0]
        # 获取项目详细信息
        system = project[2]  # system字段（可能为JSON字符串）
        product_type = project[3]  # product_type字段
        environment = project[4]  # environment字段
        raw_product_address = project[5]  # product_address字段
        
        # 规范化系统字段（仅用于日志/显示）
        try:
            system_display = json.loads(system) if isinstance(system, str) else system
        except (json.JSONDecodeError, TypeError):
            system_display = system
        log_info(f"测试连接 - 项目ID: {project_id}, 系统: {system_display}, 产品类型: {product_type}, 环境: {environment}")
        
        # 直接从 automation_projects.product_address 解析地址
        product_addresses = []
        try:
            if raw_product_address:
                parsed_addr = json.loads(raw_product_address)
                if isinstance(parsed_addr, dict):
                    product_addresses = list(parsed_addr.values())
                elif isinstance(parsed_addr, list):
                    product_addresses = parsed_addr
                else:
                    product_addresses = [str(parsed_addr)]
        except (json.JSONDecodeError, TypeError):
            product_addresses = [raw_product_address]
        # 规范化为非空字符串列表
        product_addresses = [str(a).strip() for a in product_addresses if a and str(a).strip()]
        log_info(f"项目产品地址: {product_addresses}")
        
        # 根据产品类型或环境选择测试文件
        pt_lower = (product_type or '').lower()
        env_lower = (environment or '').lower()
        test_result = None
        if pt_lower == 'web' or env_lower == 'web':
            # 将地址以 test_web_connection 的通用格式传递（列表或字符串均可被解析）
            test_result = run_connection_test('web_google_test.py', project_id, str(system_display), product_type, environment, product_addresses)
        else:
            return jsonify({
                'success': False,
                'message': f'暂不支持 {system_display} 系统的连接测试，后续版本将支持'
            }), 400
        
        if test_result['success']:
            return jsonify({
                'success': True,
                'message': f'连接测试成功！系统: {system_display}, 产品类型: {product_type}',
                'details': test_result['details']
            })
        else:
            return jsonify({
                'success': False,
                'message': f'连接测试失败: {test_result["error"]}',
                'details': test_result.get('details', '')
            }), 500
        
    except Exception as e:
        log_info(f"测试连接异常: {e}")
        return jsonify({
            'success': False,
            'message': f'测试连接失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>/cancel', methods=['POST'])
def cancel_test(project_id):
    """取消测试"""
    try:
        # 获取取消类型参数
        try:
            if request.is_json:
                cancel_type = request.json.get('type', 'cancel')
            else:
                # 如果没有JSON数据，尝试从form数据获取，否则使用默认值
                cancel_type = request.form.get('type', 'cancel')
        except:
            cancel_type = 'cancel'
        
        log_info(f"收到取消请求，项目ID: {project_id}, 类型: {cancel_type}")
        
        # 检查项目是否存在
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('SELECT status FROM automation_projects WHERE id=?')
            project_results = execute_query_with_results(conn, query, (project_id,))
        
        if not project_results:
            return jsonify({
                'success': False,
                'message': '项目不存在'
            }), 404
        
        project = project_results[0]
        current_status = project[0]
        
        # 如果项目不在运行中，检查是否需要清理状态
        if project_id not in running_tests:
            # 检查是否存在状态不一致的情况
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('''
                    SELECT status, start_time, end_time 
                    FROM automation_executions 
                    WHERE project_id=? 
                    ORDER BY start_time DESC 
                    LIMIT 1
                ''')
                execution_results = execute_query_with_results(conn, query, (project_id,))
                latest_execution = execution_results[0] if execution_results else None
            
            # 如果数据库状态是running但实际不在运行，说明进程已经结束
            if current_status == 'running':
                # 根据取消类型决定状态
                if cancel_type == 'errors':
                    final_status = 'failed'
                    log_message = '测试运行异常'
                else:
                    final_status = 'failed'
                    log_message = '进程异常退出（手动取消）'
                
                # 更新项目状态
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                    execute_query(conn, query, (final_status, project_id))
                    
                    # 同时更新执行记录状态，包括取消类型
                    query = adapt_query_placeholders('''
                        UPDATE automation_executions 
                        SET status=?, end_time=NOW(), log_message=?, cancel_type=? 
                        WHERE project_id=? AND status='running'
                    ''')
                    execute_query(conn, query, (final_status, log_message, cancel_type, project_id))
                
                return jsonify({
                    'success': True,
                    'message': f'测试进程已结束，状态已更新为{final_status}'
                })
            elif latest_execution and latest_execution[0] == 'running' and latest_execution[2] is None:
                # 如果最新执行记录是running状态且没有结束时间，但项目状态不是running
                # 这是状态不一致的情况，更新执行记录状态
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('''
                        UPDATE automation_executions 
                        SET status=?, end_time=NOW(), log_message=? 
                        WHERE project_id=? AND status='running' AND end_time IS NULL
                    ''')
                    execute_query(conn, query, (current_status, '状态不一致修复（手动取消）', project_id))
                
                return jsonify({
                    'success': True,
                    'message': f'测试进程已结束，状态已更新为{current_status}'
                })
            else:
                return jsonify({
                    'success': False,
                    'message': f'项目当前状态为 {current_status}，无法取消'
                }), 400
        
        # 终止测试进程
        test_info = running_tests[project_id]
        thread = test_info.get('thread')
        process = test_info.get('process')
        
        # 设置取消标志
        test_info['cancelled'] = True
        
        # 如果有subprocess进程，终止它
        if process and process.poll() is None:
            try:
                import signal
                import os
                if os.name == 'nt':  # Windows
                    process.terminate()
                else:  # Unix/Linux
                    process.send_signal(signal.SIGTERM)
                    # 等待进程结束，如果超时则强制杀死
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
            except Exception as e:
                log_info(f"终止进程失败: {e}")
        
        # 根据取消类型决定状态
        if cancel_type == 'errors':
            final_status = 'failed'
            log_message = '测试运行异常'
        else:
            final_status = 'cancelled'
            log_message = '测试被用户取消'
        
        # 更新项目状态
        with get_db_connection_with_retry() as conn:
            query1 = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
            execute_query(conn, query1, (final_status, project_id))
            
            # 同时更新执行记录状态，包括取消类型
            query2 = adapt_query_placeholders('''
                UPDATE automation_executions 
                SET status=?, end_time=NOW(), log_message=?, cancel_type=? 
                WHERE project_id=? AND status='running'
            ''')
            execute_query(conn, query2, (final_status, log_message, cancel_type, project_id))
        
        return jsonify({
            'success': True,
            'message': f'测试已{final_status}'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'取消测试失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>/executions', methods=['GET'])
def get_execution_history(project_id):
    """获取执行历史记录"""
    try:
        # 获取分页参数
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 5, type=int)
        
        # 验证和修正参数
        page = max(1, page)  # 确保页码至少为1
        page_size = min(max(1, page_size), 50)  # 限制每页记录数为1-50
        offset = (page - 1) * page_size
        
        with get_db_connection_with_retry() as conn:
            # 获取总记录数
            count_query = adapt_query_placeholders('SELECT COUNT(*) FROM automation_executions WHERE project_id=?')
            total_count = execute_single_result(conn, count_query, (project_id,))[0]
            
            # 分页查询执行记录
            query = adapt_query_placeholders('''
                SELECT id, project_id, process_name, product_ids, `system`, product_type, 
                       environment, product_address, status, start_time, end_time, log_message, detailed_log, executed_by, cancel_type 
                FROM automation_executions 
                WHERE project_id=? 
                ORDER BY start_time DESC
                LIMIT ? OFFSET ?
            ''')
            results = execute_query_with_results(conn, query, (project_id, page_size, offset))
            
            executions = []
            for row in results:
                execution = {
                    'id': row[0],
                    'project_id': row[1],
                    'process_name': row[2],
                    'product_ids': row[3],
                    'system': row[4],
                    'product_type': row[5],
                    'environment': row[6],
                    'product_address': row[7],
                    'status': row[8],
                    'start_time': row[9],
                    'end_time': row[10],
                    'log_message': row[11],
                    'detailed_log': row[12],
                    'executed_by': row[13],
                    'cancel_type': row[14]
                }
                executions.append(execution)
        
        # 计算分页信息
        total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 1
        has_next = page < total_pages
        has_prev = page > 1
        
        # 如果请求的页码超过总页数，返回空数据
        if page > total_pages and total_count > 0:
            executions = []
        
        return jsonify({
            'success': True,
            'data': executions,
            'pagination': {
                'page': page,
                'page_size': page_size,
                'total_count': total_count,
                'total_pages': total_pages,
                'has_next': has_next,
                'has_prev': has_prev
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'获取执行记录失败: {str(e)}'
        }), 500

@automation_bp.route('/executions', methods=['GET'])
def get_all_executions():
    """获取所有执行记录"""
    try:
        # 获取分页参数
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 10, type=int)
        
        # 验证和修正参数
        page = max(1, page)  # 确保页码至少为1
        page_size = min(max(1, page_size), 50)  # 限制每页记录数为1-50
        offset = (page - 1) * page_size
        
        with get_db_connection_with_retry() as conn:
            # 获取总记录数
            total_count = execute_single_result(conn, 'SELECT COUNT(*) FROM automation_executions')[0]
            
            # 分页查询执行记录
            query = adapt_query_placeholders('''
                SELECT id, project_id, process_name, product_ids, `system`, product_type, 
                       environment, product_address, status, start_time, end_time, log_message, detailed_log, executed_by, cancel_type 
                FROM automation_executions 
                ORDER BY start_time DESC
                LIMIT ? OFFSET ?
            ''')
            results = execute_query_with_results(conn, query, (page_size, offset))
            
            executions = []
            for row in results:
                execution = {
                    'id': row[0],
                    'project_id': row[1],
                    'process_name': row[2],
                    'product_ids': row[3],
                    'system': row[4],
                    'product_type': row[5],
                    'environment': row[6],
                    'product_address': row[7],
                    'status': row[8],
                    'start_time': row[9],
                    'end_time': row[10],
                    'log_message': row[11],
                    'detailed_log': row[12],
                    'executed_by': row[13],
                    'cancel_type': row[14]
                }
                executions.append(execution)
        
        # 计算分页信息
        total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 1
        has_next = page < total_pages
        has_prev = page > 1
        
        # 如果请求的页码超过总页数，返回空数据
        if page > total_pages and total_count > 0:
            executions = []
        
        return jsonify({
            'success': True,
            'data': {
                'executions': executions,
                'pagination': {
                    'page': page,
                    'page_size': page_size,
                    'total_count': total_count,
                    'total_pages': total_pages,
                    'has_next': has_next,
                    'has_prev': has_prev
                }
            }
        })
        
    except Exception as e:
        log_info(f"获取所有执行记录失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'获取执行记录失败: {str(e)}'
        }), 500

@automation_bp.route('/executions/<int:execution_id>', methods=['GET'])
def get_execution_detail(execution_id):
    """获取单个执行记录的详细信息"""
    try:
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('''
                SELECT id, project_id, process_name, product_ids, `system`, product_type, 
                       environment, product_address, status, start_time, end_time, log_message, detailed_log, executed_by, cancel_type 
                FROM automation_executions 
                WHERE id = ?
            ''')
            
            execution_results = execute_query_with_results(conn, query, (execution_id,))
            if not execution_results:
                return jsonify({
                    'success': False,
                    'message': '执行记录不存在'
                }), 404
            
            row = execution_results[0]
            execution = {
                'id': row[0],
                'project_id': row[1],
                'process_name': row[2],
                'product_ids': row[3],
                'system': row[4],
                'product_type': row[5],
                'environment': row[6],
                'product_address': row[7],
                'status': row[8],
                'start_time': row[9],
                'end_time': row[10],
                'log_message': row[11],
                'detailed_log': row[12],
                'executed_by': row[13],
                'cancel_type': row[14]
            }
            
            return jsonify({
                'success': True,
                'data': execution
            })
            
    except Exception as e:
        log_info(f"获取执行记录详情失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'获取执行记录详情失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>/stop', methods=['POST'])
def stop_project(project_id):
    """停止项目执行"""
    try:
        with get_db_connection_with_retry() as conn:
            # 检查项目是否存在
            query = adapt_query_placeholders('SELECT id, process_name FROM automation_projects WHERE id = ?')
            project_results = execute_query_with_results(conn, query, (project_id,))
            
            if not project_results:
                return jsonify({
                    'success': False,
                    'message': '项目不存在'
                }), 404
            
            project = project_results[0]
            # 查找正在执行的记录
            query2 = adapt_query_placeholders('''
                SELECT id, status FROM automation_executions 
                WHERE project_id = ? AND status IN ('running', 'pending')
                ORDER BY start_time DESC LIMIT 1
            ''')
            execution_results = execute_query_with_results(conn, query2, (project_id,))
            
            execution = execution_results[0] if execution_results else None
            
            if not execution:
                return jsonify({
                    'success': False,
                    'message': '没有正在执行的任务'
                }), 400
            
            execution_id, current_status = execution
            
            # 更新执行状态为已停止
            query3 = adapt_query_placeholders('''
                UPDATE automation_executions 
                SET status = 'stopped', end_time = NOW(),
                    log_message = CONCAT(COALESCE(log_message, ''), '\n[停止时间] ', NOW(), ' - 任务被手动停止')
                WHERE id = ?
            ''')
            execute_query(conn, query3, (execution_id,))
            
            # 记录停止日志
            log_info(f"项目 {project[1]} (ID: {project_id}) 的执行被手动停止")
            
            return jsonify({
                'success': True,
                'message': '项目执行已停止'
            })
            
    except Exception as e:
        log_info(f"停止项目执行失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'停止项目执行失败: {str(e)}'
        }), 500

@automation_bp.route('/upload-image', methods=['POST'])
def upload_test_image():
    """上传测试图片"""
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'message': '没有选择图片'}), 400
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({'success': False, 'message': '没有选择图片'}), 400
        
        if file and allowed_file(file.filename):
            timestamp = str(int(time.time()))
            filename = f"{timestamp}_{file.filename}"
            
            # 确保Game_Img目录存在
            upload_dir = 'Game_Img'
            os.makedirs(upload_dir, exist_ok=True)
            
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
            
            return jsonify({
                'success': True,
                'message': '图片上传成功',
                'data': {'file_path': file_path}
            })
        else:
            return jsonify({'success': False, 'message': '不支持的图片格式'}), 400
            
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'上传图片失败: {str(e)}'
        }), 500

def generate_test_code(automation_id, data):
    """生成测试代码文件"""
    try:
        # 使用文件管理器获取正确的文件名
        from utils.file_manager import file_manager
        
        # 获取项目的文件映射信息
        file_mapping = file_manager.get_project_file_mapping(automation_id)
        
        if file_mapping:
            # 使用映射中的文件名
            filename = file_mapping['file_name']
            product_ids = data['product_ids']
            
            if len(product_ids) == 1:
                # 单产品ID场景：支持一个产品对应多个地址 → 生成多个方法
                product_id = product_ids[0]
                addresses = []
                raw_addr = data.get('product_address')
                if raw_addr:
                    try:
                        parsed = json.loads(raw_addr)
                        if isinstance(parsed, dict):
                            # 先按 product_id、product_id_n 顺序收集
                            indexed = []
                            for key, value in parsed.items():
                                if key == product_id:
                                    indexed.append((0, value))
                                elif key.startswith(f"{product_id}_"):
                                    suffix = key[len(product_id) + 1:]
                                    try:
                                        num = int(suffix)
                                    except Exception:
                                        num = 0
                                    indexed.append((num, value))
                            if indexed:
                                for _, value in sorted(indexed, key=lambda x: x[0]):
                                    addresses.append(value)
                            else:
                                # 若没有匹配到以 product_id 开头的键，则退化为 values 顺序
                                addresses.extend(list(parsed.values()))
                        elif isinstance(parsed, list):
                            addresses = list(parsed)
                        else:
                            addresses = [raw_addr]
                    except (json.JSONDecodeError, TypeError):
                        addresses = [raw_addr]
                
                # 若前端未提供，尝试从DB取并解析
                if not addresses:
                    with get_db_connection_with_retry() as conn:
                        query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                        result = execute_query_with_results(conn, query, (product_id,))
                        if result:
                            db_raw = result[0][0]
                            try:
                                parsed = json.loads(db_raw)
                                if isinstance(parsed, dict):
                                    indexed = []
                                    for key, value in parsed.items():
                                        if key == product_id:
                                            indexed.append((0, value))
                                        elif key.startswith(f"{product_id}_"):
                                            suffix = key[len(product_id) + 1:]
                                            try:
                                                num = int(suffix)
                                            except Exception:
                                                num = 0
                                            indexed.append((num, value))
                                    if indexed:
                                        for _, value in sorted(indexed, key=lambda x: x[0]):
                                            addresses.append(value)
                                    else:
                                        addresses.extend(list(parsed.values()))
                                elif isinstance(parsed, list):
                                    addresses = list(parsed)
                                else:
                                    addresses = [db_raw]
                            except (json.JSONDecodeError, TypeError):
                                addresses = [db_raw]
                
                # 检查是否有login步骤，如果有，优先使用address_credentials_list中的地址
                has_login_step = False
                login_addresses = []
                for step in data.get('test_steps', []):
                    if step.get('operation_event') == 'login':
                        has_login_step = True
                        auth_cfg = step.get('auth_config', {}) or {}
                        addr_list = auth_cfg.get('address_credentials_list', []) or []
                        for addr_cred in addr_list:
                            addr = (addr_cred.get('address') or '').strip()
                            login_addresses.append(addr)
                        break
                
                # 如果有login步骤且有对应的地址列表，使用login地址
                if has_login_step and login_addresses:
                    addresses = login_addresses
                
                if len(addresses) > 1:
                    product_addresses = [(product_id, addr) for addr in addresses]
                    generate_multi_product_test_file(filename, data, product_addresses)
                else:
                    # 保持单地址逻辑
                    single_addr = addresses[0] if addresses else ''
                    data_single = dict(data)
                    data_single['product_address'] = single_addr
                    generate_single_test_file(filename, data_single, product_id)
            else:
                # 多产品ID的情况，需要获取每个产品的地址（支持 PID、PID_1..PID_n 全量解析）
                product_addresses = []
                
                # 从当前项目的product_address字段获取地址映射
                if data.get('product_address'):
                    try:
                        address_map = json.loads(data['product_address'])
                        if isinstance(address_map, dict):
                            # 针对每个基础产品ID，收集同名与带序号的全部地址
                            unique_bases = list(dict.fromkeys(product_ids))
                            for base in unique_bases:
                                indexed = []
                                for key, value in address_map.items():
                                    if key == base:
                                        indexed.append((0, value))
                                    elif key.startswith(f"{base}_"):
                                        suffix = key[len(base) + 1:]
                                        try:
                                            num = int(suffix)
                                        except Exception:
                                            continue
                                        indexed.append((num, value))
                                for _, val in sorted(indexed, key=lambda x: x[0]):
                                    product_addresses.append((base, val))
                        elif isinstance(address_map, list):
                            # 列表顺序分配，超出部分归到最后一个产品ID
                            if product_ids:
                                for idx, val in enumerate(address_map):
                                    base = product_ids[min(idx, len(product_ids) - 1)]
                                    product_addresses.append((base, val))
                    except (json.JSONDecodeError, TypeError):
                        pass
                
                # 如果没有从product_address字段获取到地址，尝试从projects表获取
                if not product_addresses:
                    with get_db_connection_with_retry() as conn:
                        unique_bases = list(dict.fromkeys(product_ids))
                        for base in unique_bases:
                            query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                            result = execute_query_with_results(conn, query, (base,))
                            
                            if result:
                                product_address = result[0][0]
                                # 安全解析：支持JSON列表或字典，且收集全部序号
                                try:
                                    parsed = json.loads(product_address)
                                    if isinstance(parsed, dict):
                                        indexed = []
                                        for key, value in parsed.items():
                                            if key == base:
                                                indexed.append((0, value))
                                            elif key.startswith(f"{base}_"):
                                                suffix = key[len(base) + 1:]
                                                try:
                                                    num = int(suffix)
                                                except Exception:
                                                    continue
                                                indexed.append((num, value))
                                        for _, val in sorted(indexed, key=lambda x: x[0]):
                                            product_addresses.append((base, val))
                                    elif isinstance(parsed, list):
                                        for val in parsed:
                                            product_addresses.append((base, val))
                                    else:
                                        product_addresses.append((base, product_address))
                                except (json.JSONDecodeError, TypeError):
                                    product_addresses.append((base, product_address))
                            else:
                                log_info(f"警告: 未找到产品 {base} 的地址信息")

                # 检查是否有login步骤，如果有，优先使用address_credentials_list中的地址
                has_login_step = False
                login_addresses = []
                for step in data.get('test_steps', []):
                    if step.get('operation_event') == 'login':
                        has_login_step = True
                        auth_cfg = step.get('auth_config', {}) or {}
                        addr_list = auth_cfg.get('address_credentials_list', []) or []
                        for addr_cred in addr_list:
                            addr = (addr_cred.get('address') or '').strip()
                            login_addresses.append(addr)
                        break
                
                # 如果有login步骤且有对应的地址列表，使用login地址
                if has_login_step and login_addresses:
                    addresses = login_addresses

                if product_addresses:
                    generate_multi_product_test_file(filename, data, product_addresses)
                else:
                    # 如果没有找到产品地址，使用第一个产品ID生成代码
                    generate_single_test_file(filename, data, product_ids[0])
        else:
            # 如果没有文件映射，使用旧的逻辑作为后备
            product_ids = data['product_ids']
            system = data['system']
            
            if len(product_ids) == 1:
                # 单产品ID场景：也支持一个产品多个地址
                clean_product_id = product_ids[0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                filename = generate_unique_filename(clean_product_id, system)
                product_id = product_ids[0]
                addresses = []
                raw_addr = data.get('product_address')
                if raw_addr:
                    try:
                        parsed = json.loads(raw_addr)
                        if isinstance(parsed, dict):
                            indexed = []
                            for key, value in parsed.items():
                                if key == product_id:
                                    indexed.append((0, value))
                                elif key.startswith(f"{product_id}_"):
                                    suffix = key[len(product_id) + 1:]
                                    try:
                                        num = int(suffix)
                                    except Exception:
                                        num = 0
                                    indexed.append((num, value))
                            if indexed:
                                for _, value in sorted(indexed, key=lambda x: x[0]):
                                    addresses.append(value)
                            else:
                                addresses.extend(list(parsed.values()))
                        elif isinstance(parsed, list):
                            addresses = list(parsed)
                        else:
                            addresses = [raw_addr]
                    except (json.JSONDecodeError, TypeError):
                        addresses = [raw_addr]
                
                if not addresses:
                    with get_db_connection_with_retry() as conn:
                        query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                        result = execute_query_with_results(conn, query, (product_id,))
                        if result:
                            db_raw = result[0][0]
                            try:
                                parsed = json.loads(db_raw)
                                if isinstance(parsed, dict):
                                    indexed = []
                                    for key, value in parsed.items():
                                        if key == product_id:
                                            indexed.append((0, value))
                                        elif key.startswith(f"{product_id}_"):
                                            suffix = key[len(product_id) + 1:]
                                            try:
                                                num = int(suffix)
                                            except Exception:
                                                num = 0
                                            indexed.append((num, value))
                                    if indexed:
                                        for _, value in sorted(indexed, key=lambda x: x[0]):
                                            addresses.append(value)
                                    else:
                                        addresses.extend(list(parsed.values()))
                                elif isinstance(parsed, list):
                                    addresses = list(parsed)
                                else:
                                    addresses = [db_raw]
                            except (json.JSONDecodeError, TypeError):
                                addresses = [db_raw]
                
                # 检查是否有login步骤，如果有，优先使用address_credentials_list中的地址
                has_login_step = False
                login_addresses = []
                for step in data.get('test_steps', []):
                    if step.get('operation_event') == 'login':
                        has_login_step = True
                        auth_cfg = step.get('auth_config', {}) or {}
                        addr_list = auth_cfg.get('address_credentials_list', []) or []
                        for addr_cred in addr_list:
                            addr = (addr_cred.get('address') or '').strip()
                            login_addresses.append(addr)
                        break
                
                # 如果有login步骤且有对应的地址列表，使用login地址
                if has_login_step and login_addresses:
                    addresses = login_addresses
                
                if len(addresses) > 1:
                    product_addresses = [(product_id, addr) for addr in addresses]
                    generate_multi_product_test_file(filename, data, product_addresses)
                else:
                    data_single = dict(data)
                    data_single['product_address'] = addresses[0] if addresses else ''
                    generate_single_test_file(filename, data_single, product_id)
            else:
                # 多产品ID的情况，需要获取每个产品的地址（支持 PID、PID_1..PID_n 全量解析）
                product_addresses = []
                
                # 从当前项目的product_address字段获取地址映射
                if data.get('product_address'):
                    try:
                        address_map = json.loads(data['product_address'])
                        if isinstance(address_map, dict):
                            unique_bases = list(dict.fromkeys(product_ids))
                            for base in unique_bases:
                                indexed = []
                                for key, value in address_map.items():
                                    if key == base:
                                        indexed.append((0, value))
                                    elif key.startswith(f"{base}_"):
                                        suffix = key[len(base) + 1:]
                                        try:
                                            num = int(suffix)
                                        except Exception:
                                            continue
                                        indexed.append((num, value))
                                for _, val in sorted(indexed, key=lambda x: x[0]):
                                    product_addresses.append((base, val))
                        elif isinstance(address_map, list):
                            if product_ids:
                                for idx, val in enumerate(address_map):
                                    base = product_ids[min(idx, len(product_ids) - 1)]
                                    product_addresses.append((base, val))
                    except (json.JSONDecodeError, TypeError):
                        pass
                
                # 如果没有从product_address字段获取到地址，尝试从projects表获取
                if not product_addresses:
                    with get_db_connection_with_retry() as conn:
                        unique_bases = list(dict.fromkeys(product_ids))
                        for base in unique_bases:
                            query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                            result = execute_query_with_results(conn, query, (base,))
                            
                            if result:
                                product_address = result[0][0]
                                # 安全解析：支持JSON列表或字典，且收集全部序号
                                try:
                                    parsed = json.loads(product_address)
                                    if isinstance(parsed, dict):
                                        indexed = []
                                        for key, value in parsed.items():
                                            if key == base:
                                                indexed.append((0, value))
                                            elif key.startswith(f"{base}_"):
                                                suffix = key[len(base) + 1:]
                                                try:
                                                    num = int(suffix)
                                                except Exception:
                                                    continue
                                                indexed.append((num, value))
                                        for _, val in sorted(indexed, key=lambda x: x[0]):
                                            product_addresses.append((base, val))
                                    elif isinstance(parsed, list):
                                        for val in parsed:
                                            product_addresses.append((base, val))
                                    else:
                                        product_addresses.append((base, product_address))
                                except (json.JSONDecodeError, TypeError):
                                    product_addresses.append((base, product_address))
                            else:
                                log_info(f"警告: 未找到产品 {base} 的地址信息")
                
                                                        # 检查是否有login步骤，如果有，优先使用address_credentials_list中的地址
                has_login_step = False
                login_addresses = []
                for step in data.get('test_steps', []):
                    if step.get('operation_event') == 'login':
                        has_login_step = True
                        auth_cfg = step.get('auth_config', {}) or {}
                        addr_list = auth_cfg.get('address_credentials_list', []) or []
                        for addr_cred in addr_list:
                            addr = (addr_cred.get('address') or '').strip()
                            login_addresses.append(addr)
                        break
                
                # 如果有login步骤且有对应的地址列表，使用login地址
                if has_login_step and login_addresses:
                    addresses = login_addresses
                
                if product_addresses:
                    # 使用第一个产品的ID生成文件名
                    clean_product_id = product_ids[0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                    filename = generate_unique_filename(clean_product_id, system)
                    generate_multi_product_test_file(filename, data, product_addresses)
                else:
                    # 如果没有找到产品地址，使用第一个产品ID生成代码
                    clean_product_id = product_ids[0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                    filename = generate_unique_filename(clean_product_id, system)
                    generate_single_test_file(filename, data, product_ids[0])
        
    except Exception as e:
        log_info(f"生成测试代码失败: {e}")

def update_test_code(automation_id, data):
    """更新现有测试代码文件"""
    try:
        # 使用文件管理器获取正确的文件名
        from utils.file_manager import file_manager
        
        # 获取项目的文件映射信息
        file_mapping = file_manager.get_project_file_mapping(automation_id)
        
        if file_mapping:
            # 使用映射中的文件名
            filename = file_mapping['file_name']
            product_ids = data['product_ids']
            
            if len(product_ids) == 1:
                # 单产品ID：若有多个地址则生成/更新多方法，否则更新单方法
                product_id = product_ids[0]
                addresses = []
                raw_addr = data.get('product_address')
                if raw_addr:
                    try:
                        parsed = json.loads(raw_addr)
                        if isinstance(parsed, dict):
                            indexed = []
                            for key, value in parsed.items():
                                if key == product_id:
                                    indexed.append((0, value))
                                elif key.startswith(f"{product_id}_"):
                                    suffix = key[len(product_id) + 1:]
                                    try:
                                        num = int(suffix)
                                    except Exception:
                                        num = 0
                                    indexed.append((num, value))
                            if indexed:
                                for _, value in sorted(indexed, key=lambda x: x[0]):
                                    addresses.append(value)
                            else:
                                addresses.extend(list(parsed.values()))
                        elif isinstance(parsed, list):
                            addresses = list(parsed)
                        else:
                            addresses = [raw_addr]
                    except (json.JSONDecodeError, TypeError):
                        addresses = [raw_addr]
                if not addresses:
                    with get_db_connection_with_retry() as conn:
                        query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                        result = execute_query_with_results(conn, query, (product_id,))
                        if result:
                            db_raw = result[0][0]
                            try:
                                parsed = json.loads(db_raw)
                                if isinstance(parsed, dict):
                                    indexed = []
                                    for key, value in parsed.items():
                                        if key == product_id:
                                            indexed.append((0, value))
                                        elif key.startswith(f"{product_id}_"):
                                            suffix = key[len(product_id) + 1:]
                                            try:
                                                num = int(suffix)
                                            except Exception:
                                                num = 0
                                            indexed.append((num, value))
                                    if indexed:
                                        for _, value in sorted(indexed, key=lambda x: x[0]):
                                            addresses.append(value)
                                    else:
                                        addresses.extend(list(parsed.values()))
                                elif isinstance(parsed, list):
                                    addresses = list(parsed)
                                else:
                                    addresses = [db_raw]
                            except (json.JSONDecodeError, TypeError):
                                addresses = [db_raw]
                if len(addresses) > 1:
                    product_addresses = [(product_id, addr) for addr in addresses]
                    update_multi_product_test_file(filename, data, product_addresses)
                else:
                    data_single = dict(data)
                    data_single['product_address'] = addresses[0] if addresses else ''
                    update_single_test_file(filename, data_single, product_id)
            else:
                # 多产品ID的情况，需要获取每个产品的地址（支持 PID、PID_1..PID_n 全量解析）
                product_addresses = []
                
                # 从当前项目的product_address字段获取地址映射
                if data.get('product_address'):
                    try:
                        address_map = json.loads(data['product_address'])
                        if isinstance(address_map, dict):
                            # 针对每个基础产品ID，收集同名与带序号的全部地址
                            unique_bases = list(dict.fromkeys(product_ids))
                            for base in unique_bases:
                                indexed = []
                                for key, value in address_map.items():
                                    if key == base:
                                        indexed.append((0, value))
                                    elif key.startswith(f"{base}_"):
                                        suffix = key[len(base) + 1:]
                                        try:
                                            num = int(suffix)
                                        except Exception:
                                            continue
                                        indexed.append((num, value))
                                for _, val in sorted(indexed, key=lambda x: x[0]):
                                    product_addresses.append((base, val))
                        elif isinstance(address_map, list):
                            # 列表顺序分配，超出部分归到最后一个产品ID
                            if product_ids:
                                for idx, val in enumerate(address_map):
                                    base = product_ids[min(idx, len(product_ids) - 1)]
                                    product_addresses.append((base, val))
                    except (json.JSONDecodeError, TypeError):
                        pass
                
                # 如果没有从product_address字段获取到地址，尝试从projects表获取
                if not product_addresses:
                    with get_db_connection_with_retry() as conn:
                        unique_bases = list(dict.fromkeys(product_ids))
                        for base in unique_bases:
                            query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                            result = execute_query_with_results(conn, query, (base,))
                            
                            if result:
                                product_address = result[0][0]
                                # 安全解析：支持JSON列表或字典，且收集全部序号
                                try:
                                    parsed = json.loads(product_address)
                                    if isinstance(parsed, dict):
                                        indexed = []
                                        for key, value in parsed.items():
                                            if key == base:
                                                indexed.append((0, value))
                                            elif key.startswith(f"{base}_"):
                                                suffix = key[len(base) + 1:]
                                                try:
                                                    num = int(suffix)
                                                except Exception:
                                                    continue
                                                indexed.append((num, value))
                                        for _, val in sorted(indexed, key=lambda x: x[0]):
                                            product_addresses.append((base, val))
                                    elif isinstance(parsed, list):
                                        for val in parsed:
                                            product_addresses.append((base, val))
                                    else:
                                        product_addresses.append((base, product_address))
                                except (json.JSONDecodeError, TypeError):
                                    product_addresses.append((base, product_address))
                            else:
                                log_info(f"警告: 未找到产品 {base} 的地址信息")
                
                if product_addresses:
                    update_multi_product_test_file(filename, data, product_addresses)
                else:
                    # 如果没有找到产品地址，使用第一个产品ID更新代码
                    update_single_test_file(filename, data, product_ids[0])
        else:
            # 如果没有文件映射，使用旧的逻辑作为后备
            product_ids = data['product_ids']
            system = data['system']
            
            if len(product_ids) == 1:
                clean_product_id = product_ids[0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                filename = find_existing_test_file(clean_product_id, system)
                if filename:
                    update_single_test_file(filename, data, product_ids[0])
                else:
                    filename = generate_unique_filename(clean_product_id, system)
                    generate_single_test_file(filename, data, product_ids[0])
            else:
                # 多产品ID的情况，需要获取每个产品的地址（支持 PID、PID_1..PID_n 全量解析）
                product_addresses = []
                
                # 从当前项目的product_address字段获取地址映射
                if data.get('product_address'):
                    try:
                        address_map = json.loads(data['product_address'])
                        if isinstance(address_map, dict):
                            unique_bases = list(dict.fromkeys(product_ids))
                            for base in unique_bases:
                                indexed = []
                                for key, value in address_map.items():
                                    if key == base:
                                        indexed.append((0, value))
                                    elif key.startswith(f"{base}_"):
                                        suffix = key[len(base) + 1:]
                                        try:
                                            num = int(suffix)
                                        except Exception:
                                            continue
                                        indexed.append((num, value))
                                for _, val in sorted(indexed, key=lambda x: x[0]):
                                    product_addresses.append((base, val))
                        elif isinstance(address_map, list):
                            if product_ids:
                                for idx, val in enumerate(address_map):
                                    base = product_ids[min(idx, len(product_ids) - 1)]
                                    product_addresses.append((base, val))
                    except (json.JSONDecodeError, TypeError):
                        pass
                
                # 如果没有从product_address字段获取到地址，尝试从projects表获取
                if not product_addresses:
                    with get_db_connection_with_retry() as conn:
                        unique_bases = list(dict.fromkeys(product_ids))
                        list_index = 0
                        for base in unique_bases:
                            query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                            result = execute_query_with_results(conn, query, (base,))
                            
                            if result:
                                product_address = result[0][0]
                                # 安全解析：支持JSON列表或字典，且收集全部序号
                                try:
                                    parsed = json.loads(product_address)
                                    if isinstance(parsed, dict):
                                        indexed = []
                                        for key, value in parsed.items():
                                            if key == base:
                                                indexed.append((0, value))
                                            elif key.startswith(f"{base}_"):
                                                suffix = key[len(base) + 1:]
                                                try:
                                                    num = int(suffix)
                                                except Exception:
                                                    continue
                                                indexed.append((num, value))
                                        for _, val in sorted(indexed, key=lambda x: x[0]):
                                            product_addresses.append((base, val))
                                    elif isinstance(parsed, list):
                                        for val in parsed:
                                            product_addresses.append((base, val))
                                    else:
                                        product_addresses.append((base, product_address))
                                except (json.JSONDecodeError, TypeError):
                                    product_addresses.append((base, product_address))
                            else:
                                log_info(f"警告: 未找到产品 {base} 的地址信息")
                
                if product_addresses:
                    # 使用第一个产品的ID查找现有文件
                    clean_product_id = product_ids[0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                    filename = find_existing_test_file(clean_product_id, system)
                    if filename:
                        update_multi_product_test_file(filename, data, product_addresses)
                    else:
                        filename = generate_unique_filename(clean_product_id, system)
                        generate_multi_product_test_file(filename, data, product_addresses)
                else:
                    # 如果没有找到产品地址，使用第一个产品ID更新代码
                    clean_product_id = product_ids[0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                    filename = find_existing_test_file(clean_product_id, system)
                    if filename:
                        update_single_test_file(filename, data, product_ids[0])
                    else:
                        filename = generate_unique_filename(clean_product_id, system)
                        generate_single_test_file(filename, data, product_ids[0])
        
    except Exception as e:
        log_info(f"更新测试代码失败: {e}")

def generate_unique_filename(product_id, system):
    """生成唯一的文件名，如果文件已存在则添加序号"""
    base_filename = f"{product_id}_{system}_test.py"
    file_path = os.path.join('Test_Case', base_filename)
    
    # 如果文件不存在，直接返回
    if not os.path.exists(file_path):
        return base_filename
    
    # 如果文件存在，查找下一个可用的序号
    counter = 2
    while True:
        numbered_filename = f"{product_id}_{system}_{counter}_test.py"
        numbered_file_path = os.path.join('Test_Case', numbered_filename)
        
        if not os.path.exists(numbered_file_path):
            return numbered_filename
        
        counter += 1

def find_existing_test_file(product_id, system, project_id=None):
    """查找实际存在的测试文件"""
    log_info(f"查找测试文件 - 产品ID: {product_id}, 系统: {system}, 项目ID: {project_id}")
    
    # 如果提供了项目ID，优先查找对应的文件
    if project_id:
        # 首先检查是否有带项目ID的文件
        project_filename = f"{product_id}_{system}_{project_id}_test.py"
        project_file_path = os.path.join('Test_Case', project_filename)
        
        log_info(f"检查项目特定文件: {project_file_path}")
        if os.path.exists(project_file_path):
            log_info(f"找到项目特定文件: {project_filename}")
            return project_filename
    
    # 首先检查基础文件名
    base_filename = f"{product_id}_{system}_test.py"
    base_file_path = os.path.join('Test_Case', base_filename)
    
    log_info(f"检查基础文件: {base_file_path}")
    if os.path.exists(base_file_path):
        log_info(f"找到基础文件: {base_filename}")
        return base_filename
    
    # 检查带序号的文件名 (格式: {product_id}_{system}_test_{number}.py)
    counter = 2
    while True:
        numbered_filename = f"{product_id}_{system}_test_{counter}.py"
        numbered_file_path = os.path.join('Test_Case', numbered_filename)
        
        log_info(f"检查序号文件: {numbered_file_path}")
        if os.path.exists(numbered_file_path):
            log_info(f"找到序号文件: {numbered_filename}")
            return numbered_filename
        
        # 如果找不到更多文件，停止搜索
        if counter > 100:  # 防止无限循环
            break
            
        counter += 1
    
    # 也检查旧格式的文件名 (格式: {product_id}_{system}_{number}_test.py)
    counter = 2
    while True:
        old_format_filename = f"{product_id}_{system}_{counter}_test.py"
        old_format_file_path = os.path.join('Test_Case', old_format_filename)
        
        log_info(f"检查旧格式文件: {old_format_file_path}")
        if os.path.exists(old_format_file_path):
            log_info(f"找到旧格式文件: {old_format_filename}")
            return old_format_filename
        
        # 如果找不到更多文件，停止搜索
        if counter > 100:  # 防止无限循环
            break
            
        counter += 1
    
    # 列出Test_Case目录中的所有文件，帮助调试
    try:
        test_case_files = os.listdir('Test_Case')
        py_files = [f for f in test_case_files if f.endswith('.py') and not f.startswith('__')]
        log_info(f"Test_Case目录中的Python文件: {py_files}")
    except Exception as e:
        log_info(f"无法列出Test_Case目录: {e}")
    
    log_info(f"未找到匹配的文件，返回None")
    return None

def generate_assertion_code(step, step_index):
    """生成断言代码 - 支持UI断言、图片断言、自定义断言"""
    assertion_code = ""
    
    # 获取断言配置
    assertion_config = step.get('assertion_config', {})
    ui_assertions = assertion_config.get('ui_assertions', [])
    image_assertions = assertion_config.get('image_assertions', [])
    custom_assertions = assertion_config.get('custom_assertions', [])
    
    # 检查是否启用了断言
    assertion_enabled = step.get('assertion_enabled', 'no')
    
    if assertion_enabled != 'yes':
        return assertion_code
    
    # =============================================================================
    # UI断言代码生成
    # =============================================================================
    if ui_assertions:
        for assertion in ui_assertions:
            assertion_type = assertion.get('type', '')
            target_element = assertion.get('target_element', '').replace('"', "'")
            expected_value = assertion.get('expected_value', '')
            
            if not target_element:
                continue
                
            # 根据断言类型生成对应的代码
            if assertion_type == 'exists':
                assertion_code += f'''
                # UI断言: 元素存在
                with allure.step("测试步骤{step_index}: UI断言 - 元素存在"):
                    await ui_operations.elem_assert_exists("{target_element}")
'''
            elif assertion_type == 'visible':
                assertion_code += f'''
                # UI断言: 元素可见
                with allure.step("测试步骤{step_index}: UI断言 - 元素可见"):
                    await ui_operations.elem_assert_visible("{target_element}")
'''
            elif assertion_type == 'text_contains':
                if expected_value:
                    assertion_code += f'''
                # UI断言: 文本包含
                with allure.step("测试步骤{step_index}: UI断言 - 文本包含"):
                    await ui_operations.elem_assert_text_contains("{target_element}", "{expected_value}")
'''
            elif assertion_type == 'attribute_match':
                if expected_value and ':' in expected_value:
                    assertion_code += f'''
                # UI断言: 属性匹配
                with allure.step("测试步骤{step_index}: UI断言 - 属性匹配"):
                    await ui_operations.elem_assert_attribute_match("{target_element}", "{expected_value}")
'''
            elif assertion_type == 'element_count':
                if expected_value and expected_value.isdigit():
                    assertion_code += f'''
                # UI断言: 元素数量
                with allure.step("测试步骤{step_index}: UI断言 - 元素数量"):
                    await ui_operations.elem_assert_count("{target_element}", {expected_value})
'''
    
    # =============================================================================
    # 图片断言代码生成
    # =============================================================================
    if image_assertions:
        for assertion in image_assertions:
            # 处理图片断言数据，保存图片文件到指定目录
            processed_assertion = image_upload_manager.process_image_assertion_data(assertion)
            
            assertion_type = processed_assertion.get('method', '')  # 修复：使用method字段而不是type
            image_path = processed_assertion.get('image_path', '')
            # 移除路径前缀的斜杠，确保生成的代码使用相对路径
            if image_path.startswith('/'):
                image_path = image_path[1:]
            threshold = processed_assertion.get('threshold', '')
            confidence = processed_assertion.get('confidence', '')
            screenshot_area = processed_assertion.get('screenshot_area', None)
            
            if not image_path:
                log_info(f"跳过图片断言：缺少图片路径")
                continue
                
            # 根据图片断言类型生成对应的代码
            if assertion_type == 'template_match':
                confidence_value = float(confidence) if confidence else 0.8
                assertion_code += f'''
                # 图片断言: 模板匹配
                with allure.step("测试步骤{step_index}: 图片断言 - 模板匹配"):
                    await ui_operations.image_assert_template_match("{image_path}", confidence={confidence_value})
'''
            elif assertion_type == 'mse':
                threshold_value = float(threshold) if threshold else 100.0
                if screenshot_area:
                    assertion_code += f'''
                # 图片断言: MSE比较
                with allure.step("测试步骤{step_index}: 图片断言 - MSE比较"):
                    await ui_operations.image_assert_mse("{image_path}", threshold={threshold_value}, screenshot_area={screenshot_area})
'''
                else:
                    assertion_code += f'''
                # 图片断言: MSE比较
                with allure.step("测试步骤{step_index}: 图片断言 - MSE比较"):
                    await ui_operations.image_assert_mse("{image_path}", threshold={threshold_value})
'''
            elif assertion_type == 'ssim':
                threshold_value = float(threshold) if threshold else 0.8
                if screenshot_area:
                    assertion_code += f'''
                # 图片断言: SSIM比较
                with allure.step("测试步骤{step_index}: 图片断言 - SSIM比较"):
                    await ui_operations.image_assert_ssim("{image_path}", threshold={threshold_value}, screenshot_area={screenshot_area})
'''
                else:
                    assertion_code += f'''
                # 图片断言: SSIM比较
                with allure.step("测试步骤{step_index}: 图片断言 - SSIM比较"):
                    await ui_operations.image_assert_ssim("{image_path}", threshold={threshold_value})
'''
            elif assertion_type == 'perceptual_hash':
                threshold_value = float(threshold) if threshold else 10.0
                if screenshot_area:
                    assertion_code += f'''
                # 图片断言: 感知哈希比较
                with allure.step("测试步骤{step_index}: 图片断言 - 感知哈希比较"):
                    await ui_operations.image_assert_perceptual_hash("{image_path}", threshold={threshold_value}, screenshot_area={screenshot_area})
'''
                else:
                    assertion_code += f'''
                # 图片断言: 感知哈希比较
                with allure.step("测试步骤{step_index}: 图片断言 - 感知哈希比较"):
                    await ui_operations.image_assert_perceptual_hash("{image_path}", threshold={threshold_value})
'''
    
    # =============================================================================
    # 自定义断言代码生成
    # =============================================================================
    if custom_assertions:
        for assertion in custom_assertions:
            assertion_name = assertion.get('name', '')
            target_element = assertion.get('target_element', '')
            expected_result = assertion.get('expected_result', '')
            assertion_code_snippet = assertion.get('code', '')
            
            # 如果有目标元素和预期结果，使用elem_custom_assert方法
            if target_element and expected_result:
                assertion_code += f'''
                # 自定义断言: {assertion_name}
                with allure.step("测试步骤{step_index}: 自定义断言 - {assertion_name}"):
                    await ui_operations.elem_custom_assert("{target_element}", "{expected_result}")
'''
            # 如果有自定义脚本代码，直接使用脚本代码
            elif assertion_code_snippet and assertion_code_snippet.strip():
                assertion_code += f'''
                # 自定义断言: {assertion_name}
                with allure.step("测试步骤{step_index}: 自定义断言 - {assertion_name}"):
                    # 自定义断言代码
                    {assertion_code_snippet}
'''
    
    return assertion_code

def generate_single_test_file(filename, data, product_id):
    """生成单个测试文件"""
    try:
        file_path = os.path.join('Test_Case', filename)
        
        # 获取产品地址
        product_address = data.get('product_address', '')
        if not product_address:
            # 如果product_address为空，尝试从projects表获取
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                address_results = execute_query_with_results(conn, query, (product_id,))
                if address_results:
                    product_address = address_results[0][0]
                    log_info(f"从projects表获取到产品 {product_id} 的地址: {product_address}")
                else:
                    log_info(f"警告: 未找到产品 {product_id} 的地址信息")
        
        # 生成代码内容
        code_content = '''
import time
import sys
import pyautogui
import numpy
import pytest
import asyncio
import os
# 添加项目根目录到Python路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
import requests
import allure
from config.logger import log_info
from playwright.async_api import async_playwright
from utils.screen_manager import screen_manager
from utils.ui_operations import UIOperations
from typing import Tuple, List
from Base_ENV.config import *


async def test_''' + product_id.replace("-", "_") + '''(browser_args):
    """
    为 test_''' + product_id.replace("-", "_") + ''' 创建完全独立的浏览器实例，使用指定的浏览器参数
    """
    task_id = "test_''' + product_id.replace("-", "_") + '''"
    async with async_playwright() as p:
        browser = None
        context = None
        page = None
        try:
            # 启动独立的浏览器实例
            browser = await p.chromium.launch(headless=False, args=browser_args)
            context = await browser.new_context(no_viewport=True)
            page = await context.new_page()
                    
            # 创建UIOperations实例并使用混合图片识别机制，为每个任务创建独立实例
            ui_operations = UIOperations(page, task_id=task_id)
            
            # 配置参数
            website_url = "''' + product_address + '''"
            
            # 导航到目标网站
            await ui_operations.navigate_to(website_url)
            
            # 初始检查浏览器状态
            if await ui_operations.is_browser_closed():
                log_info(f"[{task_id}] 检测到浏览器已关闭，test_''' + product_id.replace("-", "_") + ''' 测试无法继续")
                raise Exception("BROWSER_CLOSED_BY_USER")
            
'''
        
        # 生成测试步骤代码
        for i, step in enumerate(data['test_steps']):
            step_name = step.get('step_name', f'step_{i+1}')
            operation_type = step.get('operation_type', 'web')
            operation_event = step.get('operation_event', 'click')

            auth_cfg = step.get('auth_config', {}) or {}
            email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
            password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
            submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")

            operation_params = step.get('operation_params', '').replace('"', "'") or email_selector or password_selector or submit_selector
            input_value = step.get('input_value', '').replace('"', "'")
            
            # 获取标签页跳转配置
            tab_switch_enabled = step.get('tab_switch_enabled', 'no')
            tab_target_url = step.get('tab_target_url', '')

            # 获取断言配置
            assert_action = step.get('assert_action', 'no')
            assert_params = step.get('assert_params', '')
            
            # 获取截图配置
            screenshot_enabled = step.get('screenshot_enabled', 'NO').upper()
            screenshot_config = step.get('screenshot_config', {})
            screenshot_timing = screenshot_config.get('timing', 'after')

            # 安全地转换数字字段，确保它们是有效的正整数
            try:
                operation_count = max(1, int(step.get('operation_count', 1)))
            except (ValueError, TypeError):
                operation_count = 1
                log_info(f"警告: 步骤 {i+1} 的操作次数无效，使用默认值 1")
            
            try:
                pause_time = max(0, int(step.get('pause_time', 1)))
            except (ValueError, TypeError):
                pause_time = 1
                log_info(f"警告: 步骤 {i+1} 的暂停时间无效，使用默认值 1")
            
            if operation_type == 'web':
                # 检查是否需要跳转到新标签页 - 需要启用跳转且有目标URL
                tab_switch_enabled = step.get('tab_switch_enabled', 'no')
                
                # 生成统一的测试步骤包装
                code_content += '''            
            # 测试步骤''' + str(i+1) + ''': ''' + step_name + ''' (操作次数: ''' + str(operation_count) + ''')
            with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + '''"):
                log_info(f"开始测试步骤''' + str(i+1) + ''' ''' + step_name + ''' 的操作==============")
'''
                
                # 如果需要标签页跳转，添加跳转代码
                if tab_switch_enabled == 'yes' and tab_target_url and tab_target_url.strip():
                    code_content += '''                
                # 标签页跳转配置
                log_info(f"[{task_id}] 正在打开新标签页: ''' + tab_target_url + '''")
                new_page = await ui_operations.open_new_tab_and_navigate("''' + tab_target_url + '''")

                # 获取所有标签页信息并确保切换到正确的标签页
                all_tabs = await ui_operations.get_all_tabs()

                # 公共断言方法，断言URL是否存在
                with allure.step("测试步骤''' + str(i+1) + ''': 公共断言URL是否存在"):
                    await ui_operations.url_assert_exists("''' + tab_target_url + '''")
                time.sleep(1)  # 等待页面加载
'''
                # 添加元素操作代码
                code_content += '''                
                # 公共断言方法，断言元素是否存在
                with allure.step("测试步骤''' + str(i+1) + ''': 公共断言元素是否存在"):
                    await ui_operations.elem_assert_exists("''' + operation_params + '''")
'''
                
                # 添加自定义断言代码
                assertion_code = generate_assertion_code(step, i+1)
                if assertion_code:
                    code_content += assertion_code
                
                # 添加步骤前截图代码
                if screenshot_enabled == 'YES' and (screenshot_timing == 'before' or screenshot_timing == 'both'):
                    code_content += '''
                # 步骤前截图
                with allure.step("测试步骤''' + str(i+1) + ''': 步骤前截图"):
                    await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''","test_step_''' + str(i+1) + '''_before")
'''
                
                # 根据截图设置动态生成失败截图代码
                if screenshot_enabled == 'YES' and screenshot_timing == 'on_failure':
                    failure_screenshot_code = '''
                            try:
                                # 失败时截图
                                with allure.step("测试步骤''' + str(i+1) + ''': 操作失败截图"):
                                    await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''","test_step_''' + str(i+1) + '''_failure")
                            except Exception as screenshot_error:
                                log_info(f"失败截图失败: {screenshot_error}")
                                raise screenshot_error
'''
                else:
                    failure_screenshot_code = ''
                
                # 根据截图设置动态生成步骤后截图代码  
                if screenshot_enabled == 'YES' and (screenshot_timing == 'after' or screenshot_timing == 'both'):
                    after_screenshot_code = '''
                # 步骤后截图
                with allure.step("测试步骤''' + str(i+1) + ''': 步骤后截图"):
                    await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''","test_step_''' + str(i+1) + '''_after")
'''
                else:
                    after_screenshot_code = ''
                
                # 构造操作调用语句，根据事件决定参数个数
                if operation_event in ['input', 'select_option', 'press_key', 'drag_and_drop']:
                    operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '", "' + input_value + '")'
                elif operation_event in ['login']:
                    auth_cfg = step.get('auth_config', {}) or {}
                    # 提前解析当前地址对应的账号（若存在）
                    current_addr = product_address if 'product_address' in locals() else ''
                    resolved_email = ''
                    resolved_password = ''
                    try:
                        # 1) 直接 accounts 列表（带 address）
                        for acc in auth_cfg.get('accounts', []) or []:
                            addr = (acc.get('address') or '').strip()
                            if addr and current_addr.strip().startswith(addr.strip()):
                                resolved_email = acc.get('email', '')
                                resolved_password = acc.get('password', '')
                                break
                        # 2) address_credentials map
                        if not resolved_email and isinstance(auth_cfg.get('address_credentials'), dict):
                            for k, v in auth_cfg.get('address_credentials', {}).items():
                                key = (k or '').strip()
                                if key and current_addr.strip().startswith(key):
                                    resolved_email = (v or {}).get('email', '')
                                    resolved_password = (v or {}).get('password', '')
                                    break
                        # 3) address_credentials_list 与当前地址顺序（兜底保持原有顺序行为）
                        if not resolved_email:
                            addr_list = auth_cfg.get('address_credentials_list', []) or []
                            # 如果没有明确映射，按第一个或与当前地址顺序对齐（跨方法已保存过顺序）
                            if isinstance(addr_list, list) and len(addr_list) > 0:
                                resolved_email = (addr_list[0] or {}).get('email', '')
                                resolved_password = (addr_list[0] or {}).get('password', '')
                    except Exception:
                        pass
                    
                    auth_cfg = step.get('auth_config', {}) or {}
                    email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                    password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                    submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                    email = step.get('email', '') or resolved_email
                    password = step.get('password', '') or resolved_password
                    operation_invoke = 'await ui_operations.elem_login("' + email_selector + '","' + password_selector + '","' + submit_selector + '","' + email + '","' + password + '")'
                elif operation_event in ['register']:
                    auth_cfg = step.get('auth_config', {}) or {}
                    current_addr = product_address
                    email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                    password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                    repeat_password_selector = auth_cfg.get('repeat_password_selector', '').replace('"', "'")
                    submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                    addr_list = auth_cfg.get('address_credentials_list', []) or []
                    email = (addr_list[0] or {}).get('email', '') if isinstance(addr_list, list) and len(addr_list) > 0 else ''
                    password = (addr_list[0] or {}).get('password', '') if isinstance(addr_list, list) and len(addr_list) > 0 else ''
                    log_info(f"auth_cfg: {auth_cfg}")
                    log_info(f"email_selector: {email_selector}, password_selector: {password_selector}, repeat_password_selector: {repeat_password_selector}, submit_selector: {submit_selector}, email: {email}, password: {password}")
                    operation_invoke = 'await ui_operations.elem_register("' + email_selector + '","' + password_selector + '","' + repeat_password_selector + '","' + submit_selector + '","' + email + '","' + password + '")'
                else:
                    operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '")'
                
                code_content += '''
                with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - ''' + operation_event + ''' 操作 (''' + operation_params + ''')"):
                    time.sleep(''' + str(pause_time) + ''')
                    
                # 执行Web元素操作 ''' + str(operation_count) + ''' 次
                for attempt in range(''' + str(operation_count) + '''):
                        # 检查浏览器是否已关闭
                        if await ui_operations.is_browser_closed():
                            log_info("检测到浏览器已关闭，测试被用户中断")
                            # 创建一个自定义异常来标识用户中断
                            raise Exception("BROWSER_CLOSED_BY_USER")
                        
                        try:
                            log_info(f"执行第{attempt + 1}次操作: ''' + operation_event + ''' on ''' + operation_params + '''")
                            # 使用安全操作机制，带重试
                            ''' + operation_invoke + '''
                            time.sleep(1)  # 每次操作后等待1秒
                        except Exception as e:
                            # 检查是否是浏览器关闭导致的异常
                            error_msg = str(e).lower()
                            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                                log_info(f"检测到浏览器连接异常，可能被用户关闭")
                                raise Exception("BROWSER_CLOSED_BY_USER")
                            log_info(f"第''' + str(operation_count) + '''次操作失败")
                            if attempt == ''' + str(operation_count) + ''' - 1:  # 最后一次尝试失败
                                log_info(f"所有操作均失败！")
                                ''' + failure_screenshot_code + '''
                time.sleep(1)  # 每次操作后等待1秒
''' + after_screenshot_code + '''
'''
                
            elif operation_type == 'game':
                img_path = operation_params.replace('\\', '/')
                # 根据操作事件选择对应的pyautogui方法
                if operation_event == 'double_click':
                    click_action = 'pyautogui.doubleClick(center_x, center_y)'
                else:
                    click_action = 'pyautogui.click(center_x, center_y)'
                
                code_content += '''            # 测试步骤''' + str(i+1) + ''': ''' + step_name + ''' (操作次数: ''' + str(operation_count) + ''')
            with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + '''"):
                log_info(f"开始测试步骤''' + str(i+1) + ''' ''' + step_name + ''' 的操作==============")
                
                # 页面滚动子步骤
                with allure.step(f"测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 页面滚动准备"):
                    # 需要等待1S后再操作滚动
                    time.sleep(1)
                    # 游戏操作前先滚动页面确保图片可见
                    # 此功能需要由编写者确认需要滚动到的页面位置是什么，默认参数：delta_x=0, delta_y=1100
                    # 请根据实际的页面滚动进行调整到图片可见
                    await ui_operations.page_mouse_scroll(delta_x=0, delta_y=1500)
                
                # 图片操作子步骤
                with allure.step(f"测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 游戏图片''' + operation_event + ''' 操作"):
                    # 执行游戏图片操作 ''' + str(operation_count) + ''' 次
                    for attempt in range(''' + str(operation_count) + '''):
                        # 检查浏览器是否已关闭（即使是游戏操作也需要检查浏览器状态）
                        if await ui_operations.is_browser_closed():
                            log_info(f"[{task_id}] 检测到浏览器已关闭，test_''' + product_id.replace("-", "_") + ''' 测试被用户中断")
                            raise Exception("BROWSER_CLOSED_BY_USER")
                        
                        try:
                            log_info(f"[test_''' + product_id.replace("-", "_") + '''] 执行第{attempt + 1}次图片操作: ''' + operation_event + ''' on ''' + img_path + '''")
                            time.sleep(''' + str(pause_time) + ''')
                            success = await ui_operations.click_image_with_fallback(
                                "''' + img_path + '''", 
                                confidence=0.5, 
                                timeout=10
                            )
                            if success:
                                log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 第{attempt + 1}次操作完成")
                            else:
                                log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 第{attempt + 1}次尝试：没有找到图片 ''' + img_path + '''")
                                if attempt == ''' + str(operation_count) + ''' - 1:  # 最后一次尝试失败
                                    log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 所有 ''' + str(operation_count) + ''' 次尝试都失败，无法找到图片")
                                raise Exception(f"图片定位失败：无法找到图片 ''' + img_path + '''")
                        except Exception as e:
                            log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 第{attempt + 1}次图片定位失败")
                            if attempt == ''' + str(operation_count) + ''' - 1:  # 最后一次尝试失败
                                log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 所有 ''' + str(operation_count) + ''' 次尝试都失败")
                            raise Exception(f"图片定位失败：无法找到图片 ''' + img_path + '''")
                        time.sleep(1)  # 每次操作后等待1秒
            
'''
        
        code_content += f'''            # 等待测试完成
            time.sleep(2)
            
            # 最终检查浏览器状态
            if await ui_operations.is_browser_closed():
                log_info(f"检测到浏览器已关闭，test_''' + product_id.replace("-", "_") + ''' 测试被用户中断")
                raise Exception("BROWSER_CLOSED_BY_USER")
            
            await ui_operations.page_screenshot(f"''' + product_id.replace("-", "_") + '''","over_test_test_step_''' + str(i+1) + '''")
            time.sleep(2)
            
            # 输出图片识别统计信息
            stats = ui_operations.get_image_stats()
            log_info(f"[{task_id}] 图片识别统计: 截图识别成功 {stats['screenshot_success']} 次, "
                    f"pyautogui成功 {stats['pyautogui_success']} 次, "
                    f"总成功率 {stats['success_rate']:.2%}")
            
            log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 完成")
            
        except Exception as e:
            log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 失败")
            raise e
        finally:
            # 清理资源
            if page:
                await page.close()
            if context:
                await context.close()
            if browser:
                await browser.close()
'''
        
        # 为单个测试案例生成并发执行函数
        product_addresses = [(product_id, product_address)]
        concurrent_function = generate_concurrent_execution_function(product_addresses)
        code_content += concurrent_function
        
        # 写入文件
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(code_content)
            
    except Exception as e:
        log_info(f"生成测试文件失败: {e}")

def update_single_test_file(filename, data, product_id):
    """更新单个测试文件"""
    try:
        file_path = os.path.join('Test_Case', filename)
        # 获取产品地址
        product_address = data.get('product_address', '')
        if not product_address:
            # 如果product_address为空，尝试从projects表获取
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('SELECT product_address FROM projects WHERE product_id = ?')
                address_results = execute_query_with_results(conn, query, (product_id,))
                if address_results:
                    product_address = address_results[0][0]
                    log_info(f"从projects表获取到产品 {product_id} 的地址: {product_address}")
                else:
                    log_info(f"警告: 未找到产品 {product_id} 的地址信息")
        
        # 生成代码内容（与generate_single_test_file相同的逻辑）
        code_content = f'''
import time
import sys
import pyautogui
import numpy
import pytest
import asyncio
import os
# 添加项目根目录到Python路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
import requests
import allure
from config.logger import log_info
from playwright.async_api import async_playwright
from utils.screen_manager import screen_manager
from utils.ui_operations import UIOperations
from typing import Tuple, List
from Base_ENV.config import *

async def test_''' + product_id.replace("-", "_") + '''(browser_args):
    """
    为 test_''' + product_id.replace("-", "_") + ''' 创建完全独立的浏览器实例，使用指定的浏览器参数
    """
    task_id = "test_''' + product_id.replace("-", "_") + '''"
    async with async_playwright() as p:
        browser = None
        context = None
        page = None
        try:
            # 启动独立的浏览器实例
            browser = await p.chromium.launch(headless=False, args=browser_args)
            context = await browser.new_context(no_viewport=True)
            page = await context.new_page()
                    
            # 创建UIOperations实例并使用混合图片识别机制，为每个任务创建独立实例
            ui_operations = UIOperations(page, task_id=task_id)
            
            # 配置参数
            website_url = "''' + product_address + '''"
            
            # 导航到目标网站
            await ui_operations.navigate_to(website_url)
            
            # 初始检查浏览器状态
            if await ui_operations.is_browser_closed():
                log_info(f"[{task_id}] 检测到浏览器已关闭，test_''' + product_id.replace("-", "_") + ''' 测试无法继续")
                raise Exception("BROWSER_CLOSED_BY_USER")
            
'''
        
        # 生成测试步骤代码
        for i, step in enumerate(data['test_steps']):
            step_name = step.get('step_name', f'step_{i+1}')
            operation_type = step.get('operation_type', 'web')
            operation_event = step.get('operation_event', 'click')

            auth_cfg = step.get('auth_config', {}) or {}
            email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
            password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
            submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")

            operation_params = step.get('operation_params', '').replace('"', "'") or email_selector or password_selector or submit_selector
            input_value = step.get('input_value', '').replace('"', "'")
            
            # 获取标签页跳转配置
            tab_switch_enabled = step.get('tab_switch_enabled', 'no')
            tab_target_url = step.get('tab_target_url', '')
            
            # 安全地转换数字字段，确保它们是有效的正整数
            try:
                operation_count = max(1, int(step.get('operation_count', 1)))
            except (ValueError, TypeError):
                operation_count = 1
                log_info(f"警告: 步骤 {i+1} 的操作次数无效，使用默认值 1")
            
            try:
                pause_time = max(0, int(step.get('pause_time', 1)))
            except (ValueError, TypeError):
                pause_time = 1
                log_info(f"警告: 步骤 {i+1} 的暂停时间无效，使用默认值 1")
            
            if operation_type == 'web':
                # 检查是否需要跳转到新标签页 - 需要启用跳转且有目标URL
                tab_switch_enabled = step.get('tab_switch_enabled', 'no')
                
                # 构造操作调用语句与文案后缀
                if operation_event in ['input', 'select_option', 'press_key', 'drag_and_drop']:
                    operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '", "' + input_value + '")'
                elif operation_event in ['login']:
                    auth_cfg = step.get('auth_config', {}) or {}
                    # 提前解析当前地址对应的账号（若存在）
                    current_addr = product_address if 'product_address' in locals() else ''
                    resolved_email = ''
                    resolved_password = ''
                    try:
                        # 1) 直接 accounts 列表（带 address）
                        for acc in auth_cfg.get('accounts', []) or []:
                            addr = (acc.get('address') or '').strip()
                            if addr and current_addr.strip().startswith(addr.strip()):
                                resolved_email = acc.get('email', '')
                                resolved_password = acc.get('password', '')
                                break
                        # 2) address_credentials map
                        if not resolved_email and isinstance(auth_cfg.get('address_credentials'), dict):
                            for k, v in auth_cfg.get('address_credentials', {}).items():
                                key = (k or '').strip()
                                if key and current_addr.strip().startswith(key):
                                    resolved_email = (v or {}).get('email', '')
                                    resolved_password = (v or {}).get('password', '')
                                    break
                        # 3) address_credentials_list 与当前地址顺序（兜底保持原有顺序行为）
                        if not resolved_email:
                            addr_list = auth_cfg.get('address_credentials_list', []) or []
                            # 如果没有明确映射，按第一个或与当前地址顺序对齐（跨方法已保存过顺序）
                            if isinstance(addr_list, list) and len(addr_list) > 0:
                                resolved_email = (addr_list[0] or {}).get('email', '')
                                resolved_password = (addr_list[0] or {}).get('password', '')
                    except Exception:
                        pass
                    email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                    password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                    submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                    email = step.get('email', '') or resolved_email
                    password = step.get('password', '') or resolved_password
                    operation_invoke = 'await ui_operations.elem_login("' + email_selector + '","' + password_selector + '","' + submit_selector + '","' + email + '","' + password + '")'
                elif operation_event in ['register']:
                    auth_cfg = step.get('auth_config', {}) or {}
                    current_addr = product_address
                    email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                    password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                    repeat_password_selector = auth_cfg.get('repeat_password_selector', '').replace('"', "'")
                    submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                    addr_list = auth_cfg.get('address_credentials_list', []) or []
                    email = (addr_list[0] or {}).get('email', '') if isinstance(addr_list, list) and len(addr_list) > 0 else ''
                    password = (addr_list[0] or {}).get('password', '') if isinstance(addr_list, list) and len(addr_list) > 0 else ''
                    log_info(f"auth_cfg: {auth_cfg}, data: {data}")
                    log_info(f"email_selector: {email_selector}, password_selector: {password_selector}, repeat_password_selector: {repeat_password_selector}, submit_selector: {submit_selector}, email: {email}, password: {password}")
                    operation_invoke = 'await ui_operations.elem_register("' + email_selector + '","' + password_selector + '","' + repeat_password_selector + '","' + submit_selector + '","' + email + '","' + password + '")'
                
                else:
                    operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '")'
                
                # 生成截图代码变量
                screenshot_enabled = step.get('screenshot_enabled', 'NO').upper()
                screenshot_config = step.get('screenshot_config', {})
                screenshot_timing = screenshot_config.get('timing', 'none')
                
                # 步骤前截图代码
                if screenshot_enabled == 'YES' and screenshot_timing in ['before', 'both']:
                    before_screenshot_code = '''
                # 步骤前截图
                with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 步骤前截图"):
                    if not await ui_operations.is_browser_closed():
                        await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''", f"step_''' + str(i+1) + '''_before")
                        log_info(f"步骤''' + str(i+1) + '''前截图完成")
                    else:
                        log_info(f"浏览器已关闭，跳过步骤''' + str(i+1) + '''前截图")
'''
                else:
                    before_screenshot_code = ''
                
                # 步骤后截图代码
                if screenshot_enabled == 'YES' and screenshot_timing in ['after', 'both']:
                    after_screenshot_code = '''
                # 步骤后截图
                with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 步骤后截图"):
                    if not await ui_operations.is_browser_closed():
                        await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''", f"step_''' + str(i+1) + '''_after")
                        log_info(f"步骤''' + str(i+1) + '''后截图完成")
                    else:
                        log_info(f"浏览器已关闭，跳过步骤''' + str(i+1) + '''后截图")
'''
                else:
                    after_screenshot_code = ''
                
                # 失败截图代码
                if screenshot_enabled == 'YES' and screenshot_timing == 'on_failure':
                    failure_screenshot_code = '''
                                # 操作失败截图
                                    with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 操作失败截图"):
                                    try:
                                        if not await ui_operations.is_browser_closed():
                                            await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''", f"step_''' + str(i+1) + '''_failure")
                                            log_info(f"步骤''' + str(i+1) + '''操作失败截图完成")
                                    except Exception as screenshot_e:
                                        log_info(f"失败截图异常: {screenshot_e}")
                                        raise screenshot_e
                                '''
                else:
                    failure_screenshot_code = ''

                # 生成统一的测试步骤包装
                code_content += f'''            
            # 测试步骤{i+1}: {step_name} (操作次数: {operation_count})
            with allure.step("测试步骤{i+1}: {step_name}"):
                log_info(f"开始测试步骤{i+1} {step_name} 的操作==============")
'''
                
                # 如果需要标签页跳转，添加跳转代码
                if tab_switch_enabled == 'yes' and tab_target_url and tab_target_url.strip():
                    code_content += f'''                
                # 标签页跳转配置
                log_info(f"[{{task_id}}] 正在打开新标签页: {tab_target_url}")
                new_page = await ui_operations.open_new_tab_and_navigate("{tab_target_url}")

                # 获取所有标签页信息并确保切换到正确的标签页
                all_tabs = await ui_operations.get_all_tabs()

                # 公共断言方法，断言URL是否存在
                with allure.step("测试步骤{i+1}: 公共断言URL是否存在"):
                    await ui_operations.url_assert_exists("{tab_target_url}")
                time.sleep(1)  # 等待页面加载
'''
                
                # 添加元素操作代码
                code_content += f'''                
                # 公共断言方法，断言元素是否存在
                with allure.step("测试步骤{i+1}: 公共断言元素是否存在"):
                    await ui_operations.elem_assert_exists("{operation_params}")
'''
                
                # 添加自定义断言代码
                assertion_code = generate_assertion_code(step, i+1)
                if assertion_code:
                    code_content += assertion_code
                
                # 添加步骤前截图代码
                code_content += before_screenshot_code
                
                code_content += f'''
                with allure.step("测试步骤{i+1}: {step_name} - {operation_event} 操作 ({operation_params})"):
                    time.sleep({pause_time})
                    
                    # 执行Web元素操作 {operation_count} 次
                    for attempt in range({operation_count}):
                        # 检查浏览器是否已关闭
                        if await ui_operations.is_browser_closed():
                            log_info("检测到浏览器已关闭，测试被用户中断")
                            # 创建一个自定义异常来标识用户中断
                            raise Exception("BROWSER_CLOSED_BY_USER")
                        
                        try:
                            log_info(f"[{{task_id}}]  执行第{attempt + 1}次操作: {operation_event} on {operation_params}")
                            # 使用安全操作机制，带重试
                            ''' + operation_invoke + '''
                            time.sleep(1)  # 每次操作后等待1秒
                        except Exception as e:
                            # 检查是否是浏览器关闭导致的异常
                            error_msg = str(e).lower()
                            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                                log_info(f"检测到浏览器连接异常，可能被用户关闭")
                                raise Exception("BROWSER_CLOSED_BY_USER")
                            log_info(f"第''' + str(operation_count) + '''次操作失败")
                            if attempt == ''' + str(operation_count) + ''' - 1:  # 最后一次尝试失败
                                log_info(f"所有操作均失败！")
                                ''' + failure_screenshot_code + '''
                time.sleep(1)  # 每次操作后等待1秒
''' + after_screenshot_code + '''
            
'''
            elif operation_type == 'game':
                img_path = operation_params.replace('\\', '/')
                # 根据操作事件选择对应的pyautogui方法
                if operation_event == 'double_click':
                    click_action = 'pyautogui.doubleClick(center_x, center_y)'
                else:
                    click_action = 'pyautogui.click(center_x, center_y)'
                
                # 生成截图代码
                screenshot_enabled = step.get('screenshot_enabled', 'NO')
                screenshot_timing = step.get('screenshot_timing', 'none')
                
                # 步骤前截图代码
                if screenshot_enabled == 'YES' and screenshot_timing in ['before', 'both']:
                    before_screenshot_code = '''
                # 步骤前截图
                with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 步骤前截图"):
                    if not await ui_operations.is_browser_closed():
                        await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''", f"step_''' + str(i+1) + '''_before")
                        log_info(f"步骤''' + str(i+1) + '''前截图完成")
                    else:
                        log_info(f"浏览器已关闭，跳过步骤''' + str(i+1) + '''前截图")
'''
                else:
                    before_screenshot_code = ''
                
                # 步骤后截图代码
                if screenshot_enabled == 'YES' and screenshot_timing in ['after', 'both']:
                    after_screenshot_code = '''
                # 步骤后截图
                with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 步骤后截图"):
                    if not await ui_operations.is_browser_closed():
                        await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''", f"step_''' + str(i+1) + '''_after")
                        log_info(f"步骤''' + str(i+1) + '''后截图完成")
                    else:
                        log_info(f"浏览器已关闭，跳过步骤''' + str(i+1) + '''后截图")
'''
                else:
                    after_screenshot_code = ''
                
                # 失败截图代码
                if screenshot_enabled == 'YES' and screenshot_timing == 'on_failure':
                    failure_screenshot_code = '''
                                # 操作失败截图
                                with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 操作失败截图"):
                                    try:
                                        if not await ui_operations.is_browser_closed():
                                            await ui_operations.page_screenshot(f"test_''' + product_id.replace("-", "_") + '''", f"step_''' + str(i+1) + '''_failure")
                                            log_info(f"步骤''' + str(i+1) + '''操作失败截图完成")
                                    except Exception as screenshot_e:
                                        log_info(f"失败截图异常: {screenshot_e}")
                                        raise screenshot_e
                                '''
                else:
                    failure_screenshot_code = ''
                
                code_content += '''            # 测试步骤''' + str(i+1) + ''': ''' + step_name + ''' (操作次数: ''' + str(operation_count) + ''')
            with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + '''"):
                log_info(f"开始测试步骤''' + str(i+1) + ''' ''' + step_name + ''' 的操作==============")
'''
                # 添加步骤前截图代码
                code_content += before_screenshot_code
                
                code_content += '''
                
                # 页面滚动子步骤
                with allure.step(f"测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 页面滚动准备"):
                    # 需要等待1S后再操作滚动
                    time.sleep(1)
                    # 游戏操作前先滚动页面确保图片可见
                    # 此功能需要由编写者确认需要滚动到的页面位置是什么，默认参数：delta_x=0, delta_y=1100
                    # 请根据实际的页面滚动进行调整到图片可见
                    await ui_operations.page_mouse_scroll(delta_x=0, delta_y=1500)
                
                # 图片操作子步骤
                with allure.step(f"测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 游戏图片''' + operation_event + ''' 操作"):
                    # 执行游戏图片操作 ''' + str(operation_count) + ''' 次
                    for attempt in range(''' + str(operation_count) + '''):
                        # 检查浏览器是否已关闭（即使是游戏操作也需要检查浏览器状态）
                        if await ui_operations.is_browser_closed():
                            log_info("检测到浏览器已关闭，测试被用户中断")
                            raise Exception("BROWSER_CLOSED_BY_USER")
                        
                        try:
                            time.sleep(''' + str(pause_time) + ''')
                            success = await ui_operations.click_image_with_fallback(
                                "''' + img_path + '''", 
                                confidence=0.5, 
                                timeout=10
                            )
                            
                            if success:
                                log_info(f"第{attempt + 1}次操作完成")
                            else:
                                log_info(f"第{attempt + 1}次尝试：没有找到图片 '''+img_path+'''")
                                if attempt == ''' + str(operation_count) + ''' - 1:  # 最后一次尝试失败
                                    log_info(f"所有 {attempt + 1} 次尝试都失败，无法找到图片")
                                raise Exception(f"图片定位失败：无法找到图片 '''+ img_path +'''")
                        except Exception as e:
                            log_info(f"第{attempt + 1}次图片定位失败")
                            if attempt == ''' + str(operation_count) + ''' - 1:  # 最后一次尝试失败
                                log_info(f"所有 '''+ str(operation_count) + ''' 次尝试都失败")
                                ''' + failure_screenshot_code + '''
                            raise Exception(f"图片定位失败：无法找到图片 '''+ img_path + '''")
                time.sleep(1)  # 每次操作后等待1秒
''' + after_screenshot_code + '''
            
'''
        code_content += f'''            # 等待测试完成
            time.sleep(3)
            
            # 最终检查浏览器状态
            if await ui_operations.is_browser_closed():
                log_info("检测到浏览器已关闭，test_''' + product_id.replace("-", "_") + ''' 无法截图")
                raise Exception("BROWSER_CLOSED_BY_USER")
            
            await ui_operations.page_screenshot(f"''' + product_id.replace("-", "_") + '''","over_test_test_step_''' + str(i+1) + '''")
            time.sleep(2)
            
            # 输出图片识别统计信息
            stats = ui_operations.get_image_stats()
            log_info(f"[{task_id}] 图片识别统计: 截图识别成功 {stats['screenshot_success']} 次, "
                    f"pyautogui成功 {stats['pyautogui_success']} 次, "
                    f"总成功率 {stats['success_rate']:.2%}")
            
            log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 完成")
            
        except Exception as e:
            log_info(f"[{task_id}] test_''' + product_id.replace("-", "_") + ''' 失败")
            raise e
        finally:
            # 清理资源
            if page:
                await page.close()
            if context:
                await context.close()
            if browser:
                await browser.close()

'''
        # 为单个测试案例生成并发执行函数
        product_addresses = [(product_id, data.get('product_address', ''))]
        concurrent_function = generate_concurrent_execution_function(product_addresses)
        code_content += concurrent_function
        
        # 更新现有文件
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(code_content)
            
        log_info(f"测试文件更新成功: {file_path}")
            
    except Exception as e:
        log_info(f"更新测试文件失败: {e}")

def run_test_in_background(project_id, start_time, execution_id, current_user):
    """在后台运行测试"""
    try:
        # 获取项目信息
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('SELECT product_ids, `system`, environment FROM automation_projects WHERE id=?')
            project_results = execute_query_with_results(conn, query, (project_id,))
            project = project_results[0] if project_results else None
        
        if not project:
            return
        
        product_ids = json.loads(project[0])
        system = project[1]
        environment = project[2]
        
        # 执行测试文件 - 使用文件管理器查找正确的文件
        from utils.file_manager import file_manager
        
        # 获取项目的文件映射信息
        file_mapping = file_manager.get_project_file_mapping(project_id)
        
        if file_mapping:
            # 使用映射中的文件名
            filename = file_mapping['file_name']
            log_info(f"执行测试文件: {filename}")
            result = run_pytest_file(filename, project_id)
        else:
            # 如果没有文件映射，使用旧的逻辑作为后备
            # 从数据库中获取项目数据
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('SELECT product_ids, `system`, environment, test_steps FROM automation_projects WHERE id=?')
                project_data = execute_query_with_results(conn, query, (project_id,))
                project_data = project_data[0] if project_data else None
            
            if project_data:
                # 构建data字典
                data = {
                    'product_ids': json.loads(project_data[0]) if isinstance(project_data[0], str) else project_data[0],
                    'system': project_data[1],
                    'environment': project_data[2],
                    'test_steps': json.loads(project_data[3]) if project_data[3] else []
                }
                
                if len(data['product_ids']) == 1:
                    clean_product_id = data['product_ids'][0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                    filename = generate_unique_filename(clean_product_id, data['system'])
                    generate_single_test_file(filename, data, data['product_ids'][0])
                else:
                    for i, product_id in enumerate(data['product_ids'], 1):
                        clean_product_id = product_id.replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                        filename = generate_unique_filename(clean_product_id, data['system'])
                        generate_single_test_file(filename, data, product_id)
            else:
                log_info(f"无法找到项目数据: {project_id}")
                result = False
        
        # 计算结束时间
        end_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # 更新执行状态
        # 在执行结束前先检查取消状态，避免竞态条件
        was_cancelled = project_id in running_tests and running_tests[project_id].get('cancelled', False)
        
        if was_cancelled:
            # 测试被取消，更新项目状态和执行记录
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                execute_query(conn, query, ('cancelled', project_id))  # 被取消的测试设置项目状态为cancelled
            
            # 更新执行记录为cancelled状态
            update_execution_record(execution_id, status='cancelled', end_time=end_time, 
                                  log_message='测试被用户取消',
                                  executed_by=current_user)
        else:
            # 正常结束，更新状态
            status = 'passed' if result else 'failed'
            with get_db_connection_with_retry() as conn:
                query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                execute_query(conn, query, (status, project_id))
            
            # 更新执行记录
            update_execution_record(execution_id, status=status, end_time=end_time,
                                  log_message=f'测试执行{"成功" if result else "失败"}', 
                                  executed_by=current_user)
        
        # 清除当前执行ID，停止实时日志记录
        from config.logger import clear_current_execution_id
        clear_current_execution_id()
        
        # 移除运行记录（让监控线程处理）
        # 注意：不要在这里删除running_tests记录，让监控线程检测到进程结束后再删除
        
        # 等待监控线程处理，但设置超时
        if project_id in running_tests:
            wait_start = time.time()
            while project_id in running_tests and (time.time() - wait_start) < 10:  # 最多等待10秒
                time.sleep(0.5)
            
            # 如果监控线程没有清理，手动清理
            if project_id in running_tests:
                log_info(f"监控线程未及时清理，手动清理项目 {project_id} 的运行记录")
                del running_tests[project_id]
        
    except Exception as e:
        log_info(f"后台执行测试失败: {e}")
        
        # 计算结束时间
        end_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # 检查是否是被取消的，如果是则不覆盖cancelled状态
        was_cancelled = project_id in running_tests and running_tests[project_id].get('cancelled', False)
        
        # 检查是否是浏览器被用户关闭
        error_msg = str(e)
        is_browser_closed = "BROWSER_CLOSED_BY_USER" in error_msg
        
        if is_browser_closed:
            # 浏览器被用户关闭，标记为人工取消
            try:
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                    execute_query(conn, query, ('cancelled', project_id))
                
                # 更新执行记录为cancelled状态
                update_execution_record(execution_id, status='cancelled', end_time=end_time,
                                      log_message='测试被用户中断：浏览器被关闭',
                                      executed_by=current_user)
            except:
                pass
        elif not was_cancelled:
            # 只有在不是被取消且不是浏览器关闭的情况下才更新为失败状态
            try:
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                    execute_query(conn, query, ('failed', project_id))
                
                # 更新执行记录
                update_execution_record(execution_id, status='failed', end_time=end_time,
                                      log_message=f'测试执行异常: {str(e)}', 
                                      executed_by=current_user)
            except:
                pass
        else:
            # 已经被取消，保持cancelled状态，只更新执行记录的结束时间
            try:
                update_execution_record(execution_id, status='cancelled', end_time=end_time,
                                      log_message='测试被用户取消',
                                      executed_by=current_user)
            except:
                pass
        
        # 清除当前执行ID，停止实时日志记录
        from config.logger import clear_current_execution_id
        clear_current_execution_id()
        
        # 移除运行记录（让监控线程处理）
        # 注意：不要在这里删除running_tests记录，让监控线程检测到进程结束后再删除
        
        # 等待监控线程处理，但设置超时
        if project_id in running_tests:
            wait_start = time.time()
            while project_id in running_tests and (time.time() - wait_start) < 10:  # 最多等待10秒
                time.sleep(0.5)
            
            # 如果监控线程没有清理，手动清理
            if project_id in running_tests:
                log_info(f"监控线程未及时清理，手动清理项目 {project_id} 的运行记录")
                del running_tests[project_id]
        
    except Exception as e:
        log_info(f"后台执行测试失败: {e}")
        
        # 计算结束时间
        end_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # 检查是否是被取消的，如果是则不覆盖cancelled状态
        was_cancelled = project_id in running_tests and running_tests[project_id].get('cancelled', False)
        
        # 检查是否是浏览器被用户关闭
        error_msg = str(e)
        is_browser_closed = "BROWSER_CLOSED_BY_USER" in error_msg
        
        if is_browser_closed:
            # 浏览器被用户关闭，标记为人工取消
            try:
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                    execute_query(conn, query, ('cancelled', project_id))
                
                # 更新执行记录为cancelled状态
                update_execution_record(execution_id, status='cancelled', end_time=end_time,
                                      log_message='测试被用户中断：浏览器被关闭',
                                      executed_by=current_user)
            except:
                pass
        elif not was_cancelled:
            # 只有在不是被取消且不是浏览器关闭的情况下才更新为失败状态
            try:
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                    execute_query(conn, query, ('failed', project_id))
                
                # 更新执行记录
                update_execution_record(execution_id, status='failed', end_time=end_time,
                                      log_message=f'测试执行异常: {str(e)}', 
                                      executed_by=current_user)
            except:
                pass
        else:
            # 已经被取消，保持cancelled状态，只更新执行记录的结束时间
            try:
                update_execution_record(execution_id, status='cancelled', end_time=end_time,
                                      log_message='测试被用户取消',
                                      executed_by=current_user)
            except:
                pass
        
        # 清除当前执行ID，停止实时日志记录
        from config.logger import clear_current_execution_id
        clear_current_execution_id()
        
        # 移除运行记录（让监控线程处理）
        # 注意：不要在这里删除running_tests记录，让监控线程检测到进程结束后再删除
        
        # 等待监控线程处理，但设置超时
        if project_id in running_tests:
            wait_start = time.time()
            while project_id in running_tests and (time.time() - wait_start) < 10:  # 最多等待10秒
                time.sleep(0.5)
            
            # 如果监控线程没有清理，手动清理
            if project_id in running_tests:
                log_info(f"监控线程未及时清理，手动清理项目 {project_id} 的运行记录")
                del running_tests[project_id]
        
    except Exception as e:
        log_info(f"后台执行测试失败: {e}")
        
        # 计算结束时间
        end_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        # 检查是否是被取消的，如果是则不覆盖cancelled状态
        was_cancelled = project_id in running_tests and running_tests[project_id].get('cancelled', False)
        
        # 检查是否是浏览器被用户关闭
        error_msg = str(e)
        is_browser_closed = "BROWSER_CLOSED_BY_USER" in error_msg
        
        if is_browser_closed:
            # 浏览器被用户关闭，标记为人工取消
            try:
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                    execute_query(conn, query, ('cancelled', project_id))
                
                # 更新执行记录为cancelled状态
                update_execution_record(execution_id, status='cancelled', end_time=end_time,
                                      log_message='测试被用户中断：浏览器被关闭',
                                      executed_by=current_user)
            except:
                pass
        elif not was_cancelled:
            # 只有在不是被取消且不是浏览器关闭的情况下才更新为失败状态
            try:
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                    execute_query(conn, query, ('failed', project_id))
                
                # 更新执行记录
                update_execution_record(execution_id, status='failed', end_time=end_time,
                                      log_message=f'测试执行异常: {str(e)}', 
                                      executed_by=current_user)
            except:
                pass
        else:
            # 已经被取消，保持cancelled状态，只更新执行记录的结束时间
            try:
                update_execution_record(execution_id, status='cancelled', end_time=end_time,
                                      log_message='测试被用户取消',
                                      executed_by=current_user)
            except:
                pass
        
        # 清除当前执行ID，停止实时日志记录
        from config.logger import clear_current_execution_id
        clear_current_execution_id()
        
        # 移除运行记录（让监控线程处理）
        # 注意：不要在这里删除running_tests记录，让监控线程检测到进程结束后再删除
        
        # 等待监控线程处理，但设置超时
        if project_id in running_tests:
            wait_start = time.time()
            while project_id in running_tests and (time.time() - wait_start) < 10:  # 最多等待10秒
                time.sleep(0.5)
            
            # 如果监控线程没有清理，手动清理
            if project_id in running_tests:
                log_info(f"监控线程未及时清理，手动清理项目 {project_id} 的运行记录")
                del running_tests[project_id]

def check_process_status(project_id):
    """检查进程状态，如果进程异常退出则更新状态"""
    if project_id not in running_tests:
        return
    
    test_info = running_tests[project_id]
    process = test_info.get('process')
    
    if process and process.poll() is not None:
        # 进程已经结束，但状态可能没有更新
        log_info(f"检测到进程已结束，项目ID: {project_id}")
        # 这里不直接更新状态，让后台线程处理
        return True
    
    return False

def analyze_test_file(file_path):
    """分析测试文件，检测是否有多个测试方法和并发方法"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 检测测试方法数量
        test_methods = []
        lines = content.split('\n')
        
        for line in lines:
            line = line.strip()
            # 检测以 test_ 开头的函数定义
            if line.startswith('async def test_') or line.startswith('def test_'):
                method_name = line.split('(')[0].replace('async def ', '').replace('def ', '')
                test_methods.append(method_name)
        
        # 检查是否有并发方法
        has_concurrent_method = 'test_concurrent_independent_browsers' in test_methods
        
        return {
            'test_methods': test_methods,
            'method_count': len(test_methods),
            'has_concurrent_method': has_concurrent_method,
            'should_use_concurrent': len(test_methods) > 1 and has_concurrent_method
        }
    except Exception as e:
        log_info(f"分析测试文件失败: {e}")
        return {
            'test_methods': [],
            'method_count': 0,
            'has_concurrent_method': False,
            'should_use_concurrent': False
        }

def run_pytest_file(filename, project_id=None):
    """执行pytest文件"""
    try:
        file_path = os.path.join('Test_Case', filename)
        if not os.path.exists(file_path):
            # 文件不存在，模拟一些执行时间并检查取消状态
            for i in range(10):  # 检查5秒钟
                if project_id and project_id in running_tests:
                    if running_tests[project_id].get('cancelled', False):
                        return False  # 被取消
                time.sleep(0.5)
            return False  # 文件不存在，执行失败
        
        # 记录测试开始时的日志行数
        from config.logger import get_log_file_line_count
        start_line_number = get_log_file_line_count()
        log_info(f"测试开始，当前日志文件行数: {start_line_number}")
        
        # 分析测试文件
        analysis = analyze_test_file(file_path)
        log_info(f"测试文件分析结果: {analysis}")
        
        # 构建pytest命令
        if analysis['should_use_concurrent']:
            # 如果有多个测试方法且有并发方法，只执行并发方法
            log_info(f"检测到多个测试方法，执行并发方法: test_concurrent_independent_browsers")
            pytest_command = ['python', '-m', 'pytest', file_path, '-k', 'test_concurrent_independent_browsers', '-v']
        else:
            # 否则执行所有测试
            pytest_command = ['python', '-m', 'pytest', file_path, '-v']
        
        # 设置测试环境变量
        env = os.environ.copy()
        if project_id:
            env['PROJECT_ID'] = str(project_id)
            log_info(f"设置环境变量 PROJECT_ID: {project_id}")
            
            # 获取项目详细信息以设置更多环境变量
            try:
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('SELECT `system`, product_type, environment FROM automation_projects WHERE id=?')
                    project_results = execute_query_with_results(conn, query, (project_id,))
                    
                    if project_results:
                        project_info = project_results[0]
                        system, product_type, environment = project_info
                        env['SYSTEM'] = system or 'web'
                        env['PRODUCT_TYPE'] = product_type or 'unknown'
                        env['ENVIRONMENT'] = environment or 'test'
                        log_info(f"设置环境变量 - SYSTEM: {env['SYSTEM']}, PRODUCT_TYPE: {env['PRODUCT_TYPE']}, ENVIRONMENT: {env['ENVIRONMENT']}")
            except Exception as e:
                log_info(f"获取项目信息失败，使用默认环境变量: {e}")
                env['SYSTEM'] = 'web'
                env['PRODUCT_TYPE'] = 'unknown'
                env['ENVIRONMENT'] = 'test'
        
        # 执行pytest命令
        log_info(f"执行pytest命令: {' '.join(pytest_command)}")
        process = subprocess.Popen(pytest_command, 
                                 stdout=subprocess.PIPE, 
                                 stderr=subprocess.PIPE, 
                                 text=True,
                                 env=env)
        
        # 如果提供了project_id，将进程信息保存到running_tests
        if project_id:
            if project_id in running_tests:
                running_tests[project_id]['process'] = process
                running_tests[project_id]['process_valid'] = True  # 标记进程对象有效
                running_tests[project_id]['start_line_number'] = start_line_number  # 保存开始时的日志行数
                log_info(f"进程已添加到running_tests，项目ID: {project_id}")
            else:
                # 如果项目不在running_tests中，这不应该发生，因为execute_test函数应该已经创建了条目
                log_info(f"警告：项目ID {project_id} 不在running_tests中，这可能是竞态条件")
                # 创建一个基本的条目，但这种情况应该很少发生
                running_tests[project_id] = {
                    'process': process,
                    'process_valid': True,  # 标记进程对象有效
                    'start_time': datetime.now(),
                    'execution_id': None,
                    'thread': None,
                    'start_line_number': start_line_number  # 保存开始时的日志行数
                }
        else:
            log_info("警告：没有提供project_id，无法监控进程状态")
        
        # 等待进程完成，同时检查是否被取消
        start_time = time.time()
        timeout_seconds = 300  # 5分钟超时
        
        while process.poll() is None:
            # 检查是否超时
            if time.time() - start_time > timeout_seconds:
                log_info(f"进程执行超时 ({timeout_seconds}秒)，强制终止")
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                # 超时后清理running_tests记录
                if project_id and project_id in running_tests:
                    del running_tests[project_id]
                    log_info(f"超时后清理项目 {project_id} 的运行记录")
                return False
            
            # 检查是否被取消
            if project_id and project_id in running_tests:
                if running_tests[project_id].get('cancelled', False):
                    # 测试被取消，终止进程
                    try:
                        process.terminate()
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                    # 取消后清理running_tests记录
                    if project_id in running_tests:
                        del running_tests[project_id]
                        log_info(f"取消后清理项目 {project_id} 的运行记录")
                    return False
            time.sleep(0.5)  # 每0.5秒检查一次
        
        # 进程正常结束后，等待一小段时间让监控线程处理，然后清理记录
        result = process.returncode == 0
        log_info(f"进程正常结束，返回码: {process.returncode}, 结果: {result}")
        
        # 获取进程的输出信息
        stdout, stderr = process.communicate()
        
        # 构建详细的执行日志
        detailed_log = f"pytest stdout:\n{stdout}\n"
        if stderr:
            detailed_log += f"pytest stderr:\n{stderr}\n"
        
        # 记录到系统日志
        if stdout:
            log_info(f"pytest stdout: {stdout}")
        if stderr:
            log_info(f"pytest stderr: {stderr}")
        
        # 如果有project_id，将详细日志存储到数据库
        # 注意：即使project_id不在running_tests中，也要尝试收集日志
        # 因为监控线程可能已经清理了记录，但日志收集仍然需要执行
        execution_id = None
        if project_id and project_id in running_tests:
            execution_id = running_tests[project_id].get('execution_id')
            # 标记进程对象已失效
            running_tests[project_id]['process_valid'] = False
        
        # 如果从running_tests中获取不到execution_id，尝试从数据库获取最新的执行记录
        if not execution_id and project_id:
            try:
                with get_db_connection_with_retry() as conn:
                    # 首先尝试查询running状态的执行记录
                    query = adapt_query_placeholders('''
                        SELECT id FROM automation_executions 
                        WHERE project_id = ? AND status = 'running'
                        ORDER BY start_time DESC LIMIT 1
                    ''')
                    execution_results = execute_query_with_results(conn, query, (project_id,))
                    if execution_results:
                        execution_id = execution_results[0][0]
                        log_info(f"从数据库获取到运行中的执行记录ID: {execution_id}")
                    else:
                        # 如果没有running状态的记录，查询最近5分钟内创建的执行记录（可能已被监控线程更新状态）
                        query2 = adapt_query_placeholders('''
                            SELECT id FROM automation_executions 
                            WHERE project_id = ? AND start_time >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
                            ORDER BY start_time DESC LIMIT 1
                        ''')
                        recent_results = execute_query_with_results(conn, query2, (project_id,))
                        if recent_results:
                            execution_id = recent_results[0][0]
                            log_info(f"从数据库获取到最近的执行记录ID: {execution_id}")
            except Exception as e:
                log_info(f"从数据库获取执行记录失败: {e}")
        
        if execution_id:
            # 获取测试结束时的日志行数
            end_line_number = get_log_file_line_count()
            log_info(f"测试结束，当前日志文件行数: {end_line_number}")
            
            # 读取测试执行期间新增的日志内容
            from config.logger import read_test_execution_logs
            if end_line_number > start_line_number:
                # 读取从开始行数到结束行数的测试执行日志内容（过滤系统日志）
                test_execution_log = read_test_execution_logs(start_line_number + 1, end_line_number)
                log_info(f"抓取到测试执行期间的日志内容，行数范围: {start_line_number + 1}-{end_line_number}")
            else:
                test_execution_log = "未检测到新的日志内容"
                log_info("未检测到测试执行期间的新日志内容")
            
            # 检查执行记录是否已有详细日志（可能被监控线程收集了）
            try:
                with get_db_connection_with_retry() as conn:
                    query = adapt_query_placeholders('SELECT detailed_log FROM automation_executions WHERE id = ?')
                    log_results = execute_query_with_results(conn, query, (execution_id,))
                    row = log_results[0] if log_results else None
                    existing_log = row[0] if row and row[0] else ""
                
                # 组合完整的详细日志
                if existing_log and "监控线程收集的日志" in existing_log:
                    # 如果监控线程已经收集了日志，补充pytest输出
                    complete_detailed_log = f"{existing_log}\n\n=== 主执行线程补充的pytest输出 ===\n{detailed_log}"
                    log_info(f"监控线程已收集部分日志，主执行线程补充pytest输出")
                else:
                    # 如果没有现有日志或监控线程未收集，创建完整日志
                    complete_detailed_log = f"=== 测试执行过程日志 (行数范围: {start_line_number + 1}-{end_line_number}) ===\n{test_execution_log}\n\n=== pytest输出 ===\n{detailed_log}"
                
                # 更新执行记录的detailed_log字段
                update_execution_detailed_log(execution_id, complete_detailed_log)
                log_info(f"详细日志已存储到执行记录 {execution_id}")
                
            except Exception as log_check_error:
                log_info(f"检查现有日志失败，使用默认逻辑: {log_check_error}")
                # 如果检查失败，使用默认的完整日志
                complete_detailed_log = f"=== 测试执行过程日志 (行数范围: {start_line_number + 1}-{end_line_number}) ===\n{test_execution_log}\n\n=== pytest输出 ===\n{detailed_log}"
                update_execution_detailed_log(execution_id, complete_detailed_log)
                log_info(f"详细日志已存储到执行记录 {execution_id}")
        else:
            log_info(f"无法获取执行记录ID，跳过日志收集，项目ID: {project_id}")
            
        # 等待2秒让监控线程有机会处理
        time.sleep(2)
        
        # 如果监控线程还没有清理，手动清理
        if project_id and project_id in running_tests:
            log_info(f"手动清理项目 {project_id} 的运行记录")
            del running_tests[project_id]
        
        return result
        
    except Exception as e:
        log_info(f"执行pytest失败: {e}")
        # 异常情况下也清理记录
        if project_id and project_id in running_tests:
            del running_tests[project_id]
            log_info(f"异常后清理项目 {project_id} 的运行记录")
        return False

@automation_bp.route('/products', methods=['GET'])
def get_products_for_automation():
    """获取可用于自动化的产品列表"""
    try:
        query = '''
            SELECT product_id, product_package_name, `system_type`, 
                   product_type, environment, product_address, version_number
            FROM projects 
            WHERE product_id IS NOT NULL AND product_id != ''
            ORDER BY `system_type`, product_id
        '''
        
        results = db_execute_query_with_results(query)
        
        products = []
        for row in results:
            product = {
                'product_id': row[0],
                'product_name': row[1],
                'system_type': row[2],
                'product_type': row[3],
                'environment': row[4],
                'product_address': row[5],
                'version_number': row[6]
            }
            products.append(product)
        
        return jsonify({
            'success': True,
            'data': products
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'获取产品列表失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>', methods=['DELETE'])
def delete_automation_project(project_id):
    """删除自动化项目"""
    try:
        # 首先获取项目信息，用于确定要删除的Python文件
        project_query = '''
            SELECT process_name, product_ids, `system`, environment 
            FROM automation_projects WHERE id = %s
        '''
        project_results = db_execute_query_with_results(project_query, (project_id,))
        
        if not project_results:
            return jsonify({
                'success': False,
                'message': '项目不存在'
            }), 404
        
        project_row = project_results[0]
        process_name, product_ids_json, system, environment = project_row
        product_ids = json.loads(product_ids_json) if product_ids_json else []
        
        # 获取项目文件映射信息
        file_query = '''
            SELECT file_name, file_path 
            FROM project_files 
            WHERE project_id = %s AND is_active = 1
        '''
        file_results = db_execute_query_with_results(file_query, (project_id,))
        file_mapping = file_results[0] if file_results else None
        
        # 删除相关的执行记录
        execute_query_without_results_auto('DELETE FROM automation_executions WHERE project_id = %s', (project_id,))
        
        # 删除项目文件映射（软删除）
        execute_query_without_results_auto('''
            UPDATE project_files 
            SET is_active = 0, updated_at = %s
            WHERE project_id = %s
        ''', (datetime.now().isoformat(), project_id))
        
        # 删除项目
        execute_query_without_results_auto('DELETE FROM automation_projects WHERE id = %s', (project_id,))
        
        # 删除对应的Python测试文件
        deleted_files = []
        try:
            if file_mapping:
                # 使用文件映射信息删除文件
                file_name, file_path = file_mapping
                if os.path.exists(file_path):
                    os.remove(file_path)
                    deleted_files.append(file_name)
                    log_info(f"已删除文件: {file_path}")
                else:
                    log_info(f"文件不存在: {file_path}")
            else:
                # 如果没有文件映射，使用旧方法查找文件
                log_info(f"项目 {project_id} 没有文件映射信息，使用旧方法查找文件")
                if len(product_ids) == 1:
                    clean_product_id = product_ids[0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                    filename = find_existing_test_file(clean_product_id, system, project_id)
                    if filename:
                        file_path = os.path.join('Test_Case', filename)
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            deleted_files.append(filename)
                            log_info(f"已删除文件: {file_path}")
                else:
                    # 多个产品ID的文件名格式
                    for i, product_id in enumerate(product_ids, 1):
                        clean_product_id = product_id.replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                        filename = find_existing_test_file(clean_product_id, system, project_id)
                        if filename:
                            file_path = os.path.join('Test_Case', filename)
                            if os.path.exists(file_path):
                                os.remove(file_path)
                                deleted_files.append(filename)
                                log_info(f"已删除文件: {file_path}")
        except Exception as file_error:
            log_info(f"删除Python文件时出错: {file_error}")
        
        success_message = '项目删除成功'
        if deleted_files:
            success_message += f'，已删除测试文件: {", ".join(deleted_files)}'
        
        return jsonify({
            'success': True,
            'message': success_message
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'删除项目失败: {str(e)}'
        }), 500 

def monitor_running_processes():
    """监控运行中的进程状态"""
    log_info("监控线程已启动")
    check_count = 0
    while True:
        try:
            check_count += 1
            print(f"后端Python监控线程第 {check_count} 次检查，当前运行中项目数量: {len(running_tests)}")
            
            # 检查所有运行中的项目
            for project_id in list(running_tests.keys()):
                test_info = running_tests[project_id]
                process = test_info.get('process')
                
                print(f"检查项目 {project_id}: 有进程信息={process is not None}")
                
                # 检查是否有进程信息
                if process:
                    try:
                        # 检查进程对象是否有效
                        if not hasattr(process, 'poll'):
                            print(f"项目 {project_id} 进程对象无效，清理记录")
                            del running_tests[project_id]
                            continue
                            
                        poll_result = process.poll()
                        print(f"项目 {project_id} 进程poll结果: {poll_result}")
                        
                        # 检查线程是否还在运行
                        thread = test_info.get('thread')
                        if thread and not thread.is_alive():
                            print(f"监控线程检测到线程已结束，项目ID: {project_id}")
                            # 标记为失败状态
                            return_code = -1
                            poll_result = return_code
                        
                        # 检查进程是否真的在运行
                        # 如果poll()返回None但进程实际上已经结束，我们需要额外检查
                        if poll_result is not None or (test_info.get('resources_cleaned', False)):
                            # 进程已经结束或资源已清理
                            print(f"监控线程检测到进程已结束或资源已清理，项目ID: {project_id}")
                            
                            # 获取进程返回码
                            return_code = process.returncode if poll_result is not None else -1
                            print(f"进程返回码: {return_code}")
                            
                            # 更新项目状态
                            try:
                                with get_db_connection_with_retry() as conn:
                                    if return_code == 0:
                                        status = 'passed'
                                    else:
                                        status = 'failed'
                                    
                                    log_info(f"准备更新项目 {project_id} 状态为: {status}")
                                    
                                    query = adapt_query_placeholders('UPDATE automation_projects SET status=? WHERE id=?')
                                    execute_query(conn, query, (status, project_id))
                                    
                                    # 更新执行记录的状态和用户信息
                                    execution_id = test_info.get('execution_id')
                                    if execution_id:
                                        end_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                                        log_message = f'测试执行{"成功" if return_code == 0 else "失败"} (返回码: {return_code})'
                                        # 在监控线程中，不更新executed_by字段，保持原有值
                                        query2 = adapt_query_placeholders('''
                                            UPDATE automation_executions 
                                            SET status=?, end_time=?, log_message=?
                                            WHERE id=?
                                        ''')
                                        execute_query(conn, query2, (status, end_time, log_message, execution_id))
                                        
                                        # 在监控线程中也尝试收集日志（如果还没有收集的话）
                                        try:
                                            # 检查是否已经有详细日志
                                            query3 = adapt_query_placeholders('SELECT detailed_log FROM automation_executions WHERE id = ?')
                                            log_results = execute_query_with_results(conn, query3, (execution_id,))
                                            row = log_results[0] if log_results else None
                                            if row and not row[0]:  # 如果没有详细日志，尝试收集
                                                # 获取测试开始时的日志行数（从test_info中获取）
                                                start_line_number = test_info.get('start_line_number')
                                                if start_line_number:
                                                    from config.logger import get_log_file_line_count, read_test_execution_logs
                                                    end_line_number = get_log_file_line_count()
                                                    
                                                    if end_line_number > start_line_number:
                                                        # 读取测试执行期间新增的日志内容
                                                        test_execution_log = read_test_execution_logs(start_line_number + 1, end_line_number)
                                                        log_info(f"监控线程抓取到测试执行期间的日志内容，行数范围: {start_line_number + 1}-{end_line_number}")
                                                        
                                                        # 组合完整的详细日志
                                                        complete_detailed_log = f"=== 测试执行过程日志 (行数范围: {start_line_number + 1}-{end_line_number}) ===\n{test_execution_log}\n\n=== 监控线程收集的日志 ==="
                                                        
                                                        # 更新执行记录的detailed_log字段
                                                        query4 = adapt_query_placeholders('UPDATE automation_executions SET detailed_log = ? WHERE id = ?')
                                                        execute_query(conn, query4, (complete_detailed_log, execution_id))
                                                        log_info(f"监控线程已存储详细日志到执行记录 {execution_id}")
                                        except Exception as log_error:
                                            log_info(f"监控线程收集日志失败: {log_error}")
                                    
                                    # 自动提交和关闭
                                
                                log_info(f"项目 {project_id} 状态已更新为: {status}")
                                
                                # 清除当前执行ID，停止实时日志记录
                                from config.logger import clear_current_execution_id
                                clear_current_execution_id()
                                
                                # 从运行列表中移除
                                del running_tests[project_id]
                                log_info(f"项目 {project_id} 已从运行列表中移除")
                                
                            except Exception as e:
                                log_info(f"更新项目 {project_id} 状态失败: {e}")
                                # 即使更新状态失败，也要清理running_tests记录
                                if project_id in running_tests:
                                    del running_tests[project_id]
                                    log_info(f"状态更新失败后清理项目 {project_id} 的运行记录")
                        else:
                            # poll()返回None，但我们需要额外检查进程是否真的在运行
                            # 检查进程是否被取消
                            if test_info.get('cancelled', False):
                                log_info(f"项目 {project_id} 已被取消，清理记录")
                                # 更新执行记录状态为cancelled
                                try:
                                    execution_id = test_info.get('execution_id')
                                    if execution_id:
                                        with get_db_connection_with_retry() as conn:
                                            query = adapt_query_placeholders('''
                                                UPDATE automation_executions 
                                                SET status=?, end_time=?, log_message=?
                                                WHERE id=?
                                            ''')
                                            execute_query(conn, query, ('cancelled', datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 
                                                  '测试被用户取消', execution_id))
                                            # 自动提交和关闭
                                            log_info(f"项目 {project_id} 执行记录状态已更新为: cancelled")
                                except Exception as update_error:
                                    log_info(f"更新项目 {project_id} 执行记录状态失败: {update_error}")
                                
                                # 清除当前执行ID，停止实时日志记录
                                from config.logger import clear_current_execution_id
                                clear_current_execution_id()
                                
                                del running_tests[project_id]
                                continue
                    except Exception as e:
                        log_info(f"检查项目 {project_id} 进程状态时出错: {e}")
                        # 进程对象可能已失效，清理记录
                        if project_id in running_tests:
                            del running_tests[project_id]
                            log_info(f"进程对象失效，清理项目 {project_id} 的运行记录")
                else:
                    # 没有进程信息，可能是run_test_in_background已经完成但还没有清理
                    log_info(f"项目 {project_id} 没有进程信息，检查是否需要清理")
                    
                    # 检查项目是否已经被标记为完成
                    try:
                        with get_db_connection_with_retry() as conn:
                            query = adapt_query_placeholders('SELECT status FROM automation_projects WHERE id=?')
                            status_results = execute_query_with_results(conn, query, (project_id,))
                            if status_results:
                                project_status = status_results[0][0]
                                if project_status in ['passed', 'failed', 'cancelled']:
                                    log_info(f"项目 {project_id} 状态为 {project_status}，清理运行记录")
                                    del running_tests[project_id]
                                    continue
                    except Exception as e:
                        log_info(f"检查项目 {project_id} 状态失败: {e}")
                    
                    # 如果项目运行时间超过30秒且没有进程信息，可能是异常情况，强制清理
                    start_time = test_info.get('start_time', 0)
                    if start_time:
                        if isinstance(start_time, (int, float)):
                            if (time.time() - start_time) > 30:  # 30秒
                                log_info(f"项目 {project_id} 运行超过30秒且无进程信息，强制清理")
                                del running_tests[project_id]
                                continue
                        else:
                            try:
                                if hasattr(start_time, 'timestamp'):
                                    start_timestamp = start_time.timestamp()
                                    if (time.time() - start_timestamp) > 30:  # 30秒
                                        log_info(f"项目 {project_id} 运行超过30秒且无进程信息，强制清理")
                                        del running_tests[project_id]
                                        continue
                            except:
                                pass
            # 每2秒检查一次
            time.sleep(2)
            
        except Exception as e:
            log_info(f"进程监控异常: {e}")
            time.sleep(5)  # 异常时等待更长时间

# 启动监控线程（确保只有一个实例）
_monitor_thread_started = False

def start_monitor_thread():
    """启动监控线程，确保只有一个实例"""
    global _monitor_thread_started
    if not _monitor_thread_started:
        monitor_thread = threading.Thread(target=monitor_running_processes, daemon=True)
        monitor_thread.start()
        _monitor_thread_started = True
        log_info("监控线程已启动")

# 启动监控线程
start_monitor_thread()

@automation_bp.route('/debug/running-tests', methods=['GET'])
def debug_running_tests():
    """调试：查看当前运行中的测试状态"""
    try:
        debug_info = {}
        for project_id, test_info in running_tests.items():
            process = test_info.get('process')
            debug_info[project_id] = {
                'has_process': process is not None,
                'process_running': process.poll() is None if process else False,
                'return_code': process.returncode if process else None,
                'cancelled': test_info.get('cancelled', False),
                'execution_id': test_info.get('execution_id'),
                'start_time': str(test_info.get('start_time', ''))
            }
        
        return jsonify({
            'success': True,
            'running_tests': debug_info,
            'total_running': len(running_tests)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'获取调试信息失败: {str(e)}'
        }), 500

@automation_bp.route('/debug/cleanup-running-tests', methods=['POST'])
def cleanup_running_tests():
    """清理可能存在的僵尸运行记录"""
    try:
        cleaned_count = 0
        for project_id in list(running_tests.keys()):
            test_info = running_tests[project_id]
            process = test_info.get('process')
            
            # 检查进程是否真的在运行
            if process and process.poll() is not None:
                # 进程已结束，清理记录
                del running_tests[project_id]
                cleaned_count += 1
                log_info(f"清理已结束的项目 {project_id}")
            elif not process:
                # 没有进程信息，清理记录
                del running_tests[project_id]
                cleaned_count += 1
                log_info(f"清理无进程信息的项目 {project_id}")
        
        return jsonify({
            'success': True,
            'message': f'清理了 {cleaned_count} 个僵尸记录',
            'remaining_count': len(running_tests)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'清理失败: {str(e)}'
        }), 500

@automation_bp.route('/debug/force-cleanup', methods=['POST'])
def debug_force_cleanup():
    """调试：强制清理所有僵尸记录"""
    try:
        # 获取当前运行中的项目数量
        before_count = len(running_tests)
        
        # 强制清理所有记录
        projects_to_remove = []
        for project_id, test_info in running_tests.items():
            process = test_info.get('process')
            if process:
                try:
                    # 检查进程是否真的在运行
                    poll_result = process.poll()
                    if poll_result is not None:
                        # 进程已结束，需要清理
                        projects_to_remove.append(project_id)
                        log_info(f"强制清理已结束的进程: 项目 {project_id}")
                    else:
                        # 检查PID是否存在
                        try:
                            import psutil
                            if not psutil.pid_exists(process.pid):
                                projects_to_remove.append(project_id)
                                log_info(f"强制清理PID不存在的进程: 项目 {project_id}")
                        except:
                            pass
                except Exception as e:
                    # 进程对象失效，清理
                    projects_to_remove.append(project_id)
                    log_info(f"强制清理失效的进程对象: 项目 {project_id}, 错误: {e}")
            else:
                # 没有进程信息，清理
                projects_to_remove.append(project_id)
                log_info(f"强制清理无进程信息的记录: 项目 {project_id}")
        
        # 移除需要清理的项目
        for project_id in projects_to_remove:
            if project_id in running_tests:
                del running_tests[project_id]
        
        after_count = len(running_tests)
        
        return jsonify({
            'success': True,
            'message': f'强制清理完成，清理了 {len(projects_to_remove)} 个僵尸记录',
            'before_count': before_count,
            'after_count': after_count,
            'cleaned_projects': projects_to_remove
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'强制清理失败: {str(e)}'
        }), 500

# ==================== 代码管理API ====================

@automation_bp.route('/projects/<int:project_id>/code', methods=['GET'])
def get_project_code(project_id):
    """获取项目的代码内容"""
    try:
        log_info(f"开始获取项目代码 - 项目ID: {project_id}")
        log_info(f"请求参数 - 时间戳: {request.args.get('t')}, 随机数: {request.args.get('r')}, 缓存破坏器: {request.args.get('cb')}")
        log_info(f"请求头 - X-Requested-With: {request.headers.get('X-Requested-With')}, X-Cache-Buster: {request.headers.get('X-Cache-Buster')}")
        
        # 使用新的文件管理系统
        from utils.file_manager import file_manager
        
        # 获取项目信息
        with get_db_connection_with_retry() as conn:            
            query = adapt_query_placeholders('''
                SELECT process_name, product_ids, `system`, product_type, environment, product_address
                FROM automation_projects 
                WHERE id = ?
            ''')
            
            result = execute_query_with_results(conn, query, (project_id,))
            project = result[0] if result else None
            if not project:
                return jsonify({
                    'success': False,
                    'message': '项目不存在'
                }), 404
            
            process_name, product_ids, system, product_type, environment, product_address = project
            log_info(f"项目信息 - 流程名称: {process_name}, 产品IDs: {product_ids}, 系统: {system}")
            
            # 使用文件管理器获取文件内容和文件名
            code_content, filename = file_manager.get_file_content(project_id)
            
            if code_content is None:
                # 如果文件不存在，生成默认代码内容
                # 使用文件管理器获取正确的文件名
                file_mapping = file_manager.get_project_file_mapping(project_id)
                if file_mapping:
                    filename = file_mapping['file_name']
                else:
                    # 如果没有文件映射，使用旧的逻辑作为后备
                    # 从项目信息中构建data字典
                    data = {
                        'product_ids': json.loads(product_ids) if isinstance(product_ids, str) else product_ids,
                        'system': system,
                        'environment': environment,
                        'test_steps': []  # 这里可能需要从数据库获取测试步骤
                    }
                    
                    if len(data['product_ids']) == 1:
                        clean_product_id = data['product_ids'][0].replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                        filename = generate_unique_filename(clean_product_id, data['system'])
                        generate_single_test_file(filename, data, data['product_ids'][0])
                    else:
                        for i, product_id in enumerate(data['product_ids'], 1):
                            clean_product_id = product_id.replace('"', '').replace('[', '').replace(']', '').replace('-', '_')
                            filename = generate_unique_filename(clean_product_id, data['system'])
                            generate_single_test_file(filename, data, product_id)
            else:
                log_info(f"读取现有文件成功，文件大小: {len(code_content)} 字符")
                log_info(f"文件不存在，生成默认代码，代码长度: {len(code_content)} 字符")
            
            # 自动提交和关闭
        
        log_info(f"代码获取完成，返回响应")
        response = jsonify({
            'success': True,
            'data': {
                'code': code_content,
                'filename': filename,
                'project_name': process_name
            }
        })
        
        # 添加强缓存控制头
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, private, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Cache-Control'] = 'no-cache'
        response.headers['Last-Modified'] = datetime.now().strftime('%a, %d %b %Y %H:%M:%S GMT')
        
        return response
        
    except Exception as e:
        log_info(f"获取代码异常: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'获取代码失败: {str(e)}'
        }), 500

@automation_bp.route('/projects/<int:project_id>/code', methods=['POST'])
def save_project_code(project_id):
    """保存项目的代码内容"""
    try:
        log_info(f"开始保存项目代码 - 项目ID: {project_id}")
        
        # 使用新的文件管理系统
        from utils.file_manager import file_manager
        
        # 获取请求数据
        data = request.get_json()
        if not data or 'code' not in data:
            return jsonify({
                'success': False,
                'message': '缺少代码内容'
            }), 400
        
        code_content = data['code']
        log_info(f"接收到的代码内容长度: {len(code_content)}")
        
        # 获取项目信息
        with get_db_connection_with_retry() as conn:            
            query = adapt_query_placeholders('''
                SELECT process_name, product_ids, `system`, environment
                FROM automation_projects 
                WHERE id = ?
            ''')
            
            result = execute_query_with_results(conn, query, (project_id,))
            project = result[0] if result else None
            if not project:
                return jsonify({
                    'success': False,
                    'message': '项目不存在'
                }), 404
            
            process_name, product_ids, system, environment = project
            log_info(f"项目信息 - 流程名称: {process_name}, 产品IDs: {product_ids}, 系统: {system}")
            
            # 使用文件管理器保存代码
            success, file_path = file_manager.save_file_content(project_id, code_content)
            
            if not success:
                return jsonify({
                    'success': False,
                    'message': '保存文件失败'
                }), 500
            
            # 获取文件映射信息
            file_mapping = file_manager.get_project_file_mapping(project_id)
            filename = file_mapping['file_name'] if file_mapping else 'unknown.py'
            
            # 自动提交和关闭
        
        log_info(f"代码保存完成，返回成功响应")
        return jsonify({
            'success': True,
            'message': '代码保存成功',
            'data': {
                'filename': filename,
                'file_path': file_path
            }
        })
        

        
    except Exception as e:
        log_info(f"保存代码异常: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'保存代码失败: {str(e)}'
        }), 500

def run_connection_test(test_file, project_id, system, product_type, environment, product_addresses=None):
    """运行连接测试"""
    try:
        log_info(f"开始连接测试 - 文件: {test_file}, 项目ID: {project_id}")
        
        # 检查测试文件是否存在
        test_file_path = os.path.join('Test_Case', test_file)
        if not os.path.exists(test_file_path):
            return {
                'success': False,
                'error': f'测试文件不存在: {test_file}',
                'details': f'文件路径: {test_file_path}'
            }
        
        # 设置测试环境变量
        env = os.environ.copy()
        env['PROJECT_ID'] = str(project_id)
        env['SYSTEM'] = system
        env['PRODUCT_TYPE'] = product_type
        env['ENVIRONMENT'] = environment
        
        # 如果有产品地址，添加到环境变量中
        if product_addresses:
            env['PRODUCT_ADDRESSES'] = json.dumps(product_addresses)
            log_info(f"设置产品地址环境变量: {product_addresses}")
        
        # 运行测试文件
        try:
            # 使用subprocess运行测试文件
            result = subprocess.run(
                ['python', test_file_path],
                capture_output=True,
                text=True,
                timeout=30,  # 30秒超时
                cwd=os.getcwd(),
                env=env
            )
            
            log_info(f"连接测试输出 - 返回码: {result.returncode}")
            log_info(f"连接测试输出 - 标准输出: {result.stdout}")
            log_info(f"连接测试输出 - 错误输出: {result.stderr}")
            
            if result.returncode == 0:
                return {
                    'success': True,
                    'details': f'连接测试通过\n返回码: {result.returncode}\n输出: {result.stdout.strip()}',
                    'return_code': result.returncode,
                    'stdout': result.stdout.strip(),
                    'stderr': result.stderr.strip()
                }
            else:
                return {
                    'success': False,
                    'error': f'连接测试失败，返回码: {result.returncode}',
                    'details': f'错误输出: {result.stderr.strip()}\n标准输出: {result.stdout.strip()}',
                    'return_code': result.returncode,
                    'stdout': result.stdout.strip(),
                    'stderr': result.stderr.strip()
                }
                
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': '连接测试超时（30秒）',
                'details': '测试执行时间超过30秒，可能网络连接较慢或目标网站响应缓慢'
            }
        except FileNotFoundError:
            return {
                'success': False,
                'error': f'Python解释器未找到',
                'details': '请确保Python已正确安装并添加到系统PATH中'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'执行测试文件时发生异常: {str(e)}',
                'details': f'异常类型: {type(e).__name__}'
            }
            
    except Exception as e:
        log_info(f"运行连接测试异常: {e}")
        return {
            'success': False,
            'error': f'运行连接测试失败: {str(e)}',
            'details': f'异常类型: {type(e).__name__}'
        } 

def generate_multi_product_test_file(filename, data, product_addresses):
    """生成多产品地址的测试文件，每个地址对应一个独立函数"""
    try:
        file_path = os.path.join('Test_Case', filename)
        
        # 为同一地址创建账号使用计数器
        address_account_counters = {}
        
        # 生成代码头部
        code_content = '''
import time
import sys
import pyautogui
import numpy
import pytest
import asyncio
import os
# 添加项目根目录到Python路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
import requests
import allure
from config.logger import log_info
from playwright.async_api import async_playwright
from utils.screen_manager import screen_manager
from utils.ui_operations import UIOperations
from typing import Tuple, List
from Base_ENV.config import *

'''
        
        # 为每个产品地址生成独立的函数
        for i, (product_id, product_address) in enumerate(product_addresses,1):
            # 生成函数名，使用产品ID
            function_name = f"test_{product_id.replace('-', '_')}_{i}"
            
            code_content += '''async def ''' + function_name + '''(browser_args):
    """
    为 ''' + function_name + ''' 创建完全独立的浏览器实例，使用指定的浏览器参数
    """
    task_id = "''' + function_name + '''"
    async with async_playwright() as p:
        browser = None
        context = None
        page = None
        try:
            # 启动独立的浏览器实例
            browser = await p.chromium.launch(headless=False, args=browser_args)
            context = await browser.new_context(no_viewport=True)
            page = await context.new_page()
                    
            # 创建UIOperations实例并使用混合图片识别机制，为每个任务创建独立实例
            ui_operations = UIOperations(page, task_id=task_id)
            
            # 配置参数
            website_url = "''' + product_address + '''"
            
            # 导航到目标网站
            await ui_operations.navigate_to(website_url)
            
            # 初始检查浏览器状态
            if await ui_operations.is_browser_closed():
                log_info(f"[{task_id}] 检测到浏览器已关闭，''' + function_name + ''' 测试无法继续")
                raise Exception("BROWSER_CLOSED_BY_USER")
            
'''
            
            # 生成测试步骤代码
            for j, step in enumerate(data['test_steps']):
                step_name = step.get('step_name', f'step_{j+1}')
                operation_type = step.get('operation_type', 'web')
                operation_event = step.get('operation_event', 'click')

                auth_cfg = step.get('auth_config', {}) or {}
                email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")

                operation_params = step.get('operation_params', '').replace('"', "'") or email_selector or password_selector or submit_selector
                
                input_value = step.get('input_value', '').replace('"', "'")
            
                # 获取标签页跳转配置
                tab_switch_enabled = step.get('tab_switch_enabled', 'no')
                tab_target_url = step.get('tab_target_url', '')
                
                # 安全地转换数字字段，确保它们是有效的正整数
                try:
                    operation_count = max(1, int(step.get('operation_count', 1)))
                except (ValueError, TypeError):
                    operation_count = 1
                    log_info(f"警告: 步骤 {j+1} 的操作次数无效，使用默认值 1")
                
                try:
                    pause_time = max(0, int(step.get('pause_time', 1)))
                except (ValueError, TypeError):
                    pause_time = 1
                    log_info(f"警告: 步骤 {j+1} 的暂停时间无效，使用默认值 1")
                
                if operation_type == 'web':
                    # 生成截图代码变量
                    screenshot_enabled = step.get('screenshot_enabled', 'NO').upper()
                    screenshot_config = step.get('screenshot_config', {})
                    screenshot_timing = screenshot_config.get('timing', 'none')
                    
                    # 步骤前截图代码
                    if screenshot_enabled == 'YES' and screenshot_timing in ['before', 'both']:
                        before_screenshot_code = '''
                # 步骤前截图
                with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + ''' - 步骤前截图"):
                    if not await ui_operations.is_browser_closed():
                        await ui_operations.page_screenshot(f"''' + function_name + '''", f"step_''' + str(j+1) + '''_before")
                        log_info(f"步骤''' + str(j+1) + '''前截图完成")
                    else:
                        log_info(f"浏览器已关闭，跳过步骤''' + str(j+1) + '''前截图")
'''
                    else:
                        before_screenshot_code = ''
                    
                    # 步骤后截图代码
                    if screenshot_enabled == 'YES' and screenshot_timing in ['after', 'both']:
                        after_screenshot_code = '''
                # 步骤后截图
                with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + ''' - 步骤后截图"):
                    if not await ui_operations.is_browser_closed():
                        await ui_operations.page_screenshot(f"''' + function_name + '''", f"step_''' + str(j+1) + '''_after")
                        log_info(f"步骤''' + str(j+1) + '''后截图完成")
                    else:
                        log_info(f"浏览器已关闭，跳过步骤''' + str(j+1) + '''后截图")
'''
                    else:
                        after_screenshot_code = ''
                    # 失败截图代码
                    if screenshot_enabled == 'YES' and screenshot_timing == 'on_failure':
                        failure_screenshot_code = '''
                        # 操作失败截图
                            with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 操作失败截图"):
                            try:
                                if not await ui_operations.is_browser_closed():
                                    await ui_operations.page_screenshot(f"''' + function_name + '''", f"step_''' + str(j+1) + '''_failure")
                                    log_info(f"步骤''' + str(j+1) + '''操作失败截图完成")
                            except Exception as screenshot_e:
                                log_info(f"失败截图异常: {screenshot_e}")
                                raise screenshot_e
                        '''
                    else:
                        failure_screenshot_code = ''
                    # 检查是否需要跳转到新标签页 - 需要启用跳转且有目标URL
                    tab_switch_enabled = step.get('tab_switch_enabled', 'no')
                    # 生成统一的测试步骤包装
                    code_content += f'''            
            # 测试步骤{j+1}: {step_name} (操作次数: {operation_count})
            with allure.step("测试步骤{j+1}: {step_name}"):
                log_info(f"开始测试步骤{j+1} {step_name} 的操作==============")
'''
                    # 添加步骤前截图代码
                    code_content += before_screenshot_code
                    code_content += '''
'''
                    # 如果需要标签页跳转，添加跳转代码
                    if tab_switch_enabled == 'yes' and tab_target_url and tab_target_url.strip():
                        code_content += f'''                
                # 标签页跳转配置
                log_info(f"[{{task_id}}] 正在打开新标签页: {tab_target_url}")
                new_page = await ui_operations.open_new_tab_and_navigate("{tab_target_url}")
                
                # 获取所有标签页信息并确保切换到正确的标签页
                all_tabs = await ui_operations.get_all_tabs()
                
                # 公共断言方法，断言URL是否存在
                with allure.step("测试步骤{j+1}: 公共断言URL是否存在"):
                    await ui_operations.url_assert_exists("{tab_target_url}")
                time.sleep(1)  # 等待页面加载
                
                # 公共断言方法，断言元素是否存在
                with allure.step("测试步骤''' + str(j+1) + ''': 公共断言元素是否存在"):
                    await ui_operations.elem_assert_exists("''' + operation_params + '''")
'''
                    # 添加自定义断言代码
                    assertion_code = generate_assertion_code(step, j+1)
                    if assertion_code:
                            code_content += assertion_code
                        
                    # 构造操作调用语句与文案后缀
                    if operation_event in ['input', 'select_option', 'press_key', 'drag_and_drop']:
                        operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '", "' + input_value + '")'
                    elif operation_event in ['login']:
                        auth_cfg = step.get('auth_config', {}) or {}
                        current_addr = product_address
                        resolved_email = ''
                        resolved_password = ''
                        try:
                            # 初始化或获取当前地址的计数器（统一管理）
                            if current_addr not in address_account_counters:
                                address_account_counters[current_addr] = 0
                            
                            # 收集所有匹配当前地址的账号（从所有数据源）
                            all_matching_accounts = []
                            
                            # 1. 从accounts数组收集
                            for acc in auth_cfg.get('accounts', []) or []:
                                addr = (acc.get('address') or '').strip()
                                if addr and current_addr.strip().startswith(addr.strip()):
                                    all_matching_accounts.append(acc)
                            
                            # 2. 从address_credentials字典收集
                            if isinstance(auth_cfg.get('address_credentials'), dict):
                                for k, v in auth_cfg.get('address_credentials', {}).items():
                                    key = (k or '').strip()
                                    if key and current_addr.strip().startswith(key):
                                        account_info = {
                                            'address': key,
                                            'email': (v or {}).get('email', ''),
                                            'password': (v or {}).get('password', '')
                                        }
                                        all_matching_accounts.append(account_info)
                            
                            # 3. 从address_credentials_list数组收集
                            addr_list = auth_cfg.get('address_credentials_list', []) or []
                            for addr_cred in addr_list:
                                addr_cred_address = (addr_cred.get('address') or '').strip()
                                if addr_cred_address and current_addr.strip().startswith(addr_cred_address):
                                    all_matching_accounts.append(addr_cred)
                            
                            # 使用轮询机制分配账号
                            if all_matching_accounts:
                                # 使用轮询方式选择账号
                                account_index = address_account_counters[current_addr] % len(all_matching_accounts)
                                selected_account = all_matching_accounts[account_index]
                                resolved_email = selected_account.get('email', '')
                                resolved_password = selected_account.get('password', '')
                                
                                # 更新计数器
                                address_account_counters[current_addr] += 1
                                
                                log_info(f"地址 {current_addr} 使用第 {account_index + 1} 个账号: {resolved_email}（共{len(all_matching_accounts)}个账号）")
                                log_info(f"2当前的地址是{current_addr}，当前的邮箱是{resolved_email}，当前的密码是{resolved_password}, 账号索引:{account_index}")
                            
                            # 如果仍然没有找到匹配的凭据，使用第一个作为默认值
                            elif not resolved_email and isinstance(addr_list, list) and len(addr_list) > 0:
                                resolved_email = (addr_list[0] or {}).get('email', '')
                                resolved_password = (addr_list[0] or {}).get('password', '')
                        except Exception:
                            log_info(f"[{task_id}] 登录步骤{j+1} 操作失败")
                            pass
                        email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                        password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                        submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                        email = step.get('email', '') or resolved_email
                        password = step.get('password', '') or resolved_password
                        operation_invoke = 'await ui_operations.elem_login("' + email_selector + '","' + password_selector + '","' + submit_selector + '","' + email + '","' + password + '")'
                    elif operation_event in ['register']:
                        auth_cfg = step.get('auth_config', {}) or {}
                        current_addr = product_address
                        resolved_email = ''
                        resolved_password = ''
                        try:
                            # 初始化或获取当前地址的计数器（统一管理）
                            if current_addr not in address_account_counters:
                                address_account_counters[current_addr] = 0
                            
                            # 收集所有匹配当前地址的账号（从所有数据源）
                            all_matching_accounts = []
                            
                            # 1. 从accounts数组收集
                            for acc in auth_cfg.get('accounts', []) or []:
                                addr = (acc.get('address') or '').strip()
                                if addr and current_addr.strip().startswith(addr.strip()):
                                    all_matching_accounts.append(acc)
                            
                            # 2. 从address_credentials字典收集
                            if isinstance(auth_cfg.get('address_credentials'), dict):
                                for k, v in auth_cfg.get('address_credentials', {}).items():
                                    key = (k or '').strip()
                                    if key and current_addr.strip().startswith(key):
                                        account_info = {
                                            'address': key,
                                            'email': (v or {}).get('email', ''),
                                            'password': (v or {}).get('password', '')
                                        }
                                        all_matching_accounts.append(account_info)
                            
                            # 3. 从address_credentials_list数组收集
                            addr_list = auth_cfg.get('address_credentials_list', []) or []
                            for addr_cred in addr_list:
                                addr_cred_address = (addr_cred.get('address') or '').strip()
                                if addr_cred_address and current_addr.strip().startswith(addr_cred_address):
                                    all_matching_accounts.append(addr_cred)
                            
                            # 使用轮询机制分配账号
                            if all_matching_accounts:
                                # 使用轮询方式选择账号
                                account_index = address_account_counters[current_addr] % len(all_matching_accounts)
                                selected_account = all_matching_accounts[account_index]
                                resolved_email = selected_account.get('email', '')
                                resolved_password = selected_account.get('password', '')
                                
                                # 更新计数器
                                address_account_counters[current_addr] += 1
                                
                                log_info(f"地址 {current_addr} 使用第 {account_index + 1} 个账号: {resolved_email}（共{len(all_matching_accounts)}个账号）")
                                log_info(f"2当前的地址是{current_addr}，当前的邮箱是{resolved_email}，当前的密码是{resolved_password}, 账号索引:{account_index}")
                            
                            # 如果仍然没有找到匹配的凭据，使用第一个作为默认值
                            elif not resolved_email and isinstance(addr_list, list) and len(addr_list) > 0:
                                resolved_email = (addr_list[0] or {}).get('email', '')
                                resolved_password = (addr_list[0] or {}).get('password', '')
                        except Exception:
                            log_info(f"[{task_id}] 登录步骤{j+1} 操作失败")
                            pass
                        email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                        password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                        repeat_password_selector = auth_cfg.get('repeat_password_selector', '').replace('"', "'")
                        submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                        email = resolved_email
                        password = resolved_password
                        operation_invoke = 'await ui_operations.elem_register(email_selector="' + email_selector + '",password_selector="' + password_selector + '",repeat_password_selector="' + repeat_password_selector + '",submit_selector="' + submit_selector + '",email="' + email + '",password="' + password + '")'
                    else:
                        operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '")'
                    code_content += '''
                with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + ''' - ''' + operation_event + ''' 操作 (''' + operation_params + ''')"):
                    time.sleep(''' + str(pause_time) + ''')
                    # 执行Web元素操作 ''' + str(operation_count) + ''' 次
                    for attempt in range(''' + str(operation_count) + '''):
                        # 检查浏览器是否已关闭
                        if await ui_operations.is_browser_closed():
                            log_info("检测到浏览器已关闭，''' + function_name + ''' 测试被用户中断")
                            raise Exception("BROWSER_CLOSED_BY_USER")
                        try:
                            log_info(f"[{task_id}] 执行第{attempt + 1}次操作: ''' + operation_event + ''' on ''' + operation_params + '''")
                            # 使用安全操作机制，带重试
                            ''' + operation_invoke + '''
                            time.sleep(1)  # 每次操作后等待1秒
                        except Exception as e:
                            # 检查是否是浏览器关闭导致的异常
                            error_msg = str(e).lower()
                            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                                log_info(f"检测到浏览器连接异常，''' + function_name + ''' 可能被用户关闭")
                                raise Exception("BROWSER_CLOSED_BY_USER")
                            log_info(f"[{task_id}]第{attempt + 1}次操作失败")
                            if attempt == ''' + str(operation_count - 1) + ''':  # 最后一次尝试失败
                                log_info(f"所有操作均失败！")
                                ''' + failure_screenshot_code + '''
                time.sleep(1)  # 每次操作后等待1秒
''' + after_screenshot_code + '''
            
'''
                elif operation_type == 'game':
                    img_path = operation_params.replace('\\', '/')
                    # 根据操作事件选择对应的pyautogui方法
                    if operation_event == 'double_click':
                        click_action = 'pyautogui.doubleClick(center_x, center_y)'
                    else:
                        click_action = 'pyautogui.click(center_x, center_y)'
                    code_content += f'''            
            # 测试步骤{j+1}: {step_name} (操作次数: {operation_count})
            with allure.step("{step_name} - 游戏图片{operation_event} 操作 ({img_path})"):
                # 需要等待1S后再操作滚动
                time.sleep(1)
                # 游戏操作前先滚动页面确保图片可见
                # 此功能需要由编写者确认需要滚动到的页面位置是什么，默认参数：delta_x=0, delta_y=1100
                # 请根据实际的页面滚动进行调整到图片可见
                await ui_operations.page_mouse_scroll(delta_x=0, delta_y=1500)
                # 执行游戏图片操作 {operation_count} 次
                for attempt in range({operation_count}):
                    # 检查浏览器是否已关闭（即使是游戏操作也需要检查浏览器状态）
                    if await ui_operations.is_browser_closed():
                        log_info(f"[{{task_id}}] 检测到浏览器已关闭，{function_name} 测试被用户中断")
                        raise Exception("BROWSER_CLOSED_BY_USER")
                    try:
                        time.sleep({pause_time})
                        success = await ui_operations.click_image_with_fallback(
                            "{img_path}",
                            confidence=0.5, 
                            timeout=10
                        )
                        if success:
                            log_info(f"[{{task_id}}] 第{attempt + 1}次操作完成")
                        else:
                            log_info(f"[{{task_id}}] 第{attempt + 1}次尝试：没有找到图片 {img_path}")
                            if attempt == {operation_count - 1}:  # 最后一次尝试失败
                                log_info(f"[{{task_id}}]  所有 {operation_count} 次尝试都失败，无法找到图片")
                            raise Exception(f"图片定位失败：无法找到图片 {img_path}")
                    except Exception as e:
                        log_info(f"[{{task_id}}]  第{attempt + 1}次图片定位失败")
                        if attempt == {operation_count - 1}:  # 最后一次尝试失败
                            log_info(f"[{{task_id}}]  所有 {operation_count} 次尝试都失败")
                        raise Exception(f"图片定位失败：无法找到图片 {img_path}")
                    time.sleep(1)  # 每次操作后等待1秒
'''
            code_content += f'''            # 等待测试完成
            time.sleep(3)
            # 最终检查浏览器状态
            if await ui_operations.is_browser_closed():
                log_info("检测到浏览器已关闭，''' + function_name + ''' 无法截图")
                raise Exception("BROWSER_CLOSED_BY_USER")
            
            await ui_operations.page_screenshot("''' + function_name + '''","over_test_test_step_''' + str(j+1) + '''")
            time.sleep(2)
            
            # 输出图片识别统计信息
            stats = ui_operations.get_image_stats()
            log_info(f"[{task_id}] 图片识别统计: 截图识别成功 {stats['screenshot_success']} 次, "
                    f"pyautogui成功 {stats['pyautogui_success']} 次, "
                    f"总成功率 {stats['success_rate']:.2%}")
            log_info(f"[{task_id}] ''' + function_name + ''' 完成")
            
        except Exception as e:
            log_info(f"[{task_id}] ''' + function_name + ''' 失败")
            raise e
        finally:
            # 清理资源
            if page:
                await page.close()
            if context:
                await context.close()
            if browser:
                await browser.close()
            

'''
        
        # 生成动态并发执行函数
        concurrent_function = generate_concurrent_execution_function(product_addresses)
        code_content += concurrent_function
        
        # 写入文件
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(code_content)
            
    except Exception as e:
        log_info(f"生成多产品测试文件失败: {e}")
        raise e

def update_multi_product_test_file(filename, data, product_addresses):
    """更新多产品地址的测试文件"""
    try:
        file_path = os.path.join('Test_Case', filename)
        
        # 为同一地址创建账号使用计数器
        address_account_counters = {}
        
        # 生成代码内容（与generate_multi_product_test_file相同的逻辑）
        code_content = '''
import time
import sys
import pyautogui
import numpy
import pytest
import asyncio
import os
# 添加项目根目录到Python路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
import requests
import allure
from config.logger import log_info
from playwright.async_api import async_playwright
from utils.screen_manager import screen_manager
from utils.ui_operations import UIOperations
from typing import Tuple, List
from Base_ENV.config import *

'''
        
        # 为每个产品地址生成独立的函数
        for i, (product_id, product_address) in enumerate(product_addresses,1):
            # 生成函数名，使用产品ID
            function_name = f"test_{product_id.replace('-', '_')}_{i}"
            
            code_content += '''async def ''' + function_name + '''(browser_args):
    """
    为 ''' + function_name + ''' 创建完全独立的浏览器实例，使用指定的浏览器参数
    """
    task_id = "''' + function_name + '''"
    async with async_playwright() as p:
        browser = None
        context = None
        page = None
        try:
            # 启动独立的浏览器实例
            browser = await p.chromium.launch(headless=False, args=browser_args)
            context = await browser.new_context(no_viewport=True)
            page = await context.new_page()
                    
            # 创建UIOperations实例并使用混合图片识别机制，为每个任务创建独立实例
            ui_operations = UIOperations(page, task_id=task_id)
            
            # 配置参数
            website_url = "''' + product_address + '''"
            
            # 导航到目标网站
            await ui_operations.navigate_to(website_url)
            
            # 初始检查浏览器状态
            if await ui_operations.is_browser_closed():
                log_info(f"[{task_id}] 检测到浏览器已关闭，''' + function_name + ''' 测试无法继续")
                raise Exception("BROWSER_CLOSED_BY_USER")
            
'''
            
            # 生成测试步骤代码
            for j, step in enumerate(data['test_steps']):
                step_name = step.get('step_name', f'step_{j+1}')
                operation_type = step.get('operation_type', 'web')
                operation_event = step.get('operation_event', 'click')

                auth_cfg = step.get('auth_config', {}) or {}
                email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")

                operation_params = step.get('operation_params', '').replace('"', "'") or email_selector or password_selector or submit_selector
                input_value = step.get('input_value', '').replace('"', "'")
            
                # 获取标签页跳转配置
                tab_switch_enabled = step.get('tab_switch_enabled', 'no')
                tab_target_url = step.get('tab_target_url', '')
                
                # 安全地转换数字字段，确保它们是有效的正整数
                try:
                    operation_count = max(1, int(step.get('operation_count', 1)))
                except (ValueError, TypeError):
                    operation_count = 1
                    log_info(f"警告: 步骤 {j+1} 的操作次数无效，使用默认值 1")
                try:
                    pause_time = max(0, int(step.get('pause_time', 1)))
                except (ValueError, TypeError):
                    pause_time = 1
                    log_info(f"警告: 步骤 {j+1} 的暂停时间无效，使用默认值 1")
                
                if operation_type == 'web':
                    # 生成截图代码变量
                    screenshot_enabled = step.get('screenshot_enabled', 'NO').upper()
                    screenshot_config = step.get('screenshot_config', {})
                    screenshot_timing = screenshot_config.get('timing', 'none')
                    
                    # 步骤前截图代码
                    if screenshot_enabled == 'YES' and screenshot_timing in ['before', 'both']:
                        before_screenshot_code = '''
                # 步骤前截图
                with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + ''' - 步骤前截图"):
                    if not await ui_operations.is_browser_closed():
                        await ui_operations.page_screenshot(f"''' + function_name + '''", f"step_''' + str(j+1) + '''_before")
                        log_info(f"步骤''' + str(j+1) + '''前截图完成")
                    else:
                        log_info(f"浏览器已关闭，跳过步骤''' + str(j+1) + '''前截图")
'''
                    else:
                        before_screenshot_code = ''
                    # 步骤后截图代码
                    if screenshot_enabled == 'YES' and screenshot_timing in ['after', 'both']:
                        after_screenshot_code = '''
                # 步骤后截图
                with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + ''' - 步骤后截图"):
                    if not await ui_operations.is_browser_closed():
                        await ui_operations.page_screenshot(f"''' + function_name + '''", f"step_''' + str(j+1) + '''_after")
                        log_info(f"步骤''' + str(j+1) + '''后截图完成")
                    else:
                        log_info(f"浏览器已关闭，跳过步骤''' + str(j+1) + '''后截图")
'''
                    else:
                        after_screenshot_code = ''
                    # 失败截图代码
                    if screenshot_enabled == 'YES' and screenshot_timing == 'on_failure':
                        failure_screenshot_code = '''
                            # 操作失败截图
                            with allure.step("测试步骤''' + str(i+1) + ''': ''' + step_name + ''' - 操作失败截图"):
                                try:
                                    if not await ui_operations.is_browser_closed():
                                        await ui_operations.page_screenshot(f"''' + function_name + '''", f"step_''' + str(j+1) + '''_failure")
                                        log_info(f"步骤''' + str(j+1) + '''操作失败截图完成")
                                except Exception as screenshot_e:
                                    log_info(f"失败截图异常: {screenshot_e}")
                                    raise screenshot_e
                            '''
                    else:
                        failure_screenshot_code = ''
                    
                    # 检查是否需要跳转到新标签页 - 需要启用跳转且有目标URL
                    tab_switch_enabled = step.get('tab_switch_enabled', 'no')
                    if tab_switch_enabled == 'yes' and tab_target_url and tab_target_url.strip():
                        # 有标签页跳转的Web操作 - 统一包装
                        code_content += '''            # 测试步骤''' + str(j+1) + ''': ''' + step_name + ''' (操作次数: ''' + str(operation_count) + ''')
            with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + '''"):
                log_info(f"开始测试步骤''' + str(j+1) + ''' ''' + step_name + ''' 的操作==============")
'''
                        # 添加步骤前截图代码
                        code_content += before_screenshot_code
                        code_content += '''
                # 标签页跳转子步骤
                with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + ''' - 标签页跳转到: ''' + tab_target_url + '''"):
                    # 打开新标签页并导航到目标URL
                    log_info(f"[{task_id}] 正在打开新标签页: ''' + tab_target_url + '''")
                    new_page = await ui_operations.open_new_tab_and_navigate("''' + tab_target_url + '''")
                    # 获取所有标签页信息并确保切换到正确的标签页
                    all_tabs = await ui_operations.get_all_tabs()
                    time.sleep(1)  # 等待页面加载
                # URL断言子步骤
                with allure.step("测试步骤''' + str(j+1) + ''': 公共断言URL是否存在"):
                    await ui_operations.url_assert_exists("''' + tab_target_url + '''")
                # 元素断言子步骤
                with allure.step("测试步骤''' + str(j+1) + ''': 公共断言元素是否存在"):
                    await ui_operations.elem_assert_exists("'''+operation_params+'''")
'''
                        
                    # 添加自定义断言代码
                    assertion_code = generate_assertion_code(step, j+1)
                    if assertion_code:
                        code_content += assertion_code
                        
                    # 构造操作调用语句与文案后缀（web）
                    if operation_event in ['input', 'select_option', 'press_key', 'drag_and_drop']:
                        operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '", "' + input_value + '")'
                    elif operation_event in ['login']:
                        auth_cfg = step.get('auth_config', {}) or {}
                        current_addr = product_address
                        resolved_email = ''
                        resolved_password = ''
                        try:
                            # 初始化或获取当前地址的计数器（统一管理）
                            if current_addr not in address_account_counters:
                                address_account_counters[current_addr] = 0
                                
                            # 收集所有匹配当前地址的账号（从所有数据源）
                            all_matching_accounts = []
                                
                            # 1. 从accounts数组收集
                            for acc in auth_cfg.get('accounts', []) or []:
                                addr = (acc.get('address') or '').strip()
                                if addr and current_addr.strip().startswith(addr.strip()):
                                    all_matching_accounts.append(acc)
                                
                            # 2. 从address_credentials字典收集
                            if isinstance(auth_cfg.get('address_credentials'), dict):
                                for k, v in auth_cfg.get('address_credentials', {}).items():
                                    key = (k or '').strip()
                                    if key and current_addr.strip().startswith(key):
                                        account_info = {
                                            'address': key,
                                            'email': (v or {}).get('email', ''),
                                            'password': (v or {}).get('password', '')
                                        }
                                        all_matching_accounts.append(account_info)
                                
                            # 3. 从address_credentials_list数组收集
                            addr_list = auth_cfg.get('address_credentials_list', []) or []
                            for addr_cred in addr_list:
                                addr_cred_address = (addr_cred.get('address') or '').strip()
                                if addr_cred_address and current_addr.strip().startswith(addr_cred_address):
                                    all_matching_accounts.append(addr_cred)
                                
                            # 使用轮询机制分配账号
                            if all_matching_accounts:
                                # 使用轮询方式选择账号
                                account_index = address_account_counters[current_addr] % len(all_matching_accounts)
                                selected_account = all_matching_accounts[account_index]
                                resolved_email = selected_account.get('email', '')
                                resolved_password = selected_account.get('password', '')
                                    
                                # 更新计数器
                                address_account_counters[current_addr] += 1
                                log_info(f"地址 {current_addr} 使用第 {account_index + 1} 个账号: {resolved_email}（共{len(all_matching_accounts)}个账号）")
                                log_info(f"2当前的地址是{current_addr}，当前的邮箱是{resolved_email}，当前的密码是{resolved_password}, 账号索引:{account_index}")
                                
                            # 如果仍然没有找到匹配的凭据，使用第一个作为默认值
                            elif not resolved_email and isinstance(addr_list, list) and len(addr_list) > 0:
                                resolved_email = (addr_list[0] or {}).get('email', '')
                                resolved_password = (addr_list[0] or {}).get('password', '')
                        except Exception:
                            log_info(f"[{task_id}] 登录步骤{j+1} 操作失败")
                            pass
                        email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                        password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                        submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                        email = step.get('email', '') or resolved_email
                        password = step.get('password', '') or resolved_password
                        operation_invoke = 'await ui_operations.elem_login("' + email_selector + '","' + password_selector + '","' + submit_selector + '","' + email + '","' + password + '")'
                    
                    elif operation_event in ['register']:
                        auth_cfg = step.get('auth_config', {}) or {}
                        current_addr = product_address
                        resolved_email = ''
                        resolved_password = ''
                        try:
                            # 初始化或获取当前地址的计数器（统一管理）
                            if current_addr not in address_account_counters:
                                address_account_counters[current_addr] = 0
                            
                            # 收集所有匹配当前地址的账号（从所有数据源）
                            all_matching_accounts = []
                            
                            # 1. 从accounts数组收集
                            for acc in auth_cfg.get('accounts', []) or []:
                                addr = (acc.get('address') or '').strip()
                                if addr and current_addr.strip().startswith(addr.strip()):
                                    all_matching_accounts.append(acc)
                            
                            # 2. 从address_credentials字典收集
                            if isinstance(auth_cfg.get('address_credentials'), dict):
                                for k, v in auth_cfg.get('address_credentials', {}).items():
                                    key = (k or '').strip()
                                    if key and current_addr.strip().startswith(key):
                                        account_info = {
                                            'address': key,
                                            'email': (v or {}).get('email', ''),
                                            'password': (v or {}).get('password', '')
                                        }
                                        all_matching_accounts.append(account_info)
                            
                            # 3. 从address_credentials_list数组收集
                            addr_list = auth_cfg.get('address_credentials_list', []) or []
                            for addr_cred in addr_list:
                                addr_cred_address = (addr_cred.get('address') or '').strip()
                                if addr_cred_address and current_addr.strip().startswith(addr_cred_address):
                                    all_matching_accounts.append(addr_cred)
                            
                            # 使用轮询机制分配账号
                            if all_matching_accounts:
                                # 使用轮询方式选择账号
                                account_index = address_account_counters[current_addr] % len(all_matching_accounts)
                                selected_account = all_matching_accounts[account_index]
                                resolved_email = selected_account.get('email', '')
                                resolved_password = selected_account.get('password', '')
                                
                                # 更新计数器
                                address_account_counters[current_addr] += 1
                                
                                log_info(f"地址 {current_addr} 使用第 {account_index + 1} 个账号: {resolved_email}（共{len(all_matching_accounts)}个账号）")
                                log_info(f"2当前的地址是{current_addr}，当前的邮箱是{resolved_email}，当前的密码是{resolved_password}, 账号索引:{account_index}")
                            
                            # 如果仍然没有找到匹配的凭据，使用第一个作为默认值
                            elif not resolved_email and isinstance(addr_list, list) and len(addr_list) > 0:
                                resolved_email = (addr_list[0] or {}).get('email', '')
                                resolved_password = (addr_list[0] or {}).get('password', '')
                        except Exception:
                            log_info(f"[{task_id}] 登录步骤{j+1} 操作失败")
                            pass
                        email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                        password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                        repeat_password_selector = auth_cfg.get('repeat_password_selector', '').replace('"', "'")
                        submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                        email = resolved_email
                        password = resolved_password
                        operation_invoke = 'await ui_operations.elem_register(email_selector="' + email_selector + '",password_selector="' + password_selector + '",repeat_password_selector="' + repeat_password_selector + '",submit_selector="' + submit_selector + '",email="' + email + '",password="' + password + '")'
                    else:
                        operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '")'
                    code_content += '''
                # 操作执行子步骤
                with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + ''' - ''' + operation_event + ''' 操作 (''' + operation_params + ''')"):
                    time.sleep(''' + str(pause_time) + ''')
                    # 执行Web元素操作 ''' + str(operation_count) + ''' 次
                    for attempt in range(''' + str(operation_count) + '''):
                        # 检查浏览器是否已关闭
                        if await ui_operations.is_browser_closed():
                            log_info("检测到浏览器已关闭，''' + function_name + ''' 测试被用户中断")
                            raise Exception("BROWSER_CLOSED_BY_USER")
                        try:
                            log_info(f"[{task_id}] 执行第{attempt + 1}次操作: ''' + operation_event + ''' on ''' + operation_params + '''")
                            # 使用安全操作机制，带重试
                            ''' + operation_invoke + '''
                            time.sleep(1)  # 每次操作后等待1秒
                        except Exception as e:
                            # 检查是否是浏览器关闭导致的异常
                            error_msg = str(e).lower()
                            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                                log_info(f"[{task_id}] 检测到浏览器连接异常，''' + function_name + ''' 可能被用户关闭")
                                raise Exception("BROWSER_CLOSED_BY_USER")
                            log_info(f"[{task_id}]第{attempt + 1}次操作失败")
                            if attempt == ''' + str(operation_count) + ''' - 1:  # 最后一次尝试失败
                                log_info(f"所有操作均失败！")
                                ''' + failure_screenshot_code + '''
                time.sleep(1)  # 每次操作后等待1秒
''' + after_screenshot_code + '''
            
'''
                else:
                    # 无标签页跳转的Web操作 - 统一包装  
                        code_content += '''            # 测试步骤''' + str(j+1) + ''': ''' + step_name + ''' (操作次数: ''' + str(operation_count) + ''')
            with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + '''"):
                log_info(f"开始测试步骤''' + str(j+1) + ''' ''' + step_name + ''' 的操作==============")
'''
                        # 添加步骤前截图代码
                        code_content += before_screenshot_code
                        code_content += '''
                # 元素断言子步骤
                with allure.step("测试步骤''' + str(j+1) + ''': 公共断言元素是否存在"):
                    await ui_operations.elem_assert_exists("''' + operation_params + '''")
'''
                        # 添加自定义断言代码
                        assertion_code = generate_assertion_code(step, j+1)
                        if assertion_code:
                            code_content += assertion_code
                        # 构造操作调用语句与文案后缀（web）
                        if operation_event in ['input', 'select_option', 'press_key', 'drag_and_drop']:
                            operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '", "' + input_value + '")'
                        elif operation_event in ['login']:
                            auth_cfg = step.get('auth_config', {}) or {}
                            current_addr = product_address
                            resolved_email = ''
                            resolved_password = ''
                            try:
                                for acc in auth_cfg.get('accounts', []) or []:
                                    addr = (acc.get('address') or '').strip()
                                    if addr and current_addr.strip().startswith(addr.strip()):
                                        resolved_email = acc.get('email', '')
                                        resolved_password = acc.get('password', '')
                                        break
                                if not resolved_email and isinstance(auth_cfg.get('address_credentials'), dict):
                                    for k, v in auth_cfg.get('address_credentials', {}).items():
                                        key = (k or '').strip()
                                        if key and current_addr.strip().startswith(key):
                                            resolved_email = (v or {}).get('email', '')
                                            resolved_password = (v or {}).get('password', '')
                                            break
                                if not resolved_email:
                                    addr_list = auth_cfg.get('address_credentials_list', []) or []
                                    if isinstance(addr_list, list) and len(addr_list) > 0:
                                        resolved_email = (addr_list[0] or {}).get('email', '')
                                        resolved_password = (addr_list[0] or {}).get('password', '')
                            except Exception:
                                log_info(f"[{task_id}] 登录步骤{j+1} 操作失败")
                                pass
                            email_selector = auth_cfg.get('email_selector', '').replace('"', "'")
                            password_selector = auth_cfg.get('password_selector', '').replace('"', "'")
                            submit_selector = auth_cfg.get('submit_selector', '').replace('"', "'")
                            email = step.get('email', '') or resolved_email
                            password = step.get('password', '') or resolved_password
                            operation_invoke = 'await ui_operations.elem_login("' + email_selector + '","' + password_selector + '","' + submit_selector + '","' + email + '","' + password + '")'
                        else:
                            operation_invoke = 'await ui_operations.elem_' + operation_event + '("' + operation_params + '")'
                        code_content += '''
                # 操作执行子步骤
                with allure.step("测试步骤''' + str(j+1) + ''': ''' + step_name + ''' - ''' + operation_event + ''' 操作 (''' + operation_params + ''')"):
                    time.sleep(''' + str(pause_time) + ''')
                    # 执行Web元素操作 ''' + str(operation_count) + ''' 次
                    for attempt in range(''' + str(operation_count) + '''):
                        # 检查浏览器是否已关闭
                        if await ui_operations.is_browser_closed():
                            log_info("检测到浏览器已关闭，''' + function_name + ''' 测试被用户中断")
                            raise Exception("BROWSER_CLOSED_BY_USER")
                        try:
                            log_info(f"[{task_id}] 执行第{attempt + 1}次操作: ''' + operation_event + ''' on ''' + operation_params + '''")
                            # 使用安全操作机制，带重试
                            ''' + operation_invoke + '''
                            time.sleep(1)  # 每次操作后等待1秒
                        except Exception as e:
                            # 检查是否是浏览器关闭导致的异常
                            error_msg = str(e).lower()
                            if any(keyword in error_msg for keyword in ['target closed', 'browser has been closed', 'disconnected', 'session closed']):
                                log_info(f"[{task_id}] 检测到浏览器连接异常，'''+function_name+''' 可能被用户关闭")
                                raise Exception("BROWSER_CLOSED_BY_USER")
                            log_info(f"[{task_id}]第{attempt + 1}次操作失败")
                            if attempt == ''' + str(operation_count) + ''' - 1:  # 最后一次尝试失败
                                log_info(f"[{task_id}] 所有 '''+ str(operation_count) + ''' 次尝试都失败")
                                ''' + failure_screenshot_code + '''
                            raise Exception(f"元素操作失败：无法找到元素 '''+ operation_params + '''")
                time.sleep(1)  # 每次操作后等待1秒
            
'''
            code_content += '''            # 等待测试完成
            time.sleep(3)
            # 最终检查浏览器状态
            if await ui_operations.is_browser_closed():
                log_info("检测到浏览器已关闭，''' + function_name + ''' 无法截图")
                raise Exception("BROWSER_CLOSED_BY_USER")
            await ui_operations.page_screenshot("''' + function_name + '''","over_test_test_step_''' + str(j+1) + '''")
            time.sleep(2)
            # 输出图片识别统计信息
            stats = ui_operations.get_image_stats()
            log_info(f"[{task_id}] 图片识别统计: 截图识别成功 {stats['screenshot_success']} 次, "
                    f"pyautogui成功 {stats['pyautogui_success']} 次, "
                    f"总成功率 {stats['success_rate']:.2%}")
            log_info(f"[{task_id}] ''' + function_name + ''' 完成")
        except Exception as e:
            log_info(f"[{task_id}] ''' + function_name + ''' 失败")
            raise e
        finally:
            # 清理资源
            if page:
                await page.close()
            if context:
                await context.close()
            if browser:
                await browser.close()
            

'''
        
        # 生成动态并发执行函数
        concurrent_function = generate_concurrent_execution_function(product_addresses)
        code_content += concurrent_function
        
        # 写入文件
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(code_content)
            
    except Exception as e:
        log_info(f"更新多产品测试文件失败: {e}")

def generate_concurrent_execution_function(product_addresses):
    """根据产品地址数量动态生成并发执行函数"""
    function_calls = []
    has_multiple_products = len(product_addresses) > 1
    for i, (product_id, _) in enumerate(product_addresses):
        # 根据产品数量决定是否添加序号
        base_name = f"test_{product_id.replace('-', '_')}"
        function_name = f"{base_name}_{i+1}" if has_multiple_products else base_name
        function_calls.append(f"    task{i+1} = asyncio.create_task({function_name}(browser_args_list[{i}]))")
    
    # 生成任务列表
    task_list = ", ".join([f"task{i+1}" for i in range(len(product_addresses))])
    
    # 生成并发执行函数
    concurrent_code = f'''

@pytest.mark.asyncio
async def test_concurrent_independent_browsers():
    """
    并发执行 ''' + str(len(product_addresses)) + ''' 个完全独立的浏览器实例
    每个测试方法都会获得自己独立的浏览器进程
    """
    # 存储所有创建的任务，用于清理
    tasks = []
    try:
        log_info("开始并发执行 ''' + str(len(product_addresses)) + ''' 个独立浏览器实例")
        log_info("=" * 60)

        # 获取浏览器位置
        browser_count = ''' + str(len(product_addresses)) + '''  # 当前有''' + str(len(product_addresses)) + '''个测试方法
        browser_positions = screen_manager.get_browser_positions(browser_count)
        
        # 为每个位置生成浏览器参数
        browser_args_list = []
        for position in browser_positions:
            browser_args = screen_manager.get_browser_args(position, browser_count)
            browser_args_list.append(browser_args)

        # 打印布局信息
        screen_manager.print_layout_info(browser_count)
        
        # 创建 ''' + str(len(product_addresses)) + ''' 个独立的浏览器实例任务
        ''' + '\n        '.join([call.strip() for call in function_calls]) + '''
        
        log_info("创建了 ''' + str(len(product_addresses)) + ''' 个独立浏览器实例的测试任务")
        log_info("开始并发执行...")
        
        # 存储创建的任务
        tasks = [''' + task_list + ''']
        
        # 并发执行所有测试
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 处理结果
        success_count = 0
        failed_tests = []
        for i, result in enumerate(results, 1):
            if isinstance(result, Exception):
                error_msg = str(result)
                if "EPIPE" in error_msg:
                    log_info(f"测试 {i} 因管道通信中断而失败，这可能是由于浏览器被手动关闭")
                else:
                    log_info(f"测试 {i} 失败: {result}")
                failed_tests.append(f"测试 {i}: {result}")
            else:
                log_info(f"测试 {i} 成功完成")
                success_count += 1
        
        log_info(f"并发执行结果: {success_count}/{len(results)} 个测试成功")
        
        if success_count == len(results):
            log_info("所有测试都成功完成！")
        else:
            log_info("部分测试失败，请检查错误信息")
            # 获取当前项目ID
            project_id = os.environ.get('PROJECT_ID')
            if not project_id:
                log_info("无法获取当前项目ID，跳过取消接口调用")
            else:
                log_info(f"获取到项目ID: {project_id}")
            # 获取当前服务URL
            # 尝试从环境变量获取，如果没有则使用默认值
            service_host = os.environ.get('SERVICE_HOST', '127.0.0.1')
            service_port = os.environ.get('SERVICE_PORT', '5000')
            service_url = f"http://{service_host}:{service_port}"
            log_info(f"服务URL: {service_url}")
            # 调用取消接口
            try:
                cancel_url = f"{service_url}/api/automation/projects/{project_id}/cancel"
                log_info(f"调用取消接口: {cancel_url}")
                
                # 传递取消类型为 errors，表示测试运行异常
                payload = {"type": "errors"}
                response = requests.post(cancel_url, json=payload, timeout=10)
                
                if response.status_code == 200:
                    log_info("✅ 取消接口调用成功")
                else:
                    log_info(f"⚠️  取消接口调用失败，状态码: {response.status_code}")
            except Exception as e:
                log_info(f"❌ 调用取消接口时发生错误: {e}")
        # 如果有任何测试失败，抛出异常让pytest知道测试失败
    except Exception as e:
        raise Exception(f"并发测试失败: {', '.join(failed_tests)}")
    return results

'''
    
    return concurrent_code

@automation_bp.route('/projects/grouped', methods=['GET'])
def get_grouped_automation_projects():
    """获取按产品分组的自动化项目列表"""
    try:
        # 获取分组方式参数
        group_by = request.args.get('group_by', 'product_package_name')
        
        with get_db_connection_with_retry() as conn:
            # 首先获取所有产品
            products_query = adapt_query_placeholders('''
                SELECT DISTINCT product_package_name, product_id, `system_type`, product_type, environment, version_number
                FROM projects
                WHERE product_package_name IS NOT NULL AND product_package_name != ''
                ORDER BY product_package_name
            ''')
            products_results = execute_query_with_results(conn, products_query)
            
            # 初始化所有产品的分组 - 修复：使用product_package_name作为键进行分组
            grouped_projects = {}
            product_details = {}
            # 新增：建立 product_id -> [product_package_name] 的映射，便于回退分组
            product_id_to_package_names = {}
            
            # 使用 product_package_name + product_id 组合作为分组键
            for row in products_results:
                product_package_name = row[0]
                product_id = row[1]
                system_type = row[2]
                product_type = row[3]
                environment = row[4]
                version_number = row[5] if len(row) > 5 else ''
                
                # 根据分组方式生成分组键和显示名称
                if group_by == 'version_number':
                    group_key = (version_number or '未设置版本号')
                    # 版本分组：使用版本号作为名称，并提供稳定的字符串ID
                    product_details[group_key] = {
                        'product_id': group_key,
                        'product_name': group_key,
                        'system_type': system_type,
                        'product_type': product_type,
                        'environment': environment,
                        'version_number': group_key
                    }
                    if group_key not in grouped_projects:
                        grouped_projects[group_key] = []
                else:
                    # 默认按产品包名+产品ID组合分组
                    group_key = f"{product_package_name}#{product_id}"
                    product_details[group_key] = {
                        'product_id': product_id,
                        'product_name': product_package_name,  # 使用包名作为显示名称
                        'system_type': system_type,
                        'product_type': product_type,
                        'environment': environment,
                        'version_number': version_number
                    }
                    grouped_projects[group_key] = []
                
                # 建立映射（以字符串比较避免类型不一致）
                key = str(product_id) if product_id is not None else ''
                if key:
                    product_id_to_package_names.setdefault(key, []).append(group_key)
            
            # 获取所有自动化项目（包含 project_id 字段）
            projects_query = adapt_query_placeholders('''
                SELECT ap.id, ap.project_id, ap.process_name, ap.product_ids, ap.`system`, ap.product_type,
                       ap.environment, ap.product_address, ap.test_steps, ap.status,
                       ap.created_by, ap.created_at, ap.updated_at,
                       ap.product_package_names,
                       COUNT(ae.id) as execution_count,
                       MAX(ae.start_time) as last_start_time,
                       (SELECT status FROM automation_executions 
                        WHERE project_id = ap.id 
                        ORDER BY start_time DESC LIMIT 1) as last_status
                FROM automation_projects ap
                LEFT JOIN automation_executions ae ON ap.id = ae.project_id
                GROUP BY ap.id
                ORDER BY ap.updated_at DESC
            ''')
            projects_results = execute_query_with_results(conn, projects_query)
            
            # 将项目分配到对应的产品分组中
            for row in projects_results:
                project = {
                    'id': row[0],
                    'project_id': row[1],
                    'process_name': row[2],
                    'product_ids': json.loads(row[3]) if row[3] else [],
                    'system': row[4],
                    'product_type': row[5],
                    'environment': row[6],
                    'product_address': row[7],
                    'test_steps': json.loads(row[8]) if row[8] else [],
                    'status': row[9],
                    'created_by': row[10],
                    'created_at': row[11],
                    'updated_at': row[12],
                    'product_package_names': json.loads(row[13]) if row[13] else [],
                    'execution_count': row[14],
                    'last_start_time': row[15],
                    'last_status': row[16]
                }
            
                # 优先使用保存的产品包名信息进行分组
                assigned = False
                
                if group_by == 'version_number':
                    # 按版本号分组：需要查询产品的版本号信息
                    if project['product_ids']:
                        for product_id in project['product_ids']:
                            # 查询该产品的版本号
                            version_query = adapt_query_placeholders('''
                                SELECT version_number FROM projects WHERE product_id = ? LIMIT 1
                            ''')
                            version_result = execute_query_with_results(conn, version_query, (product_id,))
                            if version_result:
                                version_value = version_result[0][0]
                                group_key = (version_value if version_value else '未设置版本号')
                                if group_key not in grouped_projects:
                                    grouped_projects[group_key] = []
                                if group_key not in product_details:
                                    product_details[group_key] = {
                                        'product_id': group_key,
                                        'product_name': group_key,
                                        'system_type': '',
                                        'product_type': '',
                                        'environment': '',
                                        'version_number': group_key
                                    }
                                grouped_projects[group_key].append(project)
                                assigned = True
                                break
                else:
                    # 默认按产品包名+产品ID组合分组
                    # 1. 首先尝试使用product_package_names字段结合product_ids
                    if project['product_package_names'] and project['product_ids']:
                        for package_name in project['product_package_names']:
                            for product_id in project['product_ids']:
                                group_key = f"{package_name}#{product_id}"
                                if group_key in grouped_projects:
                                    grouped_projects[group_key].append(project)
                                    assigned = True
                                    break
                            if assigned:
                                break
                    
                    # 2. 回退：若没有 product_package_names，则尝试用 product_ids 映射到产品包名
                    if not assigned and project['product_ids']:
                        try:
                            for pid in project['product_ids']:
                                pid_key = str(pid)
                                if pid_key in product_id_to_package_names:
                                    for pkg in product_id_to_package_names[pid_key]:
                                        if pkg in grouped_projects:
                                            grouped_projects[pkg].append(project)
                                            assigned = True
                                            break
                                    if assigned:
                                        break
                        except Exception:
                            # 映射异常时忽略，进入未分组
                            pass
                
                # 3. 如果仍未分组，放入"未分组"
                if not assigned:
                    if '未分组' not in grouped_projects:
                        grouped_projects['未分组'] = []
                        product_details['未分组'] = {
                            'product_id': '',
                            'product_name': '未分组',
                            'system_type': '',
                            'product_type': '',
                            'environment': '',
                            'version_number': ''
                        }
                    grouped_projects['未分组'].append(project)
            
            # 构建最终结果
            result = []
            for package_name, project_list in grouped_projects.items():
                if package_name in product_details:  # 确保产品详细信息存在
                    product_info = product_details[package_name]
                    result.append({
                        'product_id': product_info['product_id'],
                        'product_name': product_info['product_name'],
                        'system_type': product_info['system_type'],
                        'product_type': product_info['product_type'],
                        'environment': product_info['environment'],
                        'version_number': product_info.get('version_number', ''),
                        'projects': project_list
                    })
            
            return jsonify({
                'success': True,
                'data': result
            })
        
    except Exception as e:
        log_info(f"获取分组项目列表失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"获取分组项目列表失败: {str(e)}"
        }), 500

@automation_bp.route('/auth-accounts', methods=['GET'])
def get_auth_accounts():
    try:
        project_id = request.args.get('project_id', type=int)
        if not project_id:
            return jsonify({'success': True, 'data': {'accounts': {}, 'accounts_list': []}})
        # 获取项目信息与文件映射
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('SELECT process_name, product_ids, product_address FROM automation_projects WHERE id = ?')
            row = execute_single_result(conn, query, (project_id,))
            if not row:
                return jsonify({'success': True, 'data': {'accounts': {}, 'accounts_list': []}})
            process_name = row[0]
            project_product_ids = row[1] if len(row) > 1 else None
            project_product_address = row[2] if len(row) > 2 else None
        mapping = file_manager.get_project_file_mapping(project_id)
        if mapping:
            accounts = read_accounts(process_name, mapping['file_name']) or {}
            accounts_list = read_accounts_list(process_name, mapping['file_name']) or []
            accounts_slots = read_accounts_slots(process_name, mapping['file_name']) or {}
            product_slots = read_product_address_slots(process_name, mapping['file_name']) or {}
        else:
            accounts, accounts_list, accounts_slots, product_slots = {}, [], {}, {}
        # 如果全部结构为空，则按项目的产品地址尝试全局查找一次进行回填
        all_empty = (len(accounts) == 0) and (len(accounts_list) == 0) and (len(accounts_slots) == 0)
        if all_empty:
            try:
                # 综合使用 product_ids 与 product_address，得到有效地址序列
                addresses_seq = []
                # 优先使用项目保存的 product_address（可保留重复与顺序）
                seq_from_product_address = []
                if project_product_address:
                    try:
                        decoded = json.loads(project_product_address)
                        if isinstance(decoded, list):
                            seq_from_product_address = [str(x).strip() for x in decoded]
                        elif isinstance(decoded, dict):
                            for _, value in decoded.items():
                                seq_from_product_address.append(str(value).strip())
                        elif isinstance(decoded, str) and decoded.strip():
                            seq_from_product_address = [decoded.strip()]
                    except Exception:
                        # 非JSON，按单地址处理
                        seq_from_product_address = [str(project_product_address).strip()]
                # 如未提供或解析为空，再回退到通过 product_ids 推导的地址
                seq_from_pairs = []
                if len(seq_from_product_address) == 0:
                    try:
                        parsed_pairs = get_project_product_addresses(project_product_ids, project_product_address) or []
                        if parsed_pairs:
                            seq_from_pairs = [str(addr).strip() for (_pid, addr) in parsed_pairs if addr]
                    except Exception:
                        seq_from_pairs = []
                addresses_seq = seq_from_product_address if len(seq_from_product_address) > 0 else seq_from_pairs
                # 进行全局查找
                if addresses_seq:
                    from utils.auth_accounts import lookup_accounts_for_addresses
                    lookup = lookup_accounts_for_addresses(addresses_seq) or {}
                    # 使用 lookup 的 accounts_list 构造槽位与映射，以便前端渲染
                    looked_accounts = lookup.get('accounts') or {}
                    looked_list = lookup.get('accounts_list') or []
                    # 回填 accounts（by_address）
                    if len(accounts) == 0 and isinstance(looked_accounts, dict):
                        accounts = looked_accounts
                    # 回填 accounts_list（by_order）
                    if len(accounts_list) == 0 and isinstance(looked_list, list):
                        accounts_list = looked_list
                    # 由 addresses_seq 与 looked_list 合成临时槽位
                    if len(accounts_slots) == 0 and len(addresses_seq) > 0 and len(looked_list) > 0:
                        from config.logger import log_info
                        log_info(f"[API] Generating temporary slots from looked_list. addresses_seq: {addresses_seq}, looked_list: {looked_list}")
                        tmp_slots = {}
                        tmp_product_slots = {}
                        # 将 looked_list 按 address 分组，保持原始顺序
                        items_by_address = {}
                        for it in looked_list:
                            try:
                                addr_key = (it.get('address') or '').strip()
                            except Exception:
                                addr_key = ''
                            if not addr_key:
                                continue
                            if addr_key not in items_by_address:
                                items_by_address[addr_key] = []
                            items_by_address[addr_key].append(it)
                        log_info(f"[API] items_by_address: {items_by_address}")
                        # 记录每个地址已经使用过的邮箱，避免同一地址重复
                        used_emails_by_addr = {}
                        idx = 0
                        for addr in addresses_seq:
                            slot_key = f"SCS_{idx+1}"
                            normalized_addr = (addr or '').strip()
                            tmp_product_slots[slot_key] = normalized_addr
                            if normalized_addr not in used_emails_by_addr:
                                used_emails_by_addr[normalized_addr] = set()
                            info = None
                            log_info(f"[API] Processing slot {slot_key} for address {normalized_addr}")
                            # 优先使用按地址分组的下一条未使用邮箱
                            if normalized_addr in items_by_address and len(items_by_address[normalized_addr]) > 0:
                                log_info(f"[API] Found {len(items_by_address[normalized_addr])} items for address {normalized_addr}")
                                while len(items_by_address[normalized_addr]) > 0:
                                    candidate = items_by_address[normalized_addr].pop(0) or {}
                                    cand_email = candidate.get('email', '')
                                    log_info(f"[API] Checking candidate: {candidate}, used_emails: {used_emails_by_addr[normalized_addr]}")
                                    if cand_email not in used_emails_by_addr[normalized_addr]:
                                        info = candidate
                                        log_info(f"[API] Selected candidate: {info}")
                                        break
                            # 退回使用按地址映射（若邮箱未被使用）
                            if not info and normalized_addr in looked_accounts:
                                candidate = looked_accounts.get(normalized_addr) or {}
                                cand_email = candidate.get('email', '')
                                if cand_email not in used_emails_by_addr[normalized_addr]:
                                    info = candidate
                                    log_info(f"[API] Using fallback candidate: {info}")
                            if info:
                                used_emails_by_addr[normalized_addr].add(info.get('email', ''))
                                tmp_slots[slot_key] = {
                                    'address': normalized_addr,
                                    'email': info.get('email', ''),
                                    'password': info.get('password', '')
                                }
                                log_info(f"[API] Created slot {slot_key}: {tmp_slots[slot_key]}")
                            else:
                                log_info(f"[API] No info found for slot {slot_key}")
                            idx += 1
                        accounts_slots = tmp_slots
                        log_info(f"[API] Final tmp_slots: {tmp_slots}")
                        log_info(f"[API] Final tmp_product_slots: {tmp_product_slots}")
                        # 仅当原 product_slots 为空时再提供临时映射
                        if len(product_slots) == 0:
                            product_slots = tmp_product_slots
            except Exception:
                pass
        return jsonify({'success': True, 'data': {'accounts': accounts, 'accounts_list': accounts_list, 'accounts_slots': accounts_slots, 'product_address_slots': product_slots}})
    except Exception as e:
        return jsonify({'success': False, 'message': f'获取账号数据失败: {str(e)}'}), 500

@automation_bp.route('/auth-accounts/generate', methods=['POST'])
def generate_auth_accounts():
    """为前端传入的地址列表生成唯一邮箱与密码，并返回明文。"""
    try:
        body = request.get_json(silent=True) or {}
        addresses = body.get('addresses') or []
        if not isinstance(addresses, list):
            return jsonify({'success': False, 'message': 'addresses 参数必须为数组'}), 400
        # 为所有地址逐项生成账号列表（保留重复与顺序）
        accounts_list = generate_unique_accounts_list_for_addresses(addresses)
        # 从列表派生按地址去重映射，确保与 accounts_list 一致（重复地址仅保留第一条）
        accounts_map = {}
        for addr, item in zip(addresses or [], accounts_list or []):
            key = (str(addr) if addr is not None else '').strip()
            if not key:
                continue
            if key not in accounts_map:
                accounts_map[key] = {
                    'email': (item or {}).get('email', ''),
                    'password': (item or {}).get('password', '')
                }
        return jsonify({'success': True, 'data': {'accounts': accounts_map, 'accounts_list': accounts_list}})
    except Exception as e:
        log_error(f"生成注册账号失败: {str(e)}")
        return jsonify({'success': False, 'message': f'生成注册账号失败: {str(e)}'}), 500

@automation_bp.route('/auth-accounts/lookup', methods=['POST'])
def lookup_auth_accounts_by_address():
    try:
        body = request.get_json(silent=True) or {}
        addresses = body.get('addresses') or []
        if not isinstance(addresses, list):
            return jsonify({'success': False, 'message': 'addresses 参数必须为数组'}), 400
        # 返回同时包含 accounts（按地址映射）与 accounts_list（全局顺序列表）
        from utils.auth_accounts import lookup_accounts_for_addresses
        data = lookup_accounts_for_addresses(addresses)
        return jsonify({'success': True, 'data': data})
    except Exception as e:
        return jsonify({'success': False, 'message': f'查询账号失败: {str(e)}'}), 500