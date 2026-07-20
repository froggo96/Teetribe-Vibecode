import { variantGroupIdOf, titleWithVariantSuffix } from './variantHelpers';

/**
 * Build a cart-item entry (the shape stored in a transaction's protectedData.cartItems, and
 * sent to the server as orderData.cartItems for pricing) from a listing entity. Used both
 * for a "buy now" cart-of-one (see CheckoutPageWithPayment.js) and for a real multi-item
 * cart checkout (see CartPage.js) - in both cases every listing involved is already the
 * resolved variant sibling with grafted images where applicable (see
 * ListingPageCarousel.js/CartPage.duck.js), so its id, title, and price are exactly the
 * ones that get transacted.
 *
 * @param {Object} listing - must include its `images` relationship (denormalised), so
 *   imageListingId can tell whether this listing has its own photo
 * @param {number} quantity
 * @param {Array} listingFields the marketplace's listing fields config - used to include
 *   the variant (e.g. "(S / Black)") in the stored title when the transacted listing is a
 *   variant group's primary, whose own title carries no suffix
 * @returns {{listingId: string, quantity: number, title: string, unitPriceAmount: number, currency: string, imageListingId: string}}
 */
export const buildCartItemFromListing = (listing, quantity, listingFields) => {
  const price = listing?.attributes?.price;
  return {
    listingId: listing?.id?.uuid,
    quantity,
    title: titleWithVariantSuffix(listing, listingFields),
    unitPriceAmount: price?.amount,
    currency: price?.currency,
    // imageListingId is "whichever listing's gallery has the photo to show": the
    // transacted listing's own id if it has at least one image of its own (a sibling can
    // have its own per-color photo - see util/variantHelpers.js), otherwise the primary
    // listing's id as a fallback (also falls back to its own id for non-variant products,
    // where variantGroupIdOf is undefined).
    imageListingId:
      listing?.images?.length > 0 ? listing?.id?.uuid : variantGroupIdOf(listing) || listing?.id?.uuid,
  };
};
