import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

import { pick } from '../../util/common';
import { initiatePrivileged, transitionPrivileged } from '../../util/api';
import { denormalisedResponseEntities } from '../../util/data';
import { storableError } from '../../util/errors';
import { types as sdkTypes, createImageVariantConfig } from '../../util/sdkLoader';
import * as log from '../../util/log';
import { setCurrentUserHasOrders, fetchCurrentUser } from '../../ducks/user.duck';
import { addMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { CART_STOCK_PROCESS_NAME } from '../../transactions/transaction';
import { transitions as cartStockTransitions } from '../../transactions/transactionProcessCartStock';

const { UUID } = sdkTypes;

const CART_STOCK_PROCESS_ALIAS = `${CART_STOCK_PROCESS_NAME}/release-1`;

// ================ Async thunks ================ //

////////////////////
// Initiate Order //
////////////////////
const initiateOrderPayloadCreator = (
  { orderParams, processAlias, transactionId, transitionName, isPrivilegedTransition },
  { dispatch, extra: sdk, rejectWithValue }
) => {
  // If we already have a transaction ID, we should transition, not initiate.
  const isTransition = !!transactionId;

  const { deliveryMethod, quantity, bookingDates, cartItems, ...otherOrderParams } = orderParams;
  // Cart orders (including "buy now", which is a cart of one) reserve stock through their own
  // child transactions (see createStockReservationTransactions below) - no transition on this
  // (parent) transaction consumes stockReservationQuantity for them, so it must not be sent.
  const quantityMaybe = quantity && !cartItems ? { stockReservationQuantity: quantity } : {};
  const bookingParamsMaybe = bookingDates || {};

  // Parameters only for client app's server
  const orderData = {
    ...(deliveryMethod ? { deliveryMethod } : {}),
    ...(cartItems ? { cartItems } : {}),
  };

  // Parameters for Marketplace API
  const transitionParams = {
    ...quantityMaybe,
    ...bookingParamsMaybe,
    ...otherOrderParams,
  };

  const bodyParams = isTransition
    ? {
        id: transactionId,
        transition: transitionName,
        params: transitionParams,
      }
    : {
        processAlias,
        transition: transitionName,
        params: transitionParams,
      };
  const queryParams = {
    include: ['booking', 'provider'],
    expand: true,
  };

  const handleSuccess = response => {
    const entities = denormalisedResponseEntities(response);
    const order = entities[0];
    dispatch(setCurrentUserHasOrders());
    return order;
  };

  const handleError = e => {
    const transactionIdMaybe = transactionId ? { transactionId: transactionId.uuid } : {};
    log.error(e, 'initiate-order-failed', {
      ...transactionIdMaybe,
      listingId: orderParams.listingId.uuid,
      ...quantityMaybe,
      ...bookingParamsMaybe,
      ...orderData,
      statusText: e.statusText,
    });
    return rejectWithValue(storableError(e));
  };

  if (isTransition && isPrivilegedTransition) {
    // transition privileged
    return transitionPrivileged({ isSpeculative: false, orderData, bodyParams, queryParams })
      .then(handleSuccess)
      .catch(handleError);
  } else if (isTransition) {
    // transition non-privileged
    return sdk.transactions
      .transition(bodyParams, queryParams)
      .then(handleSuccess)
      .catch(handleError);
  } else if (isPrivilegedTransition) {
    // initiate privileged
    return initiatePrivileged({ isSpeculative: false, orderData, bodyParams, queryParams })
      .then(handleSuccess)
      .catch(handleError);
  } else {
    // initiate non-privileged
    return sdk.transactions
      .initiate(bodyParams, queryParams)
      .then(handleSuccess)
      .catch(handleError);
  }
};

export const initiateOrderThunk = createAsyncThunk(
  'CheckoutPage/initiateOrder',
  initiateOrderPayloadCreator
);
// Backward compatible wrapper function for initiateOrder
export const initiateOrder = (
  orderParams,
  processAlias,
  transactionId,
  transitionName,
  isPrivilegedTransition
) => dispatch => {
  return dispatch(
    initiateOrderThunk({
      orderParams,
      processAlias,
      transactionId,
      transitionName,
      isPrivilegedTransition,
    })
  ).unwrap();
};

/////////////////////
// Confirm Payment //
/////////////////////
const confirmPaymentPayloadCreator = (
  { transactionId, transitionName, transitionParams = {} },
  { extra: sdk, rejectWithValue }
) => {
  const bodyParams = {
    id: transactionId,
    transition: transitionName,
    params: transitionParams,
  };
  const queryParams = {
    include: ['booking', 'provider'],
    expand: true,
  };

  return sdk.transactions
    .transition(bodyParams, queryParams)
    .then(response => {
      const order = response.data.data;
      return order;
    })
    .catch(e => {
      const transactionIdMaybe = transactionId ? { transactionId: transactionId.uuid } : {};
      log.error(e, 'initiate-order-failed', {
        ...transactionIdMaybe,
      });
      return rejectWithValue(storableError(e));
    });
};

export const confirmPaymentThunk = createAsyncThunk(
  'CheckoutPage/confirmPayment',
  confirmPaymentPayloadCreator
);
// Backward compatible wrapper function for confirmPayment
export const confirmPayment = (
  transactionId,
  transitionName,
  transitionParams = {}
) => dispatch => {
  return dispatch(
    confirmPaymentThunk({
      transactionId,
      transitionName,
      transitionParams,
    })
  ).unwrap();
};

//////////////////////
// Initiate Inquiry //
//////////////////////

const initiateInquiryPayloadCreator = (
  { inquiryParams, processAlias, transitionName },
  { extra: sdk, rejectWithValue }
) => {
  if (!processAlias) {
    const error = new Error('No transaction process attached to listing');
    log.error(error, 'listing-process-missing', {
      listingId: inquiryParams?.listingId?.uuid,
    });
    return rejectWithValue(storableError(error));
  }

  const bodyParams = {
    transition: transitionName,
    processAlias,
    params: inquiryParams,
  };
  const queryParams = {
    include: ['provider'],
    expand: true,
  };

  return sdk.transactions
    .initiate(bodyParams, queryParams)
    .then(response => {
      const transactionId = response.data.data.id;
      return transactionId;
    })
    .catch(e => {
      return rejectWithValue(storableError(e));
    });
};

export const initiateInquiryThunk = createAsyncThunk(
  'CheckoutPage/initiateInquiry',
  initiateInquiryPayloadCreator
);
// Backward compatible wrapper function for initiateInquiryWithoutPayment
/**
 * Initiate transaction against default-inquiry process
 * Note: At this point inquiry transition is made directly against Marketplace API.
 *       So, client app's server is not involved here unlike with transitions including payments.
 *
 * @param {Object} params
 * @param {Object} params.inquiryParams contains listingId and protectedData
 * @param {String} params.processAlias 'default-inquiry/release-1'
 * @param {String} params.transitionName 'transition/inquire-without-payment'
 * @returns
 */
export const initiateInquiryWithoutPayment = (
  inquiryParams,
  processAlias,
  transitionName
) => dispatch => {
  return dispatch(
    initiateInquiryThunk({
      inquiryParams,
      processAlias,
      transitionName,
    })
  ).unwrap();
};

///////////////////////////
// Speculate Transaction //
///////////////////////////
/**
 * Initiate or transition the speculative transaction with the given
 * booking details
 *
 * The API allows us to do speculative transaction initiation and
 * transitions. This way we can create a test transaction and get the
 * actual pricing information as if the transaction had been started,
 * without affecting the actual data.
 *
 * We store this speculative transaction in the page store and use the
 * pricing info for the booking breakdown to get a proper estimate for
 * the price with the chosen information.
 */

const speculateTransactionPayloadCreator = (
  { orderParams, processAlias, transactionId, transitionName, isPrivilegedTransition },
  { dispatch, extra: sdk, rejectWithValue }
) => {
  // If we already have a transaction ID, we should transition, not initiate.
  const isTransition = !!transactionId;

  const {
    deliveryMethod,
    priceVariantName,
    quantity,
    bookingDates,
    cartItems,
    ...otherOrderParams
  } = orderParams;
  const quantityMaybe = quantity && !cartItems ? { stockReservationQuantity: quantity } : {};
  const bookingParamsMaybe = bookingDates || {};

  // Parameters only for client app's server
  const orderData = {
    ...(deliveryMethod ? { deliveryMethod } : {}),
    ...(priceVariantName ? { priceVariantName } : {}),
    ...(cartItems ? { cartItems } : {}),
  };

  // Parameters for Marketplace API
  const transitionParams = {
    ...quantityMaybe,
    ...bookingParamsMaybe,
    ...otherOrderParams,
    cardToken: 'CheckoutPage_speculative_card_token',
  };

  const bodyParams = isTransition
    ? {
        id: transactionId,
        transition: transitionName,
        params: transitionParams,
      }
    : {
        processAlias,
        transition: transitionName,
        params: transitionParams,
      };

  const queryParams = {
    include: ['booking', 'provider'],
    expand: true,
  };

  const handleSuccess = response => {
    const entities = denormalisedResponseEntities(response);
    if (entities.length !== 1) {
      throw new Error('Expected a resource in the speculate response');
    }
    const tx = entities[0];
    return tx;
  };

  const handleError = e => {
    log.error(e, 'speculate-transaction-failed', {
      listingId: transitionParams.listingId.uuid,
      ...quantityMaybe,
      ...bookingParamsMaybe,
      ...orderData,
      statusText: e.statusText,
    });
    return rejectWithValue(storableError(e));
  };

  if (isTransition && isPrivilegedTransition) {
    // transition privileged
    return transitionPrivileged({ isSpeculative: true, orderData, bodyParams, queryParams })
      .then(handleSuccess)
      .catch(handleError);
  } else if (isTransition) {
    // transition non-privileged
    return sdk.transactions
      .transitionSpeculative(bodyParams, queryParams)
      .then(handleSuccess)
      .catch(handleError);
  } else if (isPrivilegedTransition) {
    // initiate privileged
    return initiatePrivileged({ isSpeculative: true, orderData, bodyParams, queryParams })
      .then(handleSuccess)
      .catch(handleError);
  } else {
    // initiate non-privileged
    return sdk.transactions
      .initiateSpeculative(bodyParams, queryParams)
      .then(handleSuccess)
      .catch(handleError);
  }
};

export const speculateTransactionThunk = createAsyncThunk(
  'CheckoutPage/speculateTransaction',
  speculateTransactionPayloadCreator
);
// Backward compatible wrapper function for speculateTransaction
export const speculateTransaction = (
  orderParams,
  processAlias,
  transactionId,
  transitionName,
  isPrivilegedTransition
) => dispatch => {
  return dispatch(
    speculateTransactionThunk({
      orderParams,
      processAlias,
      transactionId,
      transitionName,
      isPrivilegedTransition,
    })
  ).unwrap();
};

///////////////////////////
// Fetch Stripe Customer //
///////////////////////////
const stripeCustomerPayloadCreator = ({}, { dispatch, rejectWithValue }) => {
  const fetchCurrentUserOptions = {
    callParams: { include: ['stripeCustomer.defaultPaymentMethod'] },
    updateHasListings: false,
    updateNotifications: false,
    enforce: true,
  };

  return dispatch(fetchCurrentUser(fetchCurrentUserOptions))
    .then(response => {
      return response;
    })
    .catch(e => {
      return rejectWithValue(storableError(e));
    });
};

export const stripeCustomerThunk = createAsyncThunk(
  'CheckoutPage/stripeCustomer',
  stripeCustomerPayloadCreator
);
// Backward compatible wrapper function for stripeCustomer
export const stripeCustomer = () => dispatch => {
  return dispatch(stripeCustomerThunk({})).unwrap();
};

///////////////////////////////////////////
// Create Stock Reservation Transactions //
///////////////////////////////////////////
// One child transaction per cart listing, on cart-stock-process. Created right after the
// parent transaction's request-payment succeeds, so stock is reserved for every listing
// before the customer is charged. Listings that already have a child (from a previous,
// partially-successful attempt) are skipped. If ANY reservation fails, this rejects with
// every listing successfully reserved so far still recorded - checkout aborts before the
// card is charged, and the created children are left to expire on their own.
const createStockReservationTransactionsPayloadCreator = (
  { cartItems, existingChildTransactions = {} },
  { extra: sdk, rejectWithValue }
) => {
  const alreadyCreated = new Set(Object.keys(existingChildTransactions));
  const toCreate = cartItems.filter(({ listingId }) => !alreadyCreated.has(listingId));

  if (toCreate.length === 0) {
    return Promise.resolve(existingChildTransactions);
  }

  return Promise.allSettled(
    toCreate.map(({ listingId, quantity }) =>
      sdk.transactions
        .initiate(
          {
            processAlias: CART_STOCK_PROCESS_ALIAS,
            transition: cartStockTransitions.REQUEST_STOCK_RESERVATION,
            params: { listingId: new UUID(listingId), stockReservationQuantity: quantity },
          },
          { expand: true }
        )
        .then(response => response.data.data.id.uuid)
    )
  ).then(results => {
    const childTransactions = { ...existingChildTransactions };
    const failedListingIds = [];

    results.forEach((result, i) => {
      const { listingId } = toCreate[i];
      if (result.status === 'fulfilled') {
        childTransactions[listingId] = result.value;
      } else {
        failedListingIds.push(listingId);
        log.error(result.reason, 'create-stock-reservation-failed', { listingId });
      }
    });

    return failedListingIds.length > 0
      ? rejectWithValue({ failedListingIds, childTransactions })
      : childTransactions;
  });
};

export const createStockReservationTransactionsThunk = createAsyncThunk(
  'CheckoutPage/createStockReservationTransactions',
  createStockReservationTransactionsPayloadCreator
);
export const createStockReservationTransactions = (
  cartItems,
  existingChildTransactions
) => dispatch => {
  return dispatch(
    createStockReservationTransactionsThunk({ cartItems, existingChildTransactions })
  ).unwrap();
};

////////////////////////////////////////////
// Confirm Stock Reservation Transactions //
////////////////////////////////////////////
// Runs after the parent transaction's payment is confirmed - the sale has already happened
// at this point, so a failure here must never fail checkout. One retry after a short delay,
// then the failure is just logged (log.error) for an operator to reconcile manually.
const confirmOneChildTransaction = (sdk, listingId, transactionIdString, attempt = 1) =>
  sdk.transactions
    .transition(
      {
        id: new UUID(transactionIdString),
        transition: cartStockTransitions.CONFIRM_STOCK_RESERVATION,
        params: {},
      },
      { expand: true }
    )
    .catch(e => {
      if (attempt >= 2) {
        log.error(e, 'confirm-stock-reservation-failed', {
          listingId,
          childTransactionId: transactionIdString,
        });
        return null;
      }
      return new Promise(resolve => setTimeout(resolve, 2000)).then(() =>
        confirmOneChildTransaction(sdk, listingId, transactionIdString, attempt + 1)
      );
    });

const confirmStockReservationTransactionsPayloadCreator = (
  { childTransactions },
  { extra: sdk }
) => {
  return Promise.all(
    Object.entries(childTransactions).map(([listingId, transactionIdString]) =>
      confirmOneChildTransaction(sdk, listingId, transactionIdString)
    )
  ).then(() => childTransactions);
};

export const confirmStockReservationTransactionsThunk = createAsyncThunk(
  'CheckoutPage/confirmStockReservationTransactions',
  confirmStockReservationTransactionsPayloadCreator
);
export const confirmStockReservationTransactions = childTransactions => dispatch => {
  return dispatch(confirmStockReservationTransactionsThunk({ childTransactions })).unwrap();
};

////////////////////////////
// Fetch Cart Item Images //
////////////////////////////
// The cart checkout side card shows one thumbnail per item (see CartDetailsSideCard.js).
// Fetched directly here - rather than trusting data threaded through orderData from
// wherever the buyer came from - so it works the same way regardless of navigation path
// (cart checkout, "buy now", a reopened/refreshed checkout tab, or a stale cart-page tab
// that predates a future change to what it sends).
const cartItemImageVariantParams = listingImageConfig => {
  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } =
    listingImageConfig || {};
  const aspectRatio = aspectHeight / aspectWidth;
  return {
    'fields.image': [`variants.${variantPrefix}`, `variants.${variantPrefix}-2x`],
    ...createImageVariantConfig(`${variantPrefix}`, 400, aspectRatio),
    ...createImageVariantConfig(`${variantPrefix}-2x`, 800, aspectRatio),
  };
};

