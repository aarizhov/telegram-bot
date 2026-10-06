import { Telegraf } from 'telegraf';
import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const bot = new Telegraf(process.env.BOT_TOKEN);

let groupChatId = -5157172835;
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const STT_MODE = process.env.STT_MODE || 'api';   // 'local' или 'api'
const TTS_MODE = process.env.TTS_MODE || 'api';   // 'local' или 'api'

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Настройки пользователей
const userSettings = new Map();
const userVoice = new Map();

const AVAILABLE_VOICES = TTS_MODE === 'local'
  ? { 'ирина 🇷🇺 (локально)': 'local' }
  : {
      'дмитрий 🇷🇺': 'ru-RU-DmitryNeural',
      'светлана 🇷🇺': 'ru-RU-SvetlanaNeural',
      'остап 🇺🇦': 'uk-UA-OstapNeural',
      'полина 🇺🇦': 'uk-UA-PolinaNeural',
    };

function getVoiceMode(userId) {
  return userSettings.get(userId) ?? true;
}

function getUserVoice(userId) {
  return userVoice.get(userId) ?? Object.values(AVAILABLE_VOICES)[0];
}

// Хранилище контекста диалогов
const conversationContext = new Map();

function getUserContext(userId) {
  if (!conversationContext.has(userId)) {
    conversationContext.set(userId, []);
  }
  return conversationContext.get(userId).slice(-50);
}

// ========== TTS ==========

// Локальный TTS через Piper
async function textToSpeechLocal(text) {
  if (text.length > 1000) text = text.substring(0, 997) + '...';
  const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.wav`);
  const scriptPath = path.join(__dirname, 'tts_local.py');

  const child = execFile('python3', [scriptPath, tmpFile], { timeout: 60000 });
  child.stdin.write(text);
  child.stdin.end();

  await new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Local TTS exited with code ${code}`));
    });
    child.on('error', reject);
  });

  const audioBuffer = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  return audioBuffer;
}

