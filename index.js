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

const shopify = async (method, path, data) => {
  const r = await axios({
    method,
    url: `https://${SHOP}/admin/api/2025-01${path}`,
    data,
    headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' }
  });
  return r.data;
};

// PANEL DE CONTROL
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
  button.danger { background: #e74c3c; }
  .result { margin-top: 12px; padding: 12px; background: #f5f0eb; border-radius: 6px; font-size: 13px; display: none; }
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
    <button onclick="run(this, '/do/add-menu-nuestra-historia')">➕ Añadir "Nuestra Historia" al menú</button>
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

// ACCIONES
app.get('/do/add-menu-nuestra-historia', async (req, res) => {
  try {
    const query = `{
      menu(handle: "main-menu") {
        id
        title
        items { id title url }
      }
    }`;
    const r = await axios.post(
      `https://${SHOP}/admin/api/2025-01/graphql.json`,
      { query },
      { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );
    const menu = r.data?.data?.menu;
    if (!menu) return res.json({ ok: false, msg: 'Menú no encontrado', raw: r.data });

    const exists = menu.items.some(i => i.url && i.url.includes('nuestra-historia'));
    if (exists) return res.json({ ok: true, msg: 'Ya existe en el menú ✅' });

    const mutation = `mutation {
      menuCreate(title: "${menu.title}", handle: "main-menu", items: [
        ${menu.items.map(i => `{ title: "${i.title}", url: "${i.url}" }`).join(',\n        ')},
        { title: "Nuestra Historia", url: "/pages/nuestra-historia" }
      ]) {
        menu { id title items { title url } }
        userErrors { field message }
      }
    }`;
    const r2 = await axios.post(
      `https://${SHOP}/admin/api/2025-01/graphql.json`,
      { query: mutation },
      { headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );
    res.json({ ok: true, result: r2.data });
  } catch(e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.get('/do/fix-english-texts', async (req, res) => {
  try {
    const locales = await shopify('get', '/themes/162207236386/assets.json?asset[key]=locales/es.json');
    let content = JSON.parse(locales.asset.value);

    if (!content.general) content.general = {};
    if (!content.layout) content.layout = {};
    content.layout.cart = content.layout.cart || {};
    content.layout.cart.title = 'Carrito';
    if (!content.customer) content.customer = {};
    content.customer.login = content.customer.login || {};
    content.customer.login.title = 'Iniciar sesión';
    content.customer.wishlist = 'Lista de deseos';

    await shopify('put', '/themes/162207236386/assets.json', {
      asset: { key: 'locales/es.json', value: JSON.stringify(content, null, 2) }
    });
    res.json({ ok: true, msg: 'Textos corregidos ✅' });
  } catch(e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.get('/do/check-pages', async (req, res) => {
  try {
    const data = await shopify('get', '/pages.json?fields=id,title,handle,published_at');
    res.json(data.pages.map(p => ({ id: p.id, titulo: p.title, url: '/pages/'+p.handle, publicada: !!p.published_at })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/do/check-products', async (req, res) => {
  try {
    const data = await shopify('get', '/products.json?limit=250&fields=id,title,status,variants');
    res.json({ total: data.products.length, productos: data.products.map(p => ({ id: p.id, titulo: p.title, estado: p.status })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// RUTAS EXISTENTES
app.get('/health', async (req, res) => {
  try {
    const shop = await shopify('get', '/shop.json');
    res.json({ status: 'ok', shop: shop.shop.name, domain: shop.shop.domain });
  } catch(e) { res.status(500).json({ status: 'error', error: e.message }); }
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

app.get('/blogs/:id/articles', async (req, res) => {
  try { res.json(await shopify('get', `/blogs/${req.params.id}/articles.json`)); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.post('/blogs/:id/articles', async (req, res) => {
  try { res.json(await shopify('post', `/blogs/${req.params.id}/articles.json`, { article: req.body })); }
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

app.get('/fix-page-template', async (req, res) => {
  try {
    const data = await shopify('put', '/themes/162207236386/assets.json', {
      asset: {
        key: 'templates/page.nuestra-historia.json',
        value: JSON.stringify({
          layout: 'theme',
          sections: { main: { type: 'main-page', settings: {} } },
          order: ['main']
        })
      }
    });
    const page = await shopify('put', '/pages/689607016824.json', {
      page: { id: 689607016824, template_suffix: 'nuestra-historia' }
    });
    res.json({ ok: true, asset: data.asset.key, template: page.page.template_suffix });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
