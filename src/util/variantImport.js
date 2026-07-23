/**
 * Redux-agnostic core of the product-variants sibling-creation flow (see variantHelpers.js for
 * the underlying data model). Extracted out of EditListingPage.duck.js so the same logic can be
 * driven by the single-listing edit wizard AND the bulk CSV importer without duplicating the
 * sequential create/update/stock/publish/orphan-sweep sequence in two places.
 *
 * Every function here takes a plain `sdk` instance and plain data - no getState()/dispatch. An
 * optional `onEntities(sdkResponse)` callback lets a caller (e.g. the wizard's duck) mirror
 * responses into its own store; it defaults to a no-op for callers that don't need that (e.g.
 * the bulk importer, which tracks its own per-row/per-group progress instead).
 */
import { types as sdkTypes } from './sdkLoader';
import * as log from './log';
import { LISTING_STATE_DRAFT, LISTING_STATE_CLOSED } from './types';
import {
  VARIANT_ATTRIBUTE_CONFIG_KEY,
  VARIANT_GROUP_ID_KEY,
  IS_PRIMARY_VARIANT_KEY,
  SIBLING_LISTING_IDS_KEY,
  PRIMARY_VARIANT_IMAGE_KEY,
  MANAGED_VARIANT_KEYS,
  variantTitleSuffix,
} from './variantHelpers';

const { UUID } = sdkTypes;

// Every non-variant public data key, i.e. everything that must be identical across all sibling
// listings of the same product (category, delivery method, other custom listing fields, etc).
// MANAGED_VARIANT_KEYS is the single source of truth for what must NOT be copied across the
// group (per-combination attributes and primary-only bookkeeping like variantImageId).
export const sharedPublicDataOf = publicData => {
  return Object.fromEntries(
    Object.entries(publicData || {}).filter(([key]) => !MANAGED_VARIANT_KEYS.includes(key))
  );
};

// Mirrors EditListingPage.duck.js's updateStockOfListingMaybe: a stock-update failure is logged
// but deliberately does NOT reject/throw - the original wizard code dispatched a thunk without
// ever unwrapping it, so a stock error there never aborted the surrounding save chain. Preserved
// here so wizard behavior via createOrUpdateVariantGroup/publishVariantGroupCascade is unchanged.
const updateStockOfListingMaybe = (sdk, listingId, stockTotals, onEntities) => {
  const { oldTotal, newTotal } = stockTotals || {};
  // Note: newTotal and oldTotal must be given, but oldTotal can be null
  const hasStockTotals = newTotal >= 0 && typeof oldTotal !== 'undefined';

  if (listingId && hasStockTotals) {
    return sdk.stock
      .compareAndSet({ listingId, oldTotal, newTotal }, { expand: true })
      .then(response => {
        onEntities(response);
        return response;
      })
      .catch(e => {
        log.error(e, 'update-stock-failed', { listingId, oldTotal, newTotal });
        return undefined;
      });
  }
  return Promise.resolve();
};

/**
 * Create/update a variant group's primary listing plus every other combination as a sibling
 * listing (each one a real listing so it gets native, atomic stock reservation for free), then
 * stamp the primary with the resulting sibling ids and sweep any orphaned stray listings.
 *
 * @param {Object} sdk marketplace API sdk instance (browser session or otherwise)
 * @param {Object} id primary listing's UUID
 * @param {Object} primaryListingEntity the primary listing's current denormalised entity (needs
 *   attributes.publicData/title/state and relationships.images.data) - the raw `data.data` of an
 *   sdk.ownListings.createDraft/update/show response already has this shape.
 * @param {Object} ownListingUpdateValues shared fields to apply to every listing in the group
 * @param {Array} variantCombinations one entry per combination (isPrimary flags the primary's own)
 * @param {Object} queryParams sdk expand/include params to use for create/update calls
 * @param {Function} [onEntities] called with each sdk response, e.g. to mirror into a store
 * @returns {Promise} resolves with the primary's final `siblingListingIds` update response
 */
