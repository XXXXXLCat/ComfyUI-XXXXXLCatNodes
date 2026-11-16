@echo off
setlocal
set "DEFAULT=E:\Comfy-Org\ComfyUI-Main\ComfyUI\custom_nodes"
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=%DEFAULT%"
for %%I in ("%~dp0..") do set "SRC=%%~fI"
set "DST=%TARGET%\ComfyUI_InfiniteCanvas"

if exist "%DST%" (
  echo [InfCanvas] Destination already exists: %DST%
  echo Nothing to do.
  exit /b 0
)
if not exist "%TARGET%" (
  echo [InfCanvas] custom_nodes directory not found: %TARGET%
  echo Usage: install.bat "C:\path\to\ComfyUI\custom_nodes"
  exit /b 1
)

mklink /J "%DST%" "%SRC%"
if errorlevel 1 (
  echo [InfCanvas] mklink failed. Run this script as administrator or create the junction manually.
  exit /b 1
)
echo [InfCanvas] Linked: %DST%  -^>  %SRC%
echo Restart ComfyUI to load the extension.
endlocal
