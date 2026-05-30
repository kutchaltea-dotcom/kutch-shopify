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

let cachedToken = null;

const getToken = async () => {
  const r = await axios.post(
    `https://${SHOP}/admin/oauth/access_token`,
    `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return r.data.access_token;
};

const shopify = async (method, path, data) => {
  if (!cachedToken) cachedToken = await getToken();
  try {
    const r = await axios({ method, url: `https://${SHOP}/admin/api/2025-01${path}`, data, headers: { 'X-Shopify-Access-Token': cachedToken, 'Content-Type': 'application/json' } });
    return r.data;
  } catch (e) {
    if (e.response?.status === 401) {
      cachedToken = await getToken();
      const r = await axios({ method, url: `https://${SHOP}/admin/api/2025-01${path}`, data, headers: { 'X-Shopify-Access-Token': cachedToken, 'Content-Type': 'application/json' } });
      return r.data;
    }
    throw e;
  }
};

app.get('/health', (req, res) => res.json({ status: 'ok', shop: SHOP }));

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

app.delete('/pages/:id', async (req, res) => {
  try { res.json(await shopify('delete', `/pages/${req.params.id}.json`)); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.get('/themes', async (req, res) => {
  try { res.json(await shopify('get', '/themes.json')); }
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

app.put('/blogs/:blog_id/articles/:id', async (req, res) => {
  try { res.json(await shopify('put', `/blogs/${req.params.blog_id}/articles/${req.params.id}.json`, { article: req.body })); }
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

app.get('/shop', async (req, res) => {
  try { res.json(await shopify('get', '/shop.json')); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.get('/redirects', async (req, res) => {
  try { res.json(await shopify('get', '/redirects.json')); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

app.post('/redirects', async (req, res) => {
  try { res.json(await shopify('post', '/redirects.json', { redirect: req.body })); }
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

app.get('/navigations', async (req, res) => {
  try { res.json(await shopify('get', '/menus.json')); }
  catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
