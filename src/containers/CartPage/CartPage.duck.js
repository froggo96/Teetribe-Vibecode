import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';
import { createImageVariantConfig } from '../../util/sdkLoader';
import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { fetchCurrentUser } from '../../ducks/user.duck';
import { selectCart, cartGroupListingEntries } from '../../ducks/cart.duck';
import { VARIANT_GROUP_ID_KEY } from '../../util/variantHelpers';
import { cartTransactionLineItems } from '../../util/api';
import * as log from '../../util/log';

// ================ Helper Functions ================ //

const uniqueListingIdsFromCart = cart =>
  Array.from(
    new Set(
      Object.values(cart || {}).flatMap(group => cartGroupListingEntries(group).map(([id]) => id))
    )
  );

// Sibling (variant) listings carry no images of their own (an image can only be attached to
// one listing) - the primary listing's gallery is what should show up as the sibling's thumbnail.
// Finds primary listing ids that need a follow-up fetch: raw (not yet denormalised) listing
// resources that have no images of their own and whose primary isn't already among the ids
// we already fetched.
const primaryIdsNeedingImages = (rawListings, alreadyFetchedIds) => {
  const alreadyFetched = new Set(alreadyFetchedIds);
  const primaryIds = new Set();
  rawListings.forEach(listing => {
    const hasOwnImages = (listing.relationships?.images?.data?.length || 0) > 0;
    const primaryId = listing.attributes?.publicData?.[VARIANT_GROUP_ID_KEY];
    const isSelf = primaryId === listing.id.uuid;
    if (!hasOwnImages && primaryId && !isSelf && !alreadyFetched.has(primaryId)) {
      primaryIds.add(primaryId);
    }
  });
  return Array.from(primaryIds);
};

const imageVariantParams = listingImageConfig => {
  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } = listingImageConfig;
  const aspectRatio = aspectHeight / aspectWidth;
  return {
    'fields.image': [`variants.${variantPrefix}`, `variants.${variantPrefix}-2x`],
    ...createImageVariantConfig(`${variantPrefix}`, 400, aspectRatio),
    ...createImageVariantConfig(`${variantPrefix}-2x`, 800, aspectRatio),
    // No 'limit.images' here (unlike e.g. FavoriteListingsPage): a variant group's
    // primary listing tracks its own color photo deeper in its gallery
    // (publicData.variantImageId), and the cart shows THAT image, not the first one -
    // so the whole gallery relationship is needed (see imagesWithVariantPhotoFirst).
  };
};

// ================ Async Thunks ================ //

//////////////////////////
// Query Cart Listings //
//////////////////////////

// NOTE: like FavoriteListingsPage, the Marketplace API's `ids` filter is capped (around 100 ids
// per call). A cart is capped at CART_MAX_LISTINGS_PER_SELLER per seller (see cart.duck.js), but
// a buyer with very many seller groups could still exceed this - split into chunks if that
// becomes a real scenario for this marketplace.
const queryCartListingsPayloadCreator = (
  { cart, listingImageConfig },
  { extra: sdk, dispatch, rejectWithValue }
) => {
  const listingIds = uniqueListingIdsFromCart(cart);
  if (listingIds.length === 0) {
    return Promise.resolve({ data: { data: [] } });
  }

  const imageParams = imageVariantParams(listingImageConfig);

  return sdk.listings
    .query({ ids: listingIds, include: ['images', 'author', 'currentStock'], ...imageParams })
    .then(response => {
      dispatch(addMarketplaceEntities(response));

      const rawListings = response.data.data;
      const primaryIds = primaryIdsNeedingImages(rawListings, listingIds);
      if (primaryIds.length === 0) {
        return response;
      }

      return sdk.listings
        .query({ ids: primaryIds, include: ['images'], ...imageParams })
        .then(primaryResponse => {
          dispatch(addMarketplaceEntities(primaryResponse));
          return response;
        });
    })
    .catch(e => rejectWithValue(storableError(e)));
};

export const queryCartListingsThunk = createAsyncThunk(
  'app/CartPage/queryCartListings',
  queryCartListingsPayloadCreator
);

/////////////////////////////////////
// Fetch a seller group's line items //
/////////////////////////////////////

const fetchCartGroupLineItemsPayloadCreator = (
  { authorId, cartItems, deliveryMethod },
  { rejectWithValue }
) => {
  const cartItemsForApi = cartItems.map(({ listingId, quantity }) => ({ listingId, quantity }));

  return cartTransactionLineItems({ orderData: { cartItems: cartItemsForApi, deliveryMethod } })
    .then(response => ({ authorId, lineItems: response.data }))
    .catch(e => {
      log.error(e, 'fetching-cart-line-items-failed', { authorId, statusText: e.statusText });
      return rejectWithValue({ authorId, error: storableError(e) });
    });
};

export const fetchCartGroupLineItemsThunk = createAsyncThunk(
  'app/CartPage/fetchCartGroupLineItems',
  fetchCartGroupLineItemsPayloadCreator
);

// Backward compatible wrapper for the thunk
export const fetchCartGroupLineItems = ({ authorId, cartItems, deliveryMethod }) => dispatch =>
  dispatch(fetchCartGroupLineItemsThunk({ authorId, cartItems, deliveryMethod }));

// ================ Slice ================ //

const resultIds = data => data.data.map(l => l.id);

const cartPageSlice = createSlice({
  name: 'CartPage',
  initialState: {
    cartListingIds: [],
    queryInProgress: false,
    queryListingsError: null,
    groupLineItems: {}, // keyed by authorId: { lineItems, fetchInProgress, fetchError }
  },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(queryCartListingsThunk.pending, state => {
        state.queryInProgress = true;
        state.queryListingsError = null;
      })
      .addCase(queryCartListingsThunk.fulfilled, (state, action) => {
        state.cartListingIds = resultIds(action.payload.data);
        state.queryInProgress = false;
      })
      .addCase(queryCartListingsThunk.rejected, (state, action) => {
        console.error(action.payload || action.error);
        state.queryInProgress = false;
        state.queryListingsError = action.payload;
      })
      .addCase(fetchCartGroupLineItemsThunk.pending, (state, action) => {
        const { authorId } = action.meta.arg;
        const existing = state.groupLineItems[authorId];
        state.groupLineItems[authorId] = {
          lineItems: existing?.lineItems || null,
          fetchInProgress: true,
          fetchError: null,
        };
      })
      .addCase(fetchCartGroupLineItemsThunk.fulfilled, (state, action) => {
        const { authorId, lineItems } = action.payload;
        state.groupLineItems[authorId] = { lineItems, fetchInProgress: false, fetchError: null };
      })
      .addCase(fetchCartGroupLineItemsThunk.rejected, (state, action) => {
        const authorId = action.payload?.authorId || action.meta.arg.authorId;
        const existing = state.groupLineItems[authorId];
        state.groupLineItems[authorId] = {
          lineItems: existing?.lineItems || null,
          fetchInProgress: false,
          fetchError: action.payload?.error || action.error,
        };
      });
  },
});

export default cartPageSlice.reducer;

// ================ Load data ================ //

export const loadData = (params, search, config) => (dispatch, getState) => {
  return dispatch(fetchCurrentUser()).then(() => {
    const cart = selectCart(getState());
    return dispatch(
      queryCartListingsThunk({ cart, listingImageConfig: config.layout.listingImage })
    );
  });
};
