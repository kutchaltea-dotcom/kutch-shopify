const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const SHOP = process.env.SHOP_DOMAIN;
const CLIENT_ID = process.env.CLIENT_ID || 'c71f0a73eb33baccae7555709567abf6';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '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';
const ACCESS_TOKEN = process.env.SHOPIFY_TOKEN;
const THEME_ID = 162207236386;

const shopify = async (method, path, data) => {
  const r = await axios({
    method,
    url: `https://${SHOP}/admin/api/2025-01${path}`,
    data,
    headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' }
  });
  return r.data;
};

// ============ AUDITORÍA COMPLETA ============
app.get('/do/audit', async (req, res) => {
  try {
    const out = {};

    // Tienda y plan
    const shop = await shopify('get', '/shop.json');
    out.tienda = {
      nombre: shop.shop.name,
      dominio: shop.shop.domain,
      plan: shop.shop.plan_display_name,
      moneda: shop.shop.currency
    };

    // Catálogo
    const prods = (await shopify('get', '/products.json?limit=250')).products;
    const limpio = h => (h || '').replace(/<[^>]*>/g, '').trim();
    out.catalogo = {
      total: prods.length,
      activos: prods.filter(p => p.status === 'active').length,
      borradores: prods.filter(p => p.status === 'draft').length,
      archivados: prods.filter(p => p.status === 'archived').length,
      sin_foto: prods.filter(p => !p.images || p.images.length === 0).map(p => ({ id: p.id, titulo: p.title })),
      con_una_sola_foto: prods.filter(p => p.images && p.images.length === 1).map(p => ({ id: p.id, titulo: p.title })),
      sin_descripcion: prods.filter(p => limpio(p.body_html).length < 30).map(p => ({ id: p.id, titulo: p.title })),
      sin_stock_activos: prods.filter(p => p.status === 'active' && p.variants.every(v => (v.inventory_quantity || 0) <= 0)).map(p => ({ id: p.id, titulo: p.title })),
      sin_tipo_producto: prods.filter(p => !p.product_type).map(p => ({ id: p.id, titulo: p.title })),
      descuento_fantasma: prods.filter(p => p.variants.some(v => v.compare_at_price && parseFloat(v.compare_at_price) <= parseFloat(v.price))).map(p => ({ id: p.id, titulo: p.title }))
    };

    // Pedidos últimos 30 días
    try {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const orders = (await shopify('get', `/orders.json?status=any&created_at_min=${since}&limit=250`)).orders;
      const ventas = {};
      orders.forEach(o => (o.line_items || []).forEach(li => {
        ventas[li.title] = (ventas[li.title] || 0) + li.quantity;
      }));
      out.pedidos_30d = {
        total_pedidos: orders.length,
        facturacion: orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0).toFixed(2),
        ticket_medio: orders.length ? (orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0) / orders.length).toFixed(2) : 0,
        mas_vendidos: Object.entries(ventas).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, q]) => ({ producto: t, unidades: q }))
      };
    } catch (e) {
      out.pedidos_30d = { error: 'No accesible (¿falta scope read_orders?): ' + (e.response?.status || e.message) };
    }

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ============ BUSCAR EN TRADUCCIONES (locales/es.json) ============
app.get('/do/locale-find', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=locales/es.json`);
    const json = JSON.parse(a.asset.value);
    const hits = [];
    const walk = (obj, path) => {
      for (const k in obj) {
        const v = obj[k];
        const p = path ? path + '.' + k : k;
        if (typeof v === 'string') {
          if (q.length === 0 || q.some(t => v.toLowerCase().includes(t))) hits.push({ key: p, valor: v });
        } else if (v && typeof v === 'object') walk(v, p);
      }
    };
    walk(json, '');
    res.json({ total: hits.length, hits: hits.slice(0, 250) });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ============ BUSCAR EN AJUSTES DEL TEMA (settings_data.json) ============
app.get('/do/settings-find', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=config/settings_data.json`);
    const json = JSON.parse(a.asset.value);
    const hits = [];
    const walk = (obj, path) => {
      for (const k in obj) {
        const v = obj[k];
        const p = path ? path + '.' + k : k;
        if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') {
          const texto = (k + ' ' + String(v)).toLowerCase();
          if (q.length === 0 || q.some(t => texto.includes(t))) hits.push({ key: p, valor: v });
        } else if (v && typeof v === 'object') walk(v, p);
      }
    };
    walk(json, '');
    res.json({ total: hits.length, hits: hits.slice(0, 250) });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ============ LIMPIAR DESCUENTOS FANTASMA (compare_at <= precio) ============
