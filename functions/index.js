const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const Anthropic = require('@anthropic-ai/sdk');
const admin = require('firebase-admin');
// pdf-to-img só existe como ESM — não dá pra usar require() nele a partir
// deste arquivo (CommonJS), por isso o import() dinâmico dentro da função.

admin.initializeApp();
const db = admin.firestore();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const MERCADOPAGO_ACCESS_TOKEN = defineSecret('MERCADOPAGO_ACCESS_TOKEN');
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

// IDs dos planos de assinatura no Mercado Pago (criados via API de
// Assinaturas/Preapproval), planos de PRODUÇÃO.
const MP_PLANO_BASE_ID = '9a61496329f34bf7bdcf0918ebc5fb81';
const MP_PLANO_EXTRA_ID = 'a75dda952dea4678aa9815a990648bbe';
// plano de vaga extra (R$5/mês, +1 pessoa no MESMO projeto) — ainda não
// criado no Mercado Pago; até lá fica com este placeholder, que nunca bate
// com nenhum preapproval_plan_id de verdade, então o webhook nunca entra
// nesse fluxo por engano
const MP_PLANO_VAGA_EXTRA_ID = '5de834075a0842cf88e5286dbbb508a5';

// franquia padrão de pessoas com acesso a um projeto — quem quiser mais
// gente no mesmo projeto assina o plano de vaga extra (1 vaga por
// assinatura), que incrementa este valor pra aquele projeto específico
const DEFAULT_LIMITE_MEMBROS = 3;

const MAX_PAGINAS = 3; // orçamentos costumam ter poucas páginas — evita custo/tempo alto num PDF gigante
const MAX_BASE64_CHARS = 20 * 1024 * 1024; // ~15MB de arquivo real — orçamento não precisa de mais que isso, evita abuso de custo/memória
const MODEL = 'claude-haiku-4-5-20251001'; // modelo mais barato — suficiente pra ler tabela de itens

// mesmo e-mail fixo do isMaster() em firestore.rules — master sempre tem
// acesso ilimitado à leitura por IA, em qualquer projeto
const MASTER_EMAIL = 'richardpessuti@hotmail.com';

// Franquia padrão de leituras por IA de cada acesso (projeto) por mês —
// cada projeto tem a própria franquia, independente dos outros projetos da
// mesma pessoa (não soma nem compartilha). Fica fixo aqui por padrão; um
// projeto pode ter um valor diferente salvo em `limiteIAMensal` (0 = sem
// acesso, negativo = ilimitado) pra planos especiais, mas isso não tem UI
// hoje — só é setado manualmente ou futuramente pela automação de pagamento.
const DEFAULT_LIMITE_IA = 15;

