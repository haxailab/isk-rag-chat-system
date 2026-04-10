@echo off
cd /d "%~dp0"

set CLAUDE_CODE_USE_BEDROCK=1
set AWS_REGION=ap-northeast-1
set ANTHROPIC_MODEL=apac.anthropic.claude-sonnet-4-20250514-v1:0

echo [OK] CLAUDE_CODE_USE_BEDROCK=%CLAUDE_CODE_USE_BEDROCK%
echo [OK] AWS_REGION=%AWS_REGION%
echo [OK] ANTHROPIC_MODEL=%ANTHROPIC_MODEL%
echo.

call claude --dangerously-skip-permissions
if %errorlevel% neq 0 (
    echo.
    echo Error: %errorlevel%
    pause
)
