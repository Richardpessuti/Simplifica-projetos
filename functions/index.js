const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const Anthropic = require('@anthropic-ai/sdk');
// pdf-to-img só existe como ESM — não dá pra usar require() nele a partir
// deste arquivo (CommonJS), por isso o import() dinâmico dentro da função.

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const MAX_PAGINAS = 3; // orçamentos costumam ter poucas páginas — evita custo/tempo alto num PDF gigante
const MODEL = 'claude-haiku-4-5-20251001'; // modelo mais barato — suficiente pra ler tabela de itens

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

exports.lerItensCotacao = onCall({ secrets: [ANTHROPIC_API_KEY], region: 'southamerica-east1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faça login pra usar a leitura automática.');
  }

  const { base64, fileName } = request.data || {};
  if (!base64 || typeof base64 !== 'string') {
    throw new HttpsError('invalid-argument', 'Nenhum arquivo enviado.');
  }

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
