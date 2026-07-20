"""BERT-NER 微调"""
import os
import sys

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import BertForTokenClassification, BertTokenizerFast
from torch.optim import AdamW

# Windows GBK 控制台兼容
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models", "bert-ner")
LABEL_LIST = ["O", "B-Mineral", "I-Mineral", "B-Rock", "I-Rock",
              "B-Structure", "I-Structure", "B-TimePeriod", "I-TimePeriod",
              "B-DepositType", "I-DepositType"]
LABEL2ID = {l: i for i, l in enumerate(LABEL_LIST)}
ID2LABEL = {i: l for l, i in LABEL2ID.items()}
IGNORE_LABEL_ID = -100

class NERDataset(Dataset):
    def __init__(self, conll_path, tokenizer, max_len=128):
        self.sentences = self._read_conll(conll_path)
        self.tokenizer = tokenizer
        self.max_len = max_len

    def _read_conll(self, path):
        sentences, current = [], []
        with open(path, encoding="utf-8") as f:
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

    def __len__(self):
        return len(self.sentences)

    def __getitem__(self, idx):
        chars, labels = zip(*self.sentences[idx])
        chars, labels = list(chars), list(labels)

        # 截断
        chars = chars[:self.max_len]
        labels = labels[:self.max_len]

        # 中文 BERT：每个字 = 一个 token，天然对齐
        encoding = self.tokenizer(
            chars,
            is_split_into_words=True,
            padding="max_length",
            truncation=True,
            max_length=self.max_len,
            return_tensors="pt"
        )

        # 标签对齐：padding 位置标 -100
        label_ids = []
        for i, label in enumerate(labels):
            if i < self.max_len:
                label_ids.append(LABEL2ID.get(label, LABEL2ID["O"]))
        # padding
        while len(label_ids) < self.max_len:
            label_ids.append(IGNORE_LABEL_ID)

        encoding["labels"] = torch.tensor([label_ids])
        return {k: v.squeeze(0) for k, v in encoding.items()}

def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    # 加载 tokenizer
    tokenizer = BertTokenizerFast.from_pretrained("bert-base-chinese")

    # 加载数据
    train_ds = NERDataset(os.path.join(OUTPUT_DIR, "train.conll"), tokenizer)
    val_ds = NERDataset(os.path.join(OUTPUT_DIR, "val.conll"), tokenizer)
    print(f"Train: {len(train_ds)} 句, Val: {len(val_ds)} 句")

    train_loader = DataLoader(train_ds, batch_size=16, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=16)

    # 模型
    model = BertForTokenClassification.from_pretrained(
        "bert-base-chinese",
        num_labels=len(LABEL_LIST),
        id2label=ID2LABEL,
        label2id=LABEL2ID
    ).to(device)

    # 优化器
    optimizer = AdamW(model.parameters(), lr=2e-5)

    # 训练
    EPOCHS = 18
    for epoch in range(EPOCHS):
        model.train()
        total_loss = 0
        for batch in train_loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            outputs = model(**batch)
            loss = outputs.loss
            loss.backward()
            optimizer.step()
            optimizer.zero_grad()
            total_loss += loss.item()

        avg_loss = total_loss / len(train_loader)
        print(f"Epoch {epoch+1}/{EPOCHS} — loss: {avg_loss:.4f}")

    # 保存
    os.makedirs(MODEL_DIR, exist_ok=True)
    model.save_pretrained(MODEL_DIR)
    tokenizer.save_pretrained(MODEL_DIR)
    print(f"\n模型已保存到 {MODEL_DIR}")

if __name__ == "__main__":
    main()
