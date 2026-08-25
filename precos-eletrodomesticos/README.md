# Preços de eletrodomésticos — coleta diária

Todo dia (via GitHub Actions), esse projeto:

1. Pega a lista de eletrodomésticos em `config/produtos.json` (só o nome —
   não precisa de link de produto).
2. Busca cada um em 5 sites: **Mercado Livre, Casas Bahia, Fast Shop,
   Magazine Luiza e Amazon**.
3. Salva o resultado (produto, site, nome encontrado, preço, link) em
   `data/historico.xlsx` (e em `data/historico.json`, que alimenta a página
   `precos.html`) — ambos versionados no repositório, com o histórico dia
   após dia.
4. Se o preço de algum item caiu em relação ao último registro, manda uma
   notificação push via [ntfy.sh](https://ntfy.sh) (sem cadastro).

A página com os preços fica em **precos.html**, publicada junto do resto do
site.

## ⚠️ Passo obrigatório: cadastrar a chave do ScraperAPI

Sites grandes de varejo bloqueiam requisições vindas de IPs de nuvem (é assim
que o GitHub Actions acessa a internet) — na primeira execução real, os 5
sites recusaram a conexão. Pra funcionar de verdade, é preciso usar um
serviço de proxy de scraping que contorna esse bloqueio: o
[ScraperAPI](https://www.scraperapi.com/).

1. Crie uma conta gratuita em https://www.scraperapi.com/ (o plano free dá
   ~5.000 créditos/mês — bem mais do que o suficiente pra 3-10 produtos
   acompanhados uma vez por dia).
2. Copie a **API Key** do painel deles.
3. No repositório do GitHub: **Settings → Secrets and variables → Actions →
   New repository secret**, nome `SCRAPERAPI_KEY`, valor a chave copiada.

Sem esse segredo cadastrado, o robô ainda roda, mas tenta acessar os sites
direto — o que tende a falhar nos 5 sites vindo do GitHub Actions, exatamente
como no primeiro teste.

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
cadastre como segredo do repositório (mesmo lugar do `SCRAPERAPI_KEY` acima),
nome `NTFY_TOPICO`, valor com o nome do seu tópico.

## Rodar manualmente (sem esperar o agendamento)

Na aba **Actions** do repositório → workflow **"Preços de eletrodomésticos
(diário)"** → **Run workflow**.

## Rodar localmente (pra testar)

```bash
cd precos-eletrodomesticos
pip install -r requirements.txt
export SCRAPERAPI_KEY=sua_chave_aqui   # opcional localmente, obrigatório no GitHub Actions
python -m scraper.main
```

## ⚠️ Status real hoje: só a Amazon funciona no plano gratuito

Testado em produção (24/08/2026): **Mercado Livre, Casas Bahia, Fast Shop e
Magazine Luiza recusam a requisição mesmo com o proxy**, com esta mensagem
explícita do ScraperAPI:

> Your current plan does not allow you to use our premium proxies. Please
> upgrade your plan to gain access to our Premium and Ultra Premium pools.

Ou seja: esses 4 sites são "domínios protegidos" pro ScraperAPI, e só
respondem através do pool de proxy residencial (`premium`/`ultra_premium`),
que **não está incluído no plano gratuito** — não é bug de código, é limite
de plano. Só a **Amazon** funciona sem precisar de proxy premium, e está
coletando preço normalmente.

Opções pra resolver isso:
1. **Fazer upgrade do plano do ScraperAPI** (veja preços/planos em
   https://docs.scraperapi.com/control-and-optimization/premium-residential-mobile-proxy-pools)
   pra liberar o pool premium — nesse caso não precisa mexer em nada aqui, o
   código (`premium=True` já configurado em `scraper/buscar.py` e
   `scraper/extrair.py`) passa a funcionar automaticamente.
2. **Deixar como está** — a coleta roda todo dia, só que só a Amazon traz
   preço; os outros 4 sites ficam registrados com erro na planilha (sem
   custo nenhum, o ScraperAPI não cobra crédito quando recusa por causa do
   plano).
3. Trocar de serviço de proxy por um cujo free tier inclua proxy residencial
   pros sites que faltam (não testado ainda).

## Limitações conhecidas (importante ler)

- Como a busca é por **nome**, e não por link exato, o item encontrado em
  cada site pode ser um modelo ligeiramente diferente (cor, vendedor,
  variação). Confira a coluna `nome_encontrado` e `url` na planilha nos
  primeiros dias — se algum site estiver pegando o produto errado, ajuste o
  `termo_busca` em `produtos.html` (ou `config/produtos.json`) pra ficar mais
  específico.
- Renderizar JavaScript (Magazine Luiza e Amazon) consome mais créditos do
  plano do ScraperAPI do que uma busca simples. Com poucos produtos e uma
  coleta por dia, o plano gratuito cobre com folga o que a Amazon já usa; se
  a lista de produtos crescer muito, vale ficar de olho no consumo de
  créditos no painel do ScraperAPI.
- Mesmo com proxy, sites grandes têm proteção anti-robô forte — é esperado
  que buscas falhem de vez em quando mesmo depois de resolvido o ponto
  acima. Quando isso acontece, o robô registra o erro na planilha (coluna
  `erro`) e segue pros outros sites/produtos, sem travar a coleta inteira.
