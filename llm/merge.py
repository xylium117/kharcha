#!/usr/bin/env python3
"""
merge.py — merge LoRA adapters into full model weights.

After fine-tuning, the checkpoint only contains the small LoRA delta.
This script fuses it back into the base model for fast inference
(no PEFT overhead, no quantisation required at runtime).

Usage:
  uv run python merge.py \\
    --adapter ./checkpoints/Kharcha-v1 \\
    --base_model Qwen/Qwen2.5-7B-Instruct \\
    --output_dir ./merged/Kharcha-v1
"""

from __future__ import annotations

import argparse

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True, help="Path to LoRA checkpoint directory")
    parser.add_argument("--base_model", default="Qwen/Qwen2.5-7B-Instruct")
    parser.add_argument("--output_dir", required=True)
    args = parser.parse_args()

    print(f"📦 Loading base model: {args.base_model}")
    base = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        torch_dtype=torch.bfloat16,
        device_map="cpu",          # merge on CPU to avoid VRAM pressure
        trust_remote_code=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(args.adapter, trust_remote_code=True)

    print(f"🔗 Applying LoRA adapters from: {args.adapter}")
    model = PeftModel.from_pretrained(base, args.adapter)

    print("⚙️  Merging and unloading LoRA weights…")
    model = model.merge_and_unload()

    print(f"💾 Saving merged model to: {args.output_dir}")
    model.save_pretrained(args.output_dir, safe_serialization=True)
    tokenizer.save_pretrained(args.output_dir)

    print("✅ Done! Merged model ready for serve.py")


if __name__ == "__main__":
    main()
