@echo off
REM Respaldo local de "Cotejo facial PIT-TA-2026" por si pit-ta-2026-cotejo.netlify.app no carga.
REM Doble clic en este archivo. Necesita Node.js instalado (nodejs.org).
cd /d "%~dp0"
echo Iniciando el cotejo facial en este equipo...
echo Cuando diga "Accepting connections", abre esa direccion en el navegador.
npx --yes serve -l 5173 .
pause
