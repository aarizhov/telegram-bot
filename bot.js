import { Telegraf } from 'telegraf';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const bot = new Telegraf(process.env.BOT_TOKEN);

let groupChatId = -5157172835;
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID);

bot.command('start', (ctx) => {
  ctx.reply('Бот запущен! Добавь меня в группу и дай права админа.');
});

bot.command('chatid', (ctx) => {
  ctx.reply(`Chat ID: ${ctx.chat.id}`);
});

bot.command('send', async (ctx) => {
  if (!groupChatId) {
    return ctx.reply('Группа ещё не найдена.');
  }
  const text = ctx.message.text.replace(/^\/send\s*/, '').trim();
  if (!text) {
    return ctx.reply('Напиши: /send <текст сообщения>');
  }
  try {
    await bot.telegram.sendMessage(groupChatId, text);
    await ctx.reply('Отправлено в группу!');
  } catch (err) {
    await ctx.reply('Ошибка: ' + err.message);
  }
});

bot.on('message', async (ctx) => {
  // Обработка групповых чатов
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    if (groupChatId !== ctx.chat.id) {
      groupChatId = ctx.chat.id;
      console.log(`Группа найдена: "${ctx.chat.title}" (ID: ${groupChatId})`);
    }
  }
  
  // Обработка голосовых сообщений
  if (ctx.message.voice) {
    try {
      const voice = ctx.message.voice;
      const file_id = voice.file_id;
      
      console.log('Получено голосовое сообщение:', file_id);
      
      // Скачиваем голосовое сообщение
      const file = await bot.telegram.getFile(file_id);
      const fileUrl = await file.getFileLink(process.env.BOT_TOKEN);
      
      // Скачиваем аудио
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const audioBuffer = Buffer.from(response.data);
      
      // Простой текстовый ответ (пока без распознавания речи)
      // Отправляем текстовое сообщение
      let botReply = "Вы отправили голосовое сообщение. Распознавание речи в разработке...";
      
      // Если есть OpenRouter API ключ, можем использовать LLM для ответа
      if (OPENROUTER_API_KEY) {
        try {
          const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              model: 'google/gemini-2.0-flash',
              messages: [
                { role: 'user', content: 'Пользователь отправил голосовое сообщение. Дай вежливый текстовый ответ.' }
              ]
            },
            {
              headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          botReply = response.data.choices[0]?.message?.content || botReply;
        } catch (err) {
          console.log('OpenRouter API error:', err.message);
        }
      }
      
      // Отправляем текстовый ответ
      await ctx.reply(botReply);
      
      // И также голосовое сообщение обратно
      await ctx.replyWithVoice(file_id, {
        caption: 'Ваше голосовое сообщение'
      });
    } catch (err) {
      console.error('Ошибка:', err);
      try {
        await ctx.reply('Не удалось обработать голосовое сообщение');
      } catch (e) {}
    }
  }
});

bot.launch();
console.log('Бот запущен!');

if (ADMIN_CHAT_ID) {
  bot.telegram.sendMessage(ADMIN_CHAT_ID, 'Бот запущен!').catch(() => {});
}

process.once('SIGINT', () => {
  bot.stop('SIGINT');
  console.log('Бот завершён!');
  if (ADMIN_CHAT_ID) {
    bot.telegram.sendMessage(ADMIN_CHAT_ID, 'Бот завершён!').catch(() => {});
  }
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  console.log('Бот завершён!');
  if (ADMIN_CHAT_ID) {
    bot.telegram.sendMessage(ADMIN_CHAT_ID, 'Бот завершён!').catch(() => {});
  }
});
