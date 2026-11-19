
// ─── 路由 Handler ───────────────────────────────
async function handleQuery(request) {
  try {
    const body = await request.json();
    const query = (body.query || '').trim();
    const topK = Math.min(parseInt(body.top_k) || 5, 20);
    if (!query) return new Response(JSON.stringify({ error: '请输入症状描述' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const terms = tokenize(query);
    const results = [];
    for (const c of TCM_DATA) {
      const s = score(c.v, terms);
      if (s > 0) results.push({ text: c.v.slice(0, 400), book: c.book, score: Math.round(s*100)/100 });
    }
    results.sort((a, b) => b.score - a.score);
    return new Response(JSON.stringify({ result: results.slice(0, topK).map(r => `【${r.book}】（相关度: ${r.score}）\n${r.text}`).join('\n\n') }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}

async function handleConsult(request, event) {
  try {
    const body = await request.json();
    const query = (body.query || '').trim();
    if (!query) return new Response(JSON.stringify({ error: '请输入症状描述' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    // 1. 古籍检索
    const terms = tokenize(query);
    const retrieved = [];
    for (const c of TCM_DATA) {
      const s = score(c.v, terms);
      if (s > 0) retrieved.push({ book: c.book, text: c.v.slice(0, 300), score: s });
    }
    retrieved.sort((a, b) => b.score - a.score);
    // 2. AI 辨证（模块函数）
    const result = await diagnose(query, retrieved.slice(0, 3), event.env);
    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}

async function handlePlan(request, event) {
  try {
    const body = await request.json();
    const pattern = (body.pattern || '').trim();
    if (!pattern) return new Response(JSON.stringify({ error: '请输入证型' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const plan = await getPlan(pattern, event.env);
    return new Response(JSON.stringify(plan), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}

async function handleLab(request, event) {
  try {
    const body = await request.json();
    const image = body.image || '';      // base64 图片
    const text = body.text || '';        // 手动输入指标
    if (!image && !text) return new Response(JSON.stringify({ error: '请上传化验单图片或输入指标' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const result = await analyzeLab({ image, text }, event.env);
    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}

async function handleConstitution(request, event) {
  try {
    const body = await request.json();
    const symptoms = (body.symptoms || '').trim();
    if (!symptoms) return new Response(JSON.stringify({ error: '请输入症状' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const result = await analyzeConstitution(symptoms, event.env);
    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
