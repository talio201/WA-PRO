import os
import time
import random
import logging
import shutil
import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', 'backend', '.env'))
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
def normalize_secret(value):
    return str(value or "").strip().strip('"').strip("'")

API_BASE_URL = str(os.getenv("API_BASE_URL", "http://localhost:3000/api") or "").strip().rstrip('/')
API_SECRET_KEY = normalize_secret(os.getenv("BOT_API_KEY") or os.getenv("API_SECRET_KEY", ""))
BOT_AGENT_ID = str(os.getenv("BOT_AGENT_ID", "bot") or "bot").strip() or "bot"
API_HEADERS = { 
    "Authorization": f"Bearer {API_SECRET_KEY}",
    "x-agent-id": BOT_AGENT_ID
}
WHATSAPP_URL = "https://web.whatsapp.com"
MAX_WAIT_TIME = 120000  # 120 segundos para aguardar página carregar

if not API_SECRET_KEY:
    logging.critical("API_SECRET_KEY/BOT_API_KEY não definida. O bot não conseguirá autenticar na API.")
else:
    masked = f"{API_SECRET_KEY[:4]}...{API_SECRET_KEY[-4:]}" if len(API_SECRET_KEY) > 8 else "***"
    logging.info(f"Bot autenticando com x-agent-id={BOT_AGENT_ID} | key={masked} | api={API_BASE_URL}")
if BOT_AGENT_ID == "bot":
    logging.warning("BOT_AGENT_ID está como 'bot' (compartilhado). Para multiusuario real, execute uma instância do python_bot por agentId.")
def type_like_human(page, text, is_priority=False):
    logging.info("Iniciando digitação...")
    if text:
        page.keyboard.type(text[0])
        time.sleep(random.uniform(0.6, 1.2))
        for char in text[1:]:
            if is_priority:
                delay = random.uniform(0.05, 0.15)
                if char in [' ', '.', ',', '!', '?']:
                    delay += random.uniform(0.05, 0.1)
            else:
                delay = random.uniform(0.08, 0.25)
                if char in [' ', '.', ',', '!', '?']:
                    delay += random.uniform(0.1, 0.3)
            page.keyboard.type(char)
            time.sleep(delay)
    logging.info("Digitação concluída.")
def check_invalid_number_modal(page):
    try:
        modal = page.wait_for_selector('div[role="dialog"]:has-text("inválido")', timeout=3000)
        if modal:
            ok_button = page.query_selector('button:has-text("OK")')
            if ok_button:
                ok_button.click()
            return True
    except PlaywrightTimeoutError:
        return False
    return False
