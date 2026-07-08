import React, { useMemo } from 'react';
import { compose } from 'redux';
import { connect, useSelector } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { getListingsById } from '../../ducks/marketplaceData.duck';
import { makeSelectFavoriteListingIdsSet } from '../../ducks/favorites.duck';

import { H3, Page, NamedLink, LayoutSingleColumn, ListingCard } from '../../components';

import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import css from './FavoriteListingsPage.module.css';

/**
 * The FavoriteListingsPage component.
 *
 * @component
 * @param {Object} props
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {propTypes.listing[]} props.listings - The favorited listings that have loaded so far
 * @param {boolean} props.queryInProgress - Whether the query is in progress
 * @param {propTypes.error} props.queryListingsError - The query listings error
 * @param {boolean} props.scrollingDisabled - Whether the scrolling is disabled
 * @returns {JSX.Element} favorite listings page component
 */
export const FavoriteListingsPageComponent = props => {
  const intl = useIntl();
  const selectFavoriteListingIdsSet = useMemo(makeSelectFavoriteListingIdsSet, []);
  const favoriteListingIdsSet = useSelector(selectFavoriteListingIdsSet);

  const {
    currentUser,
    listings = [],
    queryInProgress,
    queryListingsError,
    scrollingDisabled,
  } = props;

  // Filter against the live favorites store (not just the loadData snapshot) so
  // unfavoriting a listing here removes its card immediately, without a refetch.
  const favoriteListings = listings.filter(l => favoriteListingIdsSet.has(l.id.uuid));

  const hasResults = !queryInProgress && favoriteListings.length > 0;
  const hasNoResults = !queryInProgress && favoriteListings.length === 0;

  const panelWidth = 62.5;
  const renderSizes = [
    `(max-width: 767px) 100vw`,
    `(max-width: 1920px) ${panelWidth / 2}vw`,
    `${panelWidth / 3}vw`,
  ].join(', ');

  return (
    <Page
      title={intl.formatMessage({ id: 'FavoriteListingsPage.title' })}
      scrollingDisabled={scrollingDisabled}
    >
      <LayoutSingleColumn
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
      >
        <div className={css.listingPanel}>
          {queryInProgress ? (
            <H3 as="h2" className={css.heading}>
              <FormattedMessage id="FavoriteListingsPage.loadingFavoriteListings" />
            </H3>
          ) : null}
          {queryListingsError ? (
            <H3 as="h2" className={css.heading}>
              <FormattedMessage id="FavoriteListingsPage.queryError" />
            </H3>
          ) : null}
          {hasResults ? (
            <H3 as="h1" className={css.heading}>
              <FormattedMessage id="FavoriteListingsPage.heading" />
            </H3>
          ) : null}
          {hasNoResults ? (
            <div className={css.noResultsContainer}>
              <H3 as="h1" className={css.headingNoListings}>
                <FormattedMessage id="FavoriteListingsPage.noResults" />
              </H3>
              <p>
                <NamedLink className={css.browseListingsLink} name="SearchPage">
                  <FormattedMessage id="FavoriteListingsPage.browseListingsLink" />
                </NamedLink>
              </p>
            </div>
          ) : null}

          <ul className={css.listingCards}>
            {favoriteListings.map(l => (
              <li key={l.id.uuid} className={css.listingCard}>
                <ListingCard
                  listing={l}
                  currentUser={currentUser}
                  favoriteListingIdsSet={favoriteListingIdsSet}
                  renderSizes={renderSizes}
                />
              </li>
            ))}
          </ul>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const { currentPageResultIds, queryInProgress, queryListingsError } = state.FavoriteListingsPage;
  const listings = getListingsById(state, currentPageResultIds);
  return {
    currentUser,
    listings,
    queryInProgress,
    queryListingsError,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const FavoriteListingsPage = compose(connect(mapStateToProps))(FavoriteListingsPageComponent);

export default FavoriteListingsPage;
