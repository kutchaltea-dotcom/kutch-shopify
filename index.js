const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const SHOP = process.env.SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || 'c71f0a73eb33baccae7555709567abf6';
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const HOST = process.env.RAILWAY_PUBLIC_DOMAIN || 'kutch-shopify-production.up.railway.app';

const shopify = axios.create({
  baseURL: `https://${SHOP}/admin/api/2025-01`,
  headers: {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json'
  }
});

app.get('/install', (req, res) => {
  const scopes = 'read_products,write_products,read_content,write_content,read_themes,write_themes,read_online_store_pages,write_online_store_pages';
  const redirectUri = `https://${HOST}/callback`;
  const installUrl = `https://${SHOP}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(installUrl);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const response = await axios.post(`https://${SHOP}/admin/oauth/access_token`, {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code
    });
    const accessToken = response.data.access_token;
    res.send(`<h1>TOKEN OBTENIDO</h1><p>${accessToken}</p>`);
  } catch (e) {
    res.status(500).send('Error: ' + JSON.stringify(e.response?.data || e.message));
  }
});

app.get('/products', async (req, res) => {
  try {
    const r = await shopify.get('/products.json?limit=250');
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.put('/products/:id', async (req, res) => {
  try {
    const r = await shopify.put(`/products/${req.params.id}.json`, { product: req.body });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.get('/pages', async (req, res) => {
  try {
    const r = await shopify.get('/pages.json');
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.post('/pages', async (req, res) => {
  try {
    const r = await shopify.post('/pages.json', { page: req.body });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.put('/pages/:id', async (req, res) => {
  try {
    const r = await shopify.put(`/pages/${req.params.id}.json`, { page: req.body });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
