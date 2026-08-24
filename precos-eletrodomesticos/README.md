# Preços de eletrodomésticos — coleta diária

Todo dia (via GitHub Actions), esse projeto:

1. Pega a lista de eletrodomésticos em `config/produtos.json` (só o nome —
   não precisa de link de produto).
2. Busca cada um em 5 sites: **Mercado Livre, Casas Bahia, Fast Shop,
   Magazine Luiza e Amazon**.
3. Salva o resultado (produto, site, nome encontrado, preço, link) em
   `data/historico.xlsx`, que fica versionado no repositório — é a "planilha"
   com o histórico de preços, dia após dia.
4. Se o preço de algum item caiu em relação ao último registro, manda uma
   notificação push via [ntfy.sh](https://ntfy.sh) (sem cadastro).

## Como adicionar/mudar os eletrodomésticos que quero acompanhar

Edite `config/produtos.json`. Cada item é só:

```json
{ "nome": "Nome pra aparecer na planilha", "termo_busca": "o que digitar na busca do site" }
```

Não precisa de link — o robô procura pelo nome em cada site.

## Como receber as notificações

1. Instale o app **ntfy** ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/us/app/ntfy/id1625396347)) ou abra `https://ntfy.sh/simplifica-precos-eletro-r7k2m` no navegador.
2. Assine (subscribe) o tópico `simplifica-precos-eletro-r7k2m`.
3. Pronto — vai chegar uma notificação toda vez que algum preço cair.

Quer um tópico só seu (mais privado, já que qualquer um que souber o nome
do tópico padrão consegue assinar)? Crie um nome único, assine ele no app, e
cadastre como segredo do repositório: **Settings → Secrets and variables →
Actions → New repository secret**, nome `NTFY_TOPICO`, valor com o nome do
seu tópico.

## Rodar manualmente (sem esperar o agendamento)

Na aba **Actions** do repositório → workflow **"Preços de eletrodomésticos
(diário)"** → **Run workflow**.

## Rodar localmente (pra testar)

```bash
cd precos-eletrodomesticos
pip install -r requirements.txt
playwright install chromium
python -m scraper.main
```

## Limitações conhecidas (importante ler)

- **Mercado Livre, Casas Bahia e Fast Shop** usam APIs públicas de busca
  (a da própria Mercado Livre, e a busca padrão da plataforma VTEX, que as
  outras duas usam) — tendem a ser estáveis.
- **Magazine Luiza e Amazon** não têm API pública, então o robô abre a
  página de busca com um navegador (Playwright) e lê o preço dos dados
  estruturados da própria página (schema.org/JSON-LD). Isso é mais robusto
  que depender de classes CSS, mas **sites grandes como a Amazon têm forte
  proteção anti-robô** (captcha, bloqueio por IP) — é esperado que essas
  buscas falhem de vez em quando. Quando isso acontece, o robô registra o
  erro na planilha (coluna `erro`) e segue pros outros sites/produtos, sem
  travar a coleta inteira.
- Como a busca é por **nome**, e não por link exato, o item encontrado em
  cada site pode ser um modelo ligeiramente diferente (cor, vendedor,
  variação). Confira a coluna `nome_encontrado` e `url` na planilha nos
  primeiros dias — se algum site estiver pegando o produto errado, ajuste o
  `termo_busca` em `config/produtos.json` pra ficar mais específico.
- Este ambiente de desenvolvimento (onde o código foi escrito) bloqueia
  acesso direto a esses sites de varejo — por isso o código não pôde ser
  testado ao vivo antes do primeiro push. O primeiro teste real acontece
  quando o workflow roda no GitHub Actions (que tem acesso normal à
  internet). Rode manualmente (seção acima) depois do primeiro push e
  confira a aba **Actions** → logs, e o arquivo `data/historico.xlsx`
  gerado, pra validar se os sites estão respondendo como esperado.
