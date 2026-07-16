import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { denormalisedResponseEntities } from '../util/data';
import { storableError } from '../util/errors';
import { updateUserCart } from '../util/api';
import { setCurrentUser } from './user.duck';

// ================ Helper Functions ================ //
//
// Shopping cart shape in currentUser.attributes.profile.privateData.cart:
//
// cart: {
//   [authorId]: {
//     [listingId]: { count: 2 },
//     deliveryMethod: 'shipping', // optional; one method for the whole seller group
//   },
// }
//
// The cart is grouped by seller (author id) because checkout happens per
// seller: all listings from one seller are purchased in a single transaction.
// For products with variants, listingId is the resolved variant sibling's id
// (the listing that actually gets transacted), not the primary's.
//
// Like favorites, the cart itself is always read from state.user.currentUser
// (the single source of truth); this slice only holds ephemeral request state.
// Writes go through this app's server (server/api/update-cart.js). The user
// profile endpoint merges privateData by top-level key, so the cart and other
// privateData features (e.g. favoriteListingIds) don't clobber each other.

// Keep in sync with server/api/update-cart.js.
export const CART_MAX_LISTINGS_PER_SELLER = 20;

// Group keys that are not listing ids.
const NON_LISTING_GROUP_KEYS = ['deliveryMethod'];

export const getCart = currentUser => currentUser?.attributes?.profile?.privateData?.cart || {};

export const cartGroupListingEntries = group =>
  Object.entries(group || {}).filter(([key]) => !NON_LISTING_GROUP_KEYS.includes(key));

export const cartGroupUnitCount = group =>
  cartGroupListingEntries(group).reduce((sum, [, item]) => sum + (item?.count || 0), 0);

export const cartTotalUnitCount = cart =>
  Object.values(cart || {}).reduce((sum, group) => sum + cartGroupUnitCount(group), 0);

// A listing belongs to exactly one author, so it can appear in at most one group.
const countForListing = (cart, listingId) => {
  const groupWithListing = Object.values(cart || {}).find(group => group?.[listingId]?.count);
  return groupWithListing?.[listingId]?.count || 0;
};

// ================ Async Thunks ================ //

const writeCart = (cart, dispatch) =>
  updateUserCart({ cart }).then(response => {
    const entities = denormalisedResponseEntities(response);
    if (entities.length !== 1) {
      throw new Error('Expected a resource in the update-cart response');
    }
    dispatch(setCurrentUser(entities[0]));
    return getCart(entities[0]);
  });

const toggleCartPayloadCreator = (
  { listingId, authorId, increment },
  { getState, dispatch, rejectWithValue }
) => {
  const cart = getCart(getState().user.currentUser);
  const group = cart[authorId] || {};
  const currentCount = group[listingId]?.count || 0;
  const nextCount = Math.max(0, currentCount + increment);

  const addsNewListing = currentCount === 0 && nextCount > 0;
  if (addsNewListing && cartGroupListingEntries(group).length >= CART_MAX_LISTINGS_PER_SELLER) {
    const error = new Error('cart-max-listings-per-seller');
    error.status = 400;
    return rejectWithValue(storableError(error));
  }

  let nextGroup;
  if (nextCount === 0) {
    const { [listingId]: removedListing, ...remainingGroup } = group;
    nextGroup = remainingGroup;
  } else {
    nextGroup = { ...group, [listingId]: { count: nextCount } };
  }

  // Drop the whole seller group when its last listing is removed.
  const groupHasListings = cartGroupListingEntries(nextGroup).length > 0;
  const { [authorId]: removedGroup, ...remainingCart } = cart;
  const nextCart = groupHasListings
    ? { ...remainingCart, [authorId]: nextGroup }
    : remainingCart;

  return writeCart(nextCart, dispatch)
    .then(updatedCart => ({ listingId, authorId, cart: updatedCart }))
    .catch(e => rejectWithValue(storableError(e)));
};

export const toggleCartThunk = createAsyncThunk('cart/toggleCart', toggleCartPayloadCreator);

// Backward compatible wrapper for the thunk
export const toggleCart = (listingId, authorId, increment) => dispatch =>
  dispatch(toggleCartThunk({ listingId, authorId, increment }));

const setCartDeliveryMethodPayloadCreator = (
  { authorId, deliveryMethod },
  { getState, dispatch, rejectWithValue }
) => {
  const cart = getCart(getState().user.currentUser);
  const group = cart[authorId];
  if (!group) {
    // Group was removed meanwhile; nothing to update.
    return { authorId, cart };
  }
  const nextCart = { ...cart, [authorId]: { ...group, deliveryMethod } };
  return writeCart(nextCart, dispatch)
    .then(updatedCart => ({ authorId, cart: updatedCart }))
    .catch(e => rejectWithValue(storableError(e)));
};

