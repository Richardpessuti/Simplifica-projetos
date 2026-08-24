"""Busca e extração de preço para sites sem API pública (Magazine Luiza, Amazon).

Usa navegador (Playwright) pra renderizar a página e lê o preço dos dados
estruturados que a própria página expõe pra SEO (JSON-LD ou meta tags de
schema.org) — mais estável do que depender de classes CSS, que mudam com
frequência nesses sites.
"""
import json
import re


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


def extrair_preco(url, page):
    page.goto(url, timeout=30000, wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    html = page.content()
    return _preco_de_jsonld(html) or _preco_de_meta(html)


def _urls_candidatas(page, url_busca, filtro_href, limite):
    page.goto(url_busca, timeout=30000, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    hrefs = page.eval_on_selector_all(
        f"a[href*='{filtro_href}']", "els => els.map(e => e.href)"
    )
    vistas = []
    for href in hrefs:
        base = href.split("?")[0]
        if base not in vistas:
            vistas.append(base)
        if len(vistas) >= limite:
            break
    return vistas


def buscar_magalu(termo, browser, limite=3):
    resultados = []
    page = browser.new_page()
    try:
        termo_url = termo.replace(" ", "+")
        urls = _urls_candidatas(
            page, f"https://www.magazineluiza.com.br/busca/{termo_url}/", "/p/", limite
        )
        if not urls:
            resultados.append({"site": "Magazine Luiza", "erro": "nenhum resultado"})
        for url in urls:
            preco = extrair_preco(url, page)
            resultados.append(
                {"site": "Magazine Luiza", "nome_encontrado": None, "url": url, "preco": preco}
            )
    except Exception as e:
        resultados.append({"site": "Magazine Luiza", "erro": str(e)})
    finally:
        page.close()
    return resultados


def buscar_amazon(termo, browser, limite=3):
    resultados = []
    page = browser.new_page()
    try:
        termo_url = termo.replace(" ", "+")
        urls = _urls_candidatas(
            page, f"https://www.amazon.com.br/s?k={termo_url}", "/dp/", limite
        )
        if not urls:
            resultados.append({"site": "Amazon", "erro": "nenhum resultado (pode ser bloqueio anti-robô)"})
        for url in urls:
            preco = extrair_preco(url, page)
            resultados.append(
                {"site": "Amazon", "nome_encontrado": None, "url": url, "preco": preco}
            )
    except Exception as e:
        resultados.append({"site": "Amazon", "erro": str(e)})
    finally:
        page.close()
    return resultados
