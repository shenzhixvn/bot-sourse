@echo off
chcp 65001 >nul
echo ========================================
echo   BOT - 自动发布脚本
echo ========================================
echo.

REM 配置
set SERVER_IP=81.70.160.8
set SERVER_USER=root
set SSH_KEY=D:\SYSTEM\111.pem
set REMOTE_DIR=/var/www/update

echo [1/4] 正在打包应用...
call npm run build
if %errorlevel% neq 0 (
    echo ❌ 打包失败！
    pause
    exit /b 1
)
echo ✅ 打包完成
echo.

echo [2/4] 上传安装包和版本信息到服务器...
scp -i "%SSH_KEY%" -o StrictHostKeyChecking=no dist\*.exe %SERVER_USER%@%SERVER_IP%:%REMOTE_DIR%/
if %errorlevel% neq 0 (
    echo ❌ 上传安装包失败！
    pause
    exit /b 1
)

scp -i "%SSH_KEY%" -o StrictHostKeyChecking=no dist\latest.yml %SERVER_USER%@%SERVER_IP%:%REMOTE_DIR%/
if %errorlevel% neq 0 (
    echo ❌ 上传版本信息失败！
    pause
    exit /b 1
)
echo ✅ 上传完成
echo.

echo [3/4] 设置文件权限...
ssh -i "%SSH_KEY%" -o StrictHostKeyChecking=no %SERVER_USER%@%SERVER_IP% "chown -R www-data:www-data %REMOTE_DIR%; chmod -R 755 %REMOTE_DIR%"
echo ✅ 权限设置完成
echo.

echo [4/4] 验证服务器文件...
ssh -i "%SSH_KEY%" -o StrictHostKeyChecking=no %SERVER_USER%@%SERVER_IP% "ls -lh %REMOTE_DIR%/"
echo.

echo ========================================
echo   ✅ 发布完成！
echo ========================================
echo.
echo 更新服务器地址: https://bot.x6m.top/
echo 用户重启应用后将自动检测更新。
echo.
pause
