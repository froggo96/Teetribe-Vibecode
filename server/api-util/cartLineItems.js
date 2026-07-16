const {
  calculateShippingFee,
  calculateTotalFromLineItems,
  getProviderCommissionMaybe,
  getCustomerCommissionMaybe,
} = require('./lineItemHelpers');

// Keep in sync with CART_MAX_LISTINGS_PER_SELLER in server/api/update-cart.js
// and src/ducks/cart.duck.js. Well under the Marketplace API's 50-line-item
// cap (items + one shipping line + two commission lines).
exports.CART_MAX_ITEMS_PER_SELLER = 20;

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

const throwBadRequest = (message, code) => {
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  error.data = { code };
  throw error;
};

/**
 * Picks the "anchor" listing for the one-parcel shipping model: the cart
 * listing with the highest first-item shipping fee (ties broken by the
 * highest additional-item fee). The whole cart is treated as a single
 * shipment: the anchor's first-item fee is charged once, and every other
 * unit in the cart (across all listings) is charged at the anchor's
 * additional-item fee.
 *
 * @param {Array} listings - cart listings (only those with a numeric
 *   shippingPriceInSubunitsOneItem are considered)
 * @returns {Object|null} the anchor listing, or null if none define shipping
 */
const pickShippingAnchor = listings => {
  const withShipping = listings.filter(listing =>
    isFiniteNumber(listing.attributes.publicData?.shippingPriceInSubunitsOneItem)
  );
  if (withShipping.length === 0) {
    return null;
  }
  return withShipping.reduce((best, listing) => {
    const { shippingPriceInSubunitsOneItem: bestOne, shippingPriceInSubunitsAdditionalItems: bestAdd = 0 } =
      best.attributes.publicData;
    const { shippingPriceInSubunitsOneItem: one, shippingPriceInSubunitsAdditionalItems: add = 0 } =
      listing.attributes.publicData;
    const isHigher = one > bestOne || (one === bestOne && add > bestAdd);
    return isHigher ? listing : best;
  });
};

/**
 * Validates listings fetched for a cart order (fresh from the Marketplace API, so this
 * doesn't need to trust anything the client claims): they must all belong to the same
 * seller, all be published, and all be purchasable products. cartLineItems() itself
 * separately validates that every requested cart item resolved to one of these listings,
 * that quantities are valid, that currencies match, and the per-seller item cap.
 *
 * @param {Array} listings
 */
exports.validateCartListings = listings => {
  const authorIds = new Set(
    listings.map(l => l.relationships?.author?.data?.id?.uuid).filter(Boolean)
  );
  if (authorIds.size > 1) {
    throwBadRequest('Cart listings must all belong to the same seller', 'cart-mixed-authors');
  }

  const unavailable = listings.filter(l => l.attributes.state !== 'published');
  if (unavailable.length > 0) {
    throwBadRequest(
      'Some cart listings are not available for purchase',
      'cart-listing-unavailable'
    );
  }

  const wrongUnitType = listings.filter(l => l.attributes.publicData?.unitType !== 'item');
  if (wrongUnitType.length > 0) {
    throwBadRequest('Cart listings must all be purchasable products', 'cart-invalid-listing-type');
  }
};

/**
 * Computes line items for a single-seller cart order: one `line-item/item`
 * line per cart listing (server-trusted price and quantity), an optional
 * one-parcel shipping-fee line, and provider/customer commissions on the
 * items subtotal (shipping is excluded from commission, matching the
 * single-listing behavior in lineItems.js).
 *
 * @param {Array} listings - listing entities for every id referenced in
 *   orderData.cartItems, as fetched with the Marketplace API (must include
 *   `attributes.price` and `attributes.publicData`)
 * @param {Object} orderData
 * @param {Array<{listingId: string, quantity: number}>} orderData.cartItems
 * @param {'shipping'|'pickup'} [orderData.deliveryMethod]
 * @param {Object} providerCommission
 * @param {Object} customerCommission
 * @returns {Array} lineItems
 */
exports.cartLineItems = (listings, orderData, providerCommission, customerCommission) => {
  const { cartItems, deliveryMethod } = orderData || {};

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throwBadRequest('cartItems must be a non-empty array', 'cart-empty');
  }
  if (cartItems.length > exports.CART_MAX_ITEMS_PER_SELLER) {
    throwBadRequest(
      `cartItems exceeds the maximum of ${exports.CART_MAX_ITEMS_PER_SELLER} listings`,
      'cart-too-many-items'
    );
  }

  const listingsById = new Map(listings.map(listing => [listing.id.uuid, listing]));

  const cartListings = cartItems.map(({ listingId, quantity }) => {
    const listing = listingsById.get(listingId);
    if (!listing) {
      throwBadRequest(`No listing found for cart item ${listingId}`, 'cart-listing-unavailable');
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throwBadRequest(`Cart item ${listingId} has an invalid quantity`, 'cart-invalid-quantity');
    }
    return { listing, quantity };
  });

  const currency = cartListings[0].listing.attributes.price.currency;
  const hasMixedCurrency = cartListings.some(
    ({ listing }) => listing.attributes.price.currency !== currency
  );
  if (hasMixedCurrency) {
    throwBadRequest('All cart listings must share the same currency', 'cart-mixed-currency');
  }

  // Base line items: one per cart listing, in the same order as orderData.cartItems.
  // This order is load-bearing - the client zips these lines back up with
  // protectedData.cartItems (by index) to label each row in the UI, since
  // line items don't carry listing ids.
  const itemLineItems = cartListings.map(({ listing, quantity }) => ({
    code: 'line-item/item',
    unitPrice: listing.attributes.price,
    quantity,
    includeFor: ['customer', 'provider'],
  }));

  // One-parcel shipping: the whole cart ships together, so only the anchor
  // listing's fees apply, regardless of which listing(s) the extra units belong to.
  const isShipping = deliveryMethod === 'shipping';
  const shippingAnchor = isShipping ? pickShippingAnchor(cartListings.map(ci => ci.listing)) : null;
  const totalUnits = cartListings.reduce((sum, { quantity }) => sum + quantity, 0);
  const shippingFee = shippingAnchor
    ? calculateShippingFee(
        shippingAnchor.attributes.publicData.shippingPriceInSubunitsOneItem,
        shippingAnchor.attributes.publicData.shippingPriceInSubunitsAdditionalItems,
        currency,
        totalUnits
      )
    : null;
  const shippingLineItemMaybe = shippingFee
    ? [
        {
          code: 'line-item/shipping-fee',
          unitPrice: shippingFee,
          quantity: 1,
          includeFor: ['customer', 'provider'],
        },
      ]
    : [];

  // Commissions apply to the items subtotal only (shipping excluded, same as
  // the single-listing flow in lineItems.js). getProviderCommissionMaybe/
  // getCustomerCommissionMaybe expect a single "order" line item to compute
  // the total from, so we hand them a synthetic aggregate covering every item line.
  const itemsSubtotal = calculateTotalFromLineItems(itemLineItems);
  const aggregateOrder = {
    code: 'line-item/item',
    unitPrice: itemsSubtotal,
    quantity: 1,
    includeFor: ['customer', 'provider'],
  };

  const lineItems = [
    ...itemLineItems,
    ...shippingLineItemMaybe,
    ...getProviderCommissionMaybe(providerCommission, aggregateOrder, currency),
    ...getCustomerCommissionMaybe(customerCommission, aggregateOrder, currency),
  ];

  return lineItems;
};
