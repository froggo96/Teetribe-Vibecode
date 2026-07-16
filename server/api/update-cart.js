const { getSdk, serialize, handleError } = require('../api-util/sdk');

// Keep in sync with CART_MAX_LISTINGS_PER_SELLER in src/ducks/cart.duck.js.
// The cap keeps a single-seller checkout comfortably under the Marketplace
// API's 50-line-item limit (items + shipping + commissions).
const CART_MAX_LISTINGS_PER_SELLER = 20;

// Group keys that are not listing ids.
const NON_LISTING_GROUP_KEYS = ['deliveryMethod'];
const DELIVERY_METHODS = ['shipping', 'pickup'];

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

// Validates the cart shape:
// { [authorId]: { [listingId]: { count }, deliveryMethod? } }
// Returns an error message for an invalid cart, or null for a valid one.
const validateCart = cart => {
  if (!isPlainObject(cart)) {
    return 'cart must be an object keyed by author id';
  }

  for (const [authorId, group] of Object.entries(cart)) {
    if (!isPlainObject(group)) {
      return `cart group ${authorId} must be an object keyed by listing id`;
    }
    if (group.deliveryMethod != null && !DELIVERY_METHODS.includes(group.deliveryMethod)) {
      return `cart group ${authorId} has an invalid deliveryMethod`;
    }

    const listingEntries = Object.entries(group).filter(
      ([key]) => !NON_LISTING_GROUP_KEYS.includes(key)
    );
    if (listingEntries.length === 0) {
      return `cart group ${authorId} has no listings`;
    }
    if (listingEntries.length > CART_MAX_LISTINGS_PER_SELLER) {
      return `cart group ${authorId} exceeds ${CART_MAX_LISTINGS_PER_SELLER} listings`;
    }

    for (const [listingId, item] of listingEntries) {
      if (!isPlainObject(item) || !Number.isInteger(item.count) || item.count < 1) {
        return `cart item ${listingId} must have a positive integer count`;
      }
    }
  }

  return null;
};

module.exports = (req, res) => {
  const { cart } = req.body || {};

  const sdk = getSdk(req, res);

  Promise.resolve()
    .then(() => {
      // An empty object is valid: it clears the whole cart.
      const validationError = validateCart(cart || {});
      if (validationError) {
        const error = new Error(validationError);
        error.status = 400;
        error.statusText = validationError;
        error.data = {};
        throw error;
      }

      // privateData is merged by top-level key, so this only replaces the
      // `cart` key and leaves e.g. favoriteListingIds untouched.
      return sdk.currentUser.updateProfile({ privateData: { cart: cart || {} } }, { expand: true });
    })
    .then(apiResponse => {
      const { status, statusText, data } = apiResponse;
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(serialize({ status, statusText, data }))
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
