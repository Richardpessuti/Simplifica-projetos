"""Busca e extração de preço para sites sem API pública (Magazine Luiza, Amazon).

Pede pro proxy (scraper/proxy.py, via ScraperAPI) renderizar a página como um
navegador de verdade renderizaria, e lê o preço dos dados estruturados que a
própria página expõe pra SEO (JSON-LD ou meta tags de schema.org) — mais
estável do que depender de classes CSS, que mudam com frequência nesses sites.
"""
import json
import re
from urllib.parse import urljoin

from scraper.proxy import get_via_proxy

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


def _preco_de_jsonld(html):
    for match in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.S,
    ):
        try:
            dados = json.loads(match.group(1).strip())
        except Exception:
            continue
        candidatos = dados if isinstance(dados, list) else [dados]
        for item in candidatos:
            if not isinstance(item, dict):
                continue
            ofertas = item.get("offers")
            if isinstance(ofertas, list):
                ofertas = ofertas[0] if ofertas else None
            if isinstance(ofertas, dict) and ofertas.get("price"):
                try:
                    return float(str(ofertas["price"]).replace(",", "."))
                except ValueError:
                    continue
    return None


def _preco_de_meta(html):
    padrao = (
        r'<meta[^>]+(?:property|itemprop|name)=["\']'
        r'(?:product:price:amount|price)["\'][^>]+content=["\']([\d.,]+)["\']'
    )
    m = re.search(padrao, html)
    if m:
        try:
            return float(m.group(1).replace(".", "").replace(",", "."))
        except ValueError:
            return None
    return None


def _preco_de_padrao_amazon(html):
    """A Amazon nem sempre expõe JSON-LD/meta com preço — o valor "pra leitor
    de tela" (a-offscreen) é o jeito mais estável de pegar o preço exibido."""
    m = re.search(r'class="a-offscreen">\s*R\$\s*([\d.,]+)', html)
    if m:
        try:
            return float(m.group(1).replace(".", "").replace(",", "."))
        except ValueError:
            return None
    return None


def extrair_preco(url, premium=False):
    r = get_via_proxy(url, renderizar=True, premium=premium, headers=HEADERS, timeout=90)
    html = r.text
    return _preco_de_jsonld(html) or _preco_de_meta(html) or _preco_de_padrao_amazon(html)


def _urls_candidatas(url_busca, base_url, filtro_href, limite, premium=False):
    r = get_via_proxy(url_busca, renderizar=True, premium=premium, headers=HEADERS, timeout=90)
    hrefs = re.findall(r'href="([^"]+)"', r.text)
    vistas = []
    for href in hrefs:
        if filtro_href not in href:
            continue
        url_absoluta = urljoin(base_url, href).split("?")[0]
        if url_absoluta not in vistas:
            vistas.append(url_absoluta)
        if len(vistas) >= limite:
            break
    return vistas


def buscar_magalu(termo, limite=3):
    resultados = []
    try:
        termo_url = termo.replace(" ", "+")
        urls = _urls_candidatas(
            f"https://www.magazineluiza.com.br/busca/{termo_url}/",
            "https://www.magazineluiza.com.br",
            "/p/",
            limite,
            premium=True,
        )
        if not urls:
            resultados.append({"site": "Magazine Luiza", "erro": "nenhum resultado"})
        for url in urls:
            preco = extrair_preco(url, premium=True)
            resultados.append(
                {"site": "Magazine Luiza", "nome_encontrado": None, "url": url, "preco": preco}
            )
    except Exception as e:
        resultados.append({"site": "Magazine Luiza", "erro": str(e)})
    return resultados


def buscar_amazon(termo, limite=3):
    resultados = []
    try:
        termo_url = termo.replace(" ", "+")
        urls = _urls_candidatas(
            f"https://www.amazon.com.br/s?k={termo_url}",
            "https://www.amazon.com.br",
            "/dp/",
            limite,
        )
        if not urls:
            resultados.append({"site": "Amazon", "erro": "nenhum resultado (pode ser bloqueio anti-robô)"})
        for url in urls:
            preco = extrair_preco(url)
            resultados.append(
                {"site": "Amazon", "nome_encontrado": None, "url": url, "preco": preco}
            )
    except Exception as e:
        resultados.append({"site": "Amazon", "erro": str(e)})
    return resultados
