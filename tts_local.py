import sys
import wave
import os
from piper import PiperVoice

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(SCRIPT_DIR, "models", "ru_RU-irina-medium.onnx")

voice = None

def get_voice():
    global voice
    if voice is None:
        voice = PiperVoice.load(MODEL_PATH)
    return voice

def main():
    text = sys.stdin.read().strip()
    output_file = sys.argv[1]

    v = get_voice()
    wav_file = wave.open(output_file, "wb")
    v.synthesize_wav(text, wav_file)
    wav_file.close()

if __name__ == "__main__":
    main()
