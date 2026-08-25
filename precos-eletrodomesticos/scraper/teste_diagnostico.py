"""Script descartável: testa se screenshot=true contorna o bloqueio de
'protected domain' do ScraperAPI pro Mercado Livre. Apagar depois do teste."""
import os

import requests

chave = os.environ["SCRAPERAPI_KEY"]
alvo = "https://lista.mercadolivre.com.br/geladeira-brastemp-frost-free-375l"

params = {"api_key": chave, "url": alvo, "render": "true", "screenshot": "true"}
r = requests.get("https://api.scraperapi.com/", params=params, timeout=90)
print("status:", r.status_code)
print("corpo (primeiros 500 chars):", r.text[:500])
