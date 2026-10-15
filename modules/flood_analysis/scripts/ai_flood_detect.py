"""AI flood-damage PREDICTION from PRE/POST SpaceNet 8 imagery via OpenRouter vision API.

This produces a model PREDICTION, compared later against the project's human-labelled
ground truth. It is never a substitute for that ground truth.

Generalized to any SN8-format dataset: takes --input/--out-dir, and reuses
processor.select_aoi_tile_ids() for the AOI tile list unless --tiles overrides it,
instead of a second hardcoded tile list per dataset.

Run (Germany, default): python scripts/ai_flood_detect.py
Run (Louisiana, 2-key pool): python scripts/ai_flood_detect.py --input data/raw_louisiana --out-dir output_louisiana --key-pool
"""
import argparse
import glob
import json
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vision_api_config import OPENROUTER_API_KEY, OPENROUTER_API_KEY_FLOODNET
from image_compress import tif_to_data_url
from flood_analysis import processor as proc

MODEL = "dots-studio/dots-3-note-preview:free"
API_URL = "https://openrouter.ai/api/v1/chat/completions"
REQUEST_DELAY_SECONDS = 0

PROMPT = """You are comparing a PRE-event and POST-event satellite image of the same location \
after a flood event. The first image is PRE-event, the second is POST-event.

Determine whether there is visible flood damage or water intrusion in the POST-event image \
that was NOT present in the PRE-event image.

Respond with ONLY a strict JSON object, no other text, in exactly this format:
{"flood_damage_detected": true or false, "confidence": "low" or "medium" or "high", "reasoning": "one short sentence"}
"""


def find_tile_images(raw_dir, tile_id):
    pre = glob.glob(os.path.join(raw_dir, "PRE-event", f"*_{tile_id}.tif"))
    post = glob.glob(os.path.join(raw_dir, "POST-event", f"*_{tile_id}.tif"))
    if not pre or not post:
        return None, None
    return pre[0], post[0]


def load_results(out_path):
    if os.path.exists(out_path):
        with open(out_path) as fh:
            return json.load(fh)
    return {}


def save_results(out_path, results):
    tmp = out_path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(results, fh, indent=2)
    os.replace(tmp, out_path)


def call_openrouter(api_key, pre_url, post_url):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": pre_url}},
                    {"type": "image_url", "image_url": {"url": post_url}},
                ],
            }
        ],
        "max_tokens": 3000,
    }
    return requests.post(API_URL, headers=headers, json=body, timeout=90)


def parse_response(resp):
    content = resp.json()["choices"][0]["message"]["content"]
    if content is None:
        raise ValueError("empty content (model returned no content, likely truncated on reasoning)")
    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.startswith("json"):
            content = content[4:]
    start = content.find("{")
    end = content.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object found in content: {content[:200]!r}")
    parsed = json.loads(content[start:end + 1])
    flood = parsed["flood_damage_detected"]
    if not isinstance(flood, bool):
        raise ValueError(f"flood_damage_detected not boolean: {flood!r}")
    return {
        "flood_damage_detected": flood,
        "confidence": parsed.get("confidence"),
        "reasoning": parsed.get("reasoning"),
    }


def is_rate_limited(resp):
    if resp.status_code == 429:
        return True
    if resp.status_code == 200:
        try:
            return resp.json().get("error", {}).get("code") == 429
        except (ValueError, KeyError):
            return False
    return False


def process_tile(raw_dir, tile_id):
    """Local offline detection using ai_flood_detect_local.judge()"""
    from ai_flood_detect_local import judge
    
    pre_path, post_path = find_tile_images(raw_dir, tile_id)
    if pre_path is None:
        return {"ERROR": "missing_imagery"}
    
    try:
        result = judge(
            pre=pre_path,
            post=post_path,
            threshold=0.001,
            model_dir=os.path.join(os.path.dirname(__file__), "..", "HighWater_Module2_Offline", "models", "segformer"),
            flood_classes=[1],
            device="cpu",
            mode="accurate",
            include_dev_fields=False
        )
        return result
    except Exception as e:
        print(f"  [{tile_id}] error: {e}")
        return {"ERROR": f"detection_error: {str(e)[:200]}"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=os.path.join(os.path.dirname(__file__), "..", "data", "raw"))
    parser.add_argument("--out-dir", default=os.path.join(os.path.dirname(__file__), "..", "output"))
    parser.add_argument("--tiles", default=None, help="Comma-separated tile ids; default: processor's dynamic AOI selection")
    args = parser.parse_args()

    tile_ids = args.tiles.split(",") if args.tiles else proc.select_aoi_tile_ids(args.input)
    out_path = os.path.join(args.out_dir, "ai_predictions.json")

    print(f"AOI: {len(tile_ids)} tiles.")

    results = load_results(out_path)
    processed = 0
    errored = 0

    for tile_id in tile_ids:
        if tile_id in results and "ERROR" not in results.get(tile_id, {}):
            print(f"[{tile_id}] already done, skipping")
            continue

        print(f"[{tile_id}] processing...")
        result = process_tile(args.input, tile_id)
        results[tile_id] = result
        save_results(out_path, results)

        if "ERROR" in result:
            errored += 1
            print(f"  [{tile_id}] -> ERROR: {result['ERROR']}")
        else:
            processed += 1
            print(f"  [{tile_id}] -> flood_damage_detected={result['flood_damage_detected']} "
                  f"confidence={result['confidence']}")

    print(f"\nDone. succeeded={processed} errored={errored}")


if __name__ == "__main__":
    main()
