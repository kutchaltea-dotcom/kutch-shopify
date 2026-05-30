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
const CLIENT_ID = process.env.CLIENT_ID || 'bffe6d248a8b6cd9661cdd9e107ad6f4';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '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';
let ACCESS_TOKEN = process.env.SHOPIFY_TOKEN;

const shopify = async (method, path, data) => {
  const r = await axios({ method, url: `https://${SHOP}/admin/api/2025-01${path}`, data, headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } });
  return r.data;
};

const gql = async (query, variables = {}) => {
  const r = await axios.post(`https://${SHOP}/admin/api/2025-01/graphql.json`, { query, variables }, { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } });
  return r.data;
};

app.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.send('No code received');
    const r = await axios.post(`https://${SHOP}/admin/oauth/access_token`, { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code });
    ACCESS_TOKEN = r.data.access_token;
    res.send(`<html><body style="font-family:sans-serif;padding:40px;background:#f5f0eb"><h1 style="letter-spacing:4px">KUTCH ✅</h1><p>Token obtenido.</p><p><strong>Pon este valor en Railway como SHOPIFY_TOKEN:</strong></p><p style="background:white;padding:12px;border-radius:8px;word-break:break-all;font-family:monospace">${ACCESS_TOKEN}</p><a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#1a1a1a;color:white;text-decoration:none;border-radius:8px">Ir al panel →</a></body></html>`);
  } catch(e) { res.status(500).send('Error: ' + e.message); }
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
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
  .result { margin-top: 12px; padding: 12px; background: #f5f0eb; border-radius: 6px; font-size: 13px; display: none; white-space: pre-wrap; word-break: break-all; }
  .result.ok { border-left: 3px solid #27ae60; }
  .result.err { border-left: 3px solid #e74c3c; }
</style>
</head>
<body>
<h1>KUTCH</h1>
<p class="sub">Panel de Control — kutch.es</p>
<div class="grid">
  <div class="card">
    <h2>🧭 Navegación</h2>
    <button onclick="run(this, '/do/add-nuestra-historia-todos-menus')">➕ Añadir "Nuestra Historia" a todos los menús</button>
    <button onclick="run(this, '/do/get-menus')">🔍 Ver todos los menús</button>
    <button onclick="run(this, '/do/fix-english-texts')">🇪🇸 Corregir textos en inglés</button>
    <div class="result"></div>
  </div>
  <div class="card">
    <h2>📄 Páginas</h2>
    <button onclick="run(this, '/do/check-pages')">🔍 Ver páginas publicadas</button>
    <div class="result"></div>
  </div>
  <div class="card">
    <h2>🛍️ Productos</h2>
    <button onclick="run(this, '/do/check-products')">🔍 Ver productos (resumen)</button>
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
  result.style.display = 'block'; result.className = 'result';
  result.textContent = 'Ejecutando...';
  try {
    const r = await fetch(url);
    const data = await r.json();
    result.className = 'result ok';
    result.textContent = JSON.stringify(data, null, 2);
  } catch(e) { result.className = 'result err'; result.textContent = 'Error: ' + e.message; }
}
</script>
</body>
</html>`);
});

// Añadir a TODOS los menús
app.get('/do/add-nuestra-historia-todos-menus', async (req, res) => {
  try {
    const data = await gql(`{ menus(first: 20) { edges { node { id handle title items { id title url type } } } } }`);
    const menus = data.data?.menus?.edges || [];
    const results = [];

    for (const edge of menus) {
      const menu = edge.node;
      const exists = menu.items.some(i => i.url && i.url.includes('nuestra-historia'));
      if (exists) { results.push({ menu: menu.handle, status: 'ya existe ✅' }); continue; }

      const itemsInput = menu.items.map(i => ({ id: i.id, title: i.title, url: i.url, type: i.type || 'HTTP' }));
      itemsInput.push({ title: 'Nuestra Historia', url: 'https://kutch.es/pages/nuestra-historia', type: 'HTTP' });

      const r = await gql(`mutation menuUpdate($id: ID!, $items: [MenuItemUpdateInput!]!) {
        menuUpdate(id: $id, items: $items) {
          menu { id title items { title url } }
          userErrors { field message }
        }
      }`, { id: menu.id, items: itemsInput });

      const errors = r.data?.menuUpdate?.userErrors;
      results.push({ menu: menu.handle, status: errors?.length ? 'error: ' + errors[0].message : 'añadido ✅' });
    }
    res.json({ ok: true, results });
  } catch(e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.get('/do/get-menus', async (req, res) => {
  try {
    const data = await gql(`{ menus(first: 20) { edges { node { id handle title items { title url } } } } }`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/do/fix-english-texts', async (req, res) => {
  try {
    const themeId = '162207236386';
    const assetsData = await shopify('get', `/themes/${themeId}/assets.json`);
    const localeFile = assetsData.assets.find(a => a.key === 'locales/es.json') || assetsData.assets.find(a => a.key.includes('es.default'));
    if (!localeFile) return res.json({ ok: false, msg: 'No se encontró archivo de locales' });
    const locales = await shopify('get', `/themes/${themeId}/assets.json?asset[key]=${localeFile.key}`);
    let content = JSON.parse(locales.asset.value);
    if (!content.layout) content.layout = {};
    content.layout.cart = content.layout.cart || {};
    content.layout.cart.title = 'Carrito';
    if (!content.customer) content.customer = {};
    content.customer.login = content.customer.login || {};
    content.customer.login.title = 'Iniciar sesión';
    content.customer.wishlist = 'Lista de deseos';
    if (!content.general) content.general = {};
    content.general.wishlist = content.general.wishlist || {};
    content.general.wishlist.title = 'Lista de deseos';
    await shopify('put', `/themes/${themeId}/assets.json`, { asset: { key: localeFile.key, value: JSON.stringify(content, null, 2) } });
    res.json({ ok: true, msg: `Textos corregidos en ${localeFile.key} ✅` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/do/check-pages', async (req, res) => {
  try {
    const data = await shopify('get', '/pages.json?fields=id,title,handle,published_at');
    res.json(data.pages.map(p => ({ id: p.id, titulo: p.title, url: '/pages/'+p.handle, publicada: !!p.published_at })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/do/check-products', async (req, res) => {
  try {
    const data = await shopify('get', '/products.json?limit=250&fields=id,title,status');
    res.json({ total: data.products.length, productos: data.products.map(p => ({ id: p.id, titulo: p.title, estado: p.status })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', async (req, res) => {
  try {
    const shop = await shopify('get', '/shop.json');
    res.json({ status: 'ok', shop: shop.shop.name, domain: shop.shop.domain });
  } catch(e) { res.status(500).json({ status: 'error', error: e.message }); }
});

app.get('/products', async (req, res) => {
  try { res.json(await shopify('get', '/products.json?limit=250')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/products/:id', async (req, res) => {
  try { res.json(await shopify('put', `/products/${req.params.id}.json`, { product: req.body })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/pages', async (req, res) => {
  try { res.json(await shopify('get', '/pages.json')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/pages', async (req, res) => {
  try { res.json(await shopify('post', '/pages.json', { page: req.body })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/pages/:id', async (req, res) => {
  try { res.json(await shopify('put', `/pages/${req.params.id}.json`, { page: req.body })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/themes/:id/assets', async (req, res) => {
  try { res.json(await shopify('get', `/themes/${req.params.id}/assets.json`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/themes/:id/assets', async (req, res) => {
  try { res.json(await shopify('put', `/themes/${req.params.id}/assets.json`, { asset: req.body })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/blogs', async (req, res) => {
  try { res.json(await shopify('get', '/blogs.json')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/blogs/:id/articles', async (req, res) => {
  try { res.json(await shopify('get', `/blogs/${req.params.id}/articles.json`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/blogs/:id/articles', async (req, res) => {
  try { res.json(await shopify('post', `/blogs/${req.params.id}/articles.json`, { article: req.body })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/collections', async (req, res) => {
  try {
    const [custom, smart] = await Promise.all([shopify('get', '/custom_collections.json'), shopify('get', '/smart_collections.json')]);
    res.json({ custom_collections: custom.custom_collections, smart_collections: smart.smart_collections });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
