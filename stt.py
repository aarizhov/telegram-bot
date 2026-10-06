import sys
import warnings
warnings.filterwarnings("ignore")

import whisper

model = None

def get_model():
    global model
    if model is None:
        model_name = sys.argv[2] if len(sys.argv) > 2 else "base"
        model = whisper.load_model(model_name)
    return model

def main():
    audio_file = sys.argv[1]
    m = get_model()
    result = m.transcribe(audio_file, language="ru", fp16=False)
    print(result["text"].strip())

if __name__ == "__main__":
    main()
