import os
#!/usr/bin/env python3
"""P1: TCM 古籍向量化 → Vectorize
流程:
1. 读古籍 chunks (cf_kv_classics.jsonl, 核心 763 chunks)
2. 调 Workers AI bge-m3 嵌入 (需限流解除)
3. 写入 Vectorize tcm-test-index
用法: python3 vectorize_tcm.py [--limit N] [--batch N]
"""
import json, os, sys, time, urllib.request, urllib.error

GKEY = os.environ.get("CF_API_TOKEN", "")
GMAIL = os.environ.get("CF_ACCOUNT_EMAIL", "")
ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "")
INDEX = "tcm-test-index"
EMBED_MODEL = "@cf/baai/bge-m3"
WORKERS_AI_URL = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/run/{EMBED_MODEL}"

def api(method, path, body=None, content_type="application/json"):
    data = body
    if isinstance(body, (dict, list)):
        data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/{path}",
        method=method, data=data,
        headers={"X-Auth-Email": GMAIL, "X-Auth-Key": GKEY, "Content-Type": content_type})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def embed_texts(texts):
    """调 Workers AI bge-m3 嵌入，返回向量列表"""
    status, resp = api("POST", f"ai/run/{EMBED_MODEL}", {"text": texts})
    if status != 200:
        return None, f"HTTP {status}: {resp.get('errors', resp)}"
    result = resp.get("result", {})
    if isinstance(result, dict):
        return result.get("data") or result.get("embeddings"), None
    return result, None

def main():
    limit = None
    batch = 16
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--limit": limit = int(args[i+1])
        if a == "--batch": batch = int(args[i+1])

    # 1. 读 chunks
    chunks = []
    with open("/opt/data/tcm_data/cf_kv_classics.jsonl", encoding="utf-8") as f:
        for line in f:
            try:
                d = json.loads(line)
                # 格式: {"k": "c:book:idx", "v": "text", "book": "..."}
                key = d.get("k", "")
                text = d.get("v", d.get("text", ""))
                book = d.get("book", key.split(":")[1] if ":" in key else "")
                if text:
                    chunks.append({"id": key, "text": text[:500], "book": book})
            except: pass
    if limit:
        chunks = chunks[:limit]
    print(f"✅ 读取 {len(chunks)} chunks")

    # 2. 嵌入 + 写入 Vectorize
    vectors = []
    for i in range(0, len(chunks), batch):
        batch_chunks = chunks[i:i+batch]
        texts = [c["text"] for c in batch_chunks]
        emb, err = embed_texts(texts)
        if err:
            print(f"❌ 第{i//batch+1}批嵌入失败: {err}")
            if "429" in str(err) or "1027" in str(err):
                print("  ⚠️ 限流未解除，暂停。可稍后重试 (已嵌入 {len(vectors)} 条)")
            return
        for c, vec in zip(batch_chunks, emb):
            vectors.append({"id": c["id"], "values": vec, "metadata": {"book": c["book"]}})
        print(f"  批次 {i//batch+1}: +{len(batch_chunks)} (累计 {len(vectors)})")
        time.sleep(0.3)

    # 3. 写入 Vectorize
    print(f"\n写入 {len(vectors)} 向量到 Vectorize...")
    # 分批写入 (每批 50)
    ok = 0
    for i in range(0, len(vectors), 50):
        batch = vectors[i:i+50]
        status, resp = api("POST", f"vectorize/v2/indexes/{INDEX}/insert", {"vectors": batch})
        if status == 200:
            ok += len(batch)
            print(f"  批次 {i//50+1}: +{len(batch)} (累计 {ok})")
        else:
            print(f"  ❌ 批次 {i//50+1} 失败: {status} {str(resp)[:200]}")
            break
        time.sleep(0.3)
    print(f"✅ 完成! 写入 {ok}/{len(vectors)} 条")

if __name__ == "__main__":
    main()
