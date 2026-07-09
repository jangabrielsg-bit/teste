@echo off
chcp 65001 >nul
echo ========================================================
echo   FORCANDO O PRIMEIRO ENVIO PARA O GITHUB (WMS SaaS)
echo ========================================================
echo.
echo Isso vai resolver o "choque" de versões com o repositorio recem criado.
echo.
git push -u origin main --force
echo.
echo Se pedir login, por favor insira ou aprove no navegador!
echo Processo concluido. Voce pode apagar este arquivo depois que funcionar.
pause
