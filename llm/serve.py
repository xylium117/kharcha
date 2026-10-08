#!/usr/bin/env python3
"""
serve.py — OpenAI-compatible streaming inference server for the Stash model.

The Next.js app calls /v1/chat/completions with streaming=true, just like
it would any OpenAI-compatible endpoint. No changes to the frontend needed —
only set AI_PROVIDER=local and LOCAL_LLM_URL=http://localhost:11434 in .env.local.

Usage:
  uv run python serve.py --model ./merged/stash-v1 --port 11434

  # Or with a HuggingFace Hub model:
  uv run python serve.py --model your-username/stash-v1 --port 11434

  # 4-bit quantisation (saves VRAM, slightly slower):
  uv run python serve.py --model ./merged/stash-v1 --load_in_4bit
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
import uuid
from typing import AsyncGenerator

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TextIteratorStreamer
from threading import Thread

# ---------------------------------------------------------------------------
# Schema (OpenAI-compatible subset)
# ---------------------------------------------------------------------------
class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    max_tokens: int = 1024
    temperature: float = 0.7
    top_p: float = 0.9
    stream: bool = True


# ---------------------------------------------------------------------------
# Global model state (loaded once at startup)
# ---------------------------------------------------------------------------
model = None
tokenizer = None


def load_model(model_path: str, load_in_4bit: bool) -> None:
    global model, tokenizer
    print(f"🔧 Loading tokenizer from {model_path}…")
    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)

    kwargs: dict = {"trust_remote_code": True, "device_map": "auto"}
    if load_in_4bit:
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_quant_type="nf4",
        )
        print("🔢 Loading model in 4-bit quantisation…")
    else:
        kwargs["torch_dtype"] = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        print("📦 Loading model in bf16…")

    model = AutoModelForCausalLM.from_pretrained(model_path, **kwargs)
    model.eval()
    print("✅ Model ready.")


# ---------------------------------------------------------------------------
# Streaming generation
# ---------------------------------------------------------------------------
async def stream_tokens(messages: list[Message], max_tokens: int, temperature: float, top_p: float) -> AsyncGenerator[str, None]:
    msg_dicts = [{"role": m.role, "content": m.content} for m in messages]
    prompt = tokenizer.apply_chat_template(msg_dicts, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    gen_kwargs = dict(
        **inputs,
        streamer=streamer,
        max_new_tokens=max_tokens,
        temperature=temperature,
        top_p=top_p,
        do_sample=temperature > 0,
        pad_token_id=tokenizer.eos_token_id,
    )

    thread = Thread(target=model.generate, kwargs=gen_kwargs, daemon=True)
    thread.start()

    req_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"
    for token_text in streamer:
        chunk = {
            "id": req_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": "Kharcha",
            "choices": [{"delta": {"content": token_text}, "index": 0, "finish_reason": None}],
        }
        yield f"data: {json.dumps(chunk)}\n\n"
        await asyncio.sleep(0)  # yield control to event loop

    # Final done chunk
    done = {
        "id": req_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": "Kharcha",
        "choices": [{"delta": {}, "index": 0, "finish_reason": "stop"}],
    }
    yield f"data: {json.dumps(done)}\n\n"
    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Stash LLM Server")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest):
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    if req.stream:
        return StreamingResponse(
            stream_tokens(req.messages, req.max_tokens, req.temperature, req.top_p),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Non-streaming: collect all tokens and return a single response object
    msg_dicts = [{"role": m.role, "content": m.content} for m in req.messages]
    prompt = tokenizer.apply_chat_template(msg_dicts, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=req.max_tokens,
            temperature=req.temperature if req.temperature > 0 else None,
            top_p=req.top_p,
            do_sample=req.temperature > 0,
            pad_token_id=tokenizer.eos_token_id,
        )
    new_ids = output_ids[0][inputs["input_ids"].shape[-1]:]
    text = tokenizer.decode(new_ids, skip_special_tokens=True)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "Kharcha",
        "choices": [{"message": {"role": "assistant", "content": text}, "index": 0, "finish_reason": "stop"}],
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="Path to merged model dir or HF Hub repo")
    parser.add_argument("--port", type=int, default=11434)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--load_in_4bit", action="store_true", help="Load model in 4-bit (saves VRAM)")
    args = parser.parse_args()

    load_model(args.model, args.load_in_4bit)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
