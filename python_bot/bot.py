import os
import time
import random
import logging
import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', 'backend', '.env'))
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:3000/api")
API_SECRET_KEY = os.getenv("API_SECRET_KEY", "")
API_HEADERS = { 
    "Authorization": f"Bearer {API_SECRET_KEY}",
    "x-agent-id": "bot"
}
WHATSAPP_URL = "https://web.whatsapp.com"
MAX_WAIT_TIME = 60000
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

    # 1. Enviar Texto Primeiro (Independente)
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
            page.wait_for_timeout(1000)
        except Exception as e:
            logging.error(f"Erro ao enviar texto: {e}")

    # 2. Enviar Mídia Depois (Independente)
    if media and media.get('fileUrl'):
        file_url = media['fileUrl']
        file_name = media.get('fileName', 'anexo')
        mimetype = media.get('mimetype', '')
        temp_dir = os.path.join(os.getcwd(), 'tmp_media')
        os.makedirs(temp_dir, exist_ok=True)

        ext = os.path.splitext(file_name)[1]
        if not ext:
            if 'image' in mimetype: ext = '.jpg'
            elif 'video' in mimetype: ext = '.mp4'
            elif 'audio' in mimetype: ext = '.mp3'
            else: ext = '.bin'

        safe_name = f"media_{int(time.time())}{ext}"
        temp_path = os.path.join(temp_dir, safe_name)

        if download_file(file_url, temp_path):
            try:
                logging.info(f"Preparando envio de midia (Original): {temp_path} | Mime: {mimetype}")

                # 1. Tentar clicar no ícone de anexo (+) com timeout maior
                try:
                    attach_btn = page.locator('span[data-icon="plus"], span[data-icon="clip"], span[data-icon="attach-menu-plus"]').first
                    attach_btn.click(timeout=10000)
                    page.wait_for_timeout(1500)
                except Exception as e_menu:
                    logging.warning(f"Nao foi possivel abrir o menu de anexo (pode ja estar aberto): {e_menu}")

                # 2. Selecionar o input correto baseando-se no atributo 'accept'
                # Evitaremos a todo custo o input que aceite 'webp' (que é o de stickers)
                is_image_or_video = 'image' in mimetype or 'video' in mimetype
                
                try:
                    # Buscamos todos os inputs de arquivo
                    inputs = page.locator('input[type="file"]')
                    input_count = inputs.count()
                    target_input = None

                    for i in range(input_count):
                        # Verificamos o atributo 'accept' via JS
                        accept_attr = inputs.nth(i).get_attribute('accept') or ""
                        logging.debug(f"Input {i} accept: {accept_attr}")
                        
                        # Se queremos imagem/video, pegamos o que aceita image/* e NAO aceita webp
                        if is_image_or_video:
                            if 'image/*' in accept_attr and 'webp' not in accept_attr:
                                target_input = inputs.nth(i)
                                logging.info(f"Input {i} identificado como Galeria (Midia Real).")
                                break
                        else:
                            # Se for documento/audio, pegamos o que aceita * (ou o que sobrou que nao seja sticker)
                            if 'webp' not in accept_attr:
                                target_input = inputs.nth(i)
                                logging.info(f"Input {i} identificado para Documento/Audio.")
                                break

                    if not target_input:
                        logging.warning("Nao foi possivel identificar o input ideal. Usando fallback (primeiro input disponivel).")
                        target_input = inputs.first

                    # Injeta o arquivo
                    target_input.set_input_files(temp_path, timeout=12000)
                    logging.info("Arquivo injetado no input selecionado.")
                    
                except Exception as e_input:
                    logging.error(f"Falha ao selecionar/interagir com o input de arquivo: {e_input}")
                    # Tentativa desesperada de fallback via clique visual se o input falhar
                    try:
                        selector = 'span[data-icon="attach-image"]' if is_image_or_video else 'span[data-icon="attach-document"]'
                        with page.expect_file_chooser(timeout=10000) as fc_info:
                            page.locator(selector).first.click(timeout=5000)
                        file_chooser = fc_info.value
                        file_chooser.set_files(temp_path)
                    except Exception:
                        pass

                # 3. Aguarda o modal de preview aparecer e clica em enviar (ou Enter)
                page.wait_for_timeout(5000) # Buffer para carregar a mídia no modal
                page.keyboard.press("Enter")
                
                # Verificando se o botão de enviar ainda está lá (caso o Enter falhe)
                try:
                    send_btn = page.locator('span[data-icon="send"], button[aria-label="Enviar"]').first
                    if send_btn.is_visible(timeout=2000):
                        send_btn.click(timeout=3000)
                except Exception:
                    pass

                logging.info("Midia enviada com sucesso (via fluxo corrigido).")
                page.wait_for_timeout(2000)

                if os.path.exists(temp_path):
                    os.remove(temp_path)
                
            except Exception as e:
                logging.error(f"Erro no fluxo de midia: {e}")
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        else:
            logging.warning("Falha no download da midia.")

    return True, "Processo de envio finalizado."
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
        user_data_dir = os.path.join(os.getcwd(), "whatsapp_session")
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
        page = browser.new_page()
        page.goto(WHATSAPP_URL, timeout=60000)
        logging.info("Aguardando carregamento da página e verificando estado de login...")
        
        import base64
        while True:
            try:
                # logging.info("Checando estado do WhatsApp...") # Comentado para não poluir demais
                pane = page.locator('div#pane-side')
                if pane.is_visible():
                    logging.info("WhatsApp logado com sucesso. Status atualizado.")
                    requests.post(f"{API_BASE_URL}/bot/status", json={"status": "LOGGED_IN", "qrCodeBase64": None}, headers=API_HEADERS)
                    break
                
                qr_canvas = page.locator('canvas')
                if qr_canvas.is_visible():
                    logging.info("Canvas de QR Code detectado! Capturando screenshot...")
                    try:
                        qr_image_bytes = qr_canvas.screenshot(timeout=5000)
                        base64_encoded = base64.b64encode(qr_image_bytes).decode('utf-8')
                        base64_str = f"data:image/png;base64,{base64_encoded}"
                        logging.info("QR Code capturado e enviado ao backend.")
                        requests.post(f"{API_BASE_URL}/bot/status", json={"status": "AWAITING_QR", "qrCodeBase64": base64_str}, headers=API_HEADERS)
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
        while True:
            try:
                response = requests.get(f"{API_BASE_URL}/messages/next", headers=API_HEADERS)
                if response.status_code != 200:
                    logging.error(f"Erro na API ao buscar próxima mensagem: {response.text}")
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

                success, error_reason = send_message(page, phone, message_text, is_priority, media)
                if success:
                    update_job_status(job_id, "sent")
                    if not is_priority:
                        tempo_espera = random.randint(15, 45)
                        logging.info(f"Aguardando {tempo_espera}s de respiro antes da próxima mensagem da Campanha...")
                        time.sleep(tempo_espera)
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
                logging.error(f"Erro inesperado no loop principal: {str(e)}")
                time.sleep(10)
if __name__ == "__main__":
    main()