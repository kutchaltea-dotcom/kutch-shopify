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

app.get('/publish-historia', async (req, res) => {
  try {
    const data = await shopify('post', '/pages.json', {
      page: {
        title: "Nuestra Historia",
        handle: "nuestra-historia",
        published: true,
        body_html: "<p>El viaje se convirtió en un oficio. El oficio, en una forma de entender la vida.</p><p>Rajasthan y Gujarat — y en particular la región de Kutch — son algunos de los territorios más singulares del planeta. Kutch conforma un inmenso desierto de sal y una sabana en el extremo occidental de India. Durante siglos, comunidades nómadas como los Rabari, los Ahir o los Mutwa se han desplazado por ese territorio llevando consigo sus técnicas de bordado como símbolo de pertenencia y moneda. Cada puntada es memoria e identidad. Geometrías que cuentan historias. Arte textil. Eso es lo que hace de Kutch un lugar único en el mundo, y lo que me arrastra hasta allí cada año.</p><p>Trabajamos con talleres familiares, fibras naturales y materiales up-cycled, preservando procesos tradicionales. Cada pieza forma parte de una colección limitada elaborada con criterio ético en un marco de comercio responsable.</p><p>Piezas con origen, adaptadas a los códigos mediterráneos con un pulso étnico y mestizo.</p><p>Mantener esa cultura viva es parte de lo que somos.</p>"
      }
    });
    res.json({ ok: true, id: data.page.id, title: data.page.title });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kutch API running on port ${PORT}`));
