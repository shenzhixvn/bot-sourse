@echo off
chcp 65001 >nul
title BOT 本地 Whisper 语音识别服务

echo ============================================================
echo   BOT - 本地 Whisper 语音识别服务
echo ============================================================
echo.

REM 使用用户安装的 Python 3.13（避免沙箱 Python 冲突）
set PYTHON_EXE=C:\Users\shenz\AppData\Local\Programs\Python\Python313\python.exe

REM 检查 Python 是否存在
if not exist "%PYTHON_EXE%" (
    echo [错误] 未找到 Python 3.13，请检查安装路径
    pause
    exit /b 1
)

REM 检查依赖是否安装
"%PYTHON_EXE%" -c "import faster_whisper" >nul 2>&1
if errorlevel 1 (
    echo [信息] 首次运行，正在安装依赖...
    echo.
    "%PYTHON_EXE%" -m pip install faster-whisper fastapi uvicorn python-multipart
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
    echo.
    echo [信息] 依赖安装完成
    echo.
)

REM 启动服务
echo [信息] 启动本地语音识别服务...
echo [信息] 首次启动会自动下载模型文件（约 100MB），请耐心等待
echo.
"%PYTHON_EXE%" "%~dp0local_whisper_server.py" --model base

pause
