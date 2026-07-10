/**
 * Helpers for the product-variants feature (e.g. size/color combinations, each backed by its
 * own sibling listing so that native, per-combination stock reservation just works).
 *
 * Each combination is a real listing. The primary listing (the one shown in search and on the
 * "canonical" listing page URL) and every sibling share `publicData.variantGroupId` (the primary
 * listing's own id). Only the primary has `publicData.isPrimaryVariant === true`.
 */

// Internal names for the two variant attributes this feature drives. Used for the in-memory
// combo shape (`{ size, color }`) everywhere - form values, picker state, etc.
export const VARIANT_ATTRIBUTE_KEYS = ['size', 'color'];

// Maps each internal attribute name to the actual Console listing-field key configured for this
// marketplace. These are NOT necessarily "size"/"color" literally - e.g. this marketplace's size
// field happens to be keyed "StyleFormat" (label "Size"). Update this map, not the rest of the
// code, if a marketplace's field keys differ.
export const VARIANT_ATTRIBUTE_CONFIG_KEY = {
  size: 'StyleFormat',
  color: 'color',
};

// listingType ids (config.listing.listingTypes[].listingType) that use the variants feature.
// This is a local, code-level opt-in since there's no hosted-config concept for it.
export const VARIANT_LISTING_TYPES = ['sell-products'];

// A back-reference stored on every listing in a group (including the primary itself, pointing
// to its own id) - read directly off an already-loaded listing, never used as a search filter.
export const VARIANT_GROUP_ID_KEY = 'variantGroupId';
// Boolean - the only variant-related field that's ever used as a search/query filter, since
// unlike an arbitrary per-product id, a fixed true/false value is what Sharetribe's search index
// is built for.
export const IS_PRIMARY_VARIANT_KEY = 'isPrimaryVariant';
// Stored only on the primary listing: the ids of every sibling listing. Siblings are fetched by
// id (`sdk.listings.query({ ids: [...] })`), not by searching for a matching variantGroupId, so
// no search index needs to be configured for grouping to work.
export const SIBLING_LISTING_IDS_KEY = 'siblingListingIds';

// Every publicData key this feature manages itself, end to end - none of these should ever be
// rendered or saved by the generic single-value listing-fields UI (Details tab), even if the
// operator has to declare isPrimaryVariant as a Console listing field to get it search-indexed.
export const MANAGED_VARIANT_KEYS = [
  ...Object.values(VARIANT_ATTRIBUTE_CONFIG_KEY),
  VARIANT_GROUP_ID_KEY,
  IS_PRIMARY_VARIANT_KEY,
  SIBLING_LISTING_IDS_KEY,
];

export const hasVariants = listingTypeConfig => {
  return VARIANT_LISTING_TYPES.includes(listingTypeConfig?.listingType);
};

// Listing fields config with every variant-managed key (size/color plus internal bookkeeping
// fields) removed - for the generic single-value listing-fields renderer/storage in the Details
// panel, which must never touch any of these.
export const excludeVariantAttributeFields = listingFields => {
  return (listingFields || []).filter(field => !MANAGED_VARIANT_KEYS.includes(field?.key));
};

// Listing fields config containing only the variant attribute fields (size/color), keyed by
// their actual Console field keys (see VARIANT_ATTRIBUTE_CONFIG_KEY).
export const pickVariantAttributeFields = listingFields => {
  const configKeys = Object.values(VARIANT_ATTRIBUTE_CONFIG_KEY);
  return (listingFields || []).filter(field => configKeys.includes(field?.key));
};

/**
 * Build the cross-product of selected variant attribute values.
 *
 * @param {Object} selections e.g. { size: ['S', 'M'], color: ['Red', 'Blue'] }
 * @returns {Array<Object>} e.g. [{size:'S',color:'Red'}, {size:'S',color:'Blue'}, ...]
 */
export const buildVariantCombinations = selections => {
  const keys = VARIANT_ATTRIBUTE_KEYS.filter(key => (selections?.[key] || []).length > 0);

  return keys.reduce(
    (combos, key) => combos.flatMap(combo => selections[key].map(value => ({ ...combo, [key]: value }))),
    [{}]
  );
};

// A stable string key for a combination, used to match form state / existing sibling listings.
export const variantComboKey = combo =>
  VARIANT_ATTRIBUTE_KEYS.map(key => combo?.[key] ?? '').join('|');

export const isPrimaryVariantListing = listing =>
  listing?.attributes?.publicData?.[IS_PRIMARY_VARIANT_KEY] === true;

export const variantGroupIdOf = listing => listing?.attributes?.publicData?.[VARIANT_GROUP_ID_KEY];
