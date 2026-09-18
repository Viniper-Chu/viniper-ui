"""Packaged model facts and pure migration, independent of HTTP and credentials."""

import copy
import json
from pathlib import Path


CATALOG = json.loads(Path(__file__).with_name("model-capabilities.json").read_text(encoding="utf-8"))
DEFAULT_DEEPSEEK_MODEL = CATALOG["default_deepseek_model"]
PROVIDER_MODEL_ALIASES = CATALOG["provider_model_aliases"]
OFFICIAL_DEEPSEEK_ENDPOINTS = {"https://api.deepseek.com", "https://api.deepseek.com/v1",
                              "https://api.deepseek.com/anthropic", "https://api.deepseek.com/anthropic/v1/messages"}


def capacity_provider_id(provider):
    endpoint = str(provider.get("base_url") or "").strip().rstrip("/")
    return "deepseek" if endpoint in OFFICIAL_DEEPSEEK_ENDPOINTS else provider.get("id", "")


def deepseek_model_options():
    entries = [item for item in CATALOG["entries"] if item["provider"] == "deepseek"]
    entries.sort(key=lambda item: item["model"] != DEFAULT_DEEPSEEK_MODEL)
    return [{"id": item["model"], "label": item["label"], "description": "",
             "context": item["context_window"]} for item in entries]


def migrate_official_deepseek_provider(provider):
    """Only official deployments own these aliases; never reinterpret a proxy's IDs."""
    result = copy.deepcopy(provider)
    endpoint = str(result.get("base_url") or "").strip().rstrip("/")
    if endpoint not in OFFICIAL_DEEPSEEK_ENDPOINTS:
        return result
    options = {item["id"]: item for item in deepseek_model_options()}
    result["model"] = PROVIDER_MODEL_ALIASES.get(result.get("model"), result.get("model"))
    if isinstance(result.get("models"), list):
        models, seen = [], set()
        for item in result["models"]:
            if not isinstance(item, dict):
                continue
            item = dict(item)
            item["id"] = PROVIDER_MODEL_ALIASES.get(item.get("id"), item.get("id"))
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            if item["id"] in options:
                item["label"] = options[item["id"]]["label"]
            models.append(item)
        result["models"] = models
    return result
