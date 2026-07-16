const sharetribeSdk = require('sharetribe-flex-sdk');
const { cartLineItems, validateCartListings } = require('../api-util/cartLineItems');
const { getSdk, handleError, serialize, fetchCommission } = require('../api-util/sdk');
const { constructValidLineItems } = require('../api-util/lineItemHelpers');

const { UUID } = sharetribeSdk.types;

const throwBadRequest = (message, code) => {
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  error.data = { code };
  throw error;
};

// Estimated (non-privileged) line items for a whole seller-group in the cart,
// used to show a per-seller breakdown on the cart page before checkout.
// Mirrors server/api/transaction-line-items.js, but for many listings from
// one seller instead of a single listing.
module.exports = (req, res) => {
  const { orderData } = req.body || {};
  const { cartItems, deliveryMethod } = orderData || {};

  const sdk = getSdk(req, res);

  Promise.resolve()
    .then(() => {
      if (!Array.isArray(cartItems) || cartItems.length === 0) {
        throwBadRequest('cartItems must be a non-empty array', 'cart-empty');
      }

      const ids = cartItems.map(({ listingId }) => new UUID(listingId));
      return Promise.all([sdk.listings.query({ ids, include: ['author'] }), fetchCommission(sdk)]);
    })
    .then(([listingsResponse, fetchAssetsResponse]) => {
      const listings = listingsResponse.data.data;
      const commissionAsset = fetchAssetsResponse.data.data[0];
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      validateCartListings(listings);

      // cartLineItems itself validates that every cart item resolved to a
      // fetched listing (covers deleted/unknown ids), currency consistency,
      // quantities, and the per-seller item cap.
      const lineItems = cartLineItems(
        listings,
        { cartItems, deliveryMethod },
        providerCommission,
        customerCommission
      );

      // Because we are using returned lineItems directly in this template we need to use the
      // helper function to add some attributes like lineTotal and reversal that the
      // Marketplace API also adds to the response.
      const validLineItems = constructValidLineItems(lineItems);

      res
        .status(200)
        .set('Content-Type', 'application/transit+json')
        .send(serialize({ data: validLineItems }))
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
