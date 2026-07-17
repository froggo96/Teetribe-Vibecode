import React, { useEffect } from 'react';
import { compose } from 'redux';
import { connect, useDispatch, useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { types as sdkTypes } from '../../util/sdkLoader';
import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { getListingsById } from '../../ducks/marketplaceData.duck';
import { initializeCardPaymentData } from '../../ducks/stripe.duck.js';
import {
  selectCart,
  cartGroupListingEntries,
  setCartDeliveryMethod,
} from '../../ducks/cart.duck';
import { fetchCartGroupLineItems } from './CartPage.duck';
import { variantGroupIdOf, VARIANT_GROUP_ID_KEY } from '../../util/variantHelpers';
import { buildCartItemFromListing } from '../../util/cartHelpers';
import { displayDeliveryPickup, displayDeliveryShipping } from '../../util/configHelpers';
import { userDisplayNameAsString } from '../../util/data';
import { findRouteByRouteName, createResourceLocatorString } from '../../util/routes';
import { createSlug } from '../../util/urlHelpers';
import { PURCHASE_PROCESS_NAME } from '../../transactions/transaction';

import { H3, Page, NamedLink, LayoutSingleColumn, PrimaryButton } from '../../components';
import EstimatedCustomerBreakdownMaybe from '../../components/OrderPanel/EstimatedCustomerBreakdownMaybe';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import CartCard from './CartCard';
import CartDeliveryForm from './CartDeliveryForm';

import css from './CartPage.module.css';

const { UUID } = sdkTypes;

// A listing lacking its own images needs its primary's images grafted on (see
// util/variantHelpers.js: sibling variant listings never carry images of their own).
const imagesForListing = (listing, primaryListingsById) => {
  if (!listing) {
    return null;
  }
  if (listing.images?.length > 0) {
    return listing.images;
  }
  const primaryId = variantGroupIdOf(listing);
  return primaryListingsById[primaryId]?.images || [];
};

const sharedDeliveryMethods = (availableItems, listingTypes) => {
  if (availableItems.length === 0) {
    return [];
  }
  const methodsFor = ({ listing }) => {
    const publicData = listing.attributes.publicData || {};
    const listingTypeConfig = listingTypes.find(c => c.listingType === publicData.listingType);
    return {
      pickup: !!publicData.pickupEnabled && displayDeliveryPickup(listingTypeConfig),
      shipping: !!publicData.shippingEnabled && displayDeliveryShipping(listingTypeConfig),
    };
  };
  const allMethods = availableItems.map(methodsFor);
  const shipping = allMethods.every(m => m.shipping);
  const pickup = allMethods.every(m => m.pickup);
  return [...(shipping ? ['shipping'] : []), ...(pickup ? ['pickup'] : [])];
};

/**
 * One seller group in the cart: its items, delivery method selector, estimated
 * breakdown, and checkout button. All listings in a group are bought together in a
 * single transaction, so only one delivery method applies to the whole group.
 */
const CartSellerGroup = props => {
  const {
    authorId,
    items,
    deliveryMethod,
    groupLineItems,
    currentUserId,
    primaryListingsById,
    renderSizes,
    listingTypes,
    listingFields,
    marketplaceCurrency,
    marketplaceName,
  } = props;
  const dispatch = useDispatch();
  const history = useHistory();
  const routeConfiguration = useRouteConfiguration();

  const availableItems = items.filter(i => i.listing);
  const unavailableItems = items.filter(i => !i.listing);

  const sharedMethods = sharedDeliveryMethods(availableItems, listingTypes);
  const sharedMethodsKey = sharedMethods.join(',');

  // Auto-select the delivery method when the group only has one option in common.
  useEffect(() => {
    if (sharedMethods.length === 1 && deliveryMethod !== sharedMethods[0]) {
      dispatch(setCartDeliveryMethod(authorId, sharedMethods[0]));
    }
  }, [sharedMethodsKey, deliveryMethod, authorId]);

  const cartItemsForFetch = availableItems.map(i => ({ listingId: i.listingId, quantity: i.quantity }));
  const fetchSignature = JSON.stringify({ cartItemsForFetch, deliveryMethod });

  // Refresh the group's estimated price breakdown whenever its composition changes.
  useEffect(() => {
    if (availableItems.length > 0 && deliveryMethod) {
      dispatch(fetchCartGroupLineItems({ authorId, cartItems: cartItemsForFetch, deliveryMethod }));
    }
  }, [fetchSignature]);

  const author = availableItems[0]?.listing?.author;
  const authorName = userDisplayNameAsString(author, '');

  const hasStockIssue = availableItems.some(({ listing, quantity }) => {
    const stock = listing.currentStock?.attributes?.quantity;
    return typeof stock === 'number' && quantity > stock;
  });
  const hasOwnListing =
    !!currentUserId && availableItems.some(({ listing }) => listing.author?.id?.uuid === currentUserId);
  const canCheckout =
    unavailableItems.length === 0 &&
    !hasStockIssue &&
    !hasOwnListing &&
    sharedMethods.length > 0 &&
    !!deliveryMethod;

  // The first-added item in the group becomes the "main" listing: the checkout URL is
  // built from it, and every item in the group (main first) rides along as cartItems -
  // this is what turns the whole group into a single-seller, single-transaction checkout.
  const handleCheckout = () => {
    if (!canCheckout) {
      return;
    }
    const mainListing = availableItems[0].listing;
    const cartItemsForOrder = availableItems.map(({ listing, quantity }) =>
      buildCartItemFromListing(listing, quantity, listingFields)
    );
    const initialValues = {
      listing: mainListing,
      orderData: {
        quantity: availableItems[0].quantity,
        deliveryMethod,
        cartItems: cartItemsForOrder,
        fromCart: true,
        cartAuthorId: authorId,
      },
      confirmPaymentError: null,
    };

    const { setInitialValues: checkoutSetInitialValues } = findRouteByRouteName(
      'CheckoutPage',
      routeConfiguration
    );
    dispatch(checkoutSetInitialValues(initialValues));
    dispatch(initializeCardPaymentData());

    history.push(
      createResourceLocatorString(
        'CheckoutPage',
        routeConfiguration,
        { id: mainListing.id.uuid, slug: createSlug(mainListing.attributes.title) },
        {}
      )
    );
  };

  const lineItems = groupLineItems?.lineItems;
  const showBreakdown =
    availableItems.length > 0 && !!deliveryMethod && lineItems && !groupLineItems?.fetchInProgress;

  return (
    <div className={css.group}>
      <H3 as="h2" className={css.groupHeading}>
        {authorName ? (
          <FormattedMessage id="CartPage.sellerHeading" values={{ name: authorName }} />
        ) : (
          <FormattedMessage id="CartPage.sellerHeadingUnknown" />
        )}
      </H3>

      <div className={css.cards}>
        {items.map(item => (
          <CartCard
            key={item.listingId}
            authorId={authorId}
            listingId={item.listingId}
            quantity={item.quantity}
            listing={item.listing}
            images={imagesForListing(item.listing, primaryListingsById)}
            currentUserId={currentUserId}
            renderSizes={renderSizes}
          />
        ))}
      </div>

      {unavailableItems.length === 0 ? (
        <CartDeliveryForm
          sharedMethods={sharedMethods}
          selectedMethod={deliveryMethod}
          onChange={method => dispatch(setCartDeliveryMethod(authorId, method))}
        />
      ) : null}

      {groupLineItems?.fetchError ? (
        <p className={css.breakdownError}>
          <FormattedMessage id="CartPage.breakdownError" />
        </p>
      ) : null}

      {showBreakdown ? (
        <div className={css.breakdownWrapper}>
          <EstimatedCustomerBreakdownMaybe
            breakdownData={{}}
            lineItems={lineItems}
            currency={marketplaceCurrency}
            marketplaceName={marketplaceName}
            processName={PURCHASE_PROCESS_NAME}
          />
        </div>
      ) : null}

      <PrimaryButton
        className={css.checkoutButton}
        type="button"
        disabled={!canCheckout}
        onClick={handleCheckout}
      >
        <FormattedMessage id="CartPage.checkout" />
      </PrimaryButton>
      {!canCheckout ? (
        <p className={css.checkoutHint}>
          <FormattedMessage id="CartPage.checkoutDisabledHint" />
        </p>
      ) : null}
    </div>
  );
};

/**
 * The CartPage component: every listing the current user has added to their cart,
 * grouped by seller (all listings from one seller are bought together).
 *
 * @component
 * @param {Object} props
 * @param {propTypes.currentUser} props.currentUser
 * @param {propTypes.listing[]} props.listings - the cart's listings that are still available
 * @param {Object} props.primaryListingsById - primary listings fetched only to graft their
 *   images onto imageless variant sibling cart items, keyed by id
 * @param {boolean} props.queryInProgress
 * @param {propTypes.error} props.queryListingsError
 * @param {Object} props.groupLineItems - per-seller estimated line items, keyed by author id
 * @param {boolean} props.scrollingDisabled
 * @returns {JSX.Element}
 */
export const CartPageComponent = props => {
  const intl = useIntl();
  const config = useConfiguration();
  const cart = useSelector(selectCart);

  const {
    currentUser,
    listings = [],
    primaryListingsById,
    queryInProgress,
    queryListingsError,
    groupLineItems,
    scrollingDisabled,
  } = props;

  const listingsById = new Map(listings.map(l => [l.id.uuid, l]));
  const currentUserId = currentUser?.id?.uuid;
  const listingTypes = config.listing.listingTypes || [];
  const listingFields = config.listing.listingFields || [];
  const marketplaceCurrency = config.currency;
  const marketplaceName = config.marketplaceName;

  const sellerGroups = Object.entries(cart).map(([authorId, group]) => ({
    authorId,
    deliveryMethod: group.deliveryMethod,
    items: cartGroupListingEntries(group).map(([listingId, item]) => ({
      listingId,
      quantity: item.count,
      listing: listingsById.get(listingId) || null,
    })),
  }));

  const hasGroups = sellerGroups.length > 0;
  const hasResults = !queryInProgress && hasGroups;
  const hasNoResults = !queryInProgress && !hasGroups;

  const panelWidth = 62.5;
  const renderSizes = [
    `(max-width: 767px) 100vw`,
    `(max-width: 1920px) ${panelWidth / 2}vw`,
    `${panelWidth / 3}vw`,
  ].join(', ');

  return (
    <Page title={intl.formatMessage({ id: 'CartPage.title' })} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <div className={css.content}>
          {queryInProgress ? (
            <H3 as="h2" className={css.heading}>
              <FormattedMessage id="CartPage.loadingCart" />
            </H3>
          ) : null}
          {queryListingsError ? (
            <H3 as="h2" className={css.heading}>
              <FormattedMessage id="CartPage.queryError" />
            </H3>
          ) : null}
          {hasResults ? (
            <H3 as="h1" className={css.heading}>
              <FormattedMessage id="CartPage.heading" />
            </H3>
          ) : null}
          {hasNoResults ? (
            <div className={css.noResultsContainer}>
              <H3 as="h1" className={css.headingNoListings}>
                <FormattedMessage id="CartPage.noItems" />
              </H3>
              <p>
                <NamedLink className={css.browseListingsLink} name="SearchPage">
                  <FormattedMessage id="CartPage.browseListingsLink" />
                </NamedLink>
              </p>
            </div>
          ) : null}

          {sellerGroups.map(group => (
            <CartSellerGroup
              key={group.authorId}
              authorId={group.authorId}
              items={group.items}
              deliveryMethod={group.deliveryMethod}
              groupLineItems={groupLineItems[group.authorId]}
              currentUserId={currentUserId}
              primaryListingsById={primaryListingsById}
              renderSizes={renderSizes}
              listingTypes={listingTypes}
              listingFields={listingFields}
              marketplaceCurrency={marketplaceCurrency}
              marketplaceName={marketplaceName}
            />
          ))}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const uniquePrimaryIdsNeedingImages = listings => {
  const ids = new Set();
  listings.forEach(listing => {
    const hasOwnImages = listing.images?.length > 0;
    const primaryId = listing.attributes?.publicData?.[VARIANT_GROUP_ID_KEY];
    const isSelf = primaryId === listing.id.uuid;
    if (!hasOwnImages && primaryId && !isSelf) {
      ids.add(primaryId);
    }
  });
  return Array.from(ids);
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const { cartListingIds, queryInProgress, queryListingsError, groupLineItems } = state.CartPage;
  const listings = getListingsById(state, cartListingIds);
  // getListingsById expects id objects (it looks entities up by id.uuid), while the
  // publicData back-reference is a plain uuid string - wrap before the lookup.
  const primaryIds = uniquePrimaryIdsNeedingImages(listings).map(id => new UUID(id));
  const primaryListings = getListingsById(state, primaryIds);
  const primaryListingsById = Object.fromEntries(primaryListings.map(l => [l.id.uuid, l]));

  return {
    currentUser,
    listings,
    primaryListingsById,
    queryInProgress,
    queryListingsError,
    groupLineItems,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const CartPage = compose(connect(mapStateToProps))(CartPageComponent);

export default CartPage;
