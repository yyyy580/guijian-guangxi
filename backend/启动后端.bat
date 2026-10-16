@echo off
chcp 936 >nul
title ������� �� ���������
cd /d "%~dp0"

echo ============================================
echo   ������� ���һ��������˫�����ɣ�
echo ============================================
echo.

set "LLM_PROVIDER=zhipu"
set "LLM_API_KEY="
set /p "LLM_API_KEY=��ճ������ API Key��ֱ�ӻس� = ��ʾģʽ��: "

if defined LLM_API_KEY (
    echo ==^> Key �����ã���������ʵ AI
) else (
    echo ==^> δ���� Key��������ʾģʽ
)

echo ==^> �����������״���� 1-2 ����...
echo ==^> �ɹ���־������ Started GuijianApplication
echo ==^> �������뱣�ִ򿪣��رմ��� = ֹͣ���
echo.

call mvn spring-boot:run

echo.
echo ==^> ������˳���������ʧ�ܣ���ѱ������Ϸ���ɫ�������շ�����ʦ��
pause