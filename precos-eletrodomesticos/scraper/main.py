"""Orquestra a coleta diária: busca cada produto do config em todos os sites,
salva tudo na planilha de histórico e notifica quando o preço cai.
"""
import datetime
import json
import os
from pathlib import Path

from scraper.buscar import buscar_casasbahia, buscar_fastshop, buscar_mercadolivre
from scraper.extrair import buscar_amazon, buscar_magalu
from scraper.notificar import notificar
from scraper.planilha import preco_anterior, salvar_json, salvar_resultados

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "config" / "produtos.json"
PLANILHA = RAIZ / "data" / "historico.xlsx"
JSON_HISTORICO = RAIZ / "data" / "historico.json"
TOPICO_NTFY = os.environ.get("NTFY_TOPICO")  # None -> usa o padrão de notificar.py


def coletar_produto(produto):
    termo = produto["termo_busca"]
    achados = []
    achados += buscar_mercadolivre(termo)
    achados += buscar_casasbahia(termo)
    achados += buscar_fastshop(termo)
    achados += buscar_magalu(termo)
    achados += buscar_amazon(termo)
    return achados


def main():
    produtos = json.loads(CONFIG.read_text(encoding="utf-8"))
    hoje = datetime.date.today().isoformat()
    todos_resultados = []
    quedas = []

    for produto in produtos:
        nome = produto["nome"]
        achados = coletar_produto(produto)
        for achado in achados:
            achado["produto"] = nome
            achado["data"] = hoje
            preco = achado.get("preco")
            if preco:
                anterior = preco_anterior(PLANILHA, nome, achado["site"])
                if anterior and preco < anterior:
                    quedas.append((nome, achado["site"], anterior, preco, achado.get("url")))
        todos_resultados.extend(achados)

    salvar_resultados(PLANILHA, todos_resultados)
    salvar_json(JSON_HISTORICO, todos_resultados)

    for nome, site, antes, agora, url in quedas:
        notificar(
            f"{site}: R$ {antes:.2f} -> R$ {agora:.2f}\n{url or ''}",
            titulo=f"Preço caiu: {nome}",
            topico=TOPICO_NTFY,
        )

    erros = [r for r in todos_resultados if r.get("erro")]
    print(f"OK — {len(todos_resultados)} resultados coletados em {hoje} "
          f"({len(erros)} com erro, {len(quedas)} queda(s) de preço).")
    for r in erros:
        print(f"  [erro] {r.get('site')} / {r.get('produto', '?')}: {r['erro']}")


if __name__ == "__main__":
    main()
