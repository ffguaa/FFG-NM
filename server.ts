import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '25mb' }));

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Variável GEMINI_API_KEY não configurada no servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.post('/api/inventory/parse-quality-image', async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body as {
      imageBase64?: string;
      mimeType?: string;
    };

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: 'Imagem do relatório não enviada.' });
      return;
    }

    const cleanBase64 = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;

    const ai = getGeminiClient();

    const promptText = `Você é um extrator OCR especialista em relatórios laboratoriais industriais de farinhas de origem animal (FFG - União Avícola).
Analise cuidadosamente a imagem anexa do Relatório de Qualidade da Produção e extraia TODAS as linhas da tabela.

As colunas esperadas na tabela são:
- DATA DE PRODUÇÃO
- HORARIO
- PERÍODO
- N° CODIGO DE BARRAS
- ACIDEZ
- IND. PEROXIDO
- UMIDADE
- EXTRATO ETÉREO
- PROTEÍNA BRUTA
- MATERIA MINERAL
- DIGESTIBILIDADE
- CLASSIFICAÇÃO

Regras estritas de extração:
1. Extraia TODAS as linhas visíveis que possuam N° CODIGO DE BARRAS.
2. Em "barcode", retorne apenas os dígitos/texto exato do N° CODIGO DE BARRAS sem espaços extras.
3. Converta números decimais com vírgula brasileira (ex: "58,40" ou "2,15") para números decimais padrão (58.4, 2.15).
4. Se alguma célula numérica ou a coluna CLASSIFICAÇÃO estiver em branco, vazia, com traço "-" ou ainda sem análise, retorne null para esse campo. NÃO invente nem estime valores.
5. Em "classification", normalize para "STANDARD" ou "COMERCIAL" em maiúsculas quando preenchido, ou null se estiver vazio/pendente.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/png',
              data: cleanBase64,
            },
          },
          { text: promptText },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              production_date: { type: Type.STRING, nullable: true },
              time: { type: Type.STRING, nullable: true },
              period: { type: Type.STRING, nullable: true },
              barcode: { type: Type.STRING },
              acidity: { type: Type.NUMBER, nullable: true },
              peroxide: { type: Type.NUMBER, nullable: true },
              moisture: { type: Type.NUMBER, nullable: true },
              ether_extract: { type: Type.NUMBER, nullable: true },
              crude_protein: { type: Type.NUMBER, nullable: true },
              mineral_matter: { type: Type.NUMBER, nullable: true },
              digestibility: { type: Type.NUMBER, nullable: true },
              classification: { type: Type.STRING, nullable: true },
            },
            required: ['barcode'],
          },
        },
      },
    });

    const rawText = (response.text ?? '[]').trim();
    const parsedRows = JSON.parse(rawText);

    res.json({ rows: Array.isArray(parsedRows) ? parsedRows : [] });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao processar imagem com Gemini Vision.';
    console.error('[Gemini Quality OCR Error]:', err);
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FFG-NM Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
