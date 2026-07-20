"""
幻觉率量化比较评估脚本

控制变量实验：同一个 DeepSeek LLM，对比"有检索增强(RAG+KG)" vs "无检索增强(裸LLM)"
在地质问答中的事实准确性差异，由 LLM-as-judge 逐句判定。

用法：
  python scripts/eval_hallucination.py           # 全量 15 题
  python scripts/eval_hallucination.py --test    # 测试模式，仅跑前 2 题
  python scripts/eval_hallucination.py --skip-llm  # 跳过 LLM 调用，仅运行 judge（需已有结果缓存）
"""
import os
import sys
import json
import time
import argparse

# 设置 HuggingFace 镜像（与其他脚本一致）
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# ============================================================
# 路径与配置
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
EVAL_DIR = os.path.join(PROJECT_ROOT, "ml-service", "eval")
RESULTS_FILE = os.path.join(EVAL_DIR, "hallucination_report.json")
CHART_FILE = os.path.join(EVAL_DIR, "hallucination_comparison.png")
CACHE_FILE = os.path.join(EVAL_DIR, "eval_cache.json")

sys.path.insert(0, BASE_DIR)
from config import LLM_CONFIG

# ============================================================
# OpenAI SDK 封装
# ============================================================
from openai import OpenAI

def create_client():
    return OpenAI(
        api_key=LLM_CONFIG["api_key"],
        base_url=LLM_CONFIG["base_url"],
    )

# ============================================================
# Phase A: RAG+KG 系统
# ============================================================
import urllib.request
import urllib.error

RAG_SEARCH_URL = "http://127.0.0.1:5000/search"
KG_SEARCH_URL = "http://127.0.0.1:3000/api/kg/subgraph"


