import { createSelector, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { denormalisedResponseEntities } from '../util/data';
import { storableError } from '../util/errors';
import { toggleFavoriteListing } from '../util/api';
import { setCurrentUser } from './user.duck';

// ================ Helper Functions ================ //

const getFavoriteListingIds = currentUser =>
  currentUser?.attributes?.profile?.privateData?.favoriteListingIds || [];

// ================ Async Thunks ================ //

// The write goes through this app's own server (server/api/toggle-favorite.js)
// rather than calling sdk.currentUser.updateProfile directly from the browser,
// so it reuses the server's battle-tested cookie-token handling (the same path
// every SSR page load already depends on) instead of the browser SDK's own
// token refresh.
//
// Note: favoriteListingIds is read directly from state.user.currentUser (the
// single source of truth) rather than from a separate mirrored copy - a
// mirrored copy synced by listening to actions has a window where it can
// disagree with currentUser (e.g. a stale fetchCurrentUser() response landing
// after a toggle), which caused a real bug where a favorite would silently
// revert. Reading directly from currentUser makes that class of bug impossible.
const toggleFavoritePayloadCreator = (listingId, { getState, dispatch, rejectWithValue }) => {
  const favoriteListingIds = getFavoriteListingIds(getState().user.currentUser);
  const isCurrentlyFavorite = favoriteListingIds.includes(listingId);
  const nextFavoriteListingIds = isCurrentlyFavorite
    ? favoriteListingIds.filter(id => id !== listingId)
    : [...favoriteListingIds, listingId];

  // NOTE: the Marketplace API merges privateData by top-level key, so this
  // only ever replaces the favoriteListingIds key - other privateData keys
  // (e.g. cart, see cart.duck.js) are left untouched.
  return toggleFavoriteListing({ favoriteListingIds: nextFavoriteListingIds })
    .then(response => {
      const entities = denormalisedResponseEntities(response);
      if (entities.length !== 1) {
        throw new Error('Expected a resource in the toggle-favorite response');
      }
      dispatch(setCurrentUser(entities[0]));
      return { listingId, isNowFavorite: !isCurrentlyFavorite };
    })
    .catch(e => rejectWithValue(storableError(e)));
};

export const toggleFavoriteThunk = createAsyncThunk(
  'favorites/toggleFavorite',
  toggleFavoritePayloadCreator
);

// Backward compatible wrapper for the thunk
export const toggleFavorite = listingId => dispatch => dispatch(toggleFavoriteThunk(listingId));

// ================ Slice ================ //

// Only ephemeral, UI-only state lives here (whether a toggle request is in
// flight, and its error). The favorited ids themselves are derived from
// state.user.currentUser by the selectors below - there is no copy to sync.
const favoritesSlice = createSlice({
  name: 'favorites',
  initialState: {
    toggleFavoritesInProgress: {},
    toggleFavoritesError: {},
  },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(toggleFavoriteThunk.pending, (state, action) => {
        const listingId = action.meta.arg;
        state.toggleFavoritesInProgress[listingId] = true;
        state.toggleFavoritesError[listingId] = null;
      })
      .addCase(toggleFavoriteThunk.fulfilled, (state, action) => {
        const { listingId } = action.payload;
        delete state.toggleFavoritesInProgress[listingId];
      })
      .addCase(toggleFavoriteThunk.rejected, (state, action) => {
        console.error('toggleFavorite failed:', action.payload || action.error);
        const listingId = action.meta.arg;
        delete state.toggleFavoritesInProgress[listingId];
        state.toggleFavoritesError[listingId] = action.payload;
      });
  },
});

export default favoritesSlice.reducer;

// ================ Selectors ================ //

export const selectFavoriteListingIds = state => getFavoriteListingIds(state.user.currentUser);

export const selectIsListingFavorite = (state, listingId) =>
  selectFavoriteListingIds(state).includes(listingId);

export const selectIsToggleFavoriteInProgress = (state, listingId) =>
  !!state.favorites.toggleFavoritesInProgress[listingId];

/**
 * Create a memoized selector that returns a Set of favorited listing ids,
 * derived from state.user.currentUser. Use with `useMemo(makeSelectFavoriteListingIdsSet, [])`
 * inside components that render many listing cards, so each card can do an
 * O(1) `Set.has()` check instead of an `Array.includes()` scan.
 *
 * @returns {(state: Object) => Set<string>}
 */
export const makeSelectFavoriteListingIdsSet = () =>
  createSelector(
    [state => state.user.currentUser],
    currentUser => new Set(getFavoriteListingIds(currentUser))
  );
