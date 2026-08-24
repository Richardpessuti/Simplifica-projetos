"""Encaminha requisições através de um serviço de scraping (ScraperAPI) pra
evitar o bloqueio que sites de varejo aplicam a IPs de nuvem/CI (GitHub
Actions, AWS, Azure etc.).

Sem a chave configurada (SCRAPERAPI_KEY), cai pra requisição direta — útil só
pra teste local numa rede doméstica, onde o bloqueio por IP normalmente não
acontece. Em produção (GitHub Actions), a chave é obrigatória pra os sites
grandes responderem de verdade.
"""
import os

import requests

SCRAPERAPI_KEY = os.environ.get("SCRAPERAPI_KEY")
SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/"


def get_via_proxy(url_alvo, renderizar=False, headers=None, timeout=30):
    """GET em `url_alvo`, via ScraperAPI se houver chave configurada.

    `renderizar=True` pede pro ScraperAPI executar o JavaScript da página
    antes de devolver o HTML (necessário pra sites que montam a busca via
    JS) — consome mais créditos da conta do que uma requisição simples.
    """
    if SCRAPERAPI_KEY:
        params = {"api_key": SCRAPERAPI_KEY, "url": url_alvo}
        if renderizar:
            params["render"] = "true"
        return requests.get(SCRAPERAPI_ENDPOINT, params=params, timeout=timeout)
    return requests.get(url_alvo, headers=headers, timeout=timeout)
