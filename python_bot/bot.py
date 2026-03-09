import os
import time
import random
import logging
import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

# Carrega varáveis do backend
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', 'backend', '.env'))

# Configurações de logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Configurações da API Backend (Node.js)
API_BASE_URL = "http://localhost:3000/api"

# Configurações do Bot
WHATSAPP_URL = "https://web.whatsapp.com"
MAX_WAIT_TIME = 60000 # 60 segundos

def type_like_human(page, text, is_priority=False):
    """Digita o texto, se for prioridade (atendimento), digita com atraso muito curto."""
    logging.info("Iniciando digitação...")
    for char in text:
        # Se for atendimento em tempo real, digita super rapido mas nao instataneo
        if is_priority:
            delay = random.uniform(0.01, 0.05)
        else:
            delay = random.uniform(0.05, 0.25)
            # Pausa maior em pontuações ou espaços
            if char in [' ', '.', ',', '!', '?']:
                delay += random.uniform(0.1, 0.4)
        
        page.keyboard.type(char, delay=int(delay * 1000))
    logging.info("Digitação concluída.")

def check_invalid_number_modal(page):
    """Verifica se o modal de número inválido apareceu."""
    try:
        # Seletor do texto indicando que o número é inválido (pode mudar dependendo das atualizações do WA)
        modal = page.wait_for_selector('div[role="dialog"]:has-text("inválido")', timeout=3000)
        if modal:
            # Clica no botão de fechar/OK do modal
            ok_button = page.query_selector('button:has-text("OK")')
            if ok_button:
                ok_button.click()
            return True
    except PlaywrightTimeoutError:
        return False
    return False

def send_message(page, phone, message, is_priority=False):
    """Tenta enviar a mensagem alterando conversas silenciosamente pelo DOM, evitando reloads da tela."""
    logging.info(f"Tentando iniciar conversa silenciosa com: {phone}")
    
    dom_success = False
    
    # 1. Tenta Busca Silenciosa via DOM
    try:
        # Clica no ícone de "Nova conversa" nativo do WhatsApp na aba esquerda
        new_chat_btn = page.locator('div[title="Nova conversa"], span[data-icon="chat"]').first
        new_chat_btn.click(timeout=5000)
        page.wait_for_timeout(1000) # Gaveta lateral abre
        
        # WhatsApp Web foca o teclado na pesquisa sozinho. Digita o numero procurado.
        page.keyboard.type(phone)
        page.wait_for_timeout(3000) # Tempo para processar o contato na agenda do celular remotamente
        
        page.keyboard.press("Enter") # Geralmente escolhe o usuario sugerido
        page.wait_for_timeout(1500)
        
        chat_box = page.locator('div[role="textbox"]').last
        if not chat_box.is_visible():
            # Tenta clicar no primeiro contato exibido pela pesquisa embaixo da busca
            first_contact = page.locator('div[role="listitem"]').first
            if first_contact.is_visible():
                first_contact.click(timeout=2000)
                page.wait_for_timeout(1500)
            else:
                page.keyboard.press("Escape") # Aborta barra lateral de busca e volta a tela default
                raise Exception("Sem resultados.")
                
        # Re-verifica se de fato o chat box da direita existiu após a tentativa de abrir
        if chat_box.is_visible():
            dom_success = True
            logging.info("Aberto silenciosamente via DOM com sucesso!")
        else:
            page.keyboard.press("Escape")
            raise Exception("Caixa de chat indetectável.")
            
    except Exception as e:
        logging.warning(f"Busca silenciosa DOM falhou. Recorrendo a URL e recarregamento...")

    # 2. Fallback de URL Padrão (Caso UI mude ou modal trave por alguma atualização do WhatsApp)
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
            logging.error("Tempo esgotado aguardando o chat carregar.")
            return False, "Timeout ao abrir o chat via URL."

    logging.info("Chat inicializado no painel. Preparando para digitar...")
    
    # Se a conversa existir no DOM, limpa o rascunho. O whatsapp cacheia conversas velhas as vezes na sua GUI
    # Como não recarregamos a URL, dar Esc ou Ctrl+A pode ser útil, mas por ora confiar no teclado.
    chat_box = page.locator('div[role="textbox"]').last
    chat_box.click()
    
    # Pausa anti-ban antes de começar a digitar (ignorado em atendimento)
    if not is_priority:
        time.sleep(random.uniform(1.0, 3.0))

    # Digita o texto humanamente ou velozmente baseada na prioridade
    type_like_human(page, message, is_priority)
    
    # Pausa anti-ban antes de clicar em enviar (ignorado em atendimento)
    if not is_priority:
        time.sleep(random.uniform(0.5, 1.5))
    
    # Tenta Clicar no botão ou Envia por Enter
    try:
        send_button = page.locator('button[aria-label="Enviar"]')
        if send_button.is_visible():
            send_button.click()
            logging.info("Mensagem enviada pelo Ícone de Enviar.")
        else:
            page.keyboard.press("Enter")
    except Exception:
        page.keyboard.press("Enter")
        
    # Espera escoar a animação do envio da mensagem no ar antes de seguir viagem
    time.sleep(random.uniform(1.0, 2.0))
    return True, "Enviado com sucesso."

