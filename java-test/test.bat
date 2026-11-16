@echo off
cd /d "%~dp0"
echo.
java -jar "%~dp0JreTest.jar"
echo.
echo Code de sortie : %ERRORLEVEL%
echo.
pause
