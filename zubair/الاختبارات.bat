@echo off
chcp 65001 >nul
title زبير — الاختبارات
cd /d "%~dp0"
echo.
echo   ٣٤٣ اختباراً + الامتحان المجمَّد — نحو دقيقتين
echo.
call pnpm test
echo.
call pnpm exam
echo.
pause
