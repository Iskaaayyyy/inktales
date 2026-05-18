@echo off
cd /d "%~dp0"
echo Installing dependencies...
npm install
echo.
if not exist .env copy .env.example .env
echo Starting InkVerse + InkTales...
echo Open http://localhost:3000/app.html after the server starts.
npm run dev
pause
