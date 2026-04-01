# Usando a imagem oficial do Playwright com dependências do sistema já instaladas
FROM mcr.microsoft.com/playwright/python:v1.42.0-jammy

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Instalar os browsers do Playwright
RUN playwright install chromium

COPY . .

CMD ["python", "supervisor.py"]