export const createOrUpdateVariantGroup = ({
  sdk,
  id,
  primaryListingEntity,
  ownListingUpdateValues,
  variantCombinations,
  queryParams,
  onEntities = () => {},
}) => {
  const { id: _unusedId, images: _images, price, ...sharedRest } = ownListingUpdateValues;
  const primaryEntity = primaryListingEntity;
  const sharedPublicData = sharedPublicDataOf(primaryEntity?.attributes?.publicData);
  const isPrimaryPublished = primaryEntity?.attributes?.state !== LISTING_STATE_DRAFT;

  const primaryCombo = variantCombinations.find(c => c.isPrimary);
  const otherCombos = variantCombinations.filter(c => !c.isPrimary);

  const publicDataFor = combo => ({
    ...sharedPublicData,
    [VARIANT_GROUP_ID_KEY]: id.uuid,
    [IS_PRIMARY_VARIANT_KEY]: !!combo.isPrimary,
    [VARIANT_ATTRIBUTE_CONFIG_KEY.size]: combo.size,
    [VARIANT_ATTRIBUTE_CONFIG_KEY.color]: combo.color,
  });

  // The primary's own color can have a variant photo too, but an image can't live detached
  // from its listing - so the photo is appended to the primary's gallery images and its id is
  // tracked in publicData.variantImageId. Replacing swaps out the previously tracked image.
  const updatePrimary = (primaryCombo?.newColorImageFile
    ? sdk.images.upload({ image: primaryCombo.newColorImageFile }).then(r => r.data.data.id)
    : Promise.resolve(null)
  )
    .then(newImageId => {
      const oldVariantImageId = primaryEntity?.attributes?.publicData?.[PRIMARY_VARIANT_IMAGE_KEY];
      const currentImageIds = (primaryEntity?.relationships?.images?.data || []).map(
        ref => ref.id
      );
      const imagesMaybe = newImageId
        ? { images: [...currentImageIds.filter(iid => iid.uuid !== oldVariantImageId), newImageId] }
        : {};
      const variantImageIdMaybe = newImageId
        ? { [PRIMARY_VARIANT_IMAGE_KEY]: newImageId.uuid }
        : {};
      return sdk.ownListings.update(
        {
          id,
          price,
          ...sharedRest,
          ...imagesMaybe,
          publicData: { ...publicDataFor(primaryCombo), ...variantImageIdMaybe },
        },
        queryParams
      );
    })
    .then(response => {
      onEntities(response);
      return updateStockOfListingMaybe(sdk, id, primaryCombo.stockUpdate, onEntities).then(
        () => response
      );
    });

  // Sibling titles carry the variant, e.g. "Plain t-shirts (M / White)" - it's the transacted
  // listing's title, so this is what surfaces the purchased variant on order pages, checkout,
  // inbox and notification emails.
  const siblingTitleFor = combo => {
    const labels = [combo.sizeLabel || combo.size, combo.colorLabel || combo.color].filter(
      Boolean
    );
    return `${primaryEntity?.attributes?.title}${variantTitleSuffix(labels)}`;
  };

  // A newly picked per-color photo is uploaded once per sibling of that color: an image
  // resource can only be attached to one listing, so each sibling needs its own copy.
  const uploadColorImageMaybe = combo =>
    combo.newColorImageFile
      ? sdk.images
          .upload({ image: combo.newColorImageFile })
          .then(r => ({ images: [r.data.data.id] }))
      : Promise.resolve({});

  // Resolves to the sibling's listing id once it's fully up to date. Existing siblings that
  // are somehow still drafts while the primary is published (e.g. an earlier partially-failed
  // save) are published here too, so the whole group self-heals on the next save.
  const createOrUpdateSibling = combo => {
    if (combo.existingListingId) {
      const siblingId = combo.existingListingId;
      return uploadColorImageMaybe(combo)
        .then(imagesMaybe =>
          sdk.ownListings.update(
            { id: siblingId, title: siblingTitleFor(combo), price, ...sharedRest, ...imagesMaybe },
            queryParams
          )
        )
        .then(response => {
          // Keep the store's sibling entity fresh (incl. its image), so the variants panel
          // still shows the per-color photo right after saving.
          onEntities(response);
          const siblingState = response?.data?.data?.attributes?.state;
          // A combination the seller currently wants (it's still checked, hence being saved
          // here) should always end up in the same state as the primary - self-heals siblings
          // left in draft or wrongly closed by an earlier partially-failed save.
          if (isPrimaryPublished && siblingState === LISTING_STATE_DRAFT) {
            return sdk.ownListings.publishDraft({ id: siblingId }, { expand: true });
          }
          if (isPrimaryPublished && siblingState === LISTING_STATE_CLOSED) {
            return sdk.ownListings.open({ id: siblingId }, { expand: true });
          }
          return Promise.resolve();
        })
        .then(() => updateStockOfListingMaybe(sdk, siblingId, combo.stockUpdate, onEntities))
        .then(() => siblingId)
        .catch(e => {
          log.error(e, 'update-variant-sibling-failed', { siblingId });
          throw e;
        });
    }

    return uploadColorImageMaybe(combo)
      .then(imagesMaybe =>
        sdk.ownListings.createDraft(
          {
            title: siblingTitleFor(combo),
            price,
            ...sharedRest,
            ...imagesMaybe,
            publicData: publicDataFor(combo),
          },
          { expand: true, ...queryParams }
        )
      )
      .then(response => {
        onEntities(response);
        const siblingId = response.data.data.id;
        return updateStockOfListingMaybe(sdk, siblingId, combo.stockUpdate, onEntities)
          .then(() =>
            isPrimaryPublished
              ? sdk.ownListings.publishDraft({ id: siblingId }, { expand: true })
              : Promise.resolve()
          )
          .then(() => siblingId);
      })
      .catch(e => {
        log.error(e, 'create-variant-sibling-failed', { combo });
        throw e;
      });
  };

  // Sequential on purpose: a burst of parallel calls across many siblings is prone to
  // rate-limiting, which used to leave the group only partially created/published.
  const processSiblingsSequentially = combos =>
    combos.reduce(
      (chain, combo) =>
        chain.then(siblingIds =>
          createOrUpdateSibling(combo).then(siblingId => [...siblingIds, siblingId])
        ),
      Promise.resolve([])
    );

  return updatePrimary.then(() =>
    processSiblingsSequentially(otherCombos).then(siblingIds => {
      // Every combination's listing id is now known - record them on the primary so it can
      // always find its siblings again with a direct `ids` lookup (no search index needed).
      const keptIdStrings = [id.uuid, ...siblingIds.map(sid => sid.uuid)];
      return sdk.ownListings
        .update(
          { id, publicData: { [SIBLING_LISTING_IDS_KEY]: siblingIds.map(sid => sid.uuid) } },
          queryParams
        )
        .then(stampResponse =>
          // Orphan sweep: a partially-failed save can leave stray sibling listings that
          // back-reference this group but are no longer tracked in siblingListingIds -
          // published duplicates of a combo that confuse stock. Close any such stray.
          // (own_listings/query can't filter by publicData, so filter client-side.)
          sdk.ownListings
            .query({ perPage: 100 })
            .then(all => {
              const orphans = all.data.data.filter(
                l =>
                  l.attributes.publicData?.[VARIANT_GROUP_ID_KEY] === id.uuid &&
                  !keptIdStrings.includes(l.id.uuid) &&
                  l.attributes.state !== LISTING_STATE_CLOSED
              );
              return orphans.reduce(
                (chain, orphan) =>
                  chain.then(() =>
                    sdk.ownListings
                      .close({ id: orphan.id }, { expand: true })
                      .catch(e =>
                        log.error(e, 'close-orphan-variant-failed', { siblingId: orphan.id })
                      )
                  ),
                Promise.resolve()
              );
            })
            .catch(e => log.error(e, 'orphan-variant-sweep-failed', {}))
            .then(() => stampResponse)
        );
    })
  );
};

