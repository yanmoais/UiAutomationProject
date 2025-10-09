from flask import Blueprint, request, jsonify
from config.database import get_db_connection_with_retry, execute_query_with_results, adapt_query_placeholders
import json
from datetime import datetime

report_bp = Blueprint('report', __name__, url_prefix='/api/report')

@report_bp.route('/product-packages', methods=['GET'])
def get_product_packages():
    """获取所有产品包名+产品ID组合列表"""
    try:
        # 从projects表获取所有产品包名和产品ID的组合
        query = adapt_query_placeholders('''
            SELECT DISTINCT product_package_name, product_id
            FROM projects
            WHERE product_package_name IS NOT NULL 
            AND product_package_name != ''
            ORDER BY product_package_name, product_id
        ''')
        
        results = execute_query_with_results(query)
        
        product_packages = []
        for row in results:
            package_name = row[0]
            product_id = row[1] if row[1] is not None else 'unknown'
            
            product_packages.append({
                'name': f"{package_name} (ID: {product_id})",
                'value': f"{package_name}|{product_id}",
                'package_name': package_name,
                'product_id': product_id
            })
        
        return jsonify({
            'success': True,
            'data': product_packages,
            'message': '获取产品包名列表成功'
        })
            
    except Exception as e:
        print(f"获取产品包名列表失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'获取产品包名列表失败: {str(e)}'
        }), 500

@report_bp.route('/generate', methods=['POST'])
def generate_test_report():
    """生成测试报告"""
    try:
        data = request.get_json()
        product_packages = data.get('product_packages', [])
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        
        if not product_packages:
            return jsonify({
                'success': False,
                'message': '请至少选择一个产品包名'
            }), 400
            
        if not start_date or not end_date:
            return jsonify({
                'success': False,
                'message': '请选择日期范围'
            }), 400
        
        # 解析产品包名+产品ID组合
        package_conditions = []
        params = []
        
        for package_combo in product_packages:
            if '|' in package_combo:
                package_name, product_id = package_combo.split('|', 1)
                # 验证这个组合在projects表中存在
                projects_query = adapt_query_placeholders('''
                    SELECT id FROM projects 
                    WHERE product_package_name = ? AND product_id = ?
                ''')
                project_results = execute_query_with_results(projects_query, [package_name, product_id])
                
                # 如果projects表中存在这个组合，则在automation_projects中查找对应的product_id
                if project_results:
                    # 匹配JSON数组中的product_id，考虑各种格式：["70050"], ["70050","70051"] 等
                    package_conditions.append("(ap.product_ids LIKE ? OR ap.product_ids LIKE ? OR ap.product_ids LIKE ? OR ap.product_ids LIKE ?)")
                    params.extend([
                        f'%["{product_id}"%',      # ["70050",...
                        f'%"{product_id}"]%',      # ...,"70050"]
                        f'%,"{product_id}",%',     # ...,"70050",...
                        f'%["{product_id}"]%'      # ["70050"]
                    ])
            else:
                # 兼容旧的仅产品包名的查询
                projects_query = adapt_query_placeholders('''
                    SELECT DISTINCT product_id FROM projects WHERE product_package_name = ?
                ''')
                project_results = execute_query_with_results(projects_query, [package_combo])
                
                if project_results:
                    for project_row in project_results:
                        product_id = str(project_row[0])  # 这是产品ID
                        package_conditions.append("(ap.product_ids LIKE ? OR ap.product_ids LIKE ? OR ap.product_ids LIKE ? OR ap.product_ids LIKE ?)")
                        params.extend([
                            f'%["{product_id}"%',      # ["70050",...
                            f'%"{product_id}"]%',      # ...,"70050"]
                            f'%,"{product_id}",%',     # ...,"70050",...
                            f'%["{product_id}"]%'      # ["70050"]
                        ])
        
        if not package_conditions:
            return jsonify({
                'success': False,
                'message': '未找到匹配的项目'
            }), 400
        
        # 查询automation_projects和automation_executions的联合数据
        query = adapt_query_placeholders(f'''
            SELECT 
                ap.id as project_id,
                ap.process_name,
                ap.product_ids,
                ap.product_package_names,
                ap.system,
                ap.environment,
                ap.product_address,
                ap.created_at as project_created_at,
                e.id as execution_id,
                e.status,
                e.start_time,
                e.end_time,
                e.log_message,
                e.detailed_log,
                e.executed_by
            FROM automation_projects ap
            LEFT JOIN automation_executions e ON ap.id = e.project_id
            WHERE ({' OR '.join(package_conditions)})
            AND e.start_time >= ? AND e.start_time <= ?
            ORDER BY ap.process_name, e.start_time DESC
        ''')
        
        # 添加日期范围参数
        params.extend([f'{start_date} 00:00:00', f'{end_date} 23:59:59'])
        
        results = execute_query_with_results(query, params)
        
        # 获取所选产品的详细信息用于显示
        selected_products_info = {}
        for package_combo in product_packages:
            if '|' in package_combo:
                package_name, product_id = package_combo.split('|', 1)
                selected_products_info[package_combo] = {
                    'package_name': package_name,
                    'product_id': product_id
                }
        
        # 组织数据结构：测试案例 -> 执行记录
        report_data = {}
        
        for row in results:
            project_id = row[0]
            process_name = row[1]
            product_ids = row[2] or ''
            product_package_names = row[3] or ''
            system = row[4]
            environment = row[5]
            product_address = row[6]
            project_created_at = row[7]
            execution_id = row[8]
            status = row[9]
            start_time = row[10]
            end_time = row[11]
            log_message = row[12]
            detailed_log = row[13]
            executed_by = row[14]
            
            # 创建测试案例键
            test_case_key = f"{project_id}_{process_name}"
            
            # 初始化数据结构
            if test_case_key not in report_data:
                report_data[test_case_key] = {
                    'project_id': project_id,
                    'process_name': process_name,
                    'product_ids': product_ids,
                    'product_package_names': product_package_names,
                    'system': system,
                    'environment': environment,
                    'product_address': product_address,
                    'project_created_at': project_created_at,
                    'executions': []
                }
            
            # 添加执行记录（如果存在）
            if execution_id:
                execution_data = {
                    'execution_id': execution_id,
                    'status': status,
                    'start_time': start_time,
                    'end_time': end_time,
                    'log_message': log_message,
                    'detailed_log': detailed_log,
                    'executed_by': executed_by
                }
                report_data[test_case_key]['executions'].append(execution_data)
        
        return jsonify({
            'success': True,
            'data': {
                'report_data': report_data,
                'date_range': {
                    'start_date': start_date,
                    'end_date': end_date
                },
                'selected_packages': product_packages,
                'selected_products_info': selected_products_info
            },
            'message': '报告生成成功'
        })
        
    except Exception as e:
        print(f"生成报告失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'生成报告失败: {str(e)}'
        }), 500 