// API TTS через Edge TTS
async function textToSpeechAPI(text, voice = 'ru-RU-DmitryNeural') {
  if (text.length > 1000) text = text.substring(0, 997) + '...';
  const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
  const scriptPath = path.join(__dirname, 'tts.py');

  const child = execFile('python3', [scriptPath, tmpFile, voice], { timeout: 60000 });
  child.stdin.write(text);
  child.stdin.end();

  await new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Edge TTS exited with code ${code}`));
    });
    child.on('error', reject);
  });

  const audioBuffer = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  return audioBuffer;
}

async function textToSpeech(text, voice) {
  if (TTS_MODE === 'local') {
    return textToSpeechLocal(text);
  }
  return textToSpeechAPI(text, voice);
}

// ========== STT ==========

// Локальный STT через Whisper
async function recognizeSpeechLocal(audioBuffer) {
  const tmpFile = path.join(os.tmpdir(), `stt_${Date.now()}.ogg`);
  fs.writeFileSync(tmpFile, audioBuffer);

  const scriptPath = path.join(__dirname, 'stt.py');
  const { stdout } = await execFileAsync('python3', [scriptPath, tmpFile], { timeout: 120000 });

  fs.unlinkSync(tmpFile);
  return stdout.trim();
}

// API STT через Groq Whisper
async function recognizeSpeechAPI(audioBuffer) {
  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  form.append('model', 'whisper-large-v3');
  form.append('language', 'ru');

  const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      ...form.getHeaders(),
    },
    maxContentLength: Infinity,
  });

  return response.data.text;
}

async function recognizeSpeech(audioBuffer) {
  if (STT_MODE === 'local') {
    return recognizeSpeechLocal(audioBuffer);
  }
  return recognizeSpeechAPI(audioBuffer);
}

// ========== AI ==========

async function getAIReply(userId, userMessage) {
  if (!OPENROUTER_API_KEY) return null;

  const userContext = getUserContext(userId);
  const messages = [...userContext, { role: 'user', content: userMessage }];

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    { model: 'openai/gpt-3.5-turbo', messages, max_tokens: 200 },
    {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const reply = response.data.choices[0]?.message?.content;

  const ctx = conversationContext.get(userId) || [];
  ctx.push({ role: 'user', content: userMessage });
  ctx.push({ role: 'assistant', content: reply });
  conversationContext.set(userId, ctx.slice(-50));

  return reply;
}

// ========== Ответ ==========

async function sendReply(ctx, text) {
  if (!text) return;

  if (getVoiceMode(ctx.from.id)) {
    try {
      console.log(`TTS: ${TTS_MODE} | Текст: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      const audioBuffer = await textToSpeech(text, getUserVoice(ctx.from.id));
      const ext = TTS_MODE === 'local' ? 'wav' : 'mp3';
      console.log(`TTS: отправлено (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
      await ctx.replyWithVoice({ source: audioBuffer, filename: `reply.${ext}` });
    } catch (err) {
      console.error('Ошибка TTS:', err.message);
      await ctx.reply(text);
    }
  } else {
    await ctx.reply(text);
  }
}

// ========== Команды ==========

bot.command('start', (ctx) => {
  const mode = `STT: ${STT_MODE === 'local' ? '🖥 локальный Whisper' : '☁️ Groq API'} | TTS: ${TTS_MODE === 'local' ? '🖥 локальный Piper' : '☁️ Edge TTS'}`;
  ctx.reply(
    'Бот запущен! Я могу отвечать на вопросы текстом и голосом.\n\n' +
    `Режим: ${mode}\n\n` +
    'Команды:\n' +
    '/voice — включить/выключить голосовые ответы\n' +
    '/setvoice — выбрать голос\n' +
    '/send <текст> — отправить сообщение в группу\n' +
    '/chatid — показать ID чата'
  );
});

bot.command('voice', (ctx) => {
  const current = getVoiceMode(ctx.from.id);
  userSettings.set(ctx.from.id, !current);
  ctx.reply(`Голосовые ответы: ${!current ? '🔊 включены' : '🔇 выключены'}`);
});

bot.command('setvoice', (ctx) => {
  const current = getUserVoice(ctx.from.id);
  const buttons = Object.entries(AVAILABLE_VOICES).map(([name, id]) => {
    const label = id === current ? `✅ ${name}` : name;
    return [{ text: label, callback_data: `voice_${name}` }];
  });
  ctx.reply('Выбери голос:', {
    reply_markup: { inline_keyboard: buttons },
  });
});

bot.action(/^voice_(.+)$/, (ctx) => {
  const name = ctx.match[1];
  const voice = AVAILABLE_VOICES[name];
  if (voice) {
    userVoice.set(ctx.from.id, voice);
    ctx.answerCbQuery(`Голос: ${name} 🔊`);
    ctx.editMessageText(`Голос изменён на: ${name} 🔊`);
  }
});

bot.command('chatid', (ctx) => {
  ctx.reply(`Chat ID: ${ctx.chat.id}`);
});

bot.command('send', async (ctx) => {
  if (!groupChatId) return ctx.reply('Группа ещё не найдена.');
  const text = ctx.message.text.replace(/^\/send\s*/, '').trim();
  if (!text) return ctx.reply('Напиши: /send <текст сообщения>');
  try {
    await bot.telegram.sendMessage(groupChatId, text);
    await ctx.reply('Отправлено в группу!');
  } catch (err) {
    await ctx.reply('Ошибка: ' + err.message);
  }
});

// ========== Обработка сообщений ==========

bot.on('message', async (ctx) => {
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    if (groupChatId !== ctx.chat.id) {
      groupChatId = ctx.chat.id;
      console.log(`Группа найдена: "${ctx.chat.title}" (ID: ${groupChatId})`);
    }
    return;
  }

  if (ctx.message.voice) {
    try {
      const fileLink = await bot.telegram.getFileLink(ctx.message.voice.file_id);
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(response.data);
      console.log(`STT: ${STT_MODE} | Получено голосовое (${(audioBuffer.length / 1024).toFixed(1)} KB)`);

      const recognizedText = await recognizeSpeech(audioBuffer);
      console.log('Распознано:', recognizedText);

      await ctx.reply(`🎤 "${recognizedText}"`);

      const aiReply = await getAIReply(ctx.from.id, recognizedText);
      if (aiReply) await sendReply(ctx, aiReply);
    } catch (err) {
      console.error('Ошибка голоса:', err.message);
      await ctx.reply('Не удалось распознать голосовое сообщение').catch(() => {});
    }
    return;
  }

  if (ctx.message.text && ctx.chat.type === 'private') {
    try {
      const aiReply = await getAIReply(ctx.from.id, ctx.message.text);
      await sendReply(ctx, aiReply || 'Не удалось получить ответ');
    } catch (err) {
      console.error('Ошибка AI:', err.message);
      await ctx.reply('Ошибка при обработке сообщения').catch(() => {});
    }
  }
});

bot.launch();
console.log(`Бот запущен! STT: ${STT_MODE} | TTS: ${TTS_MODE}`);

bot.telegram.setMyCommands([
  { command: 'start', description: 'Запуск бота и список команд' },
  { command: 'voice', description: 'Вкл/выкл голосовые ответы' },
  { command: 'setvoice', description: 'Выбрать голос' },
  { command: 'send', description: 'Отправить сообщение в группу' },
  { command: 'chatid', description: 'Показать ID чата' },
]).catch(() => {});

if (ADMIN_CHAT_ID) {
  bot.telegram.sendMessage(ADMIN_CHAT_ID, 'Бот запущен!').catch(() => {});
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
