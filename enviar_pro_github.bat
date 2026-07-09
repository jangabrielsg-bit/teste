@echo off
chcp 65001 >nul
echo ===================================================
echo   ENVIAR ATUALIZACOES PARA O GITHUB (WMS SaaS)
echo ===================================================
echo.
git add .
set /p msg="O que voce alterou? (Digite a mensagem do commit): "
if "%msg%"=="" set msg="Atualizacao automatica do WMS SaaS"

echo.
echo Salvando localmente...
git commit -m "%msg%"

echo.
echo Enviando para o GitHub...
git push -u origin main

echo.
echo Concluido! Pressione qualquer tecla para fechar.
pause
