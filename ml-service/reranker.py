"""Optional cross-encoder reranking with an explicit, deterministic fallback."""

from __future__ import annotations

import os
import queue
import threading
from collections.abc import Callable, Sequence
from typing import Any


DEFAULT_MODEL_NAME = "BAAI/bge-reranker-base"
MAX_CANDIDATES = 20
MAX_TOP_K = MAX_CANDIDATES


def _default_model_factory(model_name: str):
    from sentence_transformers import CrossEncoder

    return CrossEncoder(model_name)


def _env_enabled() -> bool:
    return os.getenv("RERANKER_ENABLED", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


class BGEReranker:
    """Lazily load BGE reranker and preserve retrieval order on failure."""

    def __init__(
        self,
        *,
        enabled: bool | None = None,
        model_name: str | None = None,
        model_factory: Callable[[str], Any] | None = None,
        inference_timeout_seconds: float | None = None,
    ) -> None:
        self.enabled = _env_enabled() if enabled is None else enabled
        self.model_name = model_name or os.getenv("RERANKER_MODEL", DEFAULT_MODEL_NAME)
        self._model_factory = model_factory or _default_model_factory
        self._model = None
        self._model_lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._active_inference_thread: threading.Thread | None = None
        timeout_value = (
            os.getenv("RERANKER_TIMEOUT_SECONDS", "8")
            if inference_timeout_seconds is None
            else inference_timeout_seconds
        )
        self.inference_timeout_seconds = max(0.001, float(timeout_value))

    def rerank(
        self,
        question: str,
        candidates: Sequence[dict[str, Any]],
        *,
        top_k: int = MAX_TOP_K,
    ) -> dict[str, Any]:
        limited_candidates = [dict(item) for item in candidates[:MAX_CANDIDATES]]
        fallback_results = limited_candidates[: min(top_k, MAX_TOP_K)]

        if not self.enabled:
            return self._fallback(
                fallback_results,
                len(limited_candidates),
                "model_disabled",
                "Set RERANKER_ENABLED=true to enable optional BGE reranking.",
            )

        try:
            pairs = [[question, item["text"]] for item in limited_candidates]
            prediction = self._start_prediction(pairs)
            if prediction is None:
                return self._fallback(
                    fallback_results,
                    len(limited_candidates),
                    "inference_busy",
                    "the previous reranker inference is still running",
                )
            try:
                outcome, value = prediction.get(timeout=self.inference_timeout_seconds)
            except queue.Empty:
                return self._fallback(
                    fallback_results,
                    len(limited_candidates),
                    "inference_timeout",
                    f"reranker exceeded {self.inference_timeout_seconds:g} seconds",
                )
            if outcome == "error":
                raise value
            scores = value
            scored = []
            for item, score in zip(limited_candidates, scores):
                ranked_item = dict(item)
                ranked_item["rerank_score"] = float(score)
                scored.append(ranked_item)
            scored.sort(key=lambda item: item["rerank_score"], reverse=True)
            return {
                "results": scored[: min(top_k, MAX_TOP_K)],
                "status": "applied",
                "mode": "bge-reranker-base",
                "reason": None,
                "detail": None,
                "candidate_count": len(limited_candidates),
                "model": self.model_name,
            }
        except ImportError as exc:
            return self._fallback(
                fallback_results,
                len(limited_candidates),
                "dependency_unavailable",
                str(exc),
            )
        except Exception as exc:
            return self._fallback(
                fallback_results,
                len(limited_candidates),
                "model_error",
                str(exc),
            )

    def _start_prediction(
        self,
        pairs: list[list[str]],
    ) -> queue.Queue[tuple[str, Any]] | None:
        with self._inference_lock:
            if (
                self._active_inference_thread is not None
                and self._active_inference_thread.is_alive()
            ):
                return None

            prediction: queue.Queue[tuple[str, Any]] = queue.Queue(maxsize=1)

            def predict() -> None:
                try:
                    prediction.put(("ok", self._get_model().predict(pairs)))
                except Exception as exc:
                    prediction.put(("error", exc))

            worker = threading.Thread(
                target=predict,
                name="bge-reranker-inference",
                daemon=True,
            )
            self._active_inference_thread = worker
            worker.start()
            return prediction

    def _get_model(self):
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    self._model = self._model_factory(self.model_name)
        return self._model

    def _fallback(
        self,
        results: list[dict[str, Any]],
        candidate_count: int,
        reason: str,
        detail: str,
    ) -> dict[str, Any]:
        return {
            "results": results,
            "status": "fallback",
            "mode": "original-order",
            "reason": reason,
            "detail": detail[:200],
            "candidate_count": candidate_count,
            "model": self.model_name,
        }