def search_rag(question: str, top_k: int = 5) -> list[dict]:
    """调用 Flask /search 获取 RAG chunks."""
    try:
        payload = json.dumps({
            "question": question,
            "top_k": top_k,
            "retrieval_mode": "bge",
        }).encode("utf-8")
        req = urllib.request.Request(
            RAG_SEARCH_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("chunks", [])
    except Exception as e:
        print(f"  [WARN] RAG 检索失败: {e}")
        return []


def search_kg(question: str) -> list[dict]:
    """调用 Neo4j 子图查询获取 KG 路径."""
    try:
        payload = json.dumps({"query": question, "depth": 2}).encode("utf-8")
        req = urllib.request.Request(
            KG_SEARCH_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("results", [])
    except Exception as e:
        print(f"  [WARN] KG 查询失败: {e}")
        return []


def build_ragkg_prompt(question: str, rag_chunks: list, kg_paths: list) -> str:
    """构造与 backend/src/services/llm.ts:buildPrompt 一致的 prompt."""
    rag_section = ""
    if rag_chunks:
        rag_items = []
        for i, c in enumerate(rag_chunks[:5]):
            src = c.get("doc_title", "未知")
            page = c.get("page", "?")
            score = c.get("score", 0)
            text = c.get("text", "")
            rag_items.append(
                f"[文档片段 {i+1}]（来源：《{src}》第{page}页，相关度: {(score*100):.1f}%）\n{text}"
            )
        rag_section = "## 文档检索上下文（RAG）\n" + "\n\n".join(rag_items)

    kg_section = ""
    if kg_paths:
        items = []
        for p in kg_paths[:5]:
            from_e = p.get("from", "?")
            rel = p.get("relation", "?")
            to_e = p.get("to", "?")
            inferred = "（OWL推理）" if p.get("inferred") else ""
            items.append(f"- 「{from_e}」—[{rel}{inferred}]→「{to_e}」")
        kg_section = "## 知识图谱上下文（KG）\n" + "\n".join(items)

    context = "\n\n".join(filter(None, [rag_section, kg_section]))
    if context:
        ctx_intro = f"你的回答基于以下上下文：\n\n{context}"
    else:
        ctx_intro = "当前未检索到相关上下文，请根据你的地质知识尽力回答。"

    return (
        f"你是一个地质找矿领域的智能问答助手。{ctx_intro}\n\n"
        f"## 用户问题\n{question}\n\n"
        "## 回答要求\n"
        "1. 开头用 1 至 2 句话直接回答用户问题\n"
        "2. 仅保留与问题直接相关的证据\n"
        "3. 以 300 至 500 个汉字为目标\n"
        "4. 信息不完整时说明证据边界\n"
        "5. 必须基于提供的文献和知识图谱证据回答，不得虚构事实\n"
    )


SYSTEM_PROMPT = (
    "你是专业的地质找矿知识问答助手。"
    "必须基于提供的地质文献和真实知识图谱证据回答。"
    "先给结论，再解释与问题直接相关的要点。"
    "信息不完整时说明证据边界，完全没有相关信息时才说明知识库暂未收录。"
    "不得虚构任何地质事实。"
)

BARE_SYSTEM_PROMPT = (
    "你是一个地质找矿领域的知识问答助手。请根据你的地质学知识回答用户问题。"
    "注意：你没有外部知识库，仅凭训练记忆回答。"
    "如果不确定，请如实说明。"
)


def call_llm(system_prompt: str, user_prompt: str, label: str = "") -> str:
    """调用 DeepSeek API 生成回答."""
    client = create_client()
    max_retries = 2
    for attempt in range(max_retries + 1):
        try:
            resp = client.chat.completions.create(
                model=LLM_CONFIG["model"],
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=LLM_CONFIG["temperature"],
                max_tokens=LLM_CONFIG["max_tokens"],
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            if attempt < max_retries:
                wait = 2 ** attempt
                print(f"  [WARN] {label} API 调用失败 (尝试 {attempt+1}/{max_retries+1})，{wait}s 后重试: {e}")
                time.sleep(wait)
            else:
                print(f"  [ERROR] {label} API 调用失败: {e}")
                return f"[API 调用失败: {e}]"


def generate_ragkg_answer(question: str, cache: dict, idx: int) -> dict:
    """Phase A: 生成 RAG+KG 答案."""
    cache_key = f"ragkg_{idx}"
    if cache_key in cache:
        print(f"  [CACHE] RAG+KG 答案已缓存")
        return cache[cache_key]

    print(f"  → RAG 检索中...")
    rag_chunks = search_rag(question)
    print(f"    检索到 {len(rag_chunks)} 个 chunks")

    print(f"  → KG 查询中...")
    kg_paths = search_kg(question)
    print(f"    检索到 {len(kg_paths)} 条 KG 路径")

    prompt = build_ragkg_prompt(question, rag_chunks, kg_paths)
    answer = call_llm(SYSTEM_PROMPT, prompt, label="RAG+KG")

    result = {
        "answer": answer,
        "rag_count": len(rag_chunks),
        "kg_count": len(kg_paths),
        "rag_chunks": rag_chunks[:3],  # 仅保留前 3 个用于溯源
    }
    cache[cache_key] = result
    return result


def generate_bare_answer(question: str, cache: dict, idx: int) -> dict:
    """Phase B: 生成裸 LLM 答案（无检索上下文）."""
    cache_key = f"bare_{idx}"
    if cache_key in cache:
        print(f"  [CACHE] 裸 LLM 答案已缓存")
        return cache[cache_key]

    user_prompt = f"问题：{question}\n请根据你的地质学知识回答。"
    answer = call_llm(BARE_SYSTEM_PROMPT, user_prompt, label="BareLLM")

    result = {"answer": answer}
    cache[cache_key] = result
    return result


# ============================================================
# Phase C: LLM-as-Judge 评分
# ============================================================

JUDGE_SYSTEM_PROMPT = (
    "你是一个严格的地质学事实核查员。你的任务是对比候选答案与参考答案，"
    "逐句检查候选答案中的事实陈述是否准确。\n\n"
    "对每个事实陈述，判定为以下三类之一：\n"
    "- SUPPORTED：与参考答案或关键事实一致\n"
    "- CONTRADICTED：与参考答案或关键事实矛盾\n"
    "- UNVERIFIABLE：无法从参考答案或关键事实中验证（既不一致也不矛盾）\n\n"
    "注意：\n"
    "1. 只关注事实性陈述，不关注措辞风格\n"
    "2. 如果候选答案表达了不确定性（如'不确定'、'可能'），不算 CONTRADICTED\n"
    "3. 如果候选答案包含参考答案中不存在的细节或数据，标记为 UNVERIFIABLE\n"
    "4. 如果候选答案与参考答案直接矛盾，标记为 CONTRADICTED\n\n"
    "返回纯 JSON 格式（不要加 markdown 代码块）：\n"
    '{\n  "claims": [\n    {"text": "...", "verdict": "SUPPORTED|CONTRADICTED|UNVERIFIABLE", "reason": "..."}\n  ]\n}'
)


def judge_answer(question: str, ground_truth: str, key_facts: list, candidate_answer: str, cache: dict, label: str) -> dict:
    """Phase C: 用 LLM 裁判评分候选答案."""
    facts_str = "、".join(key_facts)
    judge_prompt = (
        f"问题：{question}\n\n"
        f"参考答案：{ground_truth}\n\n"
        f"关键事实：{facts_str}\n\n"
        f"候选答案：{candidate_answer}\n\n"
        "请逐句检查候选答案中的事实陈述，判断每个陈述与参考答案/关键事实的关系。\n"
        "返回 JSON。"
    )

    cache_key = f"judge_{label}_{question[:20]}"
    if cache_key in cache:
        return cache[cache_key]

    try:
        raw = call_llm(JUDGE_SYSTEM_PROMPT, judge_prompt, label=f"Judge-{label}")
        # 解析 JSON
        # 尝试提取 JSON（可能包裹在 ```json ... ``` 中）
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            # 去掉 markdown 代码块
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1]) if len(lines) > 2 else cleaned.strip("`")
        result = json.loads(cleaned)
        cache[cache_key] = result
        return result
    except (json.JSONDecodeError, Exception) as e:
        print(f"  [WARN] Judge-{label} JSON 解析失败: {e}")
        # 降级：简单统计
        return {
            "claims": [
                {"text": candidate_answer[:100] + "...", "verdict": "UNVERIFIABLE", "reason": "裁判解析失败"}
            ],
            "parse_error": True,
        }


# ============================================================
# Phase D: 报告生成
# ============================================================

def compute_metrics(judge_result: dict) -> dict:
    """从裁判结果计算指标."""
    claims = judge_result.get("claims", [])
    total = len(claims)
    if total == 0:
        return {"total": 0, "supported": 0, "contradicted": 0, "unverifiable": 0,
                "hallucination_rate": 0, "fact_accuracy": 0}

    supported = sum(1 for c in claims if c.get("verdict") == "SUPPORTED")
    contradicted = sum(1 for c in claims if c.get("verdict") == "CONTRADICTED")
    unverifiable = sum(1 for c in claims if c.get("verdict") == "UNVERIFIABLE")

    return {
        "total": total,
        "supported": supported,
        "contradicted": contradicted,
        "unverifiable": unverifiable,
        "hallucination_rate": round((contradicted + unverifiable) / total * 100, 1),
        "fact_accuracy": round(supported / total * 100, 1),
    }


def generate_report(results: list, test_set: list):
    """Phase D: 生成综合报告."""
    # 汇总指标
    ragkg_metrics = []
    bare_metrics = []

    for r in results:
        ragkg_metrics.append(compute_metrics(r["judge_ragkg"]))
        bare_metrics.append(compute_metrics(r["judge_bare"]))

    # 总体
    def avg_metrics(metrics_list):
        total_claims = sum(m["total"] for m in metrics_list)
        total_supported = sum(m["supported"] for m in metrics_list)
        total_contradicted = sum(m["contradicted"] for m in metrics_list)
        total_unverifiable = sum(m["unverifiable"] for m in metrics_list)
        if total_claims == 0:
            return {"hallucination_rate": 0, "fact_accuracy": 0, "total_claims": 0}
        return {
            "hallucination_rate": round((total_contradicted + total_unverifiable) / total_claims * 100, 1),
            "fact_accuracy": round(total_supported / total_claims * 100, 1),
            "total_claims": total_claims,
            "supported": total_supported,
            "contradicted": total_contradicted,
            "unverifiable": total_unverifiable,
        }

    overall_ragkg = avg_metrics(ragkg_metrics)
    overall_bare = avg_metrics(bare_metrics)

    # 按类别细分
    categories = {}
    for i, r in enumerate(results):
        cat = test_set[i]["category"]
        if cat not in categories:
            categories[cat] = {"ragkg": [], "bare": []}
        categories[cat]["ragkg"].append(ragkg_metrics[i])
        categories[cat]["bare"].append(bare_metrics[i])

    by_category = {}
    for cat, v in categories.items():
        by_category[cat] = {
            "ragkg": avg_metrics(v["ragkg"]),
            "bare": avg_metrics(v["bare"]),
        }

    # 逐题详情
    details = []
    for i, r in enumerate(results):
        q = test_set[i]
        details.append({
            "id": q["id"],
            "question": q["question"],
            "category": q["category"],
            "difficulty": q["difficulty"],
            "ragkg": {
                "metrics": ragkg_metrics[i],
                "claims": r["judge_ragkg"].get("claims", []),
                "rag_chunks_count": r["ragkg"].get("rag_count", 0),
                "kg_paths_count": r["ragkg"].get("kg_count", 0),
            },
            "bare": {
                "metrics": bare_metrics[i],
                "claims": r["judge_bare"].get("claims", []),
            },
        })

    # 改进幅度
    improvement = {
        "hallucination_rate_reduction": round(overall_bare["hallucination_rate"] - overall_ragkg["hallucination_rate"], 1),
        "relative_reduction": round(
            (overall_bare["hallucination_rate"] - overall_ragkg["hallucination_rate"])
            / max(overall_bare["hallucination_rate"], 0.1) * 100, 1
        ),
        "accuracy_improvement": round(overall_ragkg["fact_accuracy"] - overall_bare["fact_accuracy"], 1),
    }

    report = {
        "summary": {
            "total_questions": len(results),
            "ragkg": overall_ragkg,
            "bare": overall_bare,
            "improvement": improvement,
        },
        "by_category": by_category,
        "details": details,
    }

    os.makedirs(EVAL_DIR, exist_ok=True)
    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return report


# ============================================================
# 打印摘要
# ============================================================

def print_summary(report: dict):
    s = report["summary"]
    rag = s["ragkg"]
    bare = s["bare"]
    imp = s["improvement"]

    print("\n" + "=" * 60)
    print("         幻觉率量化比较结果")
    print("=" * 60)
    print(f"\n测试题目数: {s['total_questions']}")
    print(f"总事实陈述数（RAG+KG）: {rag.get('total_claims', 0)}")
    print(f"总事实陈述数（裸 LLM）: {bare.get('total_claims', 0)}")
    print(f"\n{'系统':<20} | {'幻觉率':>8} | {'事实正确率':>10}")
    print(f"{'-'*20}-+-{'-'*8}-+-{'-'*10}")
    print(f"{'我们的 RAG+KG':<20} | {rag['hallucination_rate']:>7.1f}% | {rag['fact_accuracy']:>9.1f}%")
    print(f"{'裸 LLM (Baseline)':<20} | {bare['hallucination_rate']:>7.1f}% | {bare['fact_accuracy']:>9.1f}%")
    print(f"\n幻觉率降低: {imp['hallucination_rate_reduction']:.1f} 个百分点")
    print(f"相对下降:   {imp['relative_reduction']:.1f}%")
    print(f"正确率提升: {imp['accuracy_improvement']:.1f} 个百分点")

    # 按类别
    print(f"\n按类别细分:")
    for cat, v in report["by_category"].items():
        r = v["ragkg"]["hallucination_rate"]
        b = v["bare"]["hallucination_rate"]
        print(f"  {cat}: RAG+KG 幻觉率 {r:.1f}% vs 裸 LLM {b:.1f}%")

    # 逐题
    print(f"\n逐题结果:")
    for d in report["details"]:
        r_hr = d["ragkg"]["metrics"]["hallucination_rate"]
        b_hr = d["bare"]["metrics"]["hallucination_rate"]
        r_ra = d["ragkg"]["metrics"]["fact_accuracy"]
        b_ra = d["bare"]["metrics"]["fact_accuracy"]
        tag = "✅" if r_hr < b_hr else ("⚠️" if r_hr == b_hr else "❌")
        print(f"  [{tag}] Q{d['id']} ({d['category']}, {d['difficulty']})")
        print(f"       RAG+KG: 幻觉率 {r_hr:.1f}%, 正确率 {r_ra:.1f}%")
        print(f"       裸LLM:  幻觉率 {b_hr:.1f}%, 正确率 {b_ra:.1f}%")

    print("\n" + "=" * 60)
    print(f"详细报告: {RESULTS_FILE}")
    print("=" * 60 + "\n")


# ============================================================
# 生成对比图表
# ============================================================

def generate_chart(report: dict):
    """生成对比柱状图 PNG（不依赖 matplotlib，用纯 HTML 方案或尝试 matplotlib）."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np

        fig, ax = plt.subplots(figsize=(8, 4.5))

        rag_hr = report["summary"]["ragkg"]["hallucination_rate"]
        bare_hr = report["summary"]["bare"]["hallucination_rate"]
        rag_fa = report["summary"]["ragkg"]["fact_accuracy"]
        bare_fa = report["summary"]["bare"]["fact_accuracy"]

        categories_plot = ["幻觉率 (%)", "事实正确率 (%)"]
        x = np.arange(2)
        width = 0.3

        vals_rag = [rag_hr, rag_fa]
        vals_bare = [bare_hr, bare_fa]

        bars1 = ax.bar(x - width/2, vals_rag, width, label="RAG+KG 系统", color="#2E7D5B")
        bars2 = ax.bar(x + width/2, vals_bare, width, label="裸 LLM", color="#B83A1F")

        ax.set_ylabel("百分比 (%)")
        ax.set_title("幻觉率量化比较：RAG+KG vs 裸 LLM")
        ax.set_xticks(x)
        ax.set_xticklabels(categories_plot)
        ax.legend()
        ax.set_ylim(0, max(max(vals_rag), max(vals_bare)) * 1.2)

        for bar, val in zip(bars1, vals_rag):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                    f"{val:.1f}%", ha="center", va="bottom", fontsize=10, fontweight="bold")
        for bar, val in zip(bars2, vals_bare):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                    f"{val:.1f}%", ha="center", va="bottom", fontsize=10, fontweight="bold")

        plt.tight_layout()
        plt.savefig(CHART_FILE, dpi=150, bbox_inches="tight")
        plt.close()
        print(f"对比图表已保存: {CHART_FILE}")
    except ImportError:
        print("[WARN] matplotlib 未安装，跳过图表生成。运行: pip install matplotlib")
    except Exception as e:
        print(f"[WARN] 图表生成失败: {e}")


# ============================================================
# 主流程
# ============================================================

def load_cache() -> dict:
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict):
    os.makedirs(EVAL_DIR, exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description="幻觉率量化比较评估")
    parser.add_argument("--test", action="store_true", help="测试模式：仅跑前 2 题")
    parser.add_argument("--skip-llm", action="store_true", help="跳过 LLM 生成，仅运行裁判（需已有缓存）")
    parser.add_argument("--chart", action="store_true", help="仅从已有报告生成图表")
    args = parser.parse_args()

    if args.chart:
        if not os.path.exists(RESULTS_FILE):
            print("错误: 报告文件不存在，请先运行完整评估")
            sys.exit(1)
        with open(RESULTS_FILE, "r", encoding="utf-8") as f:
            report = json.load(f)
        print_summary(report)
        generate_chart(report)
        return

    # 加载测试题库
    test_set_path = os.path.join(EVAL_DIR, "qa_test_set.json")
    if not os.path.exists(test_set_path):
        print(f"错误: 测试题库不存在: {test_set_path}")
        sys.exit(1)

    with open(test_set_path, "r", encoding="utf-8") as f:
        test_set = json.load(f)

    n_questions = 2 if args.test else len(test_set)
    test_set = test_set[:n_questions]
    print(f"{'='*50}")
    print(f"幻觉率量化比较评估")
    print(f"模式: {'测试(2题)' if args.test else f'全量({n_questions}题)'}")
    print(f"跳过LLM: {'是' if args.skip_llm else '否'}")
    print(f"{'='*50}")

    cache = load_cache()
    results = []

    for i, q in enumerate(test_set):
        idx = q["id"]
        print(f"\n[{i+1}/{n_questions}] Q{idx}: {q['question'][:50]}...")

        if args.skip_llm:
            rag_key = f"ragkg_{idx}"
            bare_key = f"bare_{idx}"
            if rag_key not in cache or bare_key not in cache:
                print(f"  [SKIP] 无缓存答案，跳过裁判")
                continue
            ragkg_answer = cache[rag_key]["answer"]
            bare_answer = cache[bare_key]["answer"]
        else:
            # Phase A
            print(f"  [Phase A] 生成 RAG+KG 答案...")
            ragkg_result = generate_ragkg_answer(q["question"], cache, idx)
            ragkg_answer = ragkg_result["answer"]

            # Phase B
            print(f"  [Phase B] 生成裸 LLM 答案...")
            bare_result = generate_bare_answer(q["question"], cache, idx)
            bare_answer = bare_result["answer"]

        # Phase C: Judge
        print(f"  [Phase C] 裁判评分 RAG+KG...")
        judge_ragkg = judge_answer(q["question"], q["ground_truth"], q["key_facts"], ragkg_answer, cache, "ragkg")

        print(f"  [Phase C] 裁判评分 裸LLM...")
        judge_bare = judge_answer(q["question"], q["ground_truth"], q["key_facts"], bare_answer, cache, "bare")

        results.append({
            "question_id": idx,
            "judge_ragkg": judge_ragkg,
            "judge_bare": judge_bare,
            "ragkg": {"answer": ragkg_answer, **({k: v for k, v in cache.get(f"ragkg_{idx}", {}).items() if k != "answer"})},
            "bare": {"answer": bare_answer, **({k: v for k, v in cache.get(f"bare_{idx}", {}).items() if k != "answer"})},
        })

        # 每做完一题就保存缓存
        save_cache(cache)

    if not results:
        print("\n没有可评估的结果。如果使用 --skip-llm，请先运行一次完整评估。")
        return

    # Phase D
    print(f"\n[Phase D] 生成报告...")
    report = generate_report(results, test_set)
    print_summary(report)
    generate_chart(report)

    # 最终保存
    save_cache(cache)
    print("评估完成。")


if __name__ == "__main__":
    main()