// Confere se quem está chamando tem acesso ao projeto informado e conta o
// uso mensal de leitura por IA daquele projeto, de forma atômica (transação),
// antes de deixar a IA rodar — assim nunca gasta chamada da Anthropic com
// quem não tem permissão ou já estourou a franquia daquele acesso.
async function verificarAcessoEContarUso(request) {
  const { projetoId } = request.data || {};
  if (!projetoId || typeof projetoId !== 'string') {
    throw new HttpsError('invalid-argument', 'Faltou informar o projeto.');
  }
  const callerEmail = (request.auth.token.email || '').toLowerCase();

  const projetoRef = db.doc(`projetos/${projetoId}`);
  const projetoSnap = await projetoRef.get();
  if (!projetoSnap.exists) {
    throw new HttpsError('not-found', 'Projeto não encontrado.');
  }
  const projeto = projetoSnap.data();
  const isMaster = callerEmail === MASTER_EMAIL;
  const isMembro = isMaster ||
    (typeof projeto.criadoPor === 'string' && projeto.criadoPor.toLowerCase() === callerEmail) ||
    (Array.isArray(projeto.membrosEmails) && projeto.membrosEmails.includes(callerEmail));
  if (!isMembro) {
    throw new HttpsError('permission-denied', 'Você não tem acesso a este projeto.');
  }

  if (isMaster) return;

  const limite = typeof projeto.limiteIAMensal === 'number' ? projeto.limiteIAMensal : DEFAULT_LIMITE_IA;

  if (limite === 0) {
    throw new HttpsError('permission-denied', 'A leitura automática por IA não está disponível neste projeto.');
  }
  if (limite < 0) return; // limite negativo = ilimitado

  const mesAtual = new Date().toISOString().slice(0, 7); // "2026-08"
  const usoRef = projetoRef.collection('usoIA').doc(mesAtual);
  await db.runTransaction(async (tx) => {
    const usoSnap = await tx.get(usoRef);
    const atual = usoSnap.exists && typeof usoSnap.data().contagem === 'number' ? usoSnap.data().contagem : 0;
    if (atual >= limite) {
      throw new HttpsError('resource-exhausted', `Limite mensal de leituras por IA atingido (${limite}/mês) neste acesso.`);
    }
    tx.set(usoRef, { contagem: atual + 1, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

// O app manda o arquivo como data URL (mesmo formato salvo em cotacoes/{id}/chunks,
// veja fileToBase64/base64ParaArquivo em index.html) — separa o mimetype dos bytes.
function parseDataUrl(base64) {
  const commaIdx = base64.indexOf(',');
  if (commaIdx === -1) throw new HttpsError('invalid-argument', 'Arquivo em formato inesperado.');
  const meta = base64.slice(0, commaIdx);
  const data = base64.slice(commaIdx + 1);
  const mimeMatch = meta.match(/data:(.*);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  return { mime, data };
}

// Sempre devolve o documento como uma lista de imagens (PNG em base64) — foto e PDF
// seguem o mesmo caminho de leitura por visão (decisão registrada no plano da Fase B).
async function paraImagensBase64(base64, fileName) {
  const { mime, data } = parseDataUrl(base64);

  if (mime.startsWith('image/')) {
    return [{ mediaType: mime, data }];
  }

  const pareceSerPdf = mime === 'application/pdf' || /\.pdf$/i.test(fileName || '');
  if (pareceSerPdf) {
    const { pdf } = await import('pdf-to-img');
    const buffer = Buffer.from(data, 'base64');
    const documento = await pdf(buffer, { scale: 1 });
    const imagens = [];
    let i = 0;
    for await (const paginaBuffer of documento) {
      if (i >= MAX_PAGINAS) break;
      imagens.push({ mediaType: 'image/png', data: Buffer.from(paginaBuffer).toString('base64') });
      i++;
    }
    return imagens;
  }

  throw new HttpsError('invalid-argument', 'Tipo de arquivo não suportado pra leitura automática: ' + mime);
}

const FERRAMENTA_EXTRACAO = {
  name: 'extrair_itens',
  description: 'Registra a empresa/contato e os itens (produtos/serviços) encontrados no orçamento/cotação.',
  input_schema: {
    type: 'object',
    properties: {
      empresa: { type: 'string', description: 'Nome da empresa/fornecedor/prestador que emitiu o documento, se aparecer. Vazio se não houver.' },
      telefone: { type: 'string', description: 'Telefone de contato da empresa, como está no documento (ex: "(19) 3475-7777"). Vazio se não houver.' },
      precoTotal: { type: 'string', description: 'Valor TOTAL final do orçamento/nota (ex: "Total", "Valor total da nota", "Total Orçado"), em reais no padrão brasileiro (ex: "8400,00"). Se o documento não mostrar um total final claro, deixe vazio — não some os itens você mesmo.' },
      itens: {
        type: 'array',
        description: 'Um item por linha/produto/serviço cotado.',
        items: {
          type: 'object',
          properties: {
            descricao: { type: 'string', description: 'Descrição do item, como está no documento.' },
            qtd: { type: 'string', description: 'Quantidade com unidade, ex: "40 sc", "55,89 m²". Vazio se não houver.' },
            valorUnit: { type: 'string', description: 'Valor unitário em reais, ex: "39,90". Vazio se não houver.' },
            valorTotal: { type: 'string', description: 'Valor total da linha em reais, ex: "1442,65".' }
          },
          required: ['descricao']
        }
      }
    },
    required: ['itens']
  }
};

exports.lerItensCotacao = onCall({ secrets: [ANTHROPIC_API_KEY], region: 'southamerica-east1', maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faça login pra usar a leitura automática.');
  }

  const { base64, fileName } = request.data || {};
  if (!base64 || typeof base64 !== 'string') {
    throw new HttpsError('invalid-argument', 'Nenhum arquivo enviado.');
  }
  if (base64.length > MAX_BASE64_CHARS) {
    throw new HttpsError('invalid-argument', 'Arquivo muito grande pra leitura automática (máximo ~15MB).');
  }

  // checa permissão/plano e conta o uso ANTES de gastar qualquer chamada da IA
  await verificarAcessoEContarUso(request);

  const imagens = await paraImagensBase64(base64, fileName);
  if (imagens.length === 0) {
    throw new HttpsError('invalid-argument', 'Não consegui ler nenhuma página do arquivo.');
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

  const content = imagens.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.data }
  }));
  content.push({
    type: 'text',
    text: 'Este é um orçamento/cotação de reforma (pode ser nota fiscal, proposta ou foto de orçamento). ' +
      'Extraia o nome da empresa/fornecedor, o telefone de contato, o valor TOTAL final do documento ' +
      '(o valor que a pessoa realmente vai pagar, já com desconto/frete se houver — não a soma dos produtos ' +
      'antes disso), e cada item/produto/serviço cotado, com quantidade e valores, usando a ferramenta "extrair_itens". ' +
      'Se um valor não aparecer claramente no documento, deixe o campo em branco em vez de inventar ou estimar. ' +
      'Sempre escreva valores em reais no padrão brasileiro (vírgula decimal, ex: "1442,65", nunca "1442.65"). ' +
      'No campo "qtd", mantenha a unidade que aparecer no documento (ex: "40 sc", "55,89 m²"), não só o número.'
  });

  const resposta = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [FERRAMENTA_EXTRACAO],
    tool_choice: { type: 'tool', name: 'extrair_itens' },
    messages: [{ role: 'user', content }]
  });

  const toolUse = resposta.content.find(bloco => bloco.type === 'tool_use');
  if (!toolUse) {
    throw new HttpsError('internal', 'A IA não retornou os itens no formato esperado.');
  }

  const itens = Array.isArray(toolUse.input.itens) ? toolUse.input.itens : [];
  const empresa = typeof toolUse.input.empresa === 'string' ? toolUse.input.empresa : '';
  const telefone = typeof toolUse.input.telefone === 'string' ? toolUse.input.telefone : '';
  const precoTotal = typeof toolUse.input.precoTotal === 'string' ? toolUse.input.precoTotal : '';
  return { itens, empresa, telefone, precoTotal };
});

