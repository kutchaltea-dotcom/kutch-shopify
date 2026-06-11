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

// ============ TRADUCIR TEXTOS EN INGLÉS (locales/es.json) ============
// Simula por defecto. Ejecutar: /do/fix-spanish?confirm=si
const TRADUCCIONES = {
  'Account': 'Cuenta',
  'Search': 'Buscar',
  'Wishlist': 'Lista de deseos',
  'Wish Lists': 'Lista de deseos',
  'My Wish List': 'Mi lista de deseos',
  'Add to wishlist': 'Añadir a la lista de deseos',
  'Add To Wishlist': 'Añadir a la lista de deseos',
  'Remove from wishlist': 'Quitar de la lista de deseos',
  'Log in': 'Iniciar sesión',
  'Log out': 'Cerrar sesión',
  'Sign In': 'Iniciar sesión',
  'Sign in': 'Iniciar sesión',
  'Create an Account': 'Crear cuenta',
  'Create account': 'Crear cuenta',
  'Email Address': 'Correo electrónico',
  'Email address': 'Correo electrónico',
  'Your email': 'Tu correo electrónico',
  'Password': 'Contraseña',
  'Forgot your password?': '¿Has olvidado tu contraseña?',
  'Add to cart': 'Añadir al carrito',
  'Add to Cart': 'Añadir al carrito',
  'Buy it now': 'Comprar ahora',
  'Sold out': 'Agotado',
  'Sold Out': 'Agotado',
  'Sold': 'Vendido',
  'Sale': 'Oferta',
  'Unit price': 'Precio unitario',
  'per': 'por',
  'Quantity': 'Cantidad',
  'Quantity:': 'Cantidad:',
  'Description': 'Descripción',
  'Reviews': 'Opiniones',
  'Close': 'Cerrar',
  'Share': 'Compartir',
  'Share on Facebook': 'Compartir en Facebook',
  'Tweet on Twitter': 'Compartir en Twitter',
  'Pin on Pinterest': 'Compartir en Pinterest',
  'Share on Pinterest': 'Compartir en Pinterest',
  'Copy link': 'Copiar enlace',
  'Link copied to clipboard!': '¡Enlace copiado!',
  'Thanks for subscribing!': '¡Gracias por suscribirte!',
  'This email has been registered!': '¡Este correo ya está registrado!',
  'Subscribe': 'Suscribirse',
  'Choose Options': 'Elegir opciones',
  'Shop the look': 'Compra el look',
  'Shop The Look': 'Compra el look',
  'View all': 'Ver todo',
  'View more': 'Ver más',
  'View cart': 'Ver carrito',
  'Home': 'Inicio',
  'Cart': 'Carrito',
  'Checkout': 'Finalizar compra',
  'Check out': 'Finalizar compra',
  'Continue shopping': 'Seguir comprando',
  'Continue Shopping': 'Seguir comprando',
  'Out of stock': 'Agotado',
  'Out Of Stock': 'Agotado',
  'In stock': 'En stock',
  'Free shipping': 'Envío gratis',
  'Edit Option': 'Editar opción',
  'this is just a warning': 'Aviso',
  'Early Access Login': 'Acceso anticipado',
  'Early Access Login*': 'Acceso anticipado*',
  'items': 'artículos',
  'item': 'artículo',
  'Menu': 'Menú',
  'Shop': 'Tienda',
  'Next': 'Siguiente',
  'Previous': 'Anterior',
  'Submit': 'Enviar',
  'Send': 'Enviar',
  'Apply': 'Aplicar',
  'Remove': 'Eliminar',
  'Update': 'Actualizar',
  'Total': 'Total',
  'Subtotal': 'Subtotal',
  'Decrease quantity for {{ title }}': 'Reducir cantidad de {{ title }}',
  'Increase quantity for {{ title }}': 'Aumentar cantidad de {{ title }}',
  '{{ count }} customers are viewing this product': '{{ count }} personas están viendo este producto',
  'Hurry up! Only {{ count }} left': '¡Date prisa! Solo quedan {{ count }}',
  'Hurry up! only {{ count }} left': '¡Date prisa! Solo quedan {{ count }}',
  'Hurry Up! Only {{ count }} Left in Stock': '¡Date prisa! Solo quedan {{ count }} en stock',
  'Limited-Time Offers, End in:': 'Oferta por tiempo limitado. Termina en:',
  'You may also like': 'También te puede gustar',
  'Related Products': 'Productos relacionados',
  'Recently Viewed Products': 'Vistos recientemente',
  'Customer Reviews': 'Opiniones de clientes',
  'Write a review': 'Escribir una opinión',
  'Newsletter': 'Newsletter',
  'Your cart is empty': 'Tu carrito está vacío',
  'Your cart is currently empty.': 'Tu carrito está vacío.',
  'Special instructions for seller': 'Instrucciones especiales para el vendedor',
  'Agree with the terms and conditions': 'Acepto los términos y condiciones',
  'Availability': 'Disponibilidad',
  'Vendor': 'Marca',
  'Product Type': 'Tipo de producto',
  'Tags': 'Etiquetas',
  'Size Guide': 'Guía de tallas',
  'Ask About This Product': 'Pregunta sobre este producto',
  'Compare Color': 'Comparar colores',
  'Confirm Your Choice': 'Confirma tu elección',
  'Back To Top': 'Volver arriba',
  'Filter': 'Filtrar',
  'Sort by': 'Ordenar por',
  'Sort By': 'Ordenar por',
  'Clear All': 'Borrar todo',
  'Show': 'Mostrar',
  'Hide': 'Ocultar',
  'Color': 'Color',
  'Size': 'Talla',
  'Material': 'Material'
};

