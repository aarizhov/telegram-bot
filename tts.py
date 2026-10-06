import sys
import asyncio
import edge_tts

async def main():
    text = sys.stdin.read().strip()
    output_file = sys.argv[1]
    voice = sys.argv[2] if len(sys.argv) > 2 else "ru-RU-DmitryNeural"

    max_retries = 3
    for attempt in range(max_retries):
        try:
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(output_file)
            return
        except Exception as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(2)
            else:
                raise e

asyncio.run(main())
