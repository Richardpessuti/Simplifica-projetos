"""Lê e grava o histórico de preços em uma planilha .xlsx."""
from pathlib import Path

import openpyxl

COLUNAS = ["data", "produto", "site", "nome_encontrado", "preco", "url", "erro"]
ABA = "Histórico"


def _abrir_ou_criar(caminho: Path):
    if caminho.exists():
        return openpyxl.load_workbook(caminho)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = ABA
    ws.append(COLUNAS)
    return wb


def salvar_resultados(caminho: Path, resultados):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    wb = _abrir_ou_criar(caminho)
    ws = wb[ABA]
    for r in resultados:
        ws.append([r.get(c, "") for c in COLUNAS])
    wb.save(caminho)


def preco_anterior(caminho: Path, produto, site):
    """Último preço registrado pra esse produto+site antes de hoje (None se não houver)."""
    if not caminho.exists():
        return None
    wb = openpyxl.load_workbook(caminho)
    ws = wb[ABA]
    ultimo = None
    for linha in ws.iter_rows(min_row=2, values_only=True):
        _data, produto_linha, site_linha, _nome, preco, *_resto = linha
        if produto_linha == produto and site_linha == site and preco not in (None, ""):
            ultimo = preco
    return ultimo
