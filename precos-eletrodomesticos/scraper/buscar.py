"""Busca produtos por nome em sites que oferecem API pública de busca
(Mercado Livre, e as lojas em VTEX: Casas Bahia e Fast Shop).

Essas três não precisam de navegador: a busca já devolve JSON com preço.
"""
import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


def buscar_mercadolivre(termo, limite=3):
    resultados = []
    try:
        r = requests.get(
            "https://api.mercadolibre.com/sites/MLB/search",
            params={"q": termo, "limit": limite},
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        for item in r.json().get("results", [])[:limite]:
            resultados.append(
                {
                    "site": "Mercado Livre",
                    "nome_encontrado": item.get("title"),
                    "url": item.get("permalink"),
                    "preco": item.get("price"),
                }
            )
        if not resultados:
            resultados.append({"site": "Mercado Livre", "erro": "nenhum resultado"})
    except Exception as e:
        resultados.append({"site": "Mercado Livre", "erro": str(e)})
    return resultados


def _buscar_vtex(base_url, site_nome, termo, limite=3):
    resultados = []
    try:
        r = requests.get(
            f"{base_url}/api/catalog_system/pub/products/search/{termo}",
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        itens = r.json()
        for item in itens[:limite]:
            preco = None
            try:
                preco = item["items"][0]["sellers"][0]["commertialOffer"]["Price"]
            except (KeyError, IndexError, TypeError):
                pass
            link_texto = item.get("linkText")
            url = f"{base_url}/{link_texto}/p" if link_texto else item.get("link")
            resultados.append(
                {
                    "site": site_nome,
                    "nome_encontrado": item.get("productName"),
                    "url": url,
                    "preco": preco,
                }
            )
        if not resultados:
            resultados.append({"site": site_nome, "erro": "nenhum resultado"})
    except Exception as e:
        resultados.append({"site": site_nome, "erro": str(e)})
    return resultados


def buscar_casasbahia(termo, limite=3):
    return _buscar_vtex("https://www.casasbahia.com.br", "Casas Bahia", termo, limite)


def buscar_fastshop(termo, limite=3):
    return _buscar_vtex("https://www.fastshop.com.br", "Fast Shop", termo, limite)
