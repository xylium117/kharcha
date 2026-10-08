# Stash 🦉 — Fine-tuned LLM

Fine-tunes **Qwen2.5-7B-Instruct** with QLoRA on Stash-style financial Q&A, then serves it as a drop-in replacement for the Gemini/Claude backends.

## Directory layout

```
llm/
├── README.md              ← you are here
├── generate_data.py       ← generate training data (JSONL)
├── finetune.py            ← QLoRA fine-tuning (LoRA adapters)
├── merge.py               ← merge LoRA into full model weights
├── serve.py               ← FastAPI inference server (OpenAI-compatible)
├── requirements.txt       ← Python deps
└── data/
    └── Kharcha_train.jsonl   (generated, not committed)
```

## Quickstart

### 0 — Prerequisites
- Python 3.10+, `uv` (`pip install uv` or `irm https://astral.sh/uv/install.ps1 | iex`)
- NVIDIA GPU with ≥12 GB VRAM for fine-tuning (or use Google Colab free T4)
- CPU-only inference is possible but slow; quantised GGUF + llama.cpp is recommended for CPU

### 1 — Install dependencies
```bash
cd llm
uv venv .venv
uv pip install -r requirements.txt
```

### 2 — Generate training data
```bash
uv run python generate_data.py --out data/Kharcha_train.jsonl --samples 2000
```
This synthesises realistic student finance scenarios using the same system prompt as the live app. Review a few rows before training.

### 3 — Fine-tune (GPU required)
```bash
uv run python finetune.py \
  --data data/Kharcha_train.jsonl \
  --base_model Qwen/Qwen2.5-7B-Instruct \
  --output_dir ./checkpoints/Kharcha-v1 \
  --epochs 3 \
  --lora_r 64
```
Takes ~2–4 h on a single A100 or ~8 h on a T4 (Colab).

### 4 — Merge LoRA adapters into full model
```bash
uv run python merge.py \
  --adapter ./checkpoints/Kharcha-v1 \
  --base_model Qwen/Qwen2.5-7B-Instruct \
  --output_dir ./merged/Kharcha-v1
```

### 5 — Run inference server
```bash
uv run python serve.py --model ./merged/Kharcha-v1 --port 11434
```

### 6 — Point the app at it
Add to `.env.local`:
```
AI_PROVIDER=local
LOCAL_LLM_URL=http://localhost:11434
```

## CPU / low-VRAM option (GGUF + llama.cpp)
After merging, convert to GGUF and use `llama-server` instead of `serve.py`. See [llama.cpp docs](https://github.com/ggerganov/llama.cpp).

## Hugging Face Hub
Push merged model:
```bash
huggingface-cli login
python -c "from transformers import AutoModelForCausalLM, AutoTokenizer; \
  m=AutoModelForCausalLM.from_pretrained('./merged/Kharcha-v1'); \
  m.push_to_hub('your-username/Kharcha-v1')"
```
Then set `LOCAL_LLM_URL` to point at your HF Inference Endpoint.
