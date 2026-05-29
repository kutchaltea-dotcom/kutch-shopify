const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const SHOP = process.env.SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_TOKEN;

const shopify = axios.create({
  baseURL: `https://${SHOP}/admin/api/2024-01`,
  headers: {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json'
  }
});

// GET productos
app.get('/products', async (req, res) => {
  try {
    const r = await shopify.get('/products.json?limit=250');
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE descripción de producto
app.put('/products/:id', async (req, res) => {
  try {
    const r = await shopify.put(`/products/${req.params.id}.json`, { product: req.body });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET páginas
app.get('/pages', async (req, res) => {
  try {
    const r = await shopify.get('/pages.json');
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CREATE o UPDATE página
app.post('/pages', async (req, res) => {
  try {
    const r = await shopify.post('/pages.json', { page: req.body });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/pages/:id', async (req, res) => {
  try {
    const r = await shopify.put(`/pages/${req.params.id}.json`, { page: req.body });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE menú navegación
app.get('/menus', async (req, res) => {
  try {
    const r = await shopify.get('/custom_collections.json');
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
