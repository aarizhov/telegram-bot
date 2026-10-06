# AGENTS.md

## Обзор проекта

Telegram-бот на Node.js с AI-ответами, распознаванием и синтезом речи.

## Стек

- **Runtime:** Node.js 18 (ESM modules, `"type": "module"`)
- **Фреймворк бота:** Telegraf v4
- **AI:** OpenRouter API (GPT-3.5-turbo)
- **STT (речь → текст):** Groq Whisper API
- **TTS (текст → речь):** Microsoft Edge TTS через Python-скрипт `tts.py`
- **HTTP:** axios, form-data

## Структура

- `bot.js` — основной файл бота (точка входа)
- `tts.py` — Python-скрипт для синтеза речи (вызывается из Node.js через child_process)
- `.env` — секреты (BOT_TOKEN, ADMIN_CHAT_ID, OPENROUTER_API_KEY, GROQ_API_KEY)

## Запуск

```bash
npm start
```

Требуется установленный `edge-tts` для Python: `pip3 install edge-tts`

## Важные детали

- Бот отвечает только в личных сообщениях, в группе только запоминает chat ID
- Контекст диалога хранится в памяти (Map), 50 последних сообщений на пользователя, сбрасывается при перезапуске
- TTS работает через вызов Python из Node.js (stdin → файл → Buffer), потому что Node-пакеты для Edge TTS нестабильны на Node 18
- Голосовые ответы включены по умолчанию, переключаются командой `/voice`
- Group chat ID захардкожен как fallback: `-5157172835`
- При запуске отправляет "Бот запущен!" админу в личку

## Соглашения

- Коммиты на русском языке
- Код на JavaScript (ESM), комментарии на русском