const fetchCartItemImagesPayloadCreator = (
  { imageListingIds, listingImageConfig },
  { extra: sdk, dispatch, rejectWithValue }
) => {
  if (!imageListingIds || imageListingIds.length === 0) {
    return Promise.resolve();
  }
  return sdk.listings
    .query({
      ids: imageListingIds.map(id => new UUID(id)),
      include: ['images'],
      ...cartItemImageVariantParams(listingImageConfig),
    })
    .then(response => {
      dispatch(addMarketplaceEntities(response));
    })
    .catch(e => {
      log.error(e, 'fetch-cart-item-images-failed', { imageListingIds });
      return rejectWithValue(storableError(e));
    });
};

export const fetchCartItemImagesThunk = createAsyncThunk(
  'CheckoutPage/fetchCartItemImages',
  fetchCartItemImagesPayloadCreator
);
export const fetchCartItemImages = (imageListingIds, listingImageConfig) => dispatch => {
  return dispatch(fetchCartItemImagesThunk({ imageListingIds, listingImageConfig }));
};

// ================ Slice ================ //

const initialState = {
  listing: null,
  orderData: null,
  speculateTransactionInProgress: false,
  speculateTransactionError: null,
  speculatedTransaction: null,
  isClockInSync: false,
  transaction: null,
  initiateOrderError: null,
  confirmPaymentError: null,
  initiateCartChildrenError: null,
  stripeCustomerFetched: false,
  stripeCustomerFetchError: null,
  initiateInquiryInProgress: false,
  initiateInquiryError: null,
};

const checkoutPageSlice = createSlice({
  name: 'CheckoutPage',
  initialState,
  reducers: {
    setInitialValues: (state, action) => {
      return { ...initialState, ...pick(action.payload, Object.keys(initialState)) };
    },
  },
  extraReducers: builder => {
    builder
      // Initiate Order cases
      .addCase(initiateOrderThunk.pending, state => {
        state.initiateOrderError = null;
      })
      .addCase(initiateOrderThunk.fulfilled, (state, action) => {
        state.transaction = action.payload;
      })
      .addCase(initiateOrderThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.initiateOrderError = action.payload;
      })
      // Confirm Payment cases
      .addCase(confirmPaymentThunk.pending, state => {
        state.confirmPaymentError = null;
      })
      .addCase(confirmPaymentThunk.fulfilled, state => {
        // Payment confirmed successfully, no state change needed
      })
      .addCase(confirmPaymentThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.confirmPaymentError = action.payload;
      })
      // Create Stock Reservation Transactions cases (cart checkout)
      .addCase(createStockReservationTransactionsThunk.pending, state => {
        state.initiateCartChildrenError = null;
      })
      .addCase(createStockReservationTransactionsThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.initiateCartChildrenError = action.payload;
      })
      // Speculate Transaction cases
      .addCase(speculateTransactionThunk.pending, state => {
        state.speculateTransactionInProgress = true;
        state.speculateTransactionError = null;
        state.speculatedTransaction = null;
      })
      .addCase(speculateTransactionThunk.fulfilled, (state, action) => {
        // Check that the local devices clock is within a minute from the server
        const lastTransitionedAt = action.payload?.attributes?.lastTransitionedAt;
        const localTime = new Date();
        const minute = 60000;
        state.speculateTransactionInProgress = false;
        state.speculatedTransaction = action.payload;
        state.isClockInSync =
          Math.abs(lastTransitionedAt?.getTime() - localTime.getTime()) < minute;
      })
      .addCase(speculateTransactionThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.speculateTransactionInProgress = false;
        state.speculateTransactionError = action.payload;
      })
      // Stripe Customer cases
      .addCase(stripeCustomerThunk.pending, state => {
        state.stripeCustomerFetched = false;
        state.stripeCustomerFetchError = null;
      })
      .addCase(stripeCustomerThunk.fulfilled, state => {
        state.stripeCustomerFetched = true;
      })
      .addCase(stripeCustomerThunk.rejected, (state, action) => {
        console.error(action.payload);
        state.stripeCustomerFetchError = action.payload;
      })
      // Initiate Inquiry cases
      .addCase(initiateInquiryThunk.pending, state => {
        state.initiateInquiryInProgress = true;
        state.initiateInquiryError = null;
      })
      .addCase(initiateInquiryThunk.fulfilled, state => {
        state.initiateInquiryInProgress = false;
      })
      .addCase(initiateInquiryThunk.rejected, (state, action) => {
        state.initiateInquiryInProgress = false;
        state.initiateInquiryError = action.payload;
      });
  },
});

// Export the action creators
export const { setInitialValues } = checkoutPageSlice.actions;

// Export the reducer
export default checkoutPageSlice.reducer;
