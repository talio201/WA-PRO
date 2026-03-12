import socket
from datetime import datetime
import sys

def scan_ports(target, start_port, end_port):
    try:
        target_ip = socket.gethostbyname(target)
    except socket.gaierror:
        print(f"\n[!] Erro: Host '{target}' não pôde ser resolvido.")
        return

    print("-" * 50)
    print(f"Varrendo alvo: {target_ip}")
    print(f"Hora de início: {datetime.now()}")
    print("-" * 50)

    try:
        for port in range(start_port, end_port + 1):
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            socket.setdefaulttimeout(0.5)
            
            result = s.connect_ex((target_ip, port))
            if result == 0:
                print(f"[+] Porta {port}: ABERTA")
            s.close()
            
    except KeyboardInterrupt:
        print("\nExiting program.")
        sys.exit()
    except socket.error:
        print("\nServer not responding.")
        sys.exit()

    print("-" * 50)
    print(f"Varredura finalizada em: {datetime.now()}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python port_scan.py <alvo> [porta_inicio] [porta_fim]")
        sys.exit()
        
    target = sys.argv[1]
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    end = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    
    scan_ports(target, start, end)
