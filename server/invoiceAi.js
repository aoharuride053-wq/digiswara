// Analisis invoice Lynk.id memakai TokenHarbor Vision; PDF teks dibaca lokal.

const { normalizeRefId, isValidRefId, extractEmail } = require('./lynk');
const { PDFParse } = require('pdf-parse');

const TOKENHARBOR_BASE_URL = (process.env.TOKENHARBOR_BASE_URL || 'https://tokenharbor.ai/v1').replace(/\/$/, '');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_invoice: { type: 'BOOLEAN' },
    ref_id: { type: 'STRING' },
    email: { type: 'STRING' },
    customer_name: { type: 'STRING' },
    product_title: { type: 'STRING' },
    amount: { type: 'NUMBER' },
    notes: { type: 'STRING' }
  },
  required: ['is_invoice', 'ref_id']
};

const buildPrompt = () => [
  'Kamu adalah asisten verifikasi invoice pembelian dari Lynk.id.',
  'Analisis dokumen/invoice pada lampiran ini lalu ekstrak data berikut.',
  '',
  'Ketentuan REF ID:',
  '- REF ID adalah kode referensi pembayaran dari Lynk.id, berupa tepat 32 karakter huruf dan angka (tanpa spasi, tanpa strip).',
  '- Salin persis seperti tertulis di invoice. Jika tertulis dengan spasi/strip, gabungkan menjadi 32 karakter huruf dan angka.',
  '- Prioritaskan nilai tepat setelah label "Ref id:" atau "REF ID:"; nilainya bisa berada di baris berikutnya.',
  '- Jangan gabungkan REF ID dengan tanggal, jam, nominal, atau teks di sekitarnya.',
  '- Jika invoice tidak berisi REF ID 32 karakter, kembalikan ref_id berupa string kosong.',
  '',
  'Field lain:',
  '- is_invoice: true jika dokumen ini benar invoice/receipt pembelian, false jika bukan.',
  '- email: email pembeli yang tertera di invoice (lowercase).',
  '- customer_name: nama pembeli.',
  '- product_title: nama produk yang dibeli.',
  '- amount: total pembayaran dalam angka (tanpa titik/koma), jika tertulis.',
  '- notes: catatan singkat (mis. "bukan invoice", "REF ID tidak ditemukan").',
  '',
  'Balas HANYA dengan objek JSON sesuai schema.'
].join('\n');

// Validasi hasil AI: pastikan REF ID benar-benar 32 karakter huruf & angka.
const validateExtraction = (result) => {
  const rawRef = String(result?.ref_id || '');
  const normalized = normalizeRefId(rawRef);

  if (isValidRefId(normalized)) {
    return { ok: true, refId: normalized, reason: 'ok' };
  }

  // Cadangan: kalau AI menuliskan kandidat lain di notes atau teks sekitarnya.
  const candidates = [rawRef, String(result?.notes || '')]
    .map(normalizeRefId)
    .filter((value) => isValidRefId(value));
  if (candidates.length) {
    return { ok: true, refId: candidates[0], reason: 'ok_from_fallback' };
  }

  if (normalized.length === 0) return { ok: false, reason: 'ref_not_found' };
  return { ok: false, reason: 'ref_invalid_format' };
};

const extractRefIdFromText = (text) => {
  const matches = String(text || '').matchAll(
    /(?:ref(?:erence)?\s*id)\s*:?\s*([A-Za-z0-9][A-Za-z0-9\s-]{31,120})/gi
  );
  for (const match of matches) {
    const candidate = normalizeRefId(match[1]).slice(0, 32);
    if (isValidRefId(candidate)) return candidate;
  }
  return null;
};

const extractPdfText = async (base64Data) => {
  const parser = new PDFParse({ data: Buffer.from(base64Data, 'base64') });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
};

// Fallback diperlukan karena dukungan gambar dan kapasitas model gratis berbeda.
const TOKENHARBOR_VISION_MODELS = (
  process.env.TOKENHARBOR_INVOICE_MODELS
    || 'mimo-v2.6-flash:free,deepseek-v4.1-flash:free,qwen3.8-flash:free'
)
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

const parseModelJson = (content) => {
  const text = Array.isArray(content)
    ? content.map((part) => part.text || '').join('')
    : String(content || '');
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean);
};

