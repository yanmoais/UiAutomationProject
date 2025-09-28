from flask import Flask, redirect, url_for, send_file, Response, send_from_directory, render_template, session, request
from flask_cors import CORS
from api.version_management import version_bp
from api.automation_management import automation_bp
from api.auth_management import auth_bp
from config.database import init_db
from config.logger import setup_logger, log_info, log_error, log_warning
from config.database_config import get_current_db_config
import os
import secrets

def create_app():
    # 设置日志记录器
    logger = setup_logger('FlaskApp')
    log_info("正在创建Flask应用...")
    
    app = Flask(__name__)
    
    # 配置会话密钥（使用固定密钥以保持session）
    app.secret_key = 'your-secret-key-here-12345'
    
    # 配置session
    app.config['PERMANENT_SESSION_LIFETIME'] = 86400  # 24小时
    
    # 启用CORS支持前后端分离，但允许credentials
    CORS(app, supports_credentials=True)
    
    # 禁用静态文件缓存（解决304重定向问题）
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    
    # 配置上传文件夹
    app.config['UPLOAD_FOLDER'] = 'static/uploads'
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
    
    # 确保上传目录存在
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    log_info(f"上传目录已创建: {app.config['UPLOAD_FOLDER']}")
    
    # 确保Game_Img目录存在
    os.makedirs('Game_Img', exist_ok=True)
    log_info("Game_Img目录已创建")
    
    # 初始化数据库
    log_info("正在初始化数据库...")
    init_db()
    log_info("数据库初始化完成")
    
    # 注册蓝图
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(version_bp, url_prefix='/api/version')
    app.register_blueprint(automation_bp, url_prefix='/api/automation')
    log_info("所有蓝图已注册完成")
    
    # 添加根路径重定向
    @app.route('/')
    def index():
        if 'user_id' in session:
            log_info("访问根路径（已登录），重定向到主页")
            return redirect('/static/index.html')
        else:
            log_info("访问根路径（未登录），重定向到登录页")
            return redirect('/login')
    
    # 添加登录页面路由
    @app.route('/login')
    def login_page():
        if 'user_id' in session:
            log_info("访问登录页面（已登录），重定向到主页")
            return redirect('/')
        log_info("访问登录页面")
        return render_template('login.html')
    
    # 添加注册页面路由
    @app.route('/register')
    def register_page():
        log_info("访问注册页面")
        return render_template('register.html')
    
    # 添加Game_Img静态文件路由
    @app.route('/Game_Img/<filename>')
    def game_img(filename):
        log_info(f"请求游戏图片: {filename}")
        response = send_from_directory('Game_Img', filename)
        # 禁用缓存
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    
    # 添加图片断言文件路由
    @app.route('/IMG_LOGS/IMA_ASSERT/<filename>')
    def assertion_img(filename):
        log_info(f"请求断言图片: {filename}")
        response = send_from_directory('IMG_LOGS/IMA_ASSERT', filename)
        # 禁用缓存
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    
    # 添加测试截图文件路由
    @app.route('/IMG_LOGS/<filename>')
    def screenshot_img(filename):
        log_info(f"请求测试截图: {filename}")
        response = send_from_directory('IMG_LOGS', filename)
        # 禁用缓存
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    
    # 添加favicon路由
    @app.route('/favicon.ico')
    def favicon():
        # 创建一个简单的SVG图标
        svg_content = '''<?xml version="1.0" encoding="UTF-8"?>
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" fill="#4A90E2"/>
  <circle cx="16" cy="12" r="6" fill="#FFFFFF"/>
  <rect x="10" y="18" width="12" height="8" rx="2" fill="#FFFFFF"/>
  <rect x="12" y="20" width="2" height="4" fill="#4A90E2"/>
  <rect x="18" y="20" width="2" height="4" fill="#4A90E2"/>
  <circle cx="13" cy="10" r="1" fill="#4A90E2"/>
  <circle cx="19" cy="10" r="1" fill="#4A90E2"/>
</svg>'''
        return Response(svg_content, mimetype='image/svg+xml')
    
    # 添加全局静态文件缓存控制
    @app.after_request
    def after_request(response):
        # 对所有静态文件禁用缓存
        if request.path.startswith('/static/'):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response
    
    log_info("Flask应用创建完成")
    return app

if __name__ == '__main__':
    log_info("=" * 50)
    log_info("星火自动化测试平台启动中...")
    log_info("=" * 50)
    
    # 显示当前数据库配置
    try:
        config = get_current_db_config()
        log_info(f"当前数据库类型: {config['type']}")
        if config['type'] == 'mysql':
            log_info(f"MySQL配置: {config['config']['host']}:{config['config']['port']}")
        else:
            log_info("SQLite配置: 本地文件")
    except Exception as e:
        log_warning(f"无法获取数据库配置: {e}")
    
    app = create_app()
    log_info("应用启动成功，监听地址: http://0.0.0.0:5000")
    log_info("💡 提示: 建议使用 python scripts/quick_start.py 启动应用")
    log_info("按 Ctrl+C 停止应用")
    log_info("-" * 50)
    
    app.run(debug=True, host='0.0.0.0', port=5000) 