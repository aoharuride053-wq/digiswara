const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.PORT = '0';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'history-retention-smoke-secret';
process.env.GEMINI_API_KEY = 'mock-gemini-key';
process.env.GEMINI_TTS_MODELS = 'gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts,gemini-2.5-pro-preview-tts';
process.env.XKIRO_API_KEY = 'mock-xkiro-key';
process.env.XKIRO_VOICEOVER_MODELS = 'qwen/qwen3.7-flash:free,qwen/qwen3.8-omni-flash:free';

const nativeFetch = global.fetch;
const ttsModelsUsed = [];
global.fetch = async (url, options = {}) => {
  if (String(url).startsWith('https://api.xkiro.com/')) {
    const request = JSON.parse(options.body);
    const prompt = request.messages[0].content.toLowerCase();
    return new Response(JSON.stringify({
      model: request.model,
      choices: [{ message: { content: prompt.includes('tulis versi b') ? 'Naskah alternatif B.' : 'Naskah alternatif A.' } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (String(url).endsWith('/v1beta/interactions')) {
    const model = JSON.parse(options.body).model;
    ttsModelsUsed.push(model);
    return new Response(JSON.stringify({ error: { message: 'mock rate limit' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (String(url).includes('/models/') && String(url).endsWith(':generateContent')) {
    ttsModelsUsed.push(String(url).split('/models/')[1].split(':')[0]);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{
        inlineData: { data: Buffer.from('mock-pcm-audio').toString('base64'), mimeType: 'audio/L16;rate=24000' }
      }] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return nativeFetch(url, options);
};

const { server, db } = require('../server');
const token = jwt.sign({ id: 1, username: 'HistorySmoke' }, process.env.JWT_SECRET, { expiresIn: '1h' });
let audioUrl;
let legacyAudioPath;

const request = (baseUrl, route, options = {}) => fetch(`${baseUrl}${route}`, {
  ...options,
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers
  }
});

const closeTestServer = () => new Promise((resolve) => {
  server.close(() => db.close(resolve));
});

server.once('listening', async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let exitCode = 0;

  try {
    const voiceoverResponse = await request(baseUrl, '/api/voiceover/generate', {
      method: 'POST',
      body: JSON.stringify({
        target: 'Uji riwayat',
        audienceGender: 'umum',
        audienceAge: '18-24 tahun',
        audienceActivity: 'pengguna',
        duration: '30',
        description: '',
        tone: 'professional',
        expressionTags: true
      })
    });
    const voiceover = await voiceoverResponse.json();
    assert.strictEqual(voiceoverResponse.status, 200);
    assert.strictEqual(voiceover.versions.length, 2);
    assert.notStrictEqual(voiceover.versions[0].script, voiceover.versions[1].script);
    assert(voiceover.expiresAt - Date.now() <= 15 * 60 * 1000);

    const audioResponse = await request(baseUrl, '/api/tts/generate', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Uji audio dengan masa berlaku.',
        voiceModel: 'zephyr',
        tone: 'professional',
        language: 'id-ID'
      })
    });
    const audio = await audioResponse.json();
    assert.strictEqual(audioResponse.status, 200);
    assert(audio.expiresAt - Date.now() <= 15 * 60 * 1000);
    audioUrl = audio.audioUrl;

    const historyResponse = await request(baseUrl, '/api/history');
    const history = await historyResponse.json();
    assert.strictEqual(history.history.length, 1);
    assert.strictEqual(history.voiceovers.length, 1);

    const downloadedResponse = await request(baseUrl, `/api/history/${audio.id}/downloaded`, { method: 'POST' });
    assert.strictEqual(downloadedResponse.status, 200);

    const actualNow = Date.now;
    Date.now = () => actualNow() + 16 * 60 * 1000;
    const expiredResponse = await request(baseUrl, '/api/history');
    Date.now = actualNow;
    const expiredHistory = await expiredResponse.json();
    assert.strictEqual(expiredHistory.history.length, 0);
    assert.strictEqual(expiredHistory.voiceovers.length, 0);
    assert.deepStrictEqual(ttsModelsUsed, [
      'gemini-3.8-flash-lite-tts',
      'gemini-3.8-flash-tts',
      'gemini-3.1-flash-tts-preview'
    ]);

    const remainingRows = await new Promise((resolve, reject) => {
      db.get(
        `SELECT
           (SELECT COUNT(*) FROM tts_requests) AS audio_count,
           (SELECT COUNT(*) FROM voiceover_history) AS voiceover_count`,
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    assert.strictEqual(remainingRows.audio_count, 0);
    assert.strictEqual(remainingRows.voiceover_count, 0);

    console.log('PASS: two distinct voiceover scripts are saved and expire within 15 minutes.');
    console.log('PASS: downloaded audio is marked, and expired audio/voiceover rows are deleted.');
    console.log('PASS: TTS silently fails over through configured models after rate limits.');
  } catch (error) {
    exitCode = 1;
    console.error('FAIL:', error.message);
  } finally {
    if (audioUrl) {
      fs.rmSync(path.join(__dirname, '..', 'public', 'audio', path.basename(audioUrl)), { force: true });
    }
    await closeTestServer();
    process.exitCode = exitCode;
  }
});