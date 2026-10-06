import { Telegraf } from 'telegraf';
import 'dotenv/config';

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

bot.on('message', (ctx) => {
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    if (groupChatId !== ctx.chat.id) {
      groupChatId = ctx.chat.id;
      console.log(`Группа найдена: "${ctx.chat.title}" (ID: ${groupChatId})`);
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