const readWithTokenHarbor = async ({ imageMimeType, imageBase64 }) => {
  if (!process.env.TOKENHARBOR_API_KEY) {
    const error = new Error('TOKENHARBOR_API_KEY belum diisi di file .env.');
    error.code = 'TOKENHARBOR_KEY_MISSING';
    throw error;
  }

  let lastError;
  for (const model of TOKENHARBOR_VISION_MODELS) {
    let response;
    try {
      response = await fetch(`${TOKENHARBOR_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.TOKENHARBOR_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: buildPrompt() },
              {
                type: 'image_url',
                image_url: { url: `data:${imageMimeType};base64,${imageBase64}` }
              }
            ]
          }],
          temperature: 0,
          max_tokens: 512
        }),
        signal: AbortSignal.timeout(90000)
      });
    } catch (requestError) {
      lastError = requestError;
      continue;
    }

    if (!response.ok) {
      const responseText = await response.text();
      let detail = responseText;
      try {
        detail = JSON.parse(responseText)?.error?.message || responseText;
      } catch (_) {
        // Keep the provider response when it is not JSON.
      }
      lastError = new Error(`TokenHarbor ${model} (${response.status}): ${detail}`);
      if (response.status === 401 || response.status === 403) {
        lastError.code = 'TOKENHARBOR_AUTH_FAILED';
        lastError.status = response.status;
        throw lastError;
      }
      continue;
    }

    try {
      const data = await response.json();
      const parsed = parseModelJson(data.choices?.[0]?.message?.content);
      const validation = validateExtraction(parsed);
      if (parsed.is_invoice === false) throw new Error('Model tidak mengenali dokumen sebagai invoice.');
      if (!validation.ok) throw new Error('Model tidak menemukan REF ID 32 karakter pada invoice.');
      return {
        isInvoice: true,
        refId: validation.refId,
        refValidation: validation,
        email: extractEmail(parsed.email),
        customerName: parsed.customer_name ? String(parsed.customer_name) : null,
        productTitle: parsed.product_title ? String(parsed.product_title) : null,
        amount: parsed.amount != null ? Number(parsed.amount) : null,
        notes: parsed.notes ? String(parsed.notes) : null,
        model
      };
    } catch (parseError) {
      lastError = parseError;
    }
  }

  const error = new Error(lastError?.message || 'Semua model TokenHarbor gagal membaca invoice.');
  error.code = 'TOKENHARBOR_VISION_FAILED';
  throw error;
};
async function extractInvoiceData({ base64Data, mimeType }) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    const error = new Error('Format file harus PDF, PNG, JPG, JPEG, WEBP, atau GIF.');
    error.code = 'INVALID_FILE_TYPE';
    throw error;
  }

  if (mimeType === 'application/pdf') {
    try {
      const text = await extractPdfText(base64Data);
      const refId = extractRefIdFromText(text);
      if (refId && /lynk/i.test(text) && /invoice/i.test(text)) {
        return {
          isInvoice: true,
          refId,
          refValidation: { ok: true, refId, reason: 'pdf_text_layer' },
          email: extractEmail(text),
          customerName: null,
          productTitle: null,
          amount: null,
          notes: null
        };
      }
    } catch (error) {
      console.warn('PDF text extraction failed; trying TokenHarbor Vision:', error.message);
    }
  }

  let imageBase64 = base64Data;
  let imageMimeType = mimeType;
  if (mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: Buffer.from(base64Data, 'base64') });
    try {
      const screenshot = await parser.getScreenshot({ first: 1, scale: 1.5 });
      const firstPage = screenshot.pages?.[0];
      if (!firstPage?.data) throw new Error('PDF tidak dapat dirender menjadi gambar.');
      imageBase64 = Buffer.from(firstPage.data).toString('base64');
      imageMimeType = 'image/png';
    } catch (renderError) {
      const error = new Error(`PDF scan tidak dapat dibaca: ${renderError.message}`);
      error.code = 'PDF_RENDER_FAILED';
      throw error;
    } finally {
      await parser.destroy();
    }
  }

  return readWithTokenHarbor({ imageMimeType, imageBase64 });
}

module.exports = {
  extractInvoiceData,
  extractRefIdFromText,
  ALLOWED_MIME_TYPES,
  TOKENHARBOR_VISION_MODELS
};