def download_file(url, target_path):
    try:
        logging.info(f"Baixando mídia de: {url}")
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
        with open(target_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        return True
    except Exception as e:
        logging.error(f"Erro ao baixar arquivo: {e}")
        return False

def send_message(page, phone, message, is_priority=False, media=None):
    logging.info(f"Tentando iniciar conversa silenciosa com: {phone}")
    dom_success = False
    try:
        new_chat_btn = page.locator('div[title="Nova conversa"], span[data-icon="chat"]').first
        new_chat_btn.click(timeout=5000)
        page.wait_for_timeout(1000) 
        page.keyboard.type(phone)
        page.wait_for_timeout(3000) 
        page.keyboard.press("Enter")
        page.wait_for_timeout(1500)
        chat_box = page.locator('#main div[role="textbox"]').last
        if not chat_box.is_visible():
            first_contact = page.locator('div[role="listitem"]').first
            if first_contact.is_visible():
                first_contact.click(timeout=2000)
                page.wait_for_timeout(1500)
            else:
                page.keyboard.press("Escape")
                raise Exception("Sem resultados.")
        if chat_box.is_visible():
            dom_success = True
            logging.info("Aberto silenciosamente via DOM com sucesso!")
        else:
            page.keyboard.press("Escape")
            raise Exception("Caixa de chat indetectável.")
    except Exception as e:
        logging.warning(f"Busca silenciosa DOM falhou. Recorrendo a URL e recarregamento...")

    if not dom_success:
        chat_url = f"{WHATSAPP_URL}/send/?phone={phone}"
        page.goto(chat_url)
        try:
            page.wait_for_selector('#main', timeout=MAX_WAIT_TIME)
            if check_invalid_number_modal(page):
                return False, "Número inválido ou sem WhatsApp."
        except PlaywrightTimeoutError:
            if check_invalid_number_modal(page):
                return False, "Número inválido ou sem WhatsApp."
            logging.error("Tempo esgotado aguardando o chat carregar.")
            return False, "Timeout ao abrir o chat via URL."

    logging.info("Chat aberto. Preparando envio...")

    # 1. Enviar Texto Primeiro (Mensagem Independente)
    if message:
        try:
            chat_box = page.locator('#main div[role="textbox"]').last
            chat_box.click(timeout=3000)
            if not is_priority:
                time.sleep(random.uniform(0.5, 1.2))
            type_like_human(page, message, is_priority)
            page.wait_for_timeout(400)
            page.keyboard.press("Enter")
            logging.info("Texto enviado com sucesso.")
            page.wait_for_timeout(1500)
        except Exception as e:
            logging.error(f"Erro ao enviar texto: {e}")

    # 2. Enviar Mídia via Simulação de 'Ctrl+V' (Paste) Universal
    if media and media.get('fileUrl'):
        file_url = media['fileUrl']
        file_name = media.get('fileName', 'arquivo.bin')
        mimetype = media.get('mimetype', 'application/octet-stream')
        
        temp_dir = os.path.join(os.getcwd(), 'tmp_media')
        os.makedirs(temp_dir, exist_ok=True)
        # Preservar o nome do arquivo se possível para o SO baixar corretamente
        ext = os.path.splitext(file_name)[1]
        safe_name = f"paste_{int(time.time())}{ext}"
        temp_path = os.path.join(temp_dir, safe_name)

        if download_file(file_url, temp_path):
            try:
                logging.info(f"Simulando Ctrl+V para arquivo: {file_name} ({mimetype})")
                import base64
                with open(temp_path, "rb") as f:
                    base64_data = base64.b64encode(f.read()).decode('utf-8')

                # Script JS Universal para injetar QUALQUER arquivo no Clipboard e disparar o Paste
                paste_script = """
                async (params) => {
                    const { base64Data, mimeType, fileName } = params;
                    const res = await fetch(`data:${mimeType};base64,${base64Data}`);
                    const blob = await res.blob();
                    
                    // Criamos o arquivo com o nome original para o WhatsApp reconhecer
                    const file = new File([blob], fileName, { type: mimeType });
                    
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    
                    const chatBox = document.querySelector('#main div[role="textbox"]');
                    if (chatBox) {
                        chatBox.focus();
                        const pasteEvent = new ClipboardEvent('paste', {
                            clipboardData: dataTransfer,
                            bubbles: true,
                            cancelable: true
                        });
                        chatBox.dispatchEvent(pasteEvent);
                        return true;
                    }
                    return false;
                }
                """
                
                success = page.evaluate(paste_script, {
                    "base64Data": base64_data, 
                    "mimeType": mimetype,
                    "fileName": file_name
                })
                
                if success:
                    logging.info(f"Evento 'Paste' para {file_name} disparado.")
                    # Aguarda o preview aparecer. Documentos e Vídeos podem demorar mais para carregar.
                    page.wait_for_timeout(6000)
                    page.keyboard.press("Enter")
                    logging.info("Mídia confirmada via Ctrl+V.")
                else:
                    logging.error("Falha ao localizar chatbox para o Paste.")

                page.wait_for_timeout(2000)
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                
            except Exception as e:
                logging.error(f"Erro no Paste universal: {e}")
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        else:
            logging.warning("Download falhou.")

    return True, "Processo concluido."
def update_job_status(job_id, status, error=None):
    data = {"status": status}
    if error:
        data["error"] = error
    try:
        response = requests.put(f"{API_BASE_URL}/messages/{job_id}/status", json=data, headers=API_HEADERS)
        response.raise_for_status()
        logging.info(f"Job {job_id} atualizado para status: {status}")
    except Exception as e:
        logging.error(f"Erro ao atualizar status do job {job_id}: {e}")
def stop_campaign(campaign_id, reason):
    logging.critical(f"ALERTA: A campanha {campaign_id} falhou devido a: {reason}")

def fetch_next_command():
    try:
        response = requests.get(f"{API_BASE_URL}/bot/commands/next", headers=API_HEADERS, timeout=5)
        if response.status_code != 200:
            if response.status_code == 401:
                logging.critical("Falha de autenticação ao consultar comandos do bot.")
            return None
        payload = response.json() or {}
        return payload.get("command")
    except Exception:
        return None

def execute_control_command(command, browser, user_data_dir):
    if not isinstance(command, dict):
        return None
    cmd_type = str(command.get("type") or "").strip().lower()
    if cmd_type == "skip_delay_once":
        reason = str((command.get("payload") or {}).get("reason") or "manual_skip_delay")
        logging.info(f"Comando recebido: pular espera anti-ban uma vez ({reason}).")
        return "skip_delay_once"

    if cmd_type != "disconnect_whatsapp":
        return None

    reason = str((command.get("payload") or {}).get("reason") or "manual_disconnect")
    logging.warning(f"Comando recebido: desconectar WhatsApp ({reason}).")

    try:
        requests.post(
            f"{API_BASE_URL}/bot/status",
            json={"status": "DISCONNECTED", "qrCodeBase64": None, "agentId": BOT_AGENT_ID},
            headers=API_HEADERS,
            timeout=5,
        )
    except Exception:
        pass

    try:
        browser.close()
    except Exception:
        pass

    try:
        shutil.rmtree(user_data_dir, ignore_errors=True)
    except Exception as e:
        logging.error(f"Falha ao limpar sessao local: {e}")

    logging.critical("Sessão removida por comando administrativo. Encerrando processo para reiniciar limpo.")
    raise SystemExit(0)


def get_campaign_delay_seconds(job):
    campaign_payload = job.get("campaign") if isinstance(job, dict) else None
    anti_ban = {}
    if isinstance(campaign_payload, dict):
        anti_ban = campaign_payload.get("antiBan") or {}

    min_delay = anti_ban.get("minDelaySeconds", 0)
    max_delay = anti_ban.get("maxDelaySeconds", 120)

    try:
        min_delay = int(float(min_delay))
    except Exception:
        min_delay = 0
    try:
        max_delay = int(float(max_delay))
    except Exception:
        max_delay = 120

    # Regra operacional: não exceder 120s de espera entre disparos
    min_delay = max(0, min(min_delay, 120))
    max_delay = max(0, min(max_delay, 120))
    if max_delay < min_delay:
        min_delay, max_delay = max_delay, min_delay

    if max_delay == min_delay:
        return min_delay

    preferred_mode = min_delay + int((max_delay - min_delay) * 0.25)
    delay_seconds = int(round(random.triangular(min_delay, max_delay, preferred_mode)))
    return max(0, delay_seconds)


def wait_with_command_poll(seconds, browser, user_data_dir):
    safe_seconds = max(0, int(seconds or 0))
    if safe_seconds <= 0:
        return False

    for _ in range(safe_seconds):
        time.sleep(1)
        command = fetch_next_command()
        if not command:
            continue
        cmd_result = execute_control_command(command, browser, user_data_dir)
        if cmd_result == "skip_delay_once":
            return True
    return False
def check_inbound_messages(page):
    try:
        inbound_elements = page.query_selector_all('div.message-in')[-5:]
        if not inbound_elements:
            return
        for el in inbound_elements:
            try:
                text_el = el.query_selector('.copyable-text span[dir="ltr"]')
                if not text_el:
                    continue
                text = text_el.inner_text().strip()
                if not text:
                    continue
                meta_el = el.query_selector('[data-pre-plain-text]')
                meta_text = meta_el.get_attribute('data-pre-plain-text') if meta_el else ""
                phone_candidate = "Desconhecido"
                if meta_text and "]" in meta_text:
                    contact_part = meta_text.split(']')[-1].strip().replace(':', '').strip()
                    phone_candidate = ''.join(filter(str.isdigit, contact_part))
                payload = {
                    "phone": phone_candidate,
                    "name": "",
                    "text": text,
                    "source": "python_worker"
                }
                requests.post(f"{API_BASE_URL}/messages/inbound", json=payload, headers=API_HEADERS)
            except Exception as e:
                pass
    except Exception as e:
        pass 
def scrape_history_for_job(page, phone):
    logging.info(f"Iniciando raspagem de historico para o numero {phone}")
    dom_success = False
    try:
        new_chat_btn = page.locator('div[title="Nova conversa"], span[data-icon="chat"]').first
        new_chat_btn.click(timeout=5000)
        page.wait_for_timeout(1000)
        page.keyboard.type(phone)
        page.wait_for_timeout(3000)
        page.keyboard.press("Enter")
        page.wait_for_timeout(1500)
        chat_box = page.locator('div[role="textbox"]').last
        if not chat_box.is_visible():
            first_contact = page.locator('div[role="listitem"]').first
            if first_contact.is_visible():
                first_contact.click(timeout=2000)
                page.wait_for_timeout(1500)
            else:
                page.keyboard.press("Escape")
                raise Exception("Sem resultados na busca.")
        if chat_box.is_visible():
            dom_success = True
    except Exception as e:
        logging.warning("Nao conseguiu abrir o chat pra historico via DOM. Tentando Fallback URL...")
    if not dom_success:
        chat_url = f"{WHATSAPP_URL}/send/?phone={phone}"
        page.goto(chat_url)
        try:
            page.wait_for_selector('div[role="textbox"]', timeout=MAX_WAIT_TIME)
            if check_invalid_number_modal(page):
                return False, "Número inválido ou sem WhatsApp."
        except PlaywrightTimeoutError:
            if check_invalid_number_modal(page):
                return False, "Número inválido ou sem WhatsApp."
            return False, "Timeout ao abrir o chat para historico."
    logging.info("Chat aberto para historico. Rolando para carregar mensagens passadas...")
    page.wait_for_timeout(2000)
    try:
        chat_box = page.locator('div[role="textbox"]').last
        chat_box.click()
        for _ in range(4):
             page.mouse.wheel(0, -3500)
             page.wait_for_timeout(800)
    except:
        pass
    messages_data = []
    msg_elements = page.query_selector_all('div.message-in, div.message-out')
    for el in msg_elements:
        try:
            direction = "inbound" if "message-in" in el.get_attribute("class") else "outbound"
            text_el = el.query_selector('.copyable-text span[dir="ltr"]')
            if not text_el:
                continue
            text = text_el.inner_text().strip()
            if not text:
                continue
            meta_el = el.query_selector('[data-pre-plain-text]')
            meta_text = meta_el.get_attribute('data-pre-plain-text') if meta_el else ""
            messages_data.append({
                "direction": direction,
                "text": text,
                "fingerprint": f"{direction}|{text}|{meta_text}",
                "at": meta_text 
            })
        except Exception as e:
            continue
    if not messages_data:
        return True, "Nenhuma mensagem legivel encontrada na tela."
    payload = {
        "phone": phone,
        "source": "python_history_sync",
        "messages": messages_data
    }
    try:
        res = requests.post(f"{API_BASE_URL}/messages/conversations/{phone}/history/sync", json=payload, headers=API_HEADERS)
        res.raise_for_status()
        logging.info(f"{len(messages_data)} itens de historico lidos e despachados com sucesso para o BD.")
        return True, "Historico raspado com sucesso."
    except Exception as e:
        logging.error(f"Erro ao enviar historico para API Node.js: {e}")
        return False, "Falha ao enviar historico para o backend Node."
def main():
    logging.info("Iniciando o Worker Python do WhatsApp...")
    with sync_playwright() as p:
        # Dinamic user data dir based on agent id for multi-session support
        session_folder = f"session_{BOT_AGENT_ID}"
        sessions_root = os.path.join(os.getcwd(), "whatsapp_session", "sessions")
        os.makedirs(sessions_root, exist_ok=True)
        user_data_dir = os.path.join(sessions_root, session_folder)
        browser = p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=True, 
            bypass_csp=True, 
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            args=[
                "--disable-blink-features=AutomationControlled", # Flag Crucial Anti-Ban: Oculta o navigator.webdriver
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
            ]
        )
        pages = browser.pages
        page = pages[0] if pages else browser.new_page()
        for extra_page in browser.pages[1:]:
            try:
                extra_page.close()
            except Exception:
                pass
        page.goto(WHATSAPP_URL, timeout=60000)
        logging.info("Aguardando carregamento da página e verificando estado de login...")
        
        import base64
        while True:
            try:
                # logging.info("Checando estado do WhatsApp...") # Comentado para não poluir demais
                pane = page.locator('div#pane-side')
                if pane.is_visible():
                    logging.info("WhatsApp logado com sucesso. Status atualizado.")
                    requests.post(f"{API_BASE_URL}/bot/status", json={"status": "LOGGED_IN", "qrCodeBase64": None, "agentId": BOT_AGENT_ID}, headers=API_HEADERS)
                    break
                
                qr_canvas = page.locator('canvas')
                if qr_canvas.is_visible():
                    logging.info("Canvas de QR Code detectado! Capturando screenshot...")
                    try:
                        qr_image_bytes = qr_canvas.screenshot(timeout=5000)
                        base64_encoded = base64.b64encode(qr_image_bytes).decode('utf-8')
                        base64_str = f"data:image/png;base64,{base64_encoded}"
                        logging.info("QR Code capturado e enviado ao backend.")
                        requests.post(f"{API_BASE_URL}/bot/status", json={"status": "AWAITING_QR", "qrCodeBase64": base64_str, "agentId": BOT_AGENT_ID}, headers=API_HEADERS)
                    except Exception as e_ss:
                        logging.warning(f"Falha ao capturar screenshot do QR (pode estar carregando): {e_ss}")
                    
                    time.sleep(3)
                else:
                    # logging.info("Nenhum estado detectado (nem logado, nem QR). Aguardando...")
                    time.sleep(2)
            except Exception as e:
                logging.error(f"Erro no laco de verificacao de QR Code: {e}")
                time.sleep(5)
                
        logging.info("WhatsApp pronto. Iniciando processamento da fila...")
        last_heartbeat = 0
        last_control_poll = 0
        HEARTBEAT_INTERVAL = 30  # seconds
        CONTROL_POLL_INTERVAL = 5
        skip_delay_once = False
        while True:
            try:
                job_id = None
                # Periodic heartbeat: re-post LOGGED_IN so backend restart doesn't show DISCONNECTED
                now_ts = time.time()
                if now_ts - last_heartbeat >= HEARTBEAT_INTERVAL:
                    try:
                        requests.post(f"{API_BASE_URL}/bot/status", json={"status": "LOGGED_IN", "qrCodeBase64": None, "agentId": BOT_AGENT_ID}, headers=API_HEADERS, timeout=5)
                        last_heartbeat = now_ts
                    except Exception as hb_err:
                        logging.warning(f"Heartbeat falhou: {hb_err}")

                if now_ts - last_control_poll >= CONTROL_POLL_INTERVAL:
                    command = fetch_next_command()
                    last_control_poll = now_ts
                    if command:
                        command_result = execute_control_command(command, browser, user_data_dir)
                        if command_result == "skip_delay_once":
                            skip_delay_once = True

                response = requests.get(f"{API_BASE_URL}/messages/next", headers=API_HEADERS)
                if response.status_code != 200:
                    if response.status_code == 401:
                        logging.critical(
                            "Falha de autenticação (401) em /messages/next. Verifique API_SECRET_KEY/BOT_API_KEY e reinicie os containers.",
                        )
                    else:
                        logging.error(f"Erro na API ao buscar próxima mensagem ({response.status_code}): {response.text}")
                    time.sleep(5)
                    continue
                data = response.json()
                job = data.get("job")
                is_priority = data.get("isPriority", False)
                if not job:
                    check_inbound_messages(page)
                    time.sleep(5)
                    continue
                job_id = job.get("_id")
                phone = job.get("phone")
                message_text = job.get("processedMessage", "Mensagem vazia")
                campaign = job.get("campaign")
                media = None
                campaign_id = None
                if isinstance(campaign, dict):
                    media = campaign.get("media")
                    campaign_id = campaign.get("_id")
                else:
                    campaign_id = campaign

                if not media:
                    media = job.get("media")

                logging.info(f"Iniciando job {job_id} para {phone} | Prioridade: {is_priority} | Midia: {bool(media)} | fileUrl: {media.get('fileUrl') if isinstance(media, dict) else None}")

                action = job.get("action", "send_message")
                if action == "history_sync":
                    success, error_reason = scrape_history_for_job(page, phone)
                    update_job_status(job_id, "sent" if success else "failed", error_reason if not success else None)
                    continue

                dispatch_started_at = time.time()
                success, error_reason = send_message(page, phone, message_text, is_priority, media)
                if success:
                    update_job_status(job_id, "sent")
                    if not is_priority:
                        if skip_delay_once:
                            logging.info("Envio imediato solicitado. Pulando espera anti-ban desta vez.")
                            skip_delay_once = False
                        else:
                            tempo_sorteado = get_campaign_delay_seconds(job)
                            tempo_processamento = max(0, int(round(time.time() - dispatch_started_at)))
                            tempo_espera = max(0, tempo_sorteado - tempo_processamento)
                            if tempo_sorteado > 0:
                                logging.info(
                                    f"Anti-ban sorteado: {tempo_sorteado}s | processamento: {tempo_processamento}s | espera restante: {tempo_espera}s"
                                )
                            if tempo_espera > 0:
                                interrupted = wait_with_command_poll(tempo_espera, browser, user_data_dir)
                                if interrupted:
                                    logging.info("Espera anti-ban interrompida por comando de disparo imediato.")
                            else:
                                logging.info("Sem espera adicional: próxima mensagem pode disparar imediatamente.")
                    else:
                        logging.info("Atendimento despachado instantaneamente. Indo checar o próximo da fila...")
                else:
                    update_job_status(job_id, "failed", error_reason)
                    if "Número inválido" in error_reason:
                        logging.warning(f"Número inválido ({phone}). Pulando e continuando a fila normalmente.")
                    else:
                        stop_campaign(campaign_id, f"Falha ao enviar para {phone}: {error_reason}")
                        logging.critical(f"Pausando a fila por alguns segundos devido a possível erro de conexão ou instabilidade ({error_reason}).")
                        time.sleep(30)
            except Exception as e:
                error_msg = f"Erro inesperado no loop principal: {str(e)}"
                logging.error(error_msg)
                # Reportar falha se há job_id em processamento
                try:
                    if 'job_id' in locals() and job_id:
                        update_job_status(job_id, "failed", error_msg)
                except Exception as update_err:
                    logging.error(f"Falha ao reportar erro para job {job_id}: {update_err}")
                time.sleep(10)
if __name__ == "__main__":
    main()