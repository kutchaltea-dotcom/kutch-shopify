const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const SHOP = process.env.SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_TOKEN;

const graphql = async (query, variables = {}) => {
  const response = await axios.post(
    `https://${SHOP}/admin/api/2026-04/graphql.json`,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
};

app.get('/products', async (req, res) => {
  try {
    const data = await graphql(`{
      products(first: 250) {
        edges {
          node {
            id
            title
            descriptionHtml
            status
          }
        }
      }
    }`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', shop: SHOP, hasToken: !!TOKEN }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
