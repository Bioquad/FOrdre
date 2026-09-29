@echo off
rem FOrdre - servidor del taller per a Windows
rem Doble clic per arrencar-lo. Per aturar-lo, tanca aquesta finestra.
chcp 65001 >nul
title FOrdre - servidor del taller
cd /d "%~dp0\.."
where node >nul 2>nul
if errorlevel 1 (
    echo Cal instal·lar Node.js 18 o superior: https://nodejs.org  ^(versio LTS^)
    echo Despres, torna a fer doble clic a aquest fitxer.
    start https://nodejs.org
    pause
    exit /b 1
)
echo Si Windows pregunta pel tallafoc, permet l'acces a les xarxes privades.
node servidor\fordre-servidor.js %*
pause