app.get('/do/fix-spanish', async (req, res) => {
  try {
    const confirm = req.query.confirm === 'si';
    const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=locales/es.json`);
    const json = JSON.parse(a.asset.value);
    const cambios = [];
    const walk = (obj, path) => {
      for (const k in obj) {
        const v = obj[k];
        const p = path ? path + '.' + k : k;
        if (typeof v === 'string' && TRADUCCIONES[v] !== undefined) {
          cambios.push({ key: p, antes: v, despues: TRADUCCIONES[v] });
          if (confirm) obj[k] = TRADUCCIONES[v];
        } else if (v && typeof v === 'object') walk(v, p);
      }
    };
    walk(json, '');
    if (confirm && cambios.length) {
      await shopify('put', `/themes/${THEME_ID}/assets.json`, {
        asset: { key: `assets/backup-es-${Date.now()}.json`, value: a.asset.value }
      });
      await shopify('put', `/themes/${THEME_ID}/assets.json`, {
        asset: { key: 'locales/es.json', value: JSON.stringify(json, null, 2) }
      });
    }
    res.json({ modo: confirm ? 'EJECUTADO ✅' : 'SIMULACIÓN — añade &confirm=si para ejecutar', total: cambios.length, cambios });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ============ MODIFICAR UNA TRADUCCIÓN SUELTA ============
// Uso: /do/locale-set?key=general.common.account&value=Cuenta&confirm=si
app.get('/do/locale-set', async (req, res) => {
  try {
    const { key, value, confirm } = req.query;
    if (!key || value === undefined) return res.json({ error: 'Faltan parámetros: key y value' });
    if (confirm !== 'si') return res.json({ modo: 'SIMULACIÓN — añade &confirm=si para ejecutar', key, value });
    const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=locales/es.json`);
    const json = JSON.parse(a.asset.value);
    const parts = key.split('.');
    let obj = json;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in obj)) return res.json({ error: 'Ruta no existe: ' + parts.slice(0, i + 1).join('.') });
      obj = obj[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (!(last in obj)) return res.json({ error: 'Clave no existe: ' + key });
    const antes = obj[last];
    obj[last] = value;
    await shopify('put', `/themes/${THEME_ID}/assets.json`, {
      asset: { key: 'locales/es.json', value: JSON.stringify(json, null, 2) }
    });
    res.json({ ok: true, key, antes, ahora: value });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ============ MODIFICAR AJUSTE DEL TEMA (con backup automático) ============
// Uso: /do/settings-set?key=current.show_countdown&value=false&confirm=si
app.get('/do/settings-set', async (req, res) => {
  try {
    const { key, value, confirm } = req.query;
    if (!key || value === undefined) return res.json({ error: 'Faltan parámetros: key y value' });
    if (confirm !== 'si') return res.json({ modo: 'SIMULACIÓN — añade &confirm=si para ejecutar', key, value });

    const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=config/settings_data.json`);
    const json = JSON.parse(a.asset.value);

    // Backup antes de tocar nada
    await shopify('put', `/themes/${THEME_ID}/assets.json`, {
      asset: { key: `assets/backup-settings-${Date.now()}.json`, value: a.asset.value }
    });

    // Convertir tipo del valor
    let v = value;
    if (value === 'true') v = true;
    else if (value === 'false') v = false;
    else if (value.trim() !== '' && !isNaN(value)) v = Number(value);

    // Navegar la ruta con puntos
    const parts = key.split('.');
    let obj = json;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in obj)) return res.json({ error: 'Ruta no existe: ' + parts.slice(0, i + 1).join('.') });
      obj = obj[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (!(last in obj)) return res.json({ error: 'Clave no existe: ' + key });
    const antes = obj[last];
    obj[last] = v;

    await shopify('put', `/themes/${THEME_ID}/assets.json`, {
      asset: { key: 'config/settings_data.json', value: JSON.stringify(json) }
    });
    res.json({ ok: true, key, antes, ahora: v, backup: 'guardado en assets/' });
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
    <button onclick="run(this, '/do/settings-find?q=countdown,visitor,viewing,example,congue,hurry,timer,view,sold,flash,scarcity,people,real_time')">⚙️ Buscar ajustes problemáticos del tema</button>
    <div class="result"></div>
  </div>

  <div class="card">
    <h2>🧹 Limpieza</h2>
    <button onclick="run(this, '/do/fix-spanish')">🇪🇸 Traducir textos en inglés (simular)</button>
    <button onclick="if(confirm('¿Aplicar todas las traducciones? Se hace backup antes.')) run(this, '/do/fix-spanish?confirm=si')">🇪🇸 Traducir textos en inglés (EJECUTAR)</button>
    <button onclick="run(this, '/do/settings-set?key=current.show_countdown&value=false')">⏱️ Apagar countdown falso (simular)</button>
    <button onclick="if(confirm('¿Apagar el countdown en toda la web?')) run(this, '/do/settings-set?key=current.show_countdown&value=false&confirm=si')">⏱️ Apagar countdown falso (EJECUTAR)</button>
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
<div style="max-width:900px;margin:40px auto 0;padding:20px;background:white;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);font-size:13px;">
  <h2 style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:12px;">🔗 Índice API (para Claude)</h2>
  <ul style="list-style:none;line-height:2;">
    <li><a href="/health">/health</a></li>
    <li><a href="/do/audit">/do/audit</a></li>
    <li><a href="/do/check-pages">/do/check-pages</a></li>
    <li><a href="/do/check-products">/do/check-products</a></li>
    <li><a href="/do/locale-find?q=">/do/locale-find (todo)</a></li>
    <li><a href="/do/locale-find?q=wish,login,search,cart,unit,hurry,subscrib,account,sold,viewing,share,sign,view,quantity,size,color">/do/locale-find (inglés común)</a></li>
    <li><a href="/do/settings-find?q=">/do/settings-find (todo)</a></li>
    <li><a href="/do/settings-find?q=countdown,visitor,viewing,example,congue,hurry,timer,view,sold,flash,scarcity,people,real_time,instagram">/do/settings-find (problemáticos)</a></li>
    <li><a href="/do/fix-spanish">/do/fix-spanish (simular)</a></li>
    <li><a href="/do/fix-spanish?confirm=si">/do/fix-spanish CONFIRM</a></li>
    <li><a href="/do/fix-compare-at">/do/fix-compare-at (simular)</a></li>
    <li><a href="/do/fix-compare-at?confirm=si">/do/fix-compare-at CONFIRM</a></li>
    <li><a href="/do/settings-set?key=&value=">/do/settings-set</a></li>
    <li><a href="/do/locale-set?key=&value=">/do/locale-set</a></li>
    <li><a href="/collections">/collections</a></li>
    <li><a href="/pages">/pages</a></li>
    <li><a href="/products">/products</a></li>
    <li><a href="/blogs">/blogs</a></li>
  </ul>
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