// Por defecto SIMULA. Para ejecutar de verdad: /do/fix-compare-at?confirm=si
app.get('/do/fix-compare-at', async (req, res) => {
  try {
    const dry = req.query.confirm !== 'si';
    const prods = (await shopify('get', '/products.json?limit=250')).products;
    const afectados = [];
    for (const p of prods) {
      const vars = p.variants.filter(v => v.compare_at_price && parseFloat(v.compare_at_price) <= parseFloat(v.price));
      if (vars.length) {
        afectados.push({ id: p.id, titulo: p.title, variantes_afectadas: vars.length });
        if (!dry) {
          for (const v of vars) {
            await shopify('put', `/variants/${v.id}.json`, { variant: { id: v.id, compare_at_price: null } });
          }
        }
      }
    }
    res.json({ modo: dry ? 'SIMULACIÓN — añade &confirm=si a la URL para ejecutar' : 'EJECUTADO ✅', total: afectados.length, afectados });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ============ PANEL DE CONTROL ============
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KUTCH — Panel de Control</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, sans-serif; background: #f5f0eb; color: #1a1a1a; padding: 20px; }
  h1 { font-size: 28px; letter-spacing: 4px; text-align: center; margin: 30px 0 10px; }
  p.sub { text-align: center; color: #888; margin-bottom: 40px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; max-width: 900px; margin: 0 auto; }
  .card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .card h2 { font-size: 14px; letter-spacing: 2px; text-transform: uppercase; color: #888; margin-bottom: 16px; }
  button { width: 100%; padding: 12px; border: none; border-radius: 8px; background: #1a1a1a; color: white; font-size: 14px; cursor: pointer; margin-top: 8px; transition: background 0.2s; }
  button:hover { background: #c8a96e; }
  .result { margin-top: 12px; padding: 12px; background: #f5f0eb; border-radius: 6px; font-size: 12px; display: none; white-space: pre-wrap; max-height: 400px; overflow: auto; }
  .result.ok { border-left: 3px solid #27ae60; }
  .result.err { border-left: 3px solid #e74c3c; }
</style>
</head>
<body>
<h1>KUTCH</h1>
<p class="sub">Panel de Control — kutch.es</p>
<div class="grid">

  <div class="card">
    <h2>📊 Auditoría</h2>
    <button onclick="run(this, '/do/audit')">🔍 Auditoría completa (catálogo + ventas)</button>
    <button onclick="run(this, '/do/locale-find?q=wish,login,search,cart,unit,hurry,subscrib,account,sold,viewing,share,sign')">🇬🇧 Buscar textos en inglés</button>
    <button onclick="run(this, '/do/settings-find?q=countdown,visitor,viewing,example,congue,hurry,timer')">⚙️ Buscar ajustes problemáticos del tema</button>
    <div class="result"></div>
  </div>

  <div class="card">
    <h2>🧹 Limpieza</h2>
    <button onclick="run(this, '/do/fix-compare-at')">👻 Descuentos fantasma (simular)</button>
    <button onclick="if(confirm('¿Ejecutar de verdad? Modifica precios comparados.')) run(this, '/do/fix-compare-at?confirm=si')">👻 Descuentos fantasma (EJECUTAR)</button>
    <div class="result"></div>
  </div>

  <div class="card">
    <h2>📄 Páginas y productos</h2>
    <button onclick="run(this, '/do/check-pages')">Ver páginas publicadas</button>
    <button onclick="run(this, '/do/check-products')">Ver productos (resumen)</button>
    <div class="result"></div>
  </div>

  <div class="card">
    <h2>🔧 Sistema</h2>
    <button onclick="run(this, '/health')">✅ Test conexión Shopify</button>
    <div class="result"></div>
  </div>

</div>
<script>
async function run(btn, url) {
  const result = btn.parentElement.querySelector('.result');
  result.style.display = 'block';
  result.className = 'result';
  result.textContent = 'Ejecutando...';
  try {
    const r = await fetch(url);
    const data = await r.json();
    result.className = 'result ok';
    result.textContent = JSON.stringify(data, null, 2);
  } catch(e) {
    result.className = 'result err';
    result.textContent = 'Error: ' + e.message;
  }
}
</script>
</body>
</html>`);
});

// ============ RUTAS EXISTENTES ============
app.get('/do/check-pages', async (req, res) => {
  try {
    const data = await shopify('get', '/pages.json?fields=id,title,handle,published_at');
    res.json(data.pages.map(p => ({ id: p.id, titulo: p.title, url: '/pages/' + p.handle, publicada: !!p.published_at })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/do/check-products', async (req, res) => {
  try {
    const data = await shopify('get', '/products.json?limit=250&fields=id,title,status,variants');
    res.json({ total: data.products.length, productos: data.products.map(p => ({ id: p.id, titulo: p.title, estado: p.status })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', async (req, res) => {
  try {
    const shop = await shopify('get', '/shop.json');
    res.json({ status: 'ok', shop: shop.shop.name, domain: shop.shop.domain });
  } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
});

app.get('/products', async (req, res) => {
  try { res.json(await shopify('get', '/products.json?limit=250')); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.put('/products/:id', async (req, res) => {
  try { res.json(await shopify('put', `/products/${req.params.id}.json`, { product: req.body })); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.get('/pages', async (req, res) => {
  try { res.json(await shopify('get', '/pages.json')); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.post('/pages', async (req, res) => {
  try { res.json(await shopify('post', '/pages.json', { page: req.body })); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.put('/pages/:id', async (req, res) => {
  try { res.json(await shopify('put', `/pages/${req.params.id}.json`, { page: req.body })); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.get('/themes/:id/assets', async (req, res) => {
  try { res.json(await shopify('get', `/themes/${req.params.id}/assets.json`)); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.put('/themes/:id/assets', async (req, res) => {
  try { res.json(await shopify('put', `/themes/${req.params.id}/assets.json`, { asset: req.body })); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.get('/blogs', async (req, res) => {
  try { res.json(await shopify('get', '/blogs.json')); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.get('/collections', async (req, res) => {
  try {
    const [custom, smart] = await Promise.all([
      shopify('get', '/custom_collections.json'),
      shopify('get', '/smart_collections.json')
    ]);
    res.json({ custom_collections: custom.custom_collections, smart_collections: smart.smart_collections });
  }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
