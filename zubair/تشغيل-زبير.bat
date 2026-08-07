@echo off
chcp 65001 >nul
setlocal
title زبير

echo.
echo   ============================================
echo     زبير — تنصيب وتشغيل
echo   ============================================
echo.

cd /d "%~dp0"

REM ---- ١) Node ----
where node >nul 2>nul
if errorlevel 1 (
  echo   [X]  Node.js NOT FOUND  -  Node.js غير منصّب
  echo.
  echo        Install from:  https://nodejs.org   ^(LTS, v22+^)
  echo        نزّله ثم أعد تشغيل هذا الملف.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo   [X]  Node TOO OLD  -  نسخة Node قديمة
  node -v
  echo        Need v22+  from  https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo   [1/3]  Node
node -v

REM ---- ٢) pnpm ----
where pnpm >nul 2>nul
if errorlevel 1 (
  echo   [2/3]  pnpm غير موجود — يُنصَّب الآن...
  call npm install -g pnpm
  if errorlevel 1 (
    echo   [X]  pnpm install failed  -  تعذّر تنصيب pnpm
    echo        Right-click this file  -^>  "Run as administrator"
    echo.
    pause
    exit /b 1
  )
) else (
  echo   [2/3]  pnpm
)
call pnpm -v

REM ---- ٣) الحزم ----
echo.
echo   [3/3]  تنزيل الحزم... ^(أول مرّة فقط، نحو دقيقة^)
echo.
call pnpm install
if errorlevel 1 (
  echo.
  echo   [X]  install failed  -  فشل التنصيب. انسخ ما فوق وأرسله.
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo     READY  -  جاهز. سيفتح المتصفّح تلقائياً.
echo     To stop: Ctrl+C   ^|   للإيقاف: Ctrl+C
echo   ============================================
echo.

call pnpm dev --open
pause