// Busca os detalhes completos de uma assinatura (preapproval) direto na API
// do Mercado Pago — nunca confia só no aviso do webhook em si (poderia ser
// forjado por qualquer um que descubra a URL), sempre confirma com a fonte.
async function buscarPreapproval(preapprovalId) {
  const resposta = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN.value()}` }
  });
  if (!resposta.ok) {
    throw new Error(`Mercado Pago respondeu ${resposta.status} ao consultar a assinatura ${preapprovalId}`);
  }
  return resposta.json();
}

// Webhook do Mercado Pago — avisado automaticamente a cada evento de uma
// assinatura (criada, paga, cancelada...). Sempre responde 200 rápido (senão
// o Mercado Pago fica reenviando o mesmo aviso em loop), e só libera acesso
// depois de confirmar com a própria API deles que a assinatura está mesmo
// "authorized" (ou seja, o pagamento foi aprovado de verdade).
async function handleMercadoPagoWebhook(req, res) {
  try {
    const preapprovalId = (req.body && req.body.data && req.body.data.id) || req.query['data.id'] || req.query.id;
    const tipo = (req.body && req.body.type) || req.query.type;

    // só nos importa notificação de assinatura — qualquer outra coisa (ex:
    // "payment" avulso) a gente ignora, mas ainda responde 200 pro Mercado
    // Pago não ficar retentando à toa.
    if (!preapprovalId || tipo !== 'subscription_preapproval') {
      res.status(200).send('ignorado');
      return;
    }

    // IDs de preapproval do Mercado Pago são sempre hex de 32 caracteres —
    // rejeita rápido qualquer coisa fora desse formato (ex: alguém mandando
    // lixo direto pro endpoint público) sem gastar uma chamada na API deles.
    if (!/^[a-f0-9]{32}$/i.test(preapprovalId)) {
      res.status(200).send('id em formato inválido');
      return;
    }

    const preapproval = await buscarPreapproval(preapprovalId);
    const email = (preapproval.payer_email || '').toLowerCase();

    // plano de vaga extra (+1 pessoa num projeto já existente) segue um
    // caminho totalmente separado: não cria/atualiza um projeto próprio
    // keyed por este preapprovalId, só ajusta o limiteMembros do projeto
    // de quem pagou.
    if (preapproval.preapproval_plan_id === MP_PLANO_VAGA_EXTRA_ID) {
      if (!email) {
        res.status(200).send('sem e-mail do pagador');
        return;
      }
      const delta = preapproval.status === 'authorized' ? 1
        : (preapproval.status === 'cancelled' || preapproval.status === 'paused') ? -1
        : 0;
      if (delta === 0) {
        res.status(200).send('status: ' + preapproval.status);
        return;
      }
      const projetosDoEmail = await db.collection('projetos').where('criadoPor', '==', email).get();
      // só aplica se der pra saber exatamente em qual projeto — não é o
      // caso comum (a maioria tem só 1), mas evita aplicar a vaga no
      // projeto errado se a pessoa tiver mais de um
      if (projetosDoEmail.size !== 1) {
        console.error(`Vaga extra de ${email}: ${projetosDoEmail.size} projeto(s) encontrado(s), não deu pra decidir automaticamente.`);
        res.status(200).send('vaga extra pendente: ' + projetosDoEmail.size + ' projeto(s)');
        return;
      }
      const projetoDoc = projetosDoEmail.docs[0];
      const limiteAtual = projetoDoc.data().limiteMembros || DEFAULT_LIMITE_MEMBROS;
      const novoLimite = Math.max(DEFAULT_LIMITE_MEMBROS, limiteAtual + delta);
      await projetoDoc.ref.set({ limiteMembros: novoLimite }, { merge: true });
      res.status(200).send('limiteMembros: ' + novoLimite);
      return;
    }

    // usa o próprio ID da assinatura como ID do projeto — assim, se o
    // Mercado Pago reenviar o mesmo aviso (acontece, é esperado), a
    // segunda vez só sobrescreve o mesmo documento em vez de duplicar
    const projetoId = `mp_${preapprovalId}`;
    const projetoRef = db.doc(`projetos/${projetoId}`);

    if (preapproval.status !== 'authorized') {
      // cancelada ou pausada: revoga o acesso daquele projeto específico —
      // mas só se ele já existia (uma assinatura cancelada antes de nunca
      // ter sido aprovada não deve criar um projeto vazio do nada). Dados
      // ficam guardados, só o acesso é bloqueado — se a pessoa reativar a
      // assinatura depois, o mesmo projeto volta a funcionar.
      if (preapproval.status === 'cancelled' || preapproval.status === 'paused') {
        const snap = await projetoRef.get();
        if (snap.exists) {
          await projetoRef.set({ ativo: false }, { merge: true });
        }
      }
      res.status(200).send('status: ' + preapproval.status);
      return;
    }

    if (!email) {
      res.status(200).send('sem e-mail do pagador');
      return;
    }

    // se o projeto já existe (reativação de uma assinatura antes cancelada,
    // ou reenvio do mesmo aviso), preserva nome, data de criação e
    // membrosEmails originais — sem isso, toda renovação mensal (que
    // também dispara este webhook) apagaria qualquer pessoa extra que o
    // admin tivesse adicionado, voltando a lista só pro pagador
    const jaExistia = (await projetoRef.get()).exists;
    await projetoRef.set({
      ...(jaExistia ? {} : {
        nome: 'Novo projeto',
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        membrosEmails: [email],
        limiteMembros: DEFAULT_LIMITE_MEMBROS
      }),
      criadoPor: email,
      mpPreapprovalId: preapprovalId,
      mpPlanId: preapproval.preapproval_plan_id || null,
      ativo: true
    }, { merge: true });

    res.status(200).send('acesso liberado');
  } catch (e) {
    console.error('Erro no webhook do Mercado Pago:', e);
    res.status(500).send('erro interno');
  }
}

exports.mercadoPagoWebhook = onRequest({ secrets: [MERCADOPAGO_ACCESS_TOKEN], region: 'southamerica-east1', maxInstances: 10 }, handleMercadoPagoWebhook);

// Avisa por e-mail quando alguém é adicionado ao "Quem tem acesso a este
// projeto" (Admin → Acesso) — chamado pelo app logo depois do arrayUnion
// em membrosEmails ter sucesso. Só o admin do projeto (ou master) pode
// disparar, e só pra um e-mail que já esteja mesmo na lista de membros —
// evita virar um jeito de mandar e-mail arbitrário pra qualquer endereço.
async function notificarNovoMembroLogica(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faça login pra adicionar acesso.');
  }
  const callerEmail = (request.auth.token.email || '').toLowerCase();
  const { projetoId, email } = request.data || {};
  if (!projetoId || typeof projetoId !== 'string' || !email || typeof email !== 'string') {
    throw new HttpsError('invalid-argument', 'Faltou informar o projeto ou o e-mail.');
  }
  const emailNormalizado = email.toLowerCase().trim();

  const projetoSnap = await db.doc(`projetos/${projetoId}`).get();
  if (!projetoSnap.exists) {
    throw new HttpsError('not-found', 'Projeto não encontrado.');
  }
  const projeto = projetoSnap.data();
  const isAdmin = callerEmail === MASTER_EMAIL ||
    (typeof projeto.criadoPor === 'string' && projeto.criadoPor.toLowerCase() === callerEmail);
  if (!isAdmin) {
    throw new HttpsError('permission-denied', 'Só o admin do projeto pode notificar novos membros.');
  }
  if (!Array.isArray(projeto.membrosEmails) || !projeto.membrosEmails.includes(emailNormalizado)) {
    throw new HttpsError('failed-precondition', 'Esse e-mail ainda não foi adicionado ao projeto.');
  }

  const nomeProjeto = projeto.nome || 'seu projeto de reforma';
  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY.value()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Simplifica Projetos <onboarding@resend.dev>',
      to: [emailNormalizado],
      subject: `Você foi adicionado ao projeto "${nomeProjeto}"`,
      html: `
        <p>Olá!</p>
        <p>Você agora tem acesso ao projeto <strong>${nomeProjeto}</strong> no Simplifica Projetos — cronograma, cotações, prestadores e financeiro, tudo num só lugar.</p>
        <p>Pra acessar: entre em <a href="https://richardpessuti.github.io/Simplifica-projetos/app.html">richardpessuti.github.io/Simplifica-projetos/app.html</a> e crie sua conta usando <strong>exatamente este e-mail</strong> (${emailNormalizado}). Depois de logar, o projeto já aparece pra você automaticamente.</p>
      `
    })
  });
  if (!resposta.ok) {
    const detalhe = await resposta.text();
    console.error('Erro ao enviar e-mail via Resend:', resposta.status, detalhe);
    throw new HttpsError('internal', 'Não consegui enviar o e-mail de convite.');
  }

  return { ok: true };
}

exports.notificarNovoMembro = onCall({ secrets: [RESEND_API_KEY], region: 'southamerica-east1', maxInstances: 10 }, notificarNovoMembroLogica);
