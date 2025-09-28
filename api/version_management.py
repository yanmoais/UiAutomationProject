from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename
from config.database import (
    get_db_connection_with_retry, 
    get_current_db_config,
    execute_insert_query_auto as execute_insert_query,
    execute_query_without_results_auto as execute_query_without_results,
    adapt_query_placeholders
)
import os
import uuid
from datetime import datetime

from utils.db_adapter import execute_query_with_results

version_bp = Blueprint('version', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

def allowed_file(filename):
    """检查文件扩展名是否被允许"""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@version_bp.route('/projects', methods=['GET'])
def get_projects():
    """获取所有项目列表"""
    try:
        with get_db_connection_with_retry() as conn:
            query = '''
                SELECT id, product_package_name, product_address, product_id, 
                       is_automated, version_number, product_image, 
                       system_type, product_type, environment, remarks
                FROM projects 
                ORDER BY id DESC
            '''
        
            # 使用适配器函数
            results = execute_query_with_results(conn, query)
        
        projects_list = []
        for row in results:
            project_dict = {
                'id': row[0],
                'product_package_name': row[1],
                'product_address': row[2],
                'product_id': row[3],
                'is_automated': row[4],
                'version_number': row[5],
                'product_image': row[6],
                'system_type': row[7],
                'product_type': row[8],
                'environment': row[9],
                'remarks': row[10]
            }
            projects_list.append(project_dict)
        
        return jsonify({
            'success': True,
            'data': projects_list,
            'message': '获取项目列表成功'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'获取项目列表失败: {str(e)}'
        }), 500

@version_bp.route('/projects', methods=['POST'])
def create_project():
    """创建新项目"""
    try:
        data = request.get_json()
        
        # 验证必填字段
        if not data.get('product_package_name') or not data.get('product_address') or not data.get('is_automated'):
            return jsonify({
                'success': False,
                'message': '产品包名、产品地址和是否自动化为必填项'
            }), 400
        
        query = adapt_query_placeholders('''
                INSERT INTO projects (product_package_name, product_address, product_id, 
                                    is_automated, version_number, product_image,
                                    system_type, product_type, environment, remarks)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''')
        
        params = (
                data['product_package_name'],
                data['product_address'],
                data.get('product_id', ''),
                data['is_automated'],
                data.get('version_number', ''),
                data.get('product_image', ''),
                data.get('system_type', ''),
                data.get('product_type', ''),
                data.get('environment', ''),
                data.get('remarks', '')
        )
        
        execute_insert_query(query, params)
        
        return jsonify({
            'success': True,
            'message': '项目创建成功'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'创建项目失败: {str(e)}'
        }), 500

@version_bp.route('/upload-image', methods=['POST'])
def upload_image():
    """上传游戏图片"""
    try:
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'message': '没有选择文件'
            }), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({
                'success': False,
                'message': '没有选择文件'
            }), 400
        
        if file and allowed_file(file.filename):
            # 生成唯一文件名
            filename = str(uuid.uuid4()) + '.' + file.filename.rsplit('.', 1)[1].lower()
            filepath = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            
            # 返回相对路径供前端使用
            return jsonify({
                'success': True,
                'data': {
                    'filename': filename,
                    'url': f'/static/uploads/{filename}'
                },
                'message': '图片上传成功'
            })
        else:
            return jsonify({
                'success': False,
                'message': '不支持的文件格式，请上传PNG、JPG、JPEG或GIF格式的图片'
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'图片上传失败: {str(e)}'
        }), 500

@version_bp.route('/projects/<int:project_id>', methods=['PUT'])
def update_project(project_id):
    """更新项目信息"""
    try:
        data = request.get_json()
        
        query = adapt_query_placeholders(f'''
                UPDATE projects 
                SET product_package_name = ?, product_address = ?, product_id = ?,
                    is_automated = ?, version_number = ?, product_image = ?,
                system_type = ?, product_type = ?, environment = ?, remarks = ?
                WHERE id = ?
        ''')
        
        params = (
            data.get('product_package_name', ''),
            data.get('product_address', ''),
                data.get('product_id', ''),
            data.get('is_automated', 0),
                data.get('version_number', ''),
                data.get('product_image', ''),
                data.get('system_type', ''),
                data.get('product_type', ''),
                data.get('environment', ''),
                data.get('remarks', ''),
                project_id
        )
        
        execute_query_without_results(query, params)
        
        return jsonify({
            'success': True,
            'message': '项目更新成功'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'项目更新失败: {str(e)}'
        }), 500

@version_bp.route('/projects/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    """删除项目"""
    try:
        query = adapt_query_placeholders('DELETE FROM projects WHERE id = ?')
        execute_query_without_results(query, (project_id,))
        
        return jsonify({
            'success': True,
            'message': '项目删除成功'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'项目删除失败: {str(e)}'
        }), 500

@version_bp.route('/projects/<int:project_id>/update-image', methods=['POST'])
def update_project_image(project_id):
    """更新项目图片路径"""
    try:
        data = request.get_json()
        image_path = data.get('image_path', '')
        
        query = adapt_query_placeholders('''
            UPDATE projects 
            SET product_image = ?
            WHERE id = ?
        ''')
        
        execute_query_without_results(query, (image_path, project_id))
        
        return jsonify({
            'success': True,
            'message': '项目图片更新成功'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'项目图片更新失败: {str(e)}'
        }), 500

@version_bp.route('/enum-values/<field_name>', methods=['GET'])
def get_enum_values(field_name):
    """获取指定字段的枚举值"""
    try:
        from config.database import get_enum_values as get_enum_values_func
        values = get_enum_values_func(field_name)
        
        return jsonify({
            'success': True,
            'data': values,
            'message': f'获取{field_name}枚举值成功'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'获取枚举值失败: {str(e)}'
        }), 500

@version_bp.route('/enum-values', methods=['POST'])
def add_enum_value():
    """添加新的枚举值"""
    try:
        data = request.get_json()
        field_name = data.get('field_name')
        field_value = data.get('field_value')
        
        if not field_name or not field_value:
            return jsonify({
                'success': False,
                'message': '字段名和字段值不能为空'
            }), 400
        
        from config.database import add_enum_value as add_enum_value_func
        success = add_enum_value_func(field_name, field_value)
        
        if success:
            return jsonify({
                'success': True,
                'message': '枚举值添加成功'
            })
        else:
            return jsonify({
                'success': False,
                'message': '枚举值可能已存在'
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'添加枚举值失败: {str(e)}'
        }), 500 