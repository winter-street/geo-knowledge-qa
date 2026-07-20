"""BERT-NER 评估：seqeval 分层达标"""
import os
import sys

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

import torch
from transformers import BertForTokenClassification, BertTokenizerFast
from seqeval.metrics import classification_report, f1_score as seq_f1

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models", "bert-ner")
TEST_PATH = os.path.join(os.path.dirname(__file__), "..", "output", "test.conll")
LABEL_LIST = ["O", "B-Mineral", "I-Mineral", "B-Rock", "I-Rock",
              "B-Structure", "I-Structure", "B-TimePeriod", "I-TimePeriod",
              "B-DepositType", "I-DepositType"]
ID2LABEL = {i: l for i, l in enumerate(LABEL_LIST)}
MAIN_TYPES = {"Mineral", "Rock"}


def read_conll(path):
    sentences, current = [], []
    with open(path, encoding="utf-8", newline="") as f:
        for line in f:
            line = line.strip()
            if not line:
                if current:
                    sentences.append(current)
                    current = []
            else:
                parts = line.split()
                if len(parts) == 2:
                    current.append((parts[0], parts[1]))
    if current:
        sentences.append(current)
    return sentences


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    tokenizer = BertTokenizerFast.from_pretrained(MODEL_DIR)
    model = BertForTokenClassification.from_pretrained(MODEL_DIR).to(device)
    model.eval()

    sentences = read_conll(TEST_PATH)
    print(f"测试集: {len(sentences)} 句")

    true_labels, pred_labels = [], []
    with torch.no_grad():
        for sent in sentences:
            chars, labels = zip(*sent)
            chars, labels = list(chars), list(labels)
            encoding = tokenizer(
                chars,
                is_split_into_words=True,
                padding=True,
                truncation=True,
                return_tensors="pt"
            ).to(device)
            outputs = model(**encoding)
            preds = outputs.logits.argmax(-1)[0].cpu().tolist()
            true_seq, pred_seq = [], []
            for i, label in enumerate(labels):
                if i < len(preds):
                    true_seq.append(label)
                    pred_seq.append(ID2LABEL.get(preds[i], "O"))
            true_labels.append(true_seq)
            pred_labels.append(pred_seq)

    print("\n=== 分类报告 ===")
    print(classification_report(true_labels, pred_labels))

    # 分层判定
    main_true, main_pred = [], []
    for true_seq, pred_seq in zip(true_labels, pred_labels):
        mt, mp = [], []
        for t, p in zip(true_seq, pred_seq):
            t_type = t[2:] if t.startswith(("B-", "I-")) else None
            if t_type in MAIN_TYPES or t_type is None:
                mt.append(t)
                mp.append(p)
            else:
                mt.append("O")
                mp.append("O")
        main_true.append(mt)
        main_pred.append(mp)

    main_f1 = seq_f1(main_true, main_pred)
    print(f"\n主力类 (Mineral+Rock) F1: {main_f1:.4f}")

    if main_f1 >= 0.70:
        print("达标 (>= 0.70)")
    elif main_f1 < 0.5:
        print("降级线 (< 0.5) - 建议退回 LLM 方案")
    else:
        print("中间地带 (0.5-0.70) - 可用但需改进")


if __name__ == "__main__":
    main()
