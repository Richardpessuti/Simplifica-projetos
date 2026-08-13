# Central de Cotações — Contexto do Projeto

> Documento de handoff. Dê este arquivo pro Claude Code (ou cole o conteúdo na primeira mensagem de uma sessão nova) pra ele entender o projeto sem precisar reexplicar tudo.

## O que é o app

App web (uma página só, `index.html`) pra arquitetos organizarem uma reforma junto com o cliente: cronograma, cotações, aprovações com parcelamento, prestadores de serviço e arquivos técnicos — tudo num só lugar, acessado pelo navegador do celular.

**Não é um app nativo.** É HTML + CSS + JavaScript puro, sem framework, sem processo de build. Um arquivo só. Hospedado no **GitHub Pages** como site estático (ver seção "Hospedagem" abaixo — trocamos do Netlify pro GitHub Pages em 13/08/2026).

## Estrutura de acesso (papéis)

- **Master** (`richardpessuti@hotmail.com`, configurável): cadastra arquitetos, pode "entrar como" qualquer arquiteto e ver os projetos dele.
- **Arquiteto**: vê e cria projetos vinculados a ele (`arquitetoId`), é admin dentro de cada projeto que criou.
- **Cliente**: só acessa projetos onde o e-mail dele está em `membrosEmails`, sem acesso ao painel master nem a outros clientes.

Essa estrutura de permissão **não deve ser alterada** sem discutir antes — várias funcionalidades novas foram construídas em cima dela.

## Stack técnica

- **Frontend**: HTML/CSS/JS vanilla, um arquivo `index.html`
- **Backend**: Firebase (Auth + Firestore), configurado direto no `<script>` do HTML (`firebaseConfig` no topo)
- **Armazenamento de arquivos**: arquivos (PDFs, imagens) são convertidos pra base64 e salvos em pedaços (`chunks`) dentro do Firestore — não usa Firebase Storage. Isso funciona mas é caro/lento; ficou pendente migrar pra Storage.
- **Hospedagem**: **GitHub Pages**, publicado direto do repositório `Richardpessuti/Simplifica-projetos`, branch `claude/leitura-perguntas-917odr`, pasta `/ (root)`. Link ao vivo: **https://richardpessuti.github.io/Simplifica-projetos/**. Deploy automático a cada push — sem passo manual.
  - **Por que não Netlify**: o site esteve conectado ao Netlify (`simplificaprojetos.netlify.app`) via Git, mas o plano gratuito do time bloqueia deploys de commits com autor "não reconhecido" (erro *"Build blocked: Unrecognized Git contributor"* — os commits feitos pelo Claude Code usam o autor `Claude <noreply@anthropic.com>`, que não está associado à conta GitHub do time). Não existe opção de liberar isso em plano gratuito, só via upgrade pago. Como alternativa gratuita, o repositório foi **tornado público** e o deploy passou a ser feito via GitHub Pages.
  - **Repositório é público** — isso expõe o `firebaseConfig` (apiKey, projectId etc.) no código-fonte. Isso por si só não é um problema de segurança (é assim que o Firebase funciona; a chave é pública por design), **mas depende de as Firestore Security Rules estarem configuradas no Firebase Console** — item que segue pendente na lista abaixo. Enquanto as regras não estiverem travadas, tratar isso como prioridade de segurança, não só "nice to have".
  - Se no futuro quiser voltar pro Netlify: resolve o bloqueio fazendo upgrade do plano do time, ou reconectando com um autor de commit associado a uma conta GitHub reconhecida como colaboradora do repositório.

## Sistema de design (implementado)

