from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from config.database import get_db_connection_with_retry, execute_single_result, execute_insert_query, execute_query_without_results, adapt_query_placeholders
from config.logger import setup_logger, log_info, log_error, log_warning
from utils.db_adapter import adapt_query_result
import re
from datetime import datetime

auth_bp = Blueprint('auth', __name__)

# 设置日志记录器
logger = setup_logger('AuthAPI')

def validate_email(email):
    """验证邮箱格式"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    """验证密码强度"""
    if len(password) < 6:
        return False, "密码长度至少6位"
    return True, ""

@auth_bp.route('/register', methods=['POST'])
def register():
    """用户注册"""
    log_info("收到用户注册请求")
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '')
        confirm_password = data.get('confirmPassword', '')
        
        log_info(f"注册用户: {username}, 邮箱: {email}")
        
        # 验证输入
        if not username or not email or not password:
            log_warning("注册失败: 缺少必填字段")
            return jsonify({'success': False, 'message': '请填写所有必填字段'}), 400
        
        if len(username) < 3:
            log_warning(f"注册失败: 用户名长度不足 - {username}")
            return jsonify({'success': False, 'message': '用户名至少3个字符'}), 400
        
        if not validate_email(email):
            log_warning(f"注册失败: 邮箱格式错误 - {email}")
            return jsonify({'success': False, 'message': '邮箱格式不正确'}), 400
        
        is_valid, msg = validate_password(password)
        if not is_valid:
            log_warning(f"注册失败: 密码强度不足 - {msg}")
            return jsonify({'success': False, 'message': msg}), 400
        
        if password != confirm_password:
            log_warning("注册失败: 两次密码输入不一致")
            return jsonify({'success': False, 'message': '两次输入的密码不一致'}), 400
        
        # 检查用户名和邮箱是否已存在，并创建新用户
        with get_db_connection_with_retry() as conn:
            # 检查用户是否已存在
            query = adapt_query_placeholders('SELECT id FROM users WHERE username = ? OR email = ?')
            existing_user = execute_single_result(conn, query, (username, email))
            
            if existing_user:
                log_warning(f"注册失败: 用户名或邮箱已存在 - {username}/{email}")
                return jsonify({'success': False, 'message': '用户名或邮箱已存在'}), 400
            
            # 创建新用户
            password_hash = generate_password_hash(password)
            query = adapt_query_placeholders('INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
            execute_insert_query(conn, query, (username, email, password_hash, datetime.now()))
        
        log_info(f"用户注册成功: {username}")
        return jsonify({'success': True, 'message': '注册成功！请登录'}), 201
        
    except Exception as e:
        log_error(f"注册过程中发生错误: {str(e)}")
        return jsonify({'success': False, 'message': f'注册失败: {str(e)}'}), 500

@auth_bp.route('/login', methods=['POST'])
def login():
    """用户登录"""
    log_info("收到用户登录请求")
    try:
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        log_info(f"用户尝试登录: {username}")
        
        if not username or not password:
            return jsonify({'success': False, 'message': '请填写用户名和密码'}), 400
        
        # 验证用户并更新登录时间
        with get_db_connection_with_retry() as conn:
            query = adapt_query_placeholders('SELECT id, username, email, password_hash FROM users WHERE username = ? AND is_active = 1')
            raw_user = execute_single_result(conn, query, (username,))
            user = adapt_query_result(raw_user, ['id', 'username', 'email', 'password_hash']) if raw_user else None
            
            if not user or not check_password_hash(user['password_hash'], password):
                return jsonify({'success': False, 'message': '用户名或密码错误'}), 401
            
            # 更新最后登录时间
            query = adapt_query_placeholders('UPDATE users SET last_login = ? WHERE id = ?')
            execute_query_without_results(conn, query, (datetime.now(), user['id']))
        
        # 设置会话
        session.permanent = True
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['email'] = user['email']
        
        return jsonify({
            'success': True, 
            'message': '登录成功',
            'user': {
                'id': user['id'],
                'username': user['username'],
                'email': user['email']
            }
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'登录失败: {str(e)}'}), 500

@auth_bp.route('/logout', methods=['POST'])
def logout():
    """用户登出"""
    try:
        session.clear()
        return jsonify({'success': True, 'message': '登出成功'}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': f'登出失败: {str(e)}'}), 500

@auth_bp.route('/check-auth', methods=['GET'])
def check_auth():
    """检查用户认证状态"""
    try:
        if 'user_id' in session:
            return jsonify({
                'success': True,
                'authenticated': True,
                'user': {
                    'id': session['user_id'],
                    'username': session['username'],
                    'email': session['email']
                }
            }), 200
        else:
            return jsonify({
                'success': True,
                'authenticated': False
            }), 200
    except Exception as e:
        return jsonify({'success': False, 'message': f'检查认证状态失败: {str(e)}'}), 500

def login_required(f):
    """登录验证装饰器"""
    from functools import wraps
    from flask import session, jsonify
    
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'success': False, 'message': '请先登录'}), 401
        return f(*args, **kwargs)
    return decorated_function 