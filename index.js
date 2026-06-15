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
let ACCESS_TOKEN = process.env.SHOPIFY_TOKEN;
const THEME_ID = 162207236386;

async function refreshToken() {
  const r = await axios.post(
    `https://${SHOP}/admin/oauth/access_token`,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  ACCESS_TOKEN = r.data.access_token;
  return ACCESS_TOKEN;
}

const shopify = async (method, path, data) => {
  const call = () => axios({
    method,
    url: `https://${SHOP}/admin/api/2025-01${path}`,
    data,
    headers: { 'X-Shopify-Access-Token': ACCESS_TOKEN, 'Content-Type': 'application/json' }
  });
  try {
    return (await call()).data;
  } catch (e) {
    if (e.response && e.response.status === 401) {
      await refreshToken();
      return (await call()).data;
    }
    throw e;
  }
};

// Refresco manual: /do/refresh-token (útil tras cambiar scopes de la app)
app.get('/do/refresh-token', async (req, res) => {
  try {
    const t = await refreshToken();
    res.json({ ok: true, token_preview: t.slice(0, 10) + '...' });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

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
  'Material': 'Material',
  // ===== Diccionario v2 =====
  'Categories': 'Categorías',
  'Click to watch video': 'Ver vídeo',
  'Scroll Down': 'Desliza hacia abajo',
  'Search products...': 'Buscar productos...',
  'Search for a product...': 'Buscar un producto...',
  'Search the store': 'Buscar en la tienda',
  'Search entire store here...': 'Busca en toda la tienda...',
  'Product Results': 'Resultados',
  'Search for': 'Buscar',
  'Search more': 'Ver más resultados',
  'View All Results ({{ count }})': 'Ver todos los resultados ({{ count }})',
  'Label Search': 'Buscador',
  'Shopping Cart': 'Carrito',
  'View my cart ({{ count }})': 'Ver mi carrito ({{ count }})',
  'Item added to your cart': 'Producto añadido al carrito',
  'Calculate Shipping': 'Calcular envío',
  'Calculating...': 'Calculando...',
  'Error: Please enter right shipping information': 'Error: revisa los datos de envío',
  'There are': 'Hay',
  'shipping rates available for': 'tarifas de envío disponibles para',
  ', starting at': ', desde',
  'There is one shipping rate available for': 'Hay una tarifa de envío disponible para',
  'There is no shipping rate available for this order and destination.': 'No hay tarifa de envío disponible para este pedido y destino.',
  'minutes.': 'minutos.',
  'Additional Comments': 'Comentarios adicionales',
  'Special instruction for seller...': 'Instrucciones para el vendedor...',
  'Secure Shopping Guarantee': 'Compra 100% segura',
  'Save': 'Guardar',
  'Cancel': 'Cancelar',
  'Adding...': 'Añadiendo...',
  'Add A Gift Wrap': 'Añadir envoltorio de regalo',
  'Order Summary': 'Resumen del pedido',
  'Get Shipping Estimate:': 'Calcular gastos de envío:',
  'Coupon Code': 'Código de descuento',
  'Coupon code will be applied on the checkout page': 'El código se aplicará al finalizar la compra',
  'Estimate Shipping Rates': 'Calcular envío',
  'State': 'Provincia',
  'ZIP Code': 'Código postal',
  'Postal Code': 'Código postal',
  'Enter Coupon Code': 'Introduce el código',
  'sold out': 'agotado',
  'Discount:': 'Descuento:',
  'Link': 'Enlace',
  'Show more': 'Ver más',
  'Loading...': 'Cargando...',
  'View All Collection': 'Ver toda la colección',
  'No More Product': 'No hay más productos',
  'enter your email address': 'tu correo electrónico',
  'Your Email Address': 'Tu correo electrónico',
  'Sign Me Up': 'Suscribirme',
  'Start Now': 'Empezar',
  "don't miss out this sale": 'no te pierdas esta oferta',
  'Skip to content': 'Ir al contenido',
  'Skip to product information': 'Ir a la información del producto',
  'Vendor:': 'Marca:',
  'Choosing a selection results in a full page refresh.': 'Al elegir una opción se recarga la página.',
  'Opens in a new window.': 'Se abre en una ventana nueva.',
  'Opens external website.': 'Abre una web externa.',
  'Slide right': 'Deslizar a la derecha',
  'Slide left': 'Deslizar a la izquierda',
  'Page {{ number }}': 'Página {{ number }}',
  'Pagination': 'Paginación',
  'Prev': 'Anterior',
  'Go Back To Previous page': 'Volver a la página anterior',
  'Leave a comment': 'Deja un comentario',
  'Name': 'Nombre',
  'Comment': 'Comentario',
  'Post comment': 'Publicar comentario',
  'Back to blog': 'Volver al blog',
  'Share this article': 'Compartir este artículo',
  '{{ count }} comment': '{{ count }} comentario',
  '{{ count }} Comments': '{{ count }} comentarios',
  'Older Post': 'Anterior',
  'Newer Post': 'Siguiente',
  'Prev Post': 'Anterior',
  'Next Post': 'Siguiente',
  'Tags:': 'Etiquetas:',
  'Read more: {{ title }}': 'Leer más: {{ title }}',
  'View Details': 'Ver detalles',
  'featured': 'destacado',
  'Please note, comments need to be approved before they are published.': 'Los comentarios se revisan antes de publicarse.',
  'All blog comments are checked prior to publishing': 'Los comentarios se revisan antes de publicarse',
  'Your comment was posted successfully! Thank you!': '¡Comentario publicado! Gracias.',
  'Your comment was posted successfully. We will publish it in a little while, as our blog is moderated.': 'Comentario enviado. Se publicará tras revisión.',
  'Example product title': 'Producto de ejemplo',
  "Your collection's name": 'Nombre de la colección',
  'Adding to cart...': 'Añadiendo...',
  'Add All to cart': 'Añadir todo al carrito',
  'Adding All to cart...': 'Añadiendo todo...',
  'Added to cart': 'Añadido al carrito',
  'You must select at least one products to add!': 'Selecciona al menos un producto',
  'is added to your shopping cart.': 'se ha añadido a tu carrito.',
  'Product variants': 'Variantes',
  'Details': 'Detalles',
  'Enter store using password:': 'Introduce la contraseña:',
  'Enter using password': 'Entrar con contraseña',
  'Your password': 'Tu contraseña',
  'Wrong password!': 'Contraseña incorrecta',
  'Enter': 'Entrar',
  'Early access password...': 'Contraseña de acceso...',
  'Enter Password': 'Introduce la contraseña',
  'Blog': 'Blog',
  'Email': 'Email',
  // ===== Diccionario v3 =====
  'Select Options': 'Elegir opciones',
  'More sizes available': 'Más tallas disponibles',
  'Measurements': 'Medidas',
  'Add More': 'Añadir más',
  'Quantity for {{ product }}': 'Cantidad de {{ product }}',
  'Increase quantity for {{ product }}': 'Aumentar cantidad de {{ product }}',
  'Decrease quantity for {{ product }}': 'Reducir cantidad de {{ product }}',
  'View store information': 'Ver información de la tienda',
  'Check availability at other stores': 'Ver disponibilidad en otras tiendas',
  'Pickup available': 'Recogida disponible',
  "Couldn't load pickup availability": 'No se pudo cargar la disponibilidad',
  'Refresh': 'Actualizar',
  'Regular price': 'Precio habitual',
  'Sale price': 'Precio rebajado',
  'Save {{ price }}': 'Ahorra {{ price }}',
  'Read Less': 'Leer menos',
  'Read More': 'Leer más',
  'Share this product': 'Compartir este producto',
  'This variant is sold out!': 'Esta variante está agotada',
  'Custom Label': 'Etiqueta',
  'Bundle': 'Pack',
  'Unavailable': 'No disponible',
  'This variant is unavailable!': 'Esta variante no está disponible',
  '{{ option_value }} (Unavailable)': '{{ option_value }} (No disponible)',
  '{{ title }} opens full screen video in same window.': '{{ title }} abre el vídeo a pantalla completa.',
  'View in your space': 'Ver en tu espacio',
  'View in your space, loads item in augmented reality window': 'Ver en tu espacio (realidad aumentada)',
  'Pre-Order': 'Reserva',
  'Quick View': 'Vista rápida',
  'Quick view': 'Vista rápida',
  'Quick Add': 'Añadir rápido',
  'Select a {{ name }}': 'Elige {{ name }}',
  'Shop Now': 'Comprar ahora',
  'Add To Cart - {{ value }}': 'Añadir al carrito - {{ value }}',
  'Hurry up! only {{ inventory }} left': 'Quedan {{ inventory }} unidades',
  'Please hurry! Only {{ inventory }} left in stock': 'Quedan {{ inventory }} unidades',
  'Maximum quantity: {{ inventory}}': 'Cantidad máxima: {{ inventory}}',
  'In Stock': 'En stock',
  'Many In Stock': 'En stock',
  ' off': ' dto.',
  'sold in last': 'vendidos en las últimas',
  'hours': 'horas',
  'Availability:': 'Disponibilidad:',
  'Product Type:': 'Tipo de producto:',
  'Show Variants': 'Ver variantes',
  'Hide Variants': 'Ocultar variantes',
  'Adding': 'Añadiendo',
  'Thank You': 'Gracias',
  'Added': 'Añadido',
  'View Full Details': 'Ver detalles',
  'Add All To Cart': 'Añadir todo al carrito',
  'include': 'incluye',
  'including': 'incluyendo',
  'Select Option': 'Elegir opción',
  'Price Total:': 'Total:',
  'Media gallery': 'Galería',
  'Oops!Page Not Found': '¡Vaya! Página no encontrada',
  "Sorry! The page you're looking for clocked out!": 'La página que buscas no existe.',
  'Return to Store': 'Volver a la tienda',
  "There are {{ count }} Page(s) and article(s) for '{{ terms }}'": "Hay {{ count }} página(s) y artículo(s) para '{{ terms }}'",
  'View {{ type }}': 'Ver {{ type }}',
  'Page': 'Página',
  'Search for products on our site': 'Busca productos en nuestra tienda',
  'Phone number': 'Teléfono',
  'Submit Contact': 'Enviar',
  "Thanks for contacting us. We'll get back to you as soon as possible.": 'Gracias por contactarnos. Te responderemos lo antes posible.',
  'Please adjust the following:': 'Revisa lo siguiente:',
  'Filter by Topic': 'Filtrar por tema',
  'Tab to show all galleries': 'Mostrar todas las galerías',
  'Tab to filter gallery': 'Filtrar galería',
  'Announcement': 'Anuncio',
  '{{ count }} item': '{{ count }} artículo',
  '{{ count }} items': '{{ count }} artículos',
  'Your cart': 'Tu carrito',
  'Cart items': 'Artículos del carrito',
  'Proceed To Checkout': 'Finalizar compra',
  'View Cart': 'Ver carrito',
  'Remove {{ title }}': 'Eliminar {{ title }}',
  '{{ count }} items in your shopping cart': '{{ count }} artículos en tu carrito',
  'New subtotal': 'Nuevo subtotal',
  'Order special instructions': 'Instrucciones del pedido',
  'Shipping': 'Envío',
  'Taxes and shipping fee will be calculated at checkout': 'Impuestos y envío se calculan al finalizar la compra',
  'You May Also Like': 'También te puede gustar',
  'There was an error while updating your cart. Please try again.': 'Error al actualizar el carrito. Inténtalo de nuevo.',
  'You can only add {{maxQuantity}} of this product to your cart': 'Solo puedes añadir {{maxQuantity}} unidades',
  'Brands A - Z': 'Marcas A - Z',
  'Password modal': 'Ventana de contraseña',
  'Load media in gallery viewer, {{ mediaAlt }}': 'Cargar imagen en la galería, {{ mediaAlt }}',
  'Load video in gallery viewer, {{ mediaAlt }}': 'Cargar vídeo en la galería, {{ mediaAlt }}',
  'Load 3D model in gallery viewer, {{ mediaAlt }}': 'Cargar modelo 3D, {{ mediaAlt }}',
  "Please, hurry! Someone has placed an order on one of the items you have in the cart. We'll keep it for you for": 'Tu carrito se mantiene durante'
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

// ============ DESACTIVAR BLOQUES DE URGENCIA FALSA (ficha de producto) ============
// hot_stock ("Hurry up!"), customer_viewing ("X customers viewing"), countdown
app.get('/do/fix-product-blocks', async (req, res) => {
  try {
    const confirm = req.query.confirm === 'si';
    const targets = ['hot_stock', 'customer_viewing', 'countdown'];
    const files = ['templates/product.json', 'templates/product.context.es.json'];
    const report = [];
    for (const f of files) {
      try {
        const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=${encodeURIComponent(f)}`);
        const json = JSON.parse(a.asset.value);
        let cambiados = 0;
        for (const sid in json.sections) {
          const s = json.sections[sid];
          if (s.blocks) {
            for (const bid in s.blocks) {
              if (targets.includes(s.blocks[bid].type) && s.blocks[bid].disabled !== true) {
                report.push({ archivo: f, seccion: sid, bloque: s.blocks[bid].type, accion: confirm ? 'desactivado' : 'se desactivaría' });
                cambiados++;
                if (confirm) s.blocks[bid].disabled = true;
              }
            }
          }
        }
        if (confirm && cambiados) {
          await shopify('put', `/themes/${THEME_ID}/assets.json`, {
            asset: { key: `assets/backup-${f.replace(/[\/.]/g, '-')}-${Date.now()}.json`, value: a.asset.value }
          });
          await shopify('put', `/themes/${THEME_ID}/assets.json`, {
            asset: { key: f, value: JSON.stringify(json) }
          });
        }
      } catch (e) {
        report.push({ archivo: f, error: e.response?.status || e.message });
      }
    }
    res.json({ modo: confirm ? 'EJECUTADO ✅' : 'SIMULACIÓN — añade &confirm=si para ejecutar', bloques: report });
  } catch (e) {
    res.status(500).json({ error: e.message, details: e.response?.data });
  }
});

// ============ ASIGNAR IMAGEN AUTOMÁTICA A COLECCIONES SIN IMAGEN ============
app.get('/do/set-collection-images', async (req, res) => {
  try {
    const confirm = req.query.confirm === 'si';
    const [custom, smart] = await Promise.all([
      shopify('get', '/custom_collections.json'),
      shopify('get', '/smart_collections.json')
    ]);
    const all = [
      ...custom.custom_collections.map(c => ({ ...c, _k: 'custom_collection', _p: 'custom_collections' })),
      ...smart.smart_collections.map(c => ({ ...c, _k: 'smart_collection', _p: 'smart_collections' }))
    ];
    const sin = all.filter(c => !(c.image && c.image.src));
    const report = [];
    for (const c of sin) {
      const prods = (await shopify('get', `/collections/${c.id}/products.json?limit=10`)).products;
      const conFoto = prods.find(p => p.images && p.images.length);
      if (!conFoto) { report.push({ coleccion: c.title, resultado: 'sin productos con foto' }); continue; }
      const src = conFoto.images[0].src;
      report.push({ coleccion: c.title, producto_usado: conFoto.title, accion: confirm ? 'imagen asignada' : 'se asignaría' });
      if (confirm) {
        await shopify('put', `/${c._p}/${c.id}.json`, { [c._k]: { id: c.id, image: { src } } });
      }
    }
    res.json({ modo: confirm ? 'EJECUTADO ✅' : 'SIMULACIÓN — añade &confirm=si para ejecutar', cambios: report });
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

// ============ FUNCIONES COMPARTIDAS DE DATOS ============
async function dataAudit() {
  const out = {};
  const shop = await shopify('get', '/shop.json');
  out.tienda = { nombre: shop.shop.name, dominio: shop.shop.domain, plan: shop.shop.plan_display_name, moneda: shop.shop.currency };
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
  try {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const orders = (await shopify('get', `/orders.json?status=any&created_at_min=${since}&limit=250`)).orders;
    const ventas = {};
    orders.forEach(o => (o.line_items || []).forEach(li => { ventas[li.title] = (ventas[li.title] || 0) + li.quantity; }));
    out.pedidos_30d = {
      total_pedidos: orders.length,
      facturacion: orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0).toFixed(2),
      ticket_medio: orders.length ? (orders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0) / orders.length).toFixed(2) : 0,
      mas_vendidos: Object.entries(ventas).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, q]) => ({ producto: t, unidades: q }))
    };
  } catch (e) {
    out.pedidos_30d = { error: 'No accesible (¿falta scope read_orders?): ' + (e.response?.status || e.message) };
  }
  return out;
}

async function dataFixSpanishSim() {
  const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=locales/es.json`);
  const json = JSON.parse(a.asset.value);
  const cambios = [];
  const pendientes = [];
  const esIngles = s => /^[A-Za-z0-9\s.,!?'"%:;()\-{}_*]+$/.test(s) && /[a-z]{3,}/.test(s) && !/[áéíóúñ¿¡]/i.test(s);
  const walk = (obj, path) => {
    for (const k in obj) {
      const v = obj[k];
      const p = path ? path + '.' + k : k;
      if (typeof v === 'string') {
        if (TRADUCCIONES[v] !== undefined) cambios.push({ key: p, antes: v, despues: TRADUCCIONES[v] });
        else if (v.length > 1 && v.length < 120 && esIngles(v) && !v.startsWith('<')) pendientes.push({ key: p, valor: v });
      } else if (v && typeof v === 'object') walk(v, p);
    }
  };
  walk(json, '');
  return { traducibles_con_diccionario: cambios.length, cambios, posibles_pendientes: pendientes.length, pendientes: pendientes.slice(0, 150) };
}

async function dataSettingsFind(terms) {
  const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=config/settings_data.json`);
  const json = JSON.parse(a.asset.value);
  const hits = [];
  const walk = (obj, path) => {
    for (const k in obj) {
      const v = obj[k];
      const p = path ? path + '.' + k : k;
      if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') {
        const texto = (k + ' ' + String(v)).toLowerCase();
        if (terms.some(t => texto.includes(t)) && String(v).length < 200) hits.push({ key: p, valor: v });
      } else if (v && typeof v === 'object') walk(v, p);
    }
  };
  walk(json, '');
  return { total: hits.length, hits: hits.slice(0, 150) };
}

async function dataPages() {
  const data = await shopify('get', '/pages.json?fields=id,title,handle,published_at');
  return data.pages.map(p => ({ id: p.id, titulo: p.title, url: '/pages/' + p.handle, publicada: !!p.published_at }));
}

async function dataCollections() {
  const [custom, smart] = await Promise.all([
    shopify('get', '/custom_collections.json'),
    shopify('get', '/smart_collections.json')
  ]);
  const map = c => ({ id: c.id, titulo: c.title, handle: c.handle, tiene_imagen: !!(c.image && c.image.src), publicada: !!c.published_at });
  return { custom: custom.custom_collections.map(map), smart: smart.smart_collections.map(map) };
}

async function dataLocales() {
  const a = await shopify('get', `/themes/${THEME_ID}/assets.json`);
  return a.assets.filter(x => x.key.startsWith('locales/') || x.key.startsWith('templates/product')).map(x => x.key);
}

async function dataProductTemplate() {
  try {
    const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=templates/product.json`);
    const json = JSON.parse(a.asset.value);
    const resumen = {};
    for (const id in json.sections) {
      const s = json.sections[id];
      resumen[id] = { type: s.type, settings_claves: Object.entries(s.settings || {}).filter(([k, v]) => typeof v === 'boolean' || (typeof v === 'string' && v.length < 80)).slice(0, 40) };
      if (s.blocks) resumen[id].blocks = Object.values(s.blocks).map(b => b.type);
    }
    return { order: json.order, secciones: resumen };
  } catch (e) {
    return { error: 'templates/product.json no existe (tema no OS2 en producto): ' + (e.response?.status || e.message) };
  }
}

async function dataLocaleMissing() {
  const [en, es] = await Promise.all([
    shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=locales/en.default.json`),
    shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=locales/es.json`)
  ]);
  const flat = (o, p = '', out = {}) => {
    for (const k in o) {
      const v = o[k];
      const np = p ? p + '.' + k : k;
      if (typeof v === 'string') out[np] = v;
      else if (v && typeof v === 'object') flat(v, np, out);
    }
    return out;
  };
  const fe = flat(JSON.parse(en.asset.value));
  const fs = flat(JSON.parse(es.asset.value));
  const faltan = [];
  for (const k in fe) if (!(k in fs)) faltan.push({ key: k, en: fe[k] });
  return { total_claves_faltantes_en_es: faltan.length, muestra: faltan.slice(0, 120) };
}

async function dataIndexTemplate() {
  const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=templates/index.json`);
  const json = JSON.parse(a.asset.value);
  const resumen = {};
  for (const id in json.sections) {
    const s = json.sections[id];
    const entry = { type: s.type };
    const interesantes = Object.entries(s.settings || {}).filter(([k, v]) =>
      typeof v === 'string' && v.length < 120 && (k.includes('image') || k.includes('title') || k.includes('collection') || k.includes('link') || k.includes('heading'))
    );
    if (interesantes.length) entry.settings = interesantes;
    if (s.blocks) {
      entry.blocks = Object.entries(s.blocks).map(([bid, b]) => ({
        id: bid,
        type: b.type,
        settings: Object.entries(b.settings || {}).filter(([k, v]) => typeof v === 'string' && v.length < 150)
      }));
    }
    resumen[id] = entry;
  }
  return { order: json.order, secciones: resumen };
}

async function dataSmartRules() {
  const smart = (await shopify('get', '/smart_collections.json')).smart_collections;
  return smart.map(c => ({ titulo: c.title, handle: c.handle, reglas: c.rules, condicion: c.disjunctive ? 'cualquiera' : 'todas' }));
}

async function dataProductTypes() {
  const prods = (await shopify('get', '/products.json?limit=250&fields=id,title,product_type,status,tags,images,variants')).products;
  const tipos = {};
  prods.forEach(p => { tipos[p.product_type || '(sin tipo)'] = (tipos[p.product_type || '(sin tipo)'] || 0) + 1; });
  const bolsos = prods
    .filter(p => /bolso|bandolera|clutch|tote|capazo|mochila|bag|cesta|cartera|monedero|neceser|riñonera|shopper/i.test(p.title + ' ' + (p.tags || '') + ' ' + (p.product_type || '')))
    .map(p => ({ id: p.id, titulo: p.title, tipo: p.product_type || '(sin tipo)', tags: p.tags, estado: p.status, fotos: (p.images || []).length }));
  const catalogo_completo = prods.map(p => ({
    id: p.id, titulo: p.title, tipo: p.product_type || '(sin tipo)', tags: p.tags || '',
    precio: p.variants && p.variants[0] ? p.variants[0].price : null, fotos: (p.images || []).length, estado: p.status
  }));
  return { tipos_de_producto: tipos, posibles_bolsos: bolsos, catalogo_completo };
}

// ============ PANEL DE CONTROL (con datos embebidos para Claude) ============
app.get('/', async (req, res) => {
  const secciones = {};
  const tareas = [
    ['AUDITORIA', dataAudit],
    ['TRADUCCIONES_SIMULACION', dataFixSpanishSim],
    ['AJUSTES_TEMA_SOSPECHOSOS', () => dataSettingsFind(['countdown', 'visitor', 'viewing', 'viewer', 'example', 'congue', 'hurry', 'timer', 'sold', 'flash', 'scarcity', 'people', 'real_time', 'instagram', 'random', 'fake', 'cart_count', 'related', 'recommend'])],
    ['PAGINAS', dataPages],
    ['COLECCIONES', dataCollections],
    ['ARCHIVOS_LOCALES_Y_TEMPLATES', dataLocales],
    ['TEMPLATE_PRODUCTO', dataProductTemplate],
    ['CLAVES_FALTANTES_EN_ES', dataLocaleMissing],
    ['TEMPLATE_HOME', dataIndexTemplate],
    ['REGLAS_COLECCIONES', dataSmartRules],
    ['TIPOS_Y_BOLSOS', dataProductTypes]
  ];
  secciones['BUILD'] = BUILD;
  secciones['TAREAS_BOOT'] = BOOT_LOG;
  await Promise.all(tareas.map(async ([nombre, fn]) => {
    try { secciones[nombre] = await fn(); }
    catch (e) { secciones[nombre] = { error: e.message, details: e.response?.data }; }
  }));
  const datos = Object.entries(secciones)
    .map(([n, d]) => `===== ${n} =====\n` + JSON.stringify(d, null, 1))
    .join('\n\n');
  res.send(panelHTML(datos));
});

function panelHTML(datos) {
  return `<!DOCTYPE html>
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
    <button onclick="run(this, '/do/fix-product-blocks')">🚫 Quitar urgencia falsa en fichas (simular)</button>
    <button onclick="if(confirm('¿Desactivar hot stock, customers viewing y countdown en fichas de producto?')) run(this, '/do/fix-product-blocks?confirm=si')">🚫 Quitar urgencia falsa en fichas (EJECUTAR)</button>
    <button onclick="run(this, '/do/set-collection-images')">🖼️ Imágenes de colecciones (simular)</button>
    <button onclick="if(confirm('¿Asignar imagen del primer producto a las colecciones sin imagen?')) run(this, '/do/set-collection-images?confirm=si')">🖼️ Imágenes de colecciones (EJECUTAR)</button>
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
<div style="max-width:900px;margin:40px auto 0;padding:20px;background:white;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
  <h2 style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:12px;">📡 Datos en vivo (auditoría automática)</h2>
  <pre style="font-size:11px;white-space:pre-wrap;max-height:600px;overflow:auto;">${datos.replace(/</g, '&lt;')}</pre>
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
</html>`;
}

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

// ============ TAREAS DE ARRANQUE (auto-ejecución en cada deploy) ============
const BUILD = 'v7 — 2026-06-15';
const BOOT_LOG = [];

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in o) || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

const flatten = (o, p = '', out = {}) => {
  for (const k in o) {
    const v = o[k];
    const np = p ? p + '.' + k : k;
    if (typeof v === 'string') out[np] = v;
    else if (v && typeof v === 'object') flatten(v, np, out);
  }
  return out;
};

// T1: añadir a es.json las claves que faltan (causa de los textos en inglés por fallback)
async function taskMergeMissingLocaleKeys() {
  const [en, es] = await Promise.all([
    shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=locales/en.default.json`),
    shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=locales/es.json`)
  ]);
  const fe = flatten(JSON.parse(en.asset.value));
  const esJson = JSON.parse(es.asset.value);
  const fs = flatten(esJson);
  let aniadidas = 0;
  const omitidas = [];
  for (const k in fe) {
    if (k in fs) continue;
    const v = fe[k];
    if (TRADUCCIONES[v] !== undefined) { setByPath(esJson, k, TRADUCCIONES[v]); aniadidas++; }
    else if (k.startsWith('shopify.') || /[áéíóúñÁÉÍÓÚÑ¿¡]/.test(v) || /^(y|, y|A - Z|Z - A|Sí|No|Gratis|Aplicar|Error|Carrito|Cerrar|Checkout|Total|Subtotal|Email|Blog)$/.test(v)) { setByPath(esJson, k, v); aniadidas++; }
    else omitidas.push({ key: k, en: v });
  }
  if (aniadidas) {
    await shopify('put', `/themes/${THEME_ID}/assets.json`, {
      asset: { key: `assets/backup-es-boot-${Date.now()}.json`, value: es.asset.value }
    });
    await shopify('put', `/themes/${THEME_ID}/assets.json`, {
      asset: { key: 'locales/es.json', value: JSON.stringify(esJson, null, 2) }
    });
  }
  return { claves_aniadidas: aniadidas, sin_traduccion_pendientes: omitidas.slice(0, 30) };
}

// T2: corregir textos en inglés incrustados en las plantillas de producto
async function taskFixTemplateTexts() {
  const mapa = {
    'Description': 'Descripción',
    'DESCRIPTION': 'DESCRIPCIÓN',
    'Reviews': 'Opiniones',
    'Login': 'Acceso',
    'this is just a warning': 'Aviso'
  };
  const files = ['templates/product.json', 'templates/product.context.es.json'];
  const report = [];
  for (const f of files) {
    try {
      const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=${encodeURIComponent(f)}`);
      const json = JSON.parse(a.asset.value);
      let cambios = 0;
      const walk = obj => {
        for (const k in obj) {
          const v = obj[k];
          if (typeof v === 'string' && mapa[v] !== undefined) { obj[k] = mapa[v]; cambios++; }
          else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(json);
      if (cambios) {
        await shopify('put', `/themes/${THEME_ID}/assets.json`, {
          asset: { key: `assets/backup-${f.replace(/[\/.]/g, '-')}-boot-${Date.now()}.json`, value: a.asset.value }
        });
        await shopify('put', `/themes/${THEME_ID}/assets.json`, { asset: { key: f, value: JSON.stringify(json) } });
      }
      report.push({ archivo: f, textos_corregidos: cambios });
    } catch (e) {
      report.push({ archivo: f, error: e.response?.status || e.message });
    }
  }
  return report;
}

// T3: corregir enlaces rotos y textos de la home (templates/index.json)
async function taskFixHomeLinks() {
  const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=templates/index.json`);
  const json = JSON.parse(a.asset.value);
  const cambios = [];
  const set = (desc, obj, key, nuevo) => {
    if (obj && obj[key] !== undefined && obj[key] !== nuevo) {
      cambios.push({ cambio: desc, antes: obj[key], ahora: nuevo });
      obj[key] = nuevo;
    }
  };
  const S = json.sections;
  // Banner principal: enlace a colección inexistente "vestido-largo" → novedades
  const slide = S['16321237356a896dad'];
  if (slide && slide.blocks) {
    const b = slide.blocks['c537f70d-cebd-4a77-bc92-2d49d06fc121'];
    if (b) set('banner_principal_link', b.settings, 'link', 'shopify://collections/novedades');
  }
  // Sección Novedades: "Ver todo" → novedades
  const nov = S['163247026462da6862'];
  if (nov) set('novedades_ver_todo', nov.settings, 'link_view_all', 'shopify://collections/novedades');
  // Sección Instagram: enlaces a colecciones demo inexistentes → perfil real
  const insta = S['1632364695b0f88b4f'];
  if (insta) {
    set('instagram_boton', insta.settings, 'instagram_button_link', 'https://www.instagram.com/kutch.es/');
    if (insta.blocks) {
      const ib = insta.blocks['566545cd-024f-4585-941a-d5bd625fbe4c'];
      if (ib) set('instagram_bloque_1', ib.settings, 'link', 'https://www.instagram.com/kutch.es/');
    }
  }
  // Newsletter: botón "Subscribe" → "Suscribirme"
  const news = S['f0e8527c-e654-4614-a464-46a98278aae1'];
  if (news && news.blocks) {
    const nb = news.blocks['9fbf7a37-f7c1-4b69-9fab-5b8e3e289862'];
    if (nb) set('newsletter_boton', nb.settings, 'button_text', 'Suscribirme');
  }
  // Bloque de políticas en inglés → texto coherente en español
  const pol = S['policies_block_hrFgpe'];
  if (pol && pol.blocks) {
    const pb = pol.blocks['text_G4UUep'];
    if (pb) {
      set('politicas_texto_ingles', pb.settings, 'text', 'Entrega en 24/48h');
      set('politicas_descripcion', pb.settings, 'description', 'en toda la península');
    }
  }
  if (cambios.length) {
    await shopify('put', `/themes/${THEME_ID}/assets.json`, {
      asset: { key: `assets/backup-index-boot-${Date.now()}.json`, value: a.asset.value }
    });
    await shopify('put', `/themes/${THEME_ID}/assets.json`, { asset: { key: 'templates/index.json', value: JSON.stringify(json) } });
  }
  return { cambios_aplicados: cambios.length, detalle: cambios };
}

// T4: corregir fichas incompletas (tipos de producto + descripción Poncho Aimara)
async function taskFixProductFichas() {
  const report = [];
  // Tipos de producto faltantes — inferidos del título/colección
  const tipos = {
    8872438071586: 'Vestido largo',   // Frida
    8872437973282: 'Vestido largo'    // Loulou
  };
  for (const id in tipos) {
    try {
      const cur = (await shopify('get', `/products/${id}.json?fields=id,title,product_type`)).product;
      if (!cur.product_type) {
        await shopify('put', `/products/${id}.json`, { product: { id: Number(id), product_type: tipos[id] } });
        report.push({ id, titulo: cur.title, tipo_asignado: tipos[id] });
      } else {
        report.push({ id, titulo: cur.title, ya_tenia_tipo: cur.product_type });
      }
    } catch (e) { report.push({ id, error: e.response?.status || e.message }); }
  }
  // Descripción Poncho Aimara (id 14891022516600) si está vacía
  try {
    const id = 14891022516600;
    const p = (await shopify('get', `/products/${id}.json?fields=id,title,body_html`)).product;
    const limpio = (p.body_html || '').replace(/<[^>]*>/g, '').trim();
    if (limpio.length < 30) {
      const desc = `<p>El <strong>Poncho Aimara</strong> es una pieza tejida a mano en pequeños talleres de la región de Kutch, en India. Cada poncho nace de telas naturales seleccionadas una a una, con la calidez y la irregularidad bella de lo verdaderamente artesanal.</p>
<p>Una prenda versátil y envolvente, pensada para acompañarte en las tardes frescas del paseo marítimo o como capa de carácter sobre cualquier look. Pieza única: no encontrarás dos iguales.</p>
<ul>
<li>Tejido artesanal en telar tradicional</li>
<li>Materiales naturales, producción ética en talleres familiares</li>
<li>Prenda atemporal, versátil y de carácter único</li>
</ul>`;
      await shopify('put', `/products/${id}.json`, { product: { id, body_html: desc } });
      report.push({ id, titulo: p.title, descripcion: 'añadida (borrador editable)' });
    } else {
      report.push({ id, titulo: p.title, descripcion: 'ya tenía' });
    }
  } catch (e) { report.push({ id: 14891022516600, error: e.response?.status || e.message }); }
  return report;
}

// T5: traducir el título de "Recently Viewed Products" en templates/product.json
async function taskFixRecentlyViewed() {
  const f = 'templates/product.json';
  try {
    const a = await shopify('get', `/themes/${THEME_ID}/assets.json?asset[key]=${encodeURIComponent(f)}`);
    const json = JSON.parse(a.asset.value);
    let cambios = 0;
    const walk = obj => {
      for (const k in obj) {
        const v = obj[k];
        if (typeof v === 'string' && (v === 'Recently Viewed Products' || v === 'Recently viewed products')) { obj[k] = 'Vistos recientemente'; cambios++; }
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(json);
    if (cambios) {
      await shopify('put', `/themes/${THEME_ID}/assets.json`, { asset: { key: f, value: JSON.stringify(json) } });
    }
    return { textos_corregidos: cambios };
  } catch (e) { return { error: e.response?.status || e.message }; }
}

async function runBootTasks() {
  const tasks = [
    ['merge_claves_es', taskMergeMissingLocaleKeys],
    ['textos_plantilla_producto', taskFixTemplateTexts],
    ['enlaces_y_textos_home', taskFixHomeLinks],
    ['fichas_incompletas', taskFixProductFichas],
    ['recently_viewed', taskFixRecentlyViewed]
  ];
  for (const [nombre, fn] of tasks) {
    try { BOOT_LOG.push({ tarea: nombre, resultado: await fn() }); }
    catch (e) { BOOT_LOG.push({ tarea: nombre, error: e.message, details: e.response?.data }); }
  }
}

app.listen(PORT, () => {
  console.log(`Kutch API running on port ${PORT} — build ${BUILD}`);
  setTimeout(() => runBootTasks().catch(e => BOOT_LOG.push({ error: e.message })), 4000);
});