@report_bp.route('/execution-summary', methods=['POST'])
def get_execution_summary():
    """获取自动化测试执行摘要"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': '请求数据不能为空'
            }), 400
        
        # 获取产品包名列表和日期范围
        product_packages = data.get('product_packages', [])
        date_range = data.get('date_range', '')
        

        
        if not product_packages:
            return jsonify({
                'success': False,
                'message': '产品包名列表不能为空'
            }), 400
        
        # 解析产品包名+产品ID组合
        package_conditions = []
        params = []
        
        for package_combo in product_packages:
            if '|' in package_combo:
                package_name, product_id = package_combo.split('|', 1)
                # 直接构建查询条件，不做projects表验证（因为数据可能不完全一致）
                # 匹配JSON数组中的product_id，考虑各种格式：["70050"], ["70050","70051"] 等
                package_conditions.append("(ap.product_ids LIKE ? OR ap.product_ids LIKE ? OR ap.product_ids LIKE ? OR ap.product_ids LIKE ?)")
                params.extend([
                    f'%["{product_id}"%',      # ["70050",...
                    f'%"{product_id}"]%',      # ...,"70050"]
                    f'%,"{product_id}",%',     # ...,"70050",...
                    f'%["{product_id}"]%'      # ["70050"]
                ])
            else:
                # 兼容旧的仅产品包名的查询
                projects_query = adapt_query_placeholders('''
                    SELECT DISTINCT product_id FROM projects WHERE product_package_name = ?
                ''')
                project_results = execute_query_with_results(projects_query, [package_combo])
                
                if project_results:
                    for project_row in project_results:
                        product_id = str(project_row[0])  # 这是产品ID
                        package_conditions.append("(ap.product_ids LIKE ? OR ap.product_ids LIKE ? OR ap.product_ids LIKE ? OR ap.product_ids LIKE ?)")
                        params.extend([
                            f'%["{product_id}"%',      # ["70050",...
                            f'%"{product_id}"]%',      # ...,"70050"]
                            f'%,"{product_id}",%',     # ...,"70050",...
                            f'%["{product_id}"]%'      # ["70050"]
                        ])
        
        if not package_conditions:
            return jsonify({
                'success': False,
                'message': '未找到匹配的产品包名和产品ID组合',
                'data': {
                    'total_executions': 0,
                    'passed': 0,
                    'failed': 0,
                    'success_rate': 0
                }
            })
        
        # 构建日期条件
        date_condition = ""
        if date_range and ',' in date_range:
            start_date, end_date = date_range.split(',', 1)
            date_condition = " AND ae.start_time BETWEEN ? AND ?"
            params.extend([start_date, end_date])
        
        # 构建最终查询
        package_condition_str = " OR ".join(package_conditions)
        
        query = adapt_query_placeholders(f'''
            SELECT 
                COUNT(*) as total_executions,
                COUNT(CASE WHEN ae.status = 'passed' THEN 1 END) as passed,
                COUNT(CASE WHEN ae.status = 'failed' THEN 1 END) as failed
            FROM automation_executions ae
            JOIN automation_projects ap ON ae.project_id = ap.id
            WHERE ({package_condition_str}){date_condition}
        ''')
        
        results = execute_query_with_results(query, params)
        
        if results and len(results) > 0:
            total_executions = results[0][0] or 0
            passed = results[0][1] or 0
            failed = results[0][2] or 0
            
            success_rate = round((passed / total_executions * 100), 2) if total_executions > 0 else 0
            
            return jsonify({
                'success': True,
                'data': {
                    'total_executions': total_executions,
                    'passed': passed,
                    'failed': failed,
                    'success_rate': success_rate
                },
                'message': '获取执行摘要成功'
            })
        else:
            return jsonify({
                'success': True,
                'data': {
                    'total_executions': 0,
                    'passed': 0,
                    'failed': 0,
                    'success_rate': 0
                },
                'message': '暂无执行数据'
            })
            
    except Exception as e:
        print(f"获取执行摘要失败: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'获取执行摘要失败: {str(e)}'
        }), 500 