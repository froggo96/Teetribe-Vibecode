import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { types as sdkTypes } from '../../util/sdkLoader';
import { LISTING_STATE_DRAFT } from '../../util/types';
import { storableError } from '../../util/errors';
import { fetchImportImage } from '../../util/api';
import { parseCsvFile, validateRows } from '../../util/csvImportParsing';
import { createOrUpdateVariantGroup, publishVariantGroupCascade } from '../../util/variantImport';
import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';

const { UUID } = sdkTypes;

// ================ Image fetch/upload helpers ================ //

// Fetch a URL once (via the local proxy - see server/api/fetch-import-image.js) and cache the
// result, so multiple listings that share one photo (e.g. every size of one color) don't
// re-fetch it from the seller's source URL more than once.
const imageFetchCache = new Map();
const fetchImageCached = url => {
  if (!imageFetchCache.has(url)) {
    imageFetchCache.set(url, fetchImportImage(url));
  }
  return imageFetchCache.get(url);
};

const fileNameFromUrl = (url, contentType) => {
  const ext = (contentType.split('/')[1] || 'jpg').split('+')[0];
  const last = (url.split('/').pop() || 'image').split('?')[0].split('#')[0];
  return last.includes('.') ? last : `${last}.${ext}`;
};

// A fresh File built from cached bytes - safe to build more than once from the same cached
// fetch, since each caller uploads it as its own independent image resource (an uploaded image
// can only ever be attached to one listing, so every listing that needs this photo needs its own
// upload call - see variantImport.js's uploadColorImageMaybe for the same rule).
const buildFileFromUrl = url =>
  fetchImageCached(url).then(
    ({ blob, contentType }) => new File([blob], fileNameFromUrl(url, contentType), { type: contentType })
  );

const uploadImageFromUrl = (sdk, url) =>
  buildFileFromUrl(url).then(file => sdk.images.upload({ image: file })).then(r => r.data.data.id);

// Sequential on purpose, same rate-limit lesson as variantImport.js: these are real
// sdk.images.upload calls against the Marketplace API, not just our own proxy.
const uploadImagesSequentially = (sdk, urls) =>
  urls.reduce(
    (chain, url) => chain.then(ids => uploadImageFromUrl(sdk, url).then(id => [...ids, id])),
    Promise.resolve([])
  );

const CREATE_QUERY_PARAMS = { expand: true, include: ['images', 'currentStock'] };

// publishVariantGroupCascade (variantImport.js) already publishes any still-draft sibling once,
// but a per-sibling publishDraft failure there is deliberately swallowed (just logged) rather
// than thrown - that matches the interactive wizard, which self-heals a stuck-draft sibling on
// the seller's next save. A one-shot bulk import has no "next save" to rely on, so verify here
// and retry a few times before surfacing an error - otherwise a single transient publish hiccup
// silently leaves a sibling stuck in draft (invisible/unpurchasable) while reporting success.
const ensureSiblingsPublished = (sdk, siblingIdStrings, onEntities, attemptsLeft = 3) => {
  if (!siblingIdStrings?.length) {
    return Promise.resolve();
  }
  return sdk.ownListings
    .query({ ids: siblingIdStrings.map(sid => new UUID(sid)) })
    .then(response => {
      const stillDraft = response.data.data.filter(l => l.attributes.state === LISTING_STATE_DRAFT);
      if (stillDraft.length === 0) {
        return;
      }
      if (attemptsLeft <= 0) {
        throw new Error(
          `${stillDraft.length} sibling listing(s) could not be published: ${stillDraft
            .map(l => l.id.uuid)
            .join(', ')}`
        );
      }
      return stillDraft
        .reduce(
          (chain, sibling) =>
            chain.then(() =>
              sdk.ownListings
                .publishDraft({ id: sibling.id }, { expand: true })
                .then(onEntities)
                .catch(() => {})
            ),
          Promise.resolve()
        )
        .then(() => ensureSiblingsPublished(sdk, siblingIdStrings, onEntities, attemptsLeft - 1));
    });
};

// ================ Import one product group ================ //

const importPlainProduct = (sdk, plan, onEntities) => {
  const imageUrls = [plan.imageUrl, ...plan.additionalImageUrls].filter(Boolean);
  return uploadImagesSequentially(sdk, imageUrls)
    .then(images =>
      sdk.ownListings.createDraft(
        {
          title: plan.title,
          description: plan.description,
          price: plan.price,
          publicData: plan.publicData,
          privateData: plan.privateData,
          images,
        },
        CREATE_QUERY_PARAMS
      )
    )
    .then(createResponse => {
      onEntities(createResponse);
      const listingId = createResponse.data.data.id;
      return sdk.stock
        .compareAndSet({ listingId, oldTotal: null, newTotal: plan.stock }, { expand: true })
        .then(stockResponse => onEntities(stockResponse))
        .then(() => sdk.ownListings.publishDraft({ id: listingId }, { expand: true }))
        .then(publishResponse => {
          onEntities(publishResponse);
          return { listingIds: [listingId] };
        });
    });
};

const importVariantGroup = (sdk, plan, onEntities) => {
  return uploadImagesSequentially(sdk, plan.additionalImageUrls)
    .then(images =>
      sdk.ownListings.createDraft(
        {
          title: plan.title,
          description: plan.description,
          price: plan.price,
          publicData: plan.publicData,
          privateData: plan.privateData,
          images,
        },
        CREATE_QUERY_PARAMS
      )
    )
    .then(createResponse => {
      onEntities(createResponse);
      const primaryId = createResponse.data.data.id;
      const primaryListingEntity = createResponse.data.data;

      // Building each combo's photo File can happen concurrently - it only hits our own image
      // proxy (cached per URL), not the Marketplace API, so the rate-limit concern doesn't apply
      // here. The actual sdk.images.upload/createDraft/stock/publish calls per sibling still run
      // sequentially, inside createOrUpdateVariantGroup itself.
      return Promise.all(
        plan.combos.map(combo =>
          combo.imageUrl
            ? buildFileFromUrl(combo.imageUrl).then(file => ({ ...combo, newColorImageFile: file }))
            : Promise.resolve(combo)
        )
      ).then(combosWithFiles =>
        createOrUpdateVariantGroup({
          sdk,
          id: primaryId,
          primaryListingEntity,
          ownListingUpdateValues: { id: primaryId, price: plan.price },
          variantCombinations: combosWithFiles.map(c => ({
            isPrimary: c.isPrimary,
            size: c.size,
            color: c.color,
            sizeLabel: c.sizeLabel,
            colorLabel: c.colorLabel,
            newColorImageFile: c.newColorImageFile,
            stockUpdate: { oldTotal: null, newTotal: c.stock },
          })),
          queryParams: CREATE_QUERY_PARAMS,
          onEntities,
        }).then(() =>
          sdk.ownListings.publishDraft({ id: primaryId }, { expand: true }).then(publishResponse => {
            onEntities(publishResponse);
            const siblingIdStrings =
              publishResponse?.data?.data?.attributes?.publicData?.siblingListingIds || [];
            return publishVariantGroupCascade({ sdk, siblingIdStrings, onEntities })
              .then(() => ensureSiblingsPublished(sdk, siblingIdStrings, onEntities))
              .then(() => ({
                listingIds: [primaryId, ...siblingIdStrings],
              }));
          })
        )
      );
    });
};

// ================ Async Thunks ================ //

export const parseAndValidateFileThunk = createAsyncThunk(
  'BulkImportListingsPage/parseAndValidateFile',
  async ({ file, config }, { rejectWithValue }) => {
    try {
      const rows = await parseCsvFile(file);
      if (rows.length === 0) {
        throw new Error('The file has no data rows.');
      }
      return validateRows(rows, config);
    } catch (e) {
      return rejectWithValue(storableError(e));
    }
  }
);

export const importGroupThunk = createAsyncThunk(
  'BulkImportListingsPage/importGroup',
  async ({ groupKey, plan }, { dispatch, rejectWithValue, extra: sdk }) => {
    const onEntities = response => dispatch(addMarketplaceEntities(response));
    try {
      const result = plan.isVariantGroup
        ? await importVariantGroup(sdk, plan, onEntities)
        : await importPlainProduct(sdk, plan, onEntities);
      return { groupKey, ...result };
    } catch (e) {
      return rejectWithValue({ groupKey, error: storableError(e) });
    }
  }
);

// Runs the given groups' imports one at a time (never Promise.all across groups) - the same
// rate-limit lesson that makes createOrUpdateVariantGroup process siblings sequentially applies
// just as much across whole product groups in one big batch.
export const runImportThunk = createAsyncThunk(
  'BulkImportListingsPage/runImport',
  async ({ groups }, { dispatch }) => {
    for (const group of groups) {
      await dispatch(importGroupThunk({ groupKey: group.groupKey, plan: group.plan }));
    }
  }
);

// ================ Slice ================ //

const statusForGroup = group => (group.errors.length > 0 ? 'invalid' : 'ready');

const initialState = {
  parseInProgress: false,
  parseError: null,
  groups: [],
  importInProgress: false,
};

const bulkImportListingsPageSlice = createSlice({
  name: 'BulkImportListingsPage',
  initialState,
  reducers: {
    clearImport: () => initialState,
  },
  extraReducers: builder => {
    builder
      .addCase(parseAndValidateFileThunk.pending, state => {
        state.parseInProgress = true;
        state.parseError = null;
        state.groups = [];
      })
      .addCase(parseAndValidateFileThunk.fulfilled, (state, action) => {
        state.parseInProgress = false;
        state.groups = action.payload.map(group => ({ ...group, status: statusForGroup(group) }));
      })
      .addCase(parseAndValidateFileThunk.rejected, (state, action) => {
        state.parseInProgress = false;
        state.parseError = action.payload;
      })
      .addCase(runImportThunk.pending, state => {
        state.importInProgress = true;
      })
      .addCase(runImportThunk.fulfilled, state => {
        state.importInProgress = false;
      })
      .addCase(runImportThunk.rejected, state => {
        state.importInProgress = false;
      })
      .addCase(importGroupThunk.pending, (state, action) => {
        const group = state.groups.find(g => g.groupKey === action.meta.arg.groupKey);
        if (group) {
          group.status = 'importing';
          group.importError = null;
        }
      })
      .addCase(importGroupThunk.fulfilled, (state, action) => {
        const group = state.groups.find(g => g.groupKey === action.payload.groupKey);
        if (group) {
          group.status = 'done';
          group.resultListingIds = action.payload.listingIds;
        }
      })
      .addCase(importGroupThunk.rejected, (state, action) => {
        const { groupKey, error } = action.payload || {};
        const group = state.groups.find(g => g.groupKey === groupKey);
        if (group) {
          group.status = 'error';
          group.importError = error;
        }
      });
  },
});

export const { clearImport } = bulkImportListingsPageSlice.actions;
export default bulkImportListingsPageSlice.reducer;