/**
 * If the just-published listing is the primary of a variant group, publish every sibling that's
 * still in draft state too - they're created alongside it but only the primary goes through an
 * explicit publish step (the wizard's own, or the bulk importer's).
 *
 * @param {Object} sdk marketplace API sdk instance
 * @param {Array<string>} siblingIdStrings the primary's publicData.siblingListingIds
 * @param {Function} [onEntities] called with each sdk response
 */
export const publishVariantGroupCascade = ({ sdk, siblingIdStrings, onEntities = () => {} }) => {
  if (!siblingIdStrings?.length) {
    return Promise.resolve();
  }
  return sdk.ownListings
    .query({ ids: siblingIdStrings.map(sid => new UUID(sid)) })
    .then(response => {
      const draftSiblings = response.data.data.filter(
        l => l.attributes.state === LISTING_STATE_DRAFT
      );
      // Sequential on purpose: parallel publish bursts are prone to rate-limiting, which used
      // to leave some siblings stuck in draft state (invisible and unpurchasable for buyers).
      return draftSiblings.reduce(
        (chain, sibling) =>
          chain.then(() =>
            sdk.ownListings
              .publishDraft({ id: sibling.id }, { expand: true })
              .then(r => onEntities(r))
              .catch(e =>
                log.error(e, 'publish-variant-sibling-failed', { siblingId: sibling.id })
              )
          ),
        Promise.resolve()
      );
    })
    .catch(e => log.error(e, 'query-variant-siblings-for-publish-failed', {}));
};