export const setCartDeliveryMethodThunk = createAsyncThunk(
  'cart/setCartDeliveryMethod',
  setCartDeliveryMethodPayloadCreator
);

export const setCartDeliveryMethod = (authorId, deliveryMethod) => dispatch =>
  dispatch(setCartDeliveryMethodThunk({ authorId, deliveryMethod }));

const removeCartAuthorGroupPayloadCreator = (
  { authorId },
  { getState, dispatch, rejectWithValue }
) => {
  const cart = getCart(getState().user.currentUser);
  if (!cart[authorId]) {
    return { authorId, cart };
  }
  const { [authorId]: removedGroup, ...remainingCart } = cart;
  return writeCart(remainingCart, dispatch)
    .then(updatedCart => ({ authorId, cart: updatedCart }))
    .catch(e => rejectWithValue(storableError(e)));
};

export const removeCartAuthorGroupThunk = createAsyncThunk(
  'cart/removeCartAuthorGroup',
  removeCartAuthorGroupPayloadCreator
);

export const removeCartAuthorGroup = authorId => dispatch =>
  dispatch(removeCartAuthorGroupThunk({ authorId }));

// ================ Slice ================ //

// Only ephemeral, UI-only state lives here; the cart itself is derived from
// state.user.currentUser by the selectors below.
const cartSlice = createSlice({
  name: 'cart',
  initialState: {
    toggleCartInProgress: {}, // keyed by listingId
    toggleCartError: {}, // keyed by listingId
    groupUpdateInProgress: {}, // keyed by authorId
    groupUpdateError: {}, // keyed by authorId
  },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(toggleCartThunk.pending, (state, action) => {
        const { listingId } = action.meta.arg;
        state.toggleCartInProgress[listingId] = true;
        state.toggleCartError[listingId] = null;
      })
      .addCase(toggleCartThunk.fulfilled, (state, action) => {
        delete state.toggleCartInProgress[action.meta.arg.listingId];
      })
      .addCase(toggleCartThunk.rejected, (state, action) => {
        console.error('toggleCart failed:', action.payload || action.error);
        const { listingId } = action.meta.arg;
        delete state.toggleCartInProgress[listingId];
        state.toggleCartError[listingId] = action.payload;
      })
      .addCase(setCartDeliveryMethodThunk.pending, (state, action) => {
        const { authorId } = action.meta.arg;
        state.groupUpdateInProgress[authorId] = true;
        state.groupUpdateError[authorId] = null;
      })
      .addCase(setCartDeliveryMethodThunk.fulfilled, (state, action) => {
        delete state.groupUpdateInProgress[action.meta.arg.authorId];
      })
      .addCase(setCartDeliveryMethodThunk.rejected, (state, action) => {
        console.error('setCartDeliveryMethod failed:', action.payload || action.error);
        const { authorId } = action.meta.arg;
        delete state.groupUpdateInProgress[authorId];
        state.groupUpdateError[authorId] = action.payload;
      })
      .addCase(removeCartAuthorGroupThunk.pending, (state, action) => {
        const { authorId } = action.meta.arg;
        state.groupUpdateInProgress[authorId] = true;
        state.groupUpdateError[authorId] = null;
      })
      .addCase(removeCartAuthorGroupThunk.fulfilled, (state, action) => {
        delete state.groupUpdateInProgress[action.meta.arg.authorId];
      })
      .addCase(removeCartAuthorGroupThunk.rejected, (state, action) => {
        console.error('removeCartAuthorGroup failed:', action.payload || action.error);
        const { authorId } = action.meta.arg;
        delete state.groupUpdateInProgress[authorId];
        state.groupUpdateError[authorId] = action.payload;
      });
  },
});

export default cartSlice.reducer;

// ================ Selectors ================ //

export const selectCart = state => getCart(state.user.currentUser);

export const selectCartTotalCount = state => cartTotalUnitCount(selectCart(state));

export const selectCartCountForListing = (state, listingId) =>
  countForListing(selectCart(state), listingId);

export const selectCartGroupForAuthor = (state, authorId) =>
  selectCart(state)[authorId] || null;

export const selectIsToggleCartInProgress = (state, listingId) =>
  !!state.cart.toggleCartInProgress[listingId];

export const selectToggleCartError = (state, listingId) =>
  state.cart.toggleCartError[listingId] || null;

export const selectIsGroupUpdateInProgress = (state, authorId) =>
  !!state.cart.groupUpdateInProgress[authorId];

export const selectGroupUpdateError = (state, authorId) =>
  state.cart.groupUpdateError[authorId] || null;
