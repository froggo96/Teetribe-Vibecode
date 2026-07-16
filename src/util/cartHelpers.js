import { variantGroupIdOf } from './variantHelpers';

/**
 * Build a cart-item entry (the shape stored in a transaction's protectedData.cartItems, and
 * sent to the server as orderData.cartItems for pricing) from a listing entity. Used both
 * for a "buy now" cart-of-one (see CheckoutPageWithPayment.js) and for a real multi-item
 * cart checkout (see CartPage.js) - in both cases every listing involved is already the
 * resolved variant sibling with grafted images where applicable (see
 * ListingPageCarousel.js/CartPage.duck.js), so its id, title, and price are exactly the
 * ones that get transacted.
 *
 * @param {Object} listing
 * @param {number} quantity
 * @returns {{listingId: string, quantity: number, title: string, unitPriceAmount: number, currency: string, imageListingId: string}}
 */
export const buildCartItemFromListing = (listing, quantity) => {
  const price = listing?.attributes?.price;
  return {
    listingId: listing?.id?.uuid,
    quantity,
    title: listing?.attributes?.title,
    unitPriceAmount: price?.amount,
    currency: price?.currency,
    // Siblings carry no images of their own - imageListingId points to the primary
    // listing whose gallery should be shown instead. Falls back to the listing's own id
    // for non-variant products.
    imageListingId: variantGroupIdOf(listing) || listing?.id?.uuid,
  };
};
