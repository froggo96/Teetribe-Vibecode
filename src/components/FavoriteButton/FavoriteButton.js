import React from 'react';
import classNames from 'classnames';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';

import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { useIntl } from '../../util/reactIntl';
import { createResourceLocatorString } from '../../util/routes';
import {
  toggleFavorite,
  selectIsListingFavorite,
  selectIsToggleFavoriteInProgress,
  selectFavoriteListingIds,
} from '../../ducks/favorites.duck';

import IconHeart from '../IconHeart/IconHeart';

import css from './FavoriteButton.module.css';

/**
 * A heart button overlaid on a listing image/thumbnail, letting a logged-in
 * user save/unsave the listing to their favorites. Safe to nest inside a
 * link or another clickable container - it always stops the click from
 * bubbling or triggering navigation.
 *
 * @component
 * @param {Object} props
 * @param {Object} props.listing - API entity: listing or ownListing
 * @param {Object?} props.currentUser - The current user, if logged in
 * @param {Set<string>?} props.favoriteListingIdsSet - Optional memoized Set of favorited listing
 *   ids (see makeSelectFavoriteListingIdsSet in ducks/favorites.duck.js). Pass this when rendering
 *   many listing cards at once (e.g. search results) to avoid an O(n) array scan per card; omit it
 *   for single-listing contexts (e.g. the listing page), where the plain selector is cheap enough.
 * @param {string?} props.className add more style rules in addition to component's own css.root
 * @param {string?} props.rootClassName overwrite component's own css.root
 * @returns {JSX.Element}
 */
const FavoriteButton = props => {
  const { listing, currentUser, favoriteListingIdsSet, className, rootClassName } = props;
  const dispatch = useDispatch();
  const history = useHistory();
  const location = useLocation();
  const routeConfiguration = useRouteConfiguration();
  const intl = useIntl();

  const listingId = listing?.id?.uuid;
  const isFavoriteFromSelector = useSelector(state => selectIsListingFavorite(state, listingId));
  const isFavorite = favoriteListingIdsSet ? favoriteListingIdsSet.has(listingId) : isFavoriteFromSelector;
  const inProgress = useSelector(state => selectIsToggleFavoriteInProgress(state, listingId));

  const handleClick = event => {
    event.preventDefault();
    event.stopPropagation();

    if (!currentUser) {
      const state = { from: `${location.pathname}${location.search}${location.hash}` };
      history.push(createResourceLocatorString('SignupPage', routeConfiguration, {}, {}), state);
      return;
    }

    if (inProgress) {
      return;
    }

    dispatch(toggleFavorite(listingId));
  };

  const ariaLabel = intl.formatMessage({
    id: isFavorite ? 'FavoriteButton.removeFromFavorites' : 'FavoriteButton.saveToFavorites',
  });

  const classes = classNames(rootClassName || css.root, className);

  const allFavoriteIds = useSelector(selectFavoriteListingIds);
  // TEMP DEBUG
  const toggleError = useSelector(state => state.favorites.toggleFavoritesError[listingId]);
  const currentUserShowTimestamp = useSelector(state => state.user.currentUserShowTimestamp);
  const currentUserPrivateData = useSelector(
    state => state.user.currentUser?.attributes?.profile?.privateData
  );

  return (
    <>
      <button type="button" className={classes} onClick={handleClick} disabled={inProgress}>
        <IconHeart className={css.icon} isFilled={isFavorite} ariaLabel={ariaLabel} />
      </button>
      {/* TEMP DEBUG - remove after diagnosing. Positions relative to whatever ancestor the
          button itself already relies on (e.g. .imageOverlayWrapper / .sectionHero), since it's
          a sibling of the button, not a new wrapper - so it doesn't change the button's layout. */}
      <div
        style={{
          position: 'absolute',
          top: '40px',
          right: '8px',
          zIndex: 999,
          background: 'yellow',
          color: 'black',
          fontSize: '9px',
          padding: '2px 4px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          width: '220px',
        }}
      >
        id={listingId}{'\n'}fav={String(isFavorite)} inProg={String(inProgress)}{'\n'}
        all=[{allFavoriteIds.join(', ')}]{'\n'}
        userTS={currentUserShowTimestamp} now={Date.now()}{'\n'}
        userPD=[{JSON.stringify(currentUserPrivateData)}]{'\n'}
        err=[{toggleError ? JSON.stringify(toggleError) : 'none'}]
      </div>
    </>
  );
};

export default FavoriteButton;
