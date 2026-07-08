import { createSelector, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { denormalisedResponseEntities } from '../util/data';
import { storableError } from '../util/errors';
import { setCurrentUser, fetchCurrentUserThunk } from './user.duck';

// ================ Helper Functions ================ //

const getFavoriteListingIds = currentUser =>
  currentUser?.attributes?.profile?.privateData?.favoriteListingIds || [];

// ================ Async Thunks ================ //

const toggleFavoritePayloadCreator = (listingId, { getState, dispatch, extra: sdk, rejectWithValue }) => {
  const { favoriteListingIds } = getState().favorites;
  const isCurrentlyFavorite = favoriteListingIds.includes(listingId);
  const nextFavoriteListingIds = isCurrentlyFavorite
    ? favoriteListingIds.filter(id => id !== listingId)
    : [...favoriteListingIds, listingId];

  // NOTE: this overwrites privateData entirely. Since favoriteListingIds is
  // the only privateData key in use today, this is safe - if another feature
  // starts using privateData, this call needs to merge with the existing value instead.
  return sdk.currentUser
    .updateProfile({ privateData: { favoriteListingIds: nextFavoriteListingIds } }, { expand: true })
    .then(response => {
      const entities = denormalisedResponseEntities(response);
      if (entities.length !== 1) {
        throw new Error('Expected a resource in the sdk.currentUser.updateProfile response');
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

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState: {
    favoriteListingIds: [],
    toggleFavoritesInProgress: {},
    toggleFavoritesError: {},
  },
  reducers: {},
  extraReducers: builder => {
    builder
      // Keep favoriteListingIds in sync whenever the current user is (re)set,
      // regardless of what triggered the refresh - both the plain setCurrentUser
      // action (dispatched by other ducks after their own updateProfile calls)
      // and fetchCurrentUserThunk (used for initial page loads) need to sync here,
      // since they update user.duck.js's state independently of one another.
      .addCase(setCurrentUser, (state, action) => {
        state.favoriteListingIds = getFavoriteListingIds(action.payload);
      })
      .addCase(fetchCurrentUserThunk.fulfilled, (state, action) => {
        state.favoriteListingIds = getFavoriteListingIds(action.payload);
      })
      .addCase(toggleFavoriteThunk.pending, (state, action) => {
        const listingId = action.meta.arg;
        state.toggleFavoritesInProgress[listingId] = true;
        state.toggleFavoritesError[listingId] = null;

        // Optimistic update - flip the id immediately, roll back on rejection.
        const isCurrentlyFavorite = state.favoriteListingIds.includes(listingId);
        state.favoriteListingIds = isCurrentlyFavorite
          ? state.favoriteListingIds.filter(id => id !== listingId)
          : [...state.favoriteListingIds, listingId];
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

        // Roll back the optimistic flip.
        const isCurrentlyFavorite = state.favoriteListingIds.includes(listingId);
        state.favoriteListingIds = isCurrentlyFavorite
          ? state.favoriteListingIds.filter(id => id !== listingId)
          : [...state.favoriteListingIds, listingId];
      });
  },
});

export default favoritesSlice.reducer;

// ================ Selectors ================ //

export const selectFavoriteListingIds = state => state.favorites.favoriteListingIds;

export const selectIsListingFavorite = (state, listingId) =>
  state.favorites.favoriteListingIds.includes(listingId);

export const selectIsToggleFavoriteInProgress = (state, listingId) =>
  !!state.favorites.toggleFavoritesInProgress[listingId];

/**
 * Create a memoized selector that returns a Set of favorited listing ids.
 * Use with `useMemo(makeSelectFavoriteListingIdsSet, [])` inside components
 * that render many listing cards, so each card can do an O(1) `Set.has()`
 * check instead of an `Array.includes()` scan.
 *
 * @returns {(state: Object) => Set<string>}
 */
export const makeSelectFavoriteListingIdsSet = () =>
  createSelector([selectFavoriteListingIds], favoriteListingIds => new Set(favoriteListingIds));
