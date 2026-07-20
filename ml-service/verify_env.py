"""环境验证：torch CUDA + 两模型可加载"""
import sys
import os

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

# Windows GBK 控制台兼容
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

def main():
    errors = []

    # 1. torch + CUDA
    try:
        import torch
        print(f"torch {torch.__version__}")
        print(f"  CUDA available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"  GPU: {torch.cuda.get_device_name(0)}")
            print(f"  VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
        else:
            errors.append("CUDA not available — torch may be CPU-only")
    except ImportError:
        errors.append("torch not installed")

    # 2. transformers
    try:
        import transformers
        print(f"transformers {transformers.__version__}")
    except ImportError:
        errors.append("transformers not installed")

    # 3. seqeval
    try:
        import seqeval
        print(f"seqeval OK")
    except ImportError:
        errors.append("seqeval not installed")

    # 4. sentence-transformers
    try:
        import sentence_transformers
        print(f"sentence-transformers {sentence_transformers.__version__}")
    except ImportError:
        errors.append("sentence-transformers not installed")

    # 5. bert-base-chinese 可加载
    try:
        from transformers import AutoTokenizer, AutoModel
        print("Loading bert-base-chinese...")
        tok = AutoTokenizer.from_pretrained("bert-base-chinese")
        mdl = AutoModel.from_pretrained("bert-base-chinese")
        print(f"  bert-base-chinese OK (vocab={tok.vocab_size})")
        del tok, mdl
    except Exception as e:
        errors.append(f"bert-base-chinese load failed: {e}")

    # 6. bge-small-zh-v1.5 可加载
    try:
        from sentence_transformers import SentenceTransformer
        print("Loading bge-small-zh-v1.5...")
        m = SentenceTransformer("BAAI/bge-small-zh-v1.5")
        dim = m.get_embedding_dimension()
        print(f"  bge-small-zh-v1.5 OK (dim={dim})")
        del m
    except Exception as e:
        errors.append(f"bge-small-zh-v1.5 load failed: {e}")

    # 结果
    print()
    if errors:
        print("FAIL:")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)
    else:
        print("PASS — environment ready")
        sys.exit(0)

if __name__ == "__main__":
    main()