Paleta e tokens em CSS custom properties no `:root`:
- `--ink` (#14171C, grafite escuro), `--paper` (#F4F5F3, fundo), `--accent` (#2F6F5E, verde-petróleo, cor de destaque/botões), `--caution` (#C7862B, âmbar/pendente), `--danger` (#C1443A, vermelho/recusado)
- `--card-bg`, `--nav-bg`, `--radius-card`, `--radius-btn` — todos editáveis pelo admin
- Tipografia: **Space Grotesk** (títulos), **Inter** (corpo), **IBM Plex Mono** (dados/labels)

### Personalização (Admin → Aparência deste cliente)
Cada projeto tem um objeto `tema` no Firestore (`projetos/{id}.tema`) com:
```
{
  corFundo, corCabecalho, corDestaque, corTexto, corSucesso,
  corCard, corMenu, corBotao, corRecusado,
  cantos: 'arredondado' | 'reto' | 'suave',
  tipoCores: { "Piso": "#2F6F5E", ... },   // cor por categoria de cotação
  decoracoes: ["🪴", "📐"]                  // emojis no banner
}
```
Aplicado via função `aplicarTema(tema)`. A logo (upload existente) agora cobre o banner inteiro (full-bleed) em vez de ficar pequena no canto — função `aplicarLogoBanner()`.

### Cômodo ilustrado (Cronograma)
Função `renderSalaProgresso()` desenha um SVG de cômodo que "se forma" visualmente conforme o % de etapas concluídas (piso aos 20%, pintura aos 40%, elétrica aos 60%, móveis aos 80%, decoração aos 100%). Cores do SVG usam as variáveis do tema.

## Funcionalidades implementadas nesta fase

### Financeiro (Cotações → Aprovados)
Cotação aprovada ganha um campo `pagamento`:
```
{
  modo: 'vista' | 'parcelado',
  parcelas: 3,
  cartao: 'Nubank Richard',
  fechamento: 10,          // dia de fechamento da fatura
  autoPay: true,            // marca parcela como paga sozinha quando a data vence
  total: 12900,
  dados: [
    { valor: 4300, data: '2026-09-10', pagaManual: null, editado: false },
    ...
  ]
}
```
- Parcelas geradas automaticamente (`gerarDadosParcelas()`), respeitando o ciclo de fechamento do cartão
- Edição pontual de uma parcela (valor/data) com redistribuição automática do restante (`redistribuirParcelas()`)
- Aba nova **Cartões**: soma todas as parcelas por cartão e por mês (`renderCartoes()`), navegável mês a mês

### Prestadores
Campos novos: `favorito` (bool), `status` ('Cotação'/'Contratado'/'Recusado'), `endereco` (+ botão "Ver no mapa" via link do Google Maps, sem API paga), `email`, `indicadoPor`, `obs` (observação interna). Cards redesenhados com avatar, ícones de ação, e busca por nome/empresa. Exportação CSV de todos os prestadores (botão no topo da aba).

### Segurança de cadastro
- Cadastro de conta só é aceito se o e-mail já foi convidado (está em `membrosEmails` de algum projeto, ou é um arquiteto cadastrado, ou é o master) — função `emailFoiConvidado()`
- E-mail de verificação enviado no cadastro (`sendEmailVerification`), com banner de aviso até confirmar

### Achar projetos / Prestadores / Etapas (redesign estrutural)
- Tela de seleção de projeto: cards com avatar/inicial, busca por nome (aparece com 5+ projetos)
- Prestadores: cards com avatar, ícones de ação em vez de botões de texto
- Linha do tempo do cronograma: cards com círculo numerado colorido por status, ações em ícone

### Modo demo (`?demo=1` na URL do site publicado)
Pula o login e mostra o app com dados fictícios, sem tocar no Firebase — pra conferir visual rápido no celular sem precisar logar. Função `ativarModoDemo()`.

### Preview local sem Firebase (`preview-real.html`)
Cópia do `index.html` com os `<script>` do Firebase removidos e o modo demo forçado sempre ativo — abre instantaneamente (inclusive como artifact no chat do Claude), sem precisar publicar em lugar nenhum. Útil pro fluxo: gerar preview → aprovar visual → só então gerar o `index.html` de verdade e publicar.

## Discutido mas NÃO implementado ainda

- **⚠️ PRIORIDADE ALTA (subiu de prioridade em 13/08/2026): Firestore Security Rules no servidor** — hoje a segurança de dados depende só da lógica do client, sem regras no Firebase Console validando `membrosEmails`/`arquitetoId` no backend. Isso já era pendente, mas agora o repositório do código é **público** (necessário pro deploy via GitHub Pages — ver seção "Hospedagem"), o que torna o `projectId`/`apiKey` do Firebase mais fácil de encontrar. Sem regras travadas, alguém com esses dados poderia ler/escrever direto no Firestore pelo SDK, sem passar pelo app. Tratar como próximo passo de segurança, não como melhoria opcional.
- Migrar armazenamento de arquivo de base64-no-Firestore pra Firebase Storage
- Compressão automática de imagem antes do upload
- PWA instalável (ícone na tela inicial)
- Exportar resumo do projeto em PDF
- Datas de início/fim previstas por etapa do cronograma
- Orçamento planejado x realizado
- Comparar cotações do mesmo item lado a lado
- Notificações quando etapa conclui ou status muda
- Log de atividade (quem alterou o quê)
- Permissões por membro (hoje qualquer membro do projeto edita tudo, não só visualiza)
- Painel consolidado pro arquiteto ver todos os clientes de uma vez
- Convite por link/QR em vez de e-mail exato
- Template de cronograma reutilizável entre projetos
- Backup/exportação geral de um projeto
- Tela de login com tratamento visual "cinematográfico" (imagem/vídeo de fundo bonito) — decidimos que faz sentido só na tela de entrada, não dentro do app em uso

## Diretriz visual pendente (prioridade alta)

O visual atual (paleta grafite/verde, cards planos, ícones emoji) foi um primeiro avanço, mas **não é o alvo final**. O padrão desejado:

- **Referência: site da Apple.** Fotografia/render grande e de alta qualidade, tipografia generosa com bastante espaço em branco, transições suaves, hierarquia visual clara — não um app "funcional" cheio de cards e ícones, e sim algo que pareça produto premium.
- **Imagens reais, não desenho.** Nada de ilustração SVG estilo desenho (o cômodo ilustrado que fizemos em `renderSalaProgresso()` foi um teste — o resultado final deve usar fotografia ou render 3D fotorrealista, não elementos desenhados como aquele).
- **3D / imagem de fundo cinematográfica**, especialmente na tela de login/entrada: um projeto de reforma "se formando" em 3D fotorrealista atrás do formulário, como pano de fundo. Já discutimos que isso deve ficar concentrado na entrada (não dentro das telas de uso diário, tipo Cotações/Aprovados, onde a pessoa está resolvendo tarefa e precisa de leitura rápida) — mas o nível de acabamento visual "Apple" deve se estender pro resto do app também, não só a capa.
- Isso é trabalho de design visual pesado (imagens/render 3D reais custam produção — banco de imagens, geração por IA, ou contratação de um render 3D) — não dá pra resolver só com CSS. Vale planejar de onde essas imagens vêm antes de implementar.

## Deploy automático (status: concluído)

O repositório já está criado e publicando sozinho via GitHub Pages a cada push (ver seção "Hospedagem" acima). Nada pendente aqui.

Pra editar com Claude Code pelo celular: app Claude → aba **Código** → **New Session** → escolher esse repositório → descrever a tarefa.

## Como pedir pro Claude Code continuar

Ao abrir uma sessão nova (terminal ou "Código" no app mobile), cole este documento inteiro como primeira mensagem, ou referencie: *"Leia o CONTEXTO-PROJETO.md antes de mexer em qualquer coisa."* Isso evita ele redescobrir a estrutura do zero e perder decisões já tomadas (principalmente a estrutura de permissões master/arquiteto/cliente, que não deve mudar sem necessidade clara).
