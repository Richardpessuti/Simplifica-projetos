"""Encaminha requisições através de um serviço de scraping (ScraperAPI) pra
evitar o bloqueio que sites de varejo aplicam a IPs de nuvem/CI (GitHub
Actions, AWS, Azure etc.).

Sem a chave configurada (SCRAPERAPI_KEY), cai pra requisição direta — útil só
pra teste local numa rede doméstica, onde o bloqueio por IP normalmente não
acontece. Em produção (GitHub Actions), a chave é obrigatória pra os sites
grandes responderem de verdade.
"""
import os
import time

import requests

SCRAPERAPI_KEY = os.environ.get("SCRAPERAPI_KEY")
SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/"


def get_via_proxy(url_alvo, renderizar=False, premium=False, headers=None, timeout=60, tentativas=2):
    """GET em `url_alvo`, via ScraperAPI se houver chave configurada.

    `renderizar=True` pede pro ScraperAPI executar o JavaScript da página
    antes de devolver o HTML (necessário pra sites que montam a busca via
    JS) — consome mais créditos da conta e demora mais.

    `premium=True` usa o pool de proxy residencial do ScraperAPI — alguns
    domínios ("protected domains", na terminologia deles) recusam a
    requisição sem isso. Consome bem mais créditos que uma requisição
    simples, então só ativar nos sites que realmente precisam.

    Serviços de proxy de scraping falham/expiram de vez em quando por
    natureza (o pedido passa por uma camada extra de rede) — por isso tenta
    de novo uma vez antes de desistir.
    """
    ultimo_erro = None
    for tentativa in range(1, tentativas + 1):
        try:
            if SCRAPERAPI_KEY:
                params = {"api_key": SCRAPERAPI_KEY, "url": url_alvo}
                if renderizar:
                    params["render"] = "true"
                if premium:
                    params["premium"] = "true"
                r = requests.get(SCRAPERAPI_ENDPOINT, params=params, timeout=timeout)
            else:
                r = requests.get(url_alvo, headers=headers, timeout=timeout)
            if not r.ok:
                # inclui o corpo da resposta de erro (ScraperAPI costuma explicar
                # o motivo real — créditos esgotados, domínio fora do plano etc.)
                # em vez de só o código HTTP, que sozinho não diz muita coisa.
                raise RuntimeError(f"{r.status_code} do proxy: {r.text[:300]!r}")
            return r
        except Exception as e:
            ultimo_erro = e
            if tentativa < tentativas:
                time.sleep(3)
    raise ultimo_erro
