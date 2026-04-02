import os
import time
import subprocess
import requests
import logging
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', 'backend', '.env'))
logging.basicConfig(level=logging.INFO, format='%(asctime)s - [SUPERVISOR] - %(message)s')

API_BASE_URL = str(os.getenv("API_BASE_URL", "http://localhost:3000/api")).strip().rstrip('/')
API_SECRET_KEY = str(os.getenv("API_SECRET_KEY", "")).strip()
BOT_MASTER_KEY = str(os.getenv("BOT_API_KEY", "")).strip() or API_SECRET_KEY

API_HEADERS = { 
    "Authorization": f"Bearer {BOT_MASTER_KEY}",
    "x-agent-id": "bot"
}

active_processes = {}

def get_instances():
    try:
        res = requests.get(f"{API_BASE_URL}/bot/instances", headers=API_HEADERS, timeout=10)
        if res.status_code == 403:
            logging.error("Acesso Negado (403). Mestre API Key inválida.")
            return []
        res.raise_for_status()
        return res.json().get("instances", [])
    except Exception as e:
        logging.error(f"Erro ao consultar/checar API para instâncias: {e}")
        return []

MAX_WORKERS = 10 # Limite de instâncias simultâneas para evitar OOM (RAM alta)

def main():
    if not BOT_MASTER_KEY:
        logging.critical("API_SECRET_KEY/BOT_API_KEY mestre não definida! Cancelando.")
        return
        
    logging.info(f"Supervisor Multi-Tenant iniciado (Limite: {MAX_WORKERS} workers). Monitorando endpoints...")
    
    while True:
        instances = get_instances()
        allowed_agent_ids = set()
        
        # Filtra instâncias para não exceder o limite (opcional: priorizar admins ou ativos antigos)
        active_instances = instances[:MAX_WORKERS]
        
        for inst in active_instances:
            agent_id = inst.get("agentId")
            api_key = inst.get("apiKey") or BOT_MASTER_KEY
            allowed_agent_ids.add(agent_id)
            
            # Se não está rodando, inicie. (Ou se deu erro/morreu sozinho via .poll())
            if agent_id not in active_processes or active_processes[agent_id].poll() is not None:
                logging.info(f"==> Iniciando Worker Isolado | Cliente: {inst.get('name')} (ID: {agent_id})")
                cmd = [
                    "python", os.path.join(os.path.dirname(__file__), "bot.py"),
                    "--agent-id", agent_id,
                    "--api-key", api_key,
                    "--api-url", API_BASE_URL
                ]
                p = subprocess.Popen(cmd)
                active_processes[agent_id] = p
        
        # Elimina os que não estão mais na lista de ativos
        for running_agent in list(active_processes.keys()):
            proc = active_processes[running_agent]
            if running_agent not in allowed_agent_ids:
                logging.warning(f"<== Desligando instânca inativa: {running_agent}")
                proc.terminate()
                del active_processes[running_agent]
                
        time.sleep(15)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logging.info("Supervisor finalizado pelo usuario. Encerrando child processes...")
        for proc in active_processes.values():
            proc.terminate()