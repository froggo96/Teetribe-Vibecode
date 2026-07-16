const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../api-util/lineItems');
const { cartLineItems, validateCartListings } = require('../api-util/cartLineItems');
const { isIntentionToMakeOffer } = require('../api-util/negotiation');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');

const { Money, UUID } = sharetribeSdk.types;

const listingPromise = (sdk, id) => sdk.listings.show({ id });

const throwBadRequest = (message, code) => {
  const error = new Error(message);
  error.status = 400;
  error.statusText = message;
  error.data = { code };
  throw error;
};

const getFullOrderData = (orderData, bodyParams, currency) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;

  return isIntentionToMakeOffer(offerInSubunits, transitionName)
    ? {
        ...orderData,
        ...bodyParams.params,
        currency,
        offer: new Money(offerInSubunits, currency),
      }
    : { ...orderData, ...bodyParams.params };
};

const getMetadata = (orderData, transition) => {
  const { actor, offerInSubunits } = orderData || {};
  // NOTE: for now, the actor is always "provider".
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  return isIntentionToMakeOffer(offerInSubunits, transition)
    ? {
        metadata: {
          offers: [
            {
              offerInSubunits,
              by,
              transition,
            },
          ],
        },
      }
    : {};
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};
  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  let lineItems = null;
  let metadataMaybe = {};

  const isCartOrder = Array.isArray(orderData?.cartItems) && orderData.cartItems.length > 0;

  const cartDataPromise = () => {
    const ids = orderData.cartItems.map(ci => new UUID(ci.listingId));
    return Promise.all([
      sdk.listings.query({ ids, include: ['author'] }),
      fetchCommission(sdk),
    ]).then(([listingsResponse, fetchAssetsResponse]) => {
      const listings = listingsResponse.data.data;
      const commissionAsset = fetchAssetsResponse.data.data[0];
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      validateCartListings(listings);
      const mainListingId = bodyParams?.params?.listingId?.uuid;
      const isMainListingInCart = listings.some(l => l.id.uuid === mainListingId);
      if (!isMainListingInCart) {
        throwBadRequest('The main listing is not part of the cart', 'cart-listing-unavailable');
      }

      lineItems = cartLineItems(listings, orderData, providerCommission, customerCommission);
    });
  };

  const singleListingDataPromise = () =>
    Promise.all([listingPromise(sdk, bodyParams?.params?.listingId), fetchCommission(sdk)]).then(
      ([showListingResponse, fetchAssetsResponse]) => {
        const listing = showListingResponse.data.data;
        const commissionAsset = fetchAssetsResponse.data.data[0];

        const currency = listing.attributes.price?.currency || orderData.currency;
        const { providerCommission, customerCommission } =
          commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

        lineItems = transactionLineItems(
          listing,
          getFullOrderData(orderData, bodyParams, currency),
          providerCommission,
          customerCommission
        );
        metadataMaybe = getMetadata(orderData, transitionName);
      }
    );

  (isCartOrder ? cartDataPromise() : singleListingDataPromise())
    .then(() => getTrustedSdk(req))
    .then(trustedSdk => {
      const { params } = bodyParams;

      // Add lineItems to the body params
      const body = {
        ...bodyParams,
        params: {
          ...params,
          lineItems,
          ...metadataMaybe,
        },
      };

      if (isSpeculative) {
        return trustedSdk.transactions.initiateSpeculative(body, queryParams);
      }
      return trustedSdk.transactions.initiate(body, queryParams);
    })
    .then(apiResponse => {
      const { status, statusText, data } = apiResponse;
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
