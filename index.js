const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const SHOP = process.env.SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || 'c71f0a73eb33baccae7555709567abf6';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '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';

app.get('/token', async (req, res) => {
  try {
    const r = await axios.post(
      `https://${SHOP}/admin/oauth/access_token`,
      `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.get('/products', async (req, res) => {
  try {
    const r = await axios.get(
      `https://${SHOP}/admin/api/2025-01/products.json?limit=250`,
      { headers: { 'X-Shopify-Access-Token': TOKEN } }
    );
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', shop: SHOP, hasToken: !!TOKEN }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
