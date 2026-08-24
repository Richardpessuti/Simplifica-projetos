"""Envia notificação push via ntfy.sh (sem cadastro, sem chave de API).

Pra receber: instale o app ntfy (Android/iOS) ou abra https://ntfy.sh/<topico>
no navegador e assine o mesmo tópico configurado aqui / no NTFY_TOPICO.
"""
import requests

TOPICO_PADRAO = "simplifica-precos-eletro-r7k2m"


def notificar(mensagem, titulo="Preço de eletrodoméstico caiu", topico=None):
    topico = topico or TOPICO_PADRAO
    try:
        requests.post(
            f"https://ntfy.sh/{topico}",
            data=mensagem.encode("utf-8"),
            headers={"Title": titulo, "Priority": "default"},
            timeout=10,
        )
    except Exception as e:
        print(f"Falha ao notificar via ntfy: {e}")
