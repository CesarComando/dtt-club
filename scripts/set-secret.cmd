@echo off
rem Saves one secret into Supabase Edge Functions secrets.
rem Usage: scripts\set-secret.cmd STRIPE_SECRET_KEY
rem The value is typed/pasted by the user and is never stored in the repo.
if "%~1"=="" (
  echo Usage: scripts\set-secret.cmd SECRET_NAME
  exit /b 1
)
set "SECRET_VALUE="
set /p SECRET_VALUE=Paste value for %~1 and press Enter:
if "%SECRET_VALUE%"=="" (
  echo Nothing pasted - cancelled.
  exit /b 1
)
call npx.cmd supabase secrets set %~1=%SECRET_VALUE% --remote=latnwksisoziluhdadgy --yes
set "SECRET_VALUE="
