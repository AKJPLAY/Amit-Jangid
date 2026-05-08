/**
 * aj-popup.js
 * Handles the product quick-view popup, variant selection, and cart operations
 * for the AJ Product Grid section.
 *
 * Rules:
 *  - Vanilla JS only — no jQuery or external dependencies
 *  - When a product with Color = "Black" AND Size = "Medium" is added to cart,
 *    the "Soft Winter Jacket" is automatically added as well.
 */

(function () {
  'use strict';

  /* ── Config ──────────────────────────────────────────────────────────────
     AJGridConfig is injected by aj-grid.liquid via a <script> tag so the
     Liquid-side settings (e.g. the soft jacket handle) are available here.
  ─────────────────────────────────────────────────────────────────────────── */
  const cfg = window.AJGridConfig || {};
  const SOFT_JACKET_HANDLE = cfg.softWinterJacketHandle || 'soft-winter-jacket';

  /* ── State ────────────────────────────────────────────────────────────── */
  let currentProduct  = null;  // Shopify product JSON (from /products/HANDLE.js)
  let selectedVariant = null;  // The matched variant object

  /* ── DOM references ───────────────────────────────────────────────────── */
  const overlay  = document.getElementById('aj-popup-overlay');
  const content  = document.getElementById('aj-popup-content');
  const closeBtn = document.getElementById('aj-popup-close');

  // Section is not present on this page — exit silently
  if (!overlay || !content) return;

  /* ══════════════════════════════════════════════════════════════════════════
     OPEN / CLOSE
  ══════════════════════════════════════════════════════════════════════════ */

  function openPopup(productHandle) {
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // Show loading skeleton while fetching
    content.innerHTML = '<p class="aj-popup__loading">Loading…</p>';

    fetchProduct(productHandle)
      .then(renderPopup)
      .catch(function (err) {
        console.error('[AJ Popup] Failed to load product "' + productHandle + '":', err);
        content.innerHTML =
          '<p class="aj-popup__error">Could not load product details.<br>' +
          '<small style="opacity:.6">' + escHtml(String(err.message)) + '</small></p>';
      });
  }

  function closePopup() {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    currentProduct  = null;
    selectedVariant = null;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     FETCH
  ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Fetches product JSON from the Shopify storefront API.
   * @param {string} handle - Shopify product handle
   * @returns {Promise<Object>} Shopify product object
   */
  function fetchProduct(handle) {
    if (!handle) return Promise.reject(new Error('No product handle provided'));

    var url = '/products/' + handle + '.js';
    console.log('[AJ Popup] Fetching:', url);

    return fetch(url, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (res) {
      console.log('[AJ Popup] Response status:', res.status, 'for', url);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for /products/' + handle + '.js — is the product published on the Online Store?');
      return res.json();
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════════ */

  function renderPopup(product) {
    currentProduct = product;

    // Identify which option index is color vs size (case-insensitive)
    var colorIdx = indexOfOption(product.options, 'color');
    var sizeIdx  = indexOfOption(product.options, 'size');

    var colors = colorIdx >= 0 ? uniqueOptionValues(product.variants, colorIdx) : [];
    var sizes  = sizeIdx  >= 0 ? uniqueOptionValues(product.variants, sizeIdx)  : [];

    // Product image — request a 300px-wide version via Shopify CDN sizing
    var imageUrl = product.featured_image
      ? product.featured_image.replace(/(\.(jpg|jpeg|png|gif|webp))(\?.*)?$/i, '_300x300$1')
      : '';

    // Price from first variant (displayed; updates with variant selection in future)
    var price = formatMoney(product.variants[0].price);

    // Strip HTML from description, cap at 140 chars
    var description = stripHtml(product.description).trim().slice(0, 140);
    if (product.description.length > 140) description += '…';

    // Build inner HTML
    content.innerHTML =
      '<div class="aj-popup__body">' +
        '<div class="aj-popup__left">' +
          '<img' +
            ' src="' + escHtml(imageUrl) + '"' +
            ' alt="' + escHtml(product.title) + '"' +
            ' class="aj-popup__product-img"' +
            ' loading="lazy"' +
          '/>' +
        '</div>' +
        '<div class="aj-popup__right">' +
          '<p class="aj-popup__product-name" id="aj-popup-title">' + escHtml(product.title) + '</p>' +
          '<p class="aj-popup__product-price">' + escHtml(price) + '</p>' +
          '<p class="aj-popup__product-desc">' + escHtml(description) + '</p>' +
        '</div>' +
      '</div>' +
      (colors.length ? renderColorSwatches(colors) : '') +
      (sizes.length  ? renderSizeDropdown(sizes)   : '') +
      '<div class="aj-popup__footer">' +
        '<button' +
          ' class="aj-btn aj-btn--black aj-popup__atc"' +
          ' id="aj-popup-atc"' +
          ' type="button"' +
        '>' +
          '<span class="aj-btn__label">ADD TO CART</span>' +
          '<span class="aj-btn__arrow" aria-hidden="true">' +
            arrowSvg() +
          '</span>' +
        '</button>' +
      '</div>';

    // Pre-select the first colour so there is always a default
    var firstColorBtn = content.querySelector('.aj-popup__color-btn');
    if (firstColorBtn) {
      firstColorBtn.classList.add('is-selected');
      firstColorBtn.setAttribute('aria-pressed', 'true');
    }

    updateVariant(); // Resolve initial selectedVariant
    bindPopupListeners();
  }

  /* ── Colour swatches ────────────────────────────────────────────────────── */

  function renderColorSwatches(colors) {
    var items = colors.map(function (c) {
      /* Resolve a CSS color from the label so the stripe is accurate.
         Most standard color names are valid CSS — fall back to #ccc
         for anything unrecognised (e.g. "Coral Reef"). */
      var cssColor = resolveCssColor(c);
      return (
        '<button' +
          ' class="aj-popup__color-btn"' +
          ' data-value="' + escHtml(c) + '"' +
          ' type="button"' +
          ' aria-pressed="false"' +
          /* CSS custom property drives the ::before stripe */
          ' style="--swatch-color:' + cssColor + '"' +
        '>' +
          escHtml(c) +
        '</button>'
      );
    }).join('');

    return (
      '<div class="aj-popup__variant-group">' +
        '<p class="aj-popup__variant-label">Color</p>' +
        '<div class="aj-popup__color-swatches">' + items + '</div>' +
      '</div>'
    );
  }

  /**
   * Maps a color label to a CSS color value.
   * Falls back gracefully for non-standard names by trying the raw label
   * (e.g. "Blue", "Navy" are valid CSS), then returning a neutral grey.
   *
   * @param {string} label  e.g. "Blue", "Coral Reef", "Off-White"
   * @returns {string} CSS color string
   */
  function resolveCssColor(label) {
    var overrides = {
      'grey':      '#888888',
      'gray':      '#888888',
      'off-white': '#f5f5f5',
      'off white': '#f5f5f5',
      'cream':     '#fffdd0',
      'beige':     '#f5e6c8',
      'navy':      '#001f5b',
      'dark blue': '#003580',
      'light blue':'#add8e6',
      'light grey':'#d3d3d3',
      'light gray':'#d3d3d3',
      'dark grey': '#555555',
      'dark gray': '#555555',
    };

    var lower = label.toLowerCase();
    if (overrides[lower]) return overrides[lower];

    /* Most basic CSS named colors (red, blue, black, white, green…) work as-is */
    return label;
  }

  /* ── Size dropdown ──────────────────────────────────────────────────────── */

  function renderSizeDropdown(sizes) {
    var options = sizes.map(function (s) {
      return '<option value="' + escHtml(s) + '">' + escHtml(s) + '</option>';
    }).join('');

    return (
      '<div class="aj-popup__variant-group">' +
        '<p class="aj-popup__variant-label">Size</p>' +
        '<div class="aj-popup__size-wrap">' +
          '<select class="aj-popup__size-select" id="aj-popup-size" aria-label="Select size">' +
            '<option value="">Choose your size</option>' +
            options +
          '</select>' +
          '<span class="aj-popup__caret" aria-hidden="true">' +
            '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<path d="M1 1L5 5L9 1" stroke="#000" stroke-width="1.5" stroke-linecap="round"/>' +
            '</svg>' +
          '</span>' +
        '</div>' +
      '</div>'
    );
  }

  /* ── Arrow SVG ──────────────────────────────────────────────────────────── */

  function arrowSvg() {
    return (
      '<svg width="24" height="10" viewBox="0 0 24 10" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M0 5H22M22 5L18 1M22 5L18 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     EVENT LISTENERS (popup-internal)
  ══════════════════════════════════════════════════════════════════════════ */

  function bindPopupListeners() {
    /* Colour buttons */
    var colorBtns = content.querySelectorAll('.aj-popup__color-btn');
    colorBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        colorBtns.forEach(function (b) {
          b.classList.remove('is-selected');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('is-selected');
        btn.setAttribute('aria-pressed', 'true');
        updateVariant();
      });
    });

    /* Size select */
    var sizeSelect = document.getElementById('aj-popup-size');
    if (sizeSelect) {
      sizeSelect.addEventListener('change', updateVariant);
    }

    /* Add-to-cart button */
    var atcBtn = document.getElementById('aj-popup-atc');
    if (atcBtn) {
      atcBtn.addEventListener('click', handleAddToCart);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     VARIANT RESOLUTION
  ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Reads the current UI selections and finds the matching variant.
   * Writes the result to the module-level `selectedVariant`.
   */
  function updateVariant() {
    if (!currentProduct) return;

    var colorIdx = indexOfOption(currentProduct.options, 'color');
    var sizeIdx  = indexOfOption(currentProduct.options, 'size');

    var selectedColorBtn = content.querySelector('.aj-popup__color-btn.is-selected');
    var sizeSelect       = document.getElementById('aj-popup-size');

    var chosenColor = selectedColorBtn ? selectedColorBtn.dataset.value : null;
    var chosenSize  = sizeSelect && sizeSelect.value ? sizeSelect.value : null;

    selectedVariant = currentProduct.variants.find(function (v) {
      var colorMatch = colorIdx < 0 || !chosenColor || v['option' + (colorIdx + 1)] === chosenColor;
      var sizeMatch  = sizeIdx  < 0 || !chosenSize  || v['option' + (sizeIdx  + 1)] === chosenSize;
      return colorMatch && sizeMatch;
    }) || null;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ADD TO CART
  ══════════════════════════════════════════════════════════════════════════ */

  function handleAddToCart() {
    updateVariant();

    if (!selectedVariant) {
      showMessage('Please select your colour and size.');
      return;
    }

    var atcBtn  = document.getElementById('aj-popup-atc');
    var labelEl = atcBtn && atcBtn.querySelector('.aj-btn__label');

    if (atcBtn) {
      atcBtn.disabled = true;
      if (labelEl) labelEl.textContent = 'Adding…';
    }

    buildCartItems()
      .then(function (items) {
        return addItemsToCart(items);
      })
      .then(function () {
        showMessage('✓ Added to cart!');
        refreshCartCount();
      })
      .catch(function (err) {
        console.error('[AJ Popup] Cart error:', err);
        showMessage('Could not add to cart. Please try again.');
      })
      .finally(function () {
        if (atcBtn) {
          atcBtn.disabled = false;
          if (labelEl) labelEl.textContent = 'ADD TO CART';
        }
      });
  }

  /**
   * Builds the array of cart items to add.
   * If the selected variant has Color=Black AND Size=Medium,
   * the Soft Winter Jacket is appended automatically.
   *
   * @returns {Promise<Array<{id:number, quantity:number}>>}
   */
  function buildCartItems() {
    var items = [{ id: selectedVariant.id, quantity: 1 }];

    var colorIdx = indexOfOption(currentProduct.options, 'color');
    var sizeIdx  = indexOfOption(currentProduct.options, 'size');

    var isBlack  = colorIdx >= 0 &&
                   selectedVariant['option' + (colorIdx + 1)].toLowerCase() === 'black';
    var isMedium = sizeIdx  >= 0 &&
                   selectedVariant['option' + (sizeIdx  + 1)].toLowerCase() === 'medium';

    if (isBlack && isMedium) {
      // Auto-add Soft Winter Jacket when Black + Medium is selected
      return fetchSoftJacketVariantId().then(function (jacketId) {
        if (jacketId) items.push({ id: jacketId, quantity: 1 });
        return items;
      });
    }

    return Promise.resolve(items);
  }

  /**
   * Looks up the default (first available) variant of the Soft Winter Jacket.
   * Returns null gracefully if the product doesn't exist in the store.
   *
   * @returns {Promise<number|null>}
   */
  function fetchSoftJacketVariantId() {
    return fetchProduct(SOFT_JACKET_HANDLE)
      .then(function (p) {
        var available = p.variants.find(function (v) { return v.available; });
        return (available || p.variants[0]).id;
      })
      .catch(function () {
        console.warn('[AJ Popup] Soft Winter Jacket not found at handle:', SOFT_JACKET_HANDLE);
        return null;
      });
  }

  /**
   * POSTs items to the Shopify Cart API.
   * Uses the /cart/add.js bulk endpoint.
   *
   * @param {Array<{id:number, quantity:number}>} items
   * @returns {Promise<Object>}
   */
  function addItemsToCart(items) {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ items: items })
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) {
          throw new Error(data.description || 'Cart add failed');
        });
      }
      return res.json();
    });
  }

  /* ── Cart count refresh ─────────────────────────────────────────────────── */

  /**
   * Updates the cart item count in Dawn's header bubble after adding.
   * Relies on /cart.js — no page reload needed.
   */
  function refreshCartCount() {
    fetch('/cart.js', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        // Dawn uses .cart-count-bubble > [aria-hidden] for the count
        document.querySelectorAll('.cart-count-bubble').forEach(function (bubble) {
          var countEl = bubble.querySelector('[aria-hidden]');
          if (countEl) countEl.textContent = cart.item_count;
        });
        // Also dispatch pubsub event for Dawn's cart drawer if present
        if (typeof window.publish === 'function' && window.PUB_SUB_EVENTS) {
          window.publish(window.PUB_SUB_EVENTS.cartUpdate, { cart: cart });
        }
      })
      .catch(function () { /* Non-critical — suppress */ });
  }

  /* ── Status message ─────────────────────────────────────────────────────── */

  function showMessage(text) {
    var existing = content.querySelector('.aj-popup__msg');
    if (existing) existing.remove();

    var msg = document.createElement('p');
    msg.className = 'aj-popup__msg';
    msg.textContent = text;

    var footer = content.querySelector('.aj-popup__footer');
    if (footer) {
      content.insertBefore(msg, footer);
    } else {
      content.appendChild(msg);
    }

    setTimeout(function () { msg.remove(); }, 3000);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     EVENT LISTENERS (global — delegated)
  ══════════════════════════════════════════════════════════════════════════ */

  /* Plus buttons on product cards */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.aj-grid__plus-btn');
    if (!btn) return;
    e.preventDefault();
    var handle = btn.dataset.productHandle;
    console.log('[AJ Popup] Plus button clicked, handle:', handle);
    if (handle) {
      openPopup(handle);
    } else {
      console.warn('[AJ Popup] Button has no data-product-handle attribute. Make sure a product is assigned in the customizer.');
    }
  });

  /* Close button */
  if (closeBtn) {
    closeBtn.addEventListener('click', closePopup);
  }

  /* Click outside the popup box */
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closePopup();
  });

  /* Escape key */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
      closePopup();
    }
  });

  /* ══════════════════════════════════════════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Returns the index of an option by name (case-insensitive).
   * Handles both string arrays ["Color","Size"] and object arrays
   * [{name:"Color", values:[...]}, ...] — Shopify returns either format
   * depending on API version / theme context.
   *
   * @param {Array}  options  product.options from /products/HANDLE.js
   * @param {string} name     option name to look for, e.g. "color"
   * @returns {number} -1 if not found
   */
  function indexOfOption(options, name) {
    if (!Array.isArray(options)) return -1;
    var lower = name.toLowerCase();
    return options.findIndex(function (o) {
      // o may be a plain string OR an option object {name, values, position}
      var optName = typeof o === 'string' ? o : (o && o.name ? String(o.name) : '');
      return optName.toLowerCase() === lower;
    });
  }

  /**
   * Collects unique values for a given option index across all variants,
   * preserving the order they first appear.
   * Safely skips null / undefined entries.
   *
   * @param {Array}  variants
   * @param {number} optionIndex  0-based
   * @returns {string[]}
   */
  function uniqueOptionValues(variants, optionIndex) {
    if (!Array.isArray(variants)) return [];
    var key  = 'option' + (optionIndex + 1);
    var seen = Object.create(null);
    return variants.reduce(function (acc, v) {
      var val = v[key];
      if (val != null && val !== '' && !seen[val]) {
        seen[val] = true;
        acc.push(String(val));
      }
      return acc;
    }, []);
  }

  /**
   * Formats a price given in Shopify's cents (integer).
   * Uses Intl.NumberFormat for locale-aware output.
   *
   * @param {number} cents
   * @returns {string}  e.g. "€12.99"
   */
  function formatMoney(cents) {
    try {
      return new Intl.NumberFormat('en-IE', {
        style: 'currency',
        currency: window.Shopify && window.Shopify.currency
          ? window.Shopify.currency.active
          : 'EUR',
        minimumFractionDigits: 2
      }).format(cents / 100);
    } catch (_) {
      return (cents / 100).toFixed(2);
    }
  }

  /**
   * Strips HTML tags from a string.
   * Uses a temporary DOM node — safe for in-memory use only.
   *
   * @param {string} html
   * @returns {string}
   */
  function stripHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  /**
   * Escapes a string for safe insertion into HTML attribute values or text.
   *
   * @param {*} str
   * @returns {string}
   */
  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

})();
