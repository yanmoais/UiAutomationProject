from flask import Flask, redirect, url_for, send_file, Response, send_from_directory, render_template, session, request
from flask_cors import CORS
from api.version_management import version_bp
from api.automation_management import automation_bp
from api.auth_management import auth_bp
from api.report_management import report_bp
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

    # 计算项目根目录，构建绝对路径，避免受当前工作目录或盘符影响
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    IMG_LOGS_DIR = os.path.join(BASE_DIR, 'IMG_LOGS')
    IMG_ASSERT_DIR = os.path.join(IMG_LOGS_DIR, 'IMA_ASSERT')
    GAME_IMG_DIR = os.path.join(BASE_DIR, 'Game_Img')
    
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
    
    # 确保上传目录存在（统一使用绝对路径）
    upload_abs = app.config['UPLOAD_FOLDER']
    if not os.path.isabs(upload_abs):
        upload_abs = os.path.join(BASE_DIR, upload_abs)
    os.makedirs(upload_abs, exist_ok=True)
    log_info(f"上传目录已创建: {upload_abs}")
    
    # 确保图片目录存在（与盘符无关）
    os.makedirs(GAME_IMG_DIR, exist_ok=True)
    os.makedirs(IMG_LOGS_DIR, exist_ok=True)
    os.makedirs(IMG_ASSERT_DIR, exist_ok=True)
    log_info(f"Game_Img目录: {GAME_IMG_DIR}")
    log_info(f"IMG_LOGS目录: {IMG_LOGS_DIR}")
    log_info(f"IMG_LOGS/IMA_ASSERT目录: {IMG_ASSERT_DIR}")
    
    # 初始化数据库
    log_info("正在初始化数据库...")
    init_db()
    log_info("数据库初始化完成")
    
    # 注册蓝图
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(version_bp, url_prefix='/api/version')
    app.register_blueprint(automation_bp, url_prefix='/api/automation')
    app.register_blueprint(report_bp)
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
        response = send_from_directory(GAME_IMG_DIR, filename)
        # 禁用缓存
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    
    # 添加Excel模板下载路由
    @app.route('/download/excel-template')
    def download_excel_template():
        try:
            import glob
            from datetime import datetime
            
            # 模板目录
            template_dir = os.path.join(BASE_DIR, 'Test_Data', 'Excel_model')
            
            # 查找所有 .xlsx 文件
            template_files = glob.glob(os.path.join(template_dir, '*.xlsx'))
            
            if not template_files:
                log_error(f"Excel模板目录中没有找到模板文件: {template_dir}")
                return "模板文件不存在", 404
            
            # 选择最新修改的文件
            template_path = max(template_files, key=os.path.getmtime)
            
            log_info(f"下载Excel模板: {template_path}")
            
            # 生成带时间戳的文件名
            timestamp = datetime.now().strftime('%Y%m%d%H%M')
            download_filename = f'测试步骤模板_{timestamp}.xlsx'
            
            return send_file(
                template_path,
                as_attachment=True,
                download_name=download_filename,
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
            
        except Exception as e:
            log_error(f"下载Excel模板失败: {str(e)}")
            return f"下载失败: {str(e)}", 500
    
    # 添加图片断言文件路由
    @app.route('/IMG_LOGS/IMA_ASSERT/<filename>')
    def assertion_img(filename):
        log_info(f"请求断言图片: {filename}")
        response = send_from_directory(IMG_ASSERT_DIR, filename)
        # 禁用缓存
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    
    # 添加测试截图文件路由
    @app.route('/IMG_LOGS/<filename>')
    def screenshot_img(filename):
        log_info(f"请求测试截图: {filename}")
        response = send_from_directory(IMG_LOGS_DIR, filename)
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