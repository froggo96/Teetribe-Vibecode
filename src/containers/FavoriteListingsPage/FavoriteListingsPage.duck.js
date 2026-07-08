import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';
import { createImageVariantConfig } from '../../util/sdkLoader';
import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { fetchCurrentUser } from '../../ducks/user.duck';
import { selectFavoriteListingIds } from '../../ducks/favorites.duck';

// ================ Async Thunks ================ //

////////////////////////////
// Query Favorite Listings //
////////////////////////////

// NOTE: the Marketplace API's `ids` filter is capped (around 100 ids per call).
// If a marketplace's users are expected to favorite more listings than that,
// this call needs to be split into chunks of ids and the results concatenated.
const queryFavoriteListingsPayloadCreator = (
  { favoriteListingIds, listingImageConfig },
  { extra: sdk, dispatch, rejectWithValue }
) => {
  if (favoriteListingIds.length === 0) {
    return Promise.resolve({ data: { data: [], meta: {} } });
  }

  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } = listingImageConfig;
  const aspectRatio = aspectHeight / aspectWidth;

  return sdk.listings
    .query({
      ids: favoriteListingIds,
      include: ['images', 'author'],
      'fields.image': [`variants.${variantPrefix}`, `variants.${variantPrefix}-2x`],
      ...createImageVariantConfig(`${variantPrefix}`, 400, aspectRatio),
      ...createImageVariantConfig(`${variantPrefix}-2x`, 800, aspectRatio),
      'limit.images': 1,
    })
    .then(response => {
      dispatch(addMarketplaceEntities(response));
      return response;
    })
    .catch(e => rejectWithValue(storableError(e)));
};

export const queryFavoriteListingsThunk = createAsyncThunk(
  'app/FavoriteListingsPage/queryFavoriteListings',
  queryFavoriteListingsPayloadCreator
);

// ================ Slice ================ //

const resultIds = data => data.data.map(l => l.id);

const favoriteListingsPageSlice = createSlice({
  name: 'FavoriteListingsPage',
  initialState: {
    currentPageResultIds: [],
    queryInProgress: false,
    queryListingsError: null,
  },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(queryFavoriteListingsThunk.pending, state => {
        state.queryInProgress = true;
        state.queryListingsError = null;
      })
      .addCase(queryFavoriteListingsThunk.fulfilled, (state, action) => {
        state.currentPageResultIds = resultIds(action.payload.data);
        state.queryInProgress = false;
      })
      .addCase(queryFavoriteListingsThunk.rejected, (state, action) => {
        console.error(action.payload || action.error);
        state.queryInProgress = false;
        state.queryListingsError = action.payload;
      });
  },
});

export default favoriteListingsPageSlice.reducer;

// ================ Load data ================ //

export const loadData = (params, search, config) => (dispatch, getState, sdk) => {
  return dispatch(fetchCurrentUser()).then(() => {
    const favoriteListingIds = selectFavoriteListingIds(getState());
    return dispatch(
      queryFavoriteListingsThunk({
        favoriteListingIds,
        listingImageConfig: config.layout.listingImage,
      })
    );
  });
};