def update_job_status(job_id, status, error=None):
    """Atualiza o status da mensagem através da API Node."""
    data = {"status": status}
    if error:
        data["error"] = error
    
    try:
        response = requests.put(f"{API_BASE_URL}/messages/{job_id}/status", json=data)
        response.raise_for_status()
        logging.info(f"Job {job_id} atualizado para status: {status}")
    except Exception as e:
        logging.error(f"Erro ao atualizar status do job {job_id}: {e}")

def stop_campaign(campaign_id, reason):
    """(Opcional) Poderíamos criar um endpoint /api/campaigns/stop."""
    logging.critical(f"ALERTA: A campanha {campaign_id} falhou devido a: {reason}")
    
def check_inbound_messages(page):
    """Checa a tela atual visível do WhatsApp buscando mensagens recebidas e as reporta para o painel de Atendimento."""
    try:
        # Pega as últimas 5 caixas de mensagem recebidas exibidas na tela
        inbound_elements = page.query_selector_all('div.message-in')[-5:]
        if not inbound_elements:
            return

        for el in inbound_elements:
            try:
                # O texto puro da mensagem
                text_el = el.query_selector('.copyable-text span[dir="ltr"]')
                if not text_el:
                    continue
                
                text = text_el.inner_text().strip()
                if not text:
                    continue
                
                # Extrai o metadado oculto que o WhatsApp salva informando a Data e Num de telefone
                meta_el = el.query_selector('[data-pre-plain-text]')
                meta_text = meta_el.get_attribute('data-pre-plain-text') if meta_el else ""
                
                phone_candidate = "Desconhecido"
                if meta_text and "]" in meta_text:
                    # Formato WA: [10:30, 20/05/2023] +55 51 9999-9999: 
                    contact_part = meta_text.split(']')[-1].strip().replace(':', '').strip()
                    phone_candidate = ''.join(filter(str.isdigit, contact_part))

                payload = {
                    "phone": phone_candidate,
                    "name": "",
                    "text": text,
                    "source": "python_worker"
                }

                # Ignora os silenciosos (ex. request ignorado pq repetido etc)
                requests.post(f"{API_BASE_URL}/messages/inbound", json=payload)
            except Exception as e:
                pass
                
    except Exception as e:
        pass # Falhas de dom não devem quebrar o bot


def main():
    logging.info("Iniciando o Worker Python do WhatsApp...")
    
    with sync_playwright() as p:
        # Usa o contexto de um navegador real para evitar ser banido.
        # Defina o userDataDir para salvar a sessão do WhatsApp e não ter que ler o QR code toda vez
        user_data_dir = os.path.join(os.getcwd(), "whatsapp_session")
        browser = p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=False # Mantenha False durante o desenvolvimento/testes
        )
        
        page = browser.new_page()
        page.goto(WHATSAPP_URL)
        logging.info("Aguarde a leitura do QR Code se for o primeiro acesso...")
        
        # Espera o usuário logar caso não esteja
        page.wait_for_selector('canvas', state='hidden', timeout=120000) # Se houver canvas QR code, espera sumir
        page.wait_for_selector('div#pane-side', timeout=120000) # Painel lateral de conversas provando que logou
        
        logging.info("WhatsApp logado com sucesso. Iniciando processamento da fila...")

        # Loop de processamento de fila
        while True:
            try:
                # 1. Puxa a requisição do backend
                response = requests.get(f"{API_BASE_URL}/messages/next")
                
                if response.status_code != 200:
                    logging.error(f"Erro na API ao buscar próxima mensagem: {response.text}")
                    time.sleep(5)
                    continue
                    
                data = response.json()
                job = data.get("job")
                is_priority = data.get("isPriority", False)
                
                
                if not job:
                    # Fila vazia - aproveita para ler mensagens do chat na tela antes do sleep.
                    check_inbound_messages(page)
                    time.sleep(5)
                    continue
                
                job_id = job.get("_id") # NodeJS usa _id
                phone = job.get("phone")
                message_text = job.get("processedMessage", "Mensagem vazia")
                campaign_id = job.get("campaign")
                
                # O Backend express, ao dar return do json("job"), automaticamente
                # já marca ela como "processing" no backend via o getNextJob. 
                logging.info(f"Iniciando job {job_id} para {phone} (Prioridade: {is_priority})")
                
                # 2. Executa o envio
                success, error_reason = send_message(page, phone, message_text, is_priority)
                
                if success:
                    # 3. Atualiza com sucesso
                    update_job_status(job_id, "sent")
                    
                    if not is_priority:
                        # Pausa anti-ban entre os envios bem-sucedidos
                        tempo_espera = random.randint(15, 45)
                        logging.info(f"Aguardando {tempo_espera}s de respiro antes da próxima mensagem da Campanha...")
                        time.sleep(tempo_espera)
                    else:
                        logging.info("Atendimento despachado instantaneamente. Indo checar o próximo da fila...")
                else:
                    # 4. Falha - tenta uma vez só e para toda a campanha conforme requisito
                    update_job_status(job_id, "failed", error_reason)
                    stop_campaign(campaign_id, f"Falha ao enviar para {phone}: {error_reason}")
                    logging.critical(f"Paralisando toda a fila devido ao erro na campanha {campaign_id}.")
                    
                    # Espera antes de uma eventual volta ou encerra o bot
                    time.sleep(60) 
            
            except Exception as e:
                logging.error(f"Erro inesperado no loop principal: {str(e)}")
                time.sleep(10)

if __name__ == "__main__":
    main()
