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

// Настройки пользователей (голосовой ответ вкл/выкл)
const userSettings = new Map();

function getVoiceMode(userId) {
  return userSettings.get(userId) ?? true; // по умолчанию включено
}

// Хранилище контекста диалогов
const conversationContext = new Map();

function getUserContext(userId) {
  if (!conversationContext.has(userId)) {
    conversationContext.set(userId, []);
  }
  return conversationContext.get(userId).slice(-50);
}

// Синтез речи через Microsoft Edge TTS (Python)
const __dirname = path.dirname(new URL(import.meta.url).pathname);

async function textToSpeech(text) {
  const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
  const scriptPath = path.join(__dirname, 'tts.py');

  const child = execFile('python3', [scriptPath, tmpFile], { timeout: 15000 });
  child.stdin.write(text);
  child.stdin.end();

  await new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`TTS exited with code ${code}`));
    });
    child.on('error', reject);
  });

  const audioBuffer = fs.readFileSync(tmpFile);
  fs.unlinkSync(tmpFile);
  return audioBuffer;
}

// Распознавание речи через Groq Whisper
async function recognizeSpeech(audioBuffer, filename) {
  const form = new FormData();
  form.append('file', audioBuffer, { filename: filename || 'voice.ogg', contentType: 'audio/ogg' });
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

// Ответ через OpenRouter AI
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

// Отправка ответа — текстом или голосом
async function sendReply(ctx, text) {
  if (!text) return;

  if (getVoiceMode(ctx.from.id)) {
    try {
      const audioBuffer = await textToSpeech(text);
      await ctx.replyWithVoice({ source: audioBuffer, filename: 'reply.mp3' });
    } catch (err) {
      console.error('Ошибка TTS:', err.message);
      await ctx.reply(text); // fallback на текст
    }
  } else {
    await ctx.reply(text);
  }
}

bot.command('start', (ctx) => {
  ctx.reply(
    'Бот запущен! Я могу отвечать на вопросы текстом и голосом.\n\n' +
    'Команды:\n' +
    '/voice — включить/выключить голосовые ответы\n' +
    '/send <текст> — отправить сообщение в группу\n' +
    '/chatid — показать ID чата'
  );
});

bot.command('voice', (ctx) => {
  const current = getVoiceMode(ctx.from.id);
  userSettings.set(ctx.from.id, !current);
  ctx.reply(`Голосовые ответы: ${!current ? '🔊 включены' : '🔇 выключены'}`);
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

bot.on('message', async (ctx) => {
  // Запоминаем группу
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    if (groupChatId !== ctx.chat.id) {
      groupChatId = ctx.chat.id;
      console.log(`Группа найдена: "${ctx.chat.title}" (ID: ${groupChatId})`);
    }
    return;
  }

  // Голосовое сообщение
  if (ctx.message.voice) {
    try {
      console.log('Получено голосовое сообщение');
      const fileLink = await bot.telegram.getFileLink(ctx.message.voice.file_id);
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(response.data);

      const recognizedText = await recognizeSpeech(audioBuffer, 'voice.ogg');
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

  // Текстовое сообщение (только в личке)
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
console.log('Бот запущен!');

if (ADMIN_CHAT_ID) {
  bot.telegram.sendMessage(ADMIN_CHAT_ID, 'Бот запущен!').catch(() => {});
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
