@echo off
chcp 65001 >nul
title 星火自动化测试平台

echo.
echo ============================================================
echo 🌟 星火自动化测试平台
echo ============================================================
echo.

echo 📦 检查Python环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未找到Python，请先安装Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo ✅ Python环境检查通过
echo.

echo 📦 安装依赖包...
pip install -r requirements.txt
if errorlevel 1 (
    echo ❌ 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)

echo ✅ 依赖安装完成
echo.

echo 🔧 检查数据库配置...
python -c "from config.database_config import get_current_db_config; config = get_current_db_config(); print(f'数据库类型: {config[\"type\"]}')" 2>nul
if errorlevel 1 (
    echo ⚠️  无法获取数据库配置，将使用默认配置
)

echo.
echo 🚀 启动应用...
echo 💡 提示: 按 Ctrl+C 停止应用
echo 🌐 访问地址: http://localhost:5000
echo 🔧 使用最新的启动方式: python scripts/quick_start.py
echo.

python scripts/quick_start.py

echo.
echo 👋 应用已停止
pause 