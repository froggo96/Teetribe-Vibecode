import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { propTypes } from '../../util/types';

import { AspectRatioWrapper, AvatarMedium, H4, H6, ResponsiveImage } from '../../components';

import css from './CheckoutPage.module.css';

/**
 * A card that displays every item in a cart order (a single-seller checkout covering
 * multiple listings - see src/util/cartHelpers.js) plus the order breakdown, on the
 * checkout page. Used instead of DetailsSideCard whenever the order has more than one
 * cart item; a plain "buy now" purchase (a cart of one) keeps using DetailsSideCard.
 *
 * @component
 * @param {Object} props
 * @param {Array<{listingId: string, title: string, quantity: number}>} props.cartItems
 * @param {propTypes.user} props.author - The seller
 * @param {propTypes.image} props.firstImage - The main listing's first image
 * @param {Object} props.layoutListingImageConfig - The layout listing image config
 * @param {ReactNode} props.speculateTransactionErrorMessage - The speculate transaction error message
 * @param {string} props.processName - The process name
 * @param {ReactNode} props.breakdown - The breakdown
 * @param {boolean} props.showListingImage
 */
const CartDetailsSideCard = props => {
  const {
    cartItems = [],
    author,
    firstImage,
    layoutListingImageConfig,
    speculateTransactionErrorMessage,
    processName,
    breakdown,
    showListingImage,
  } = props;

  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } =
    layoutListingImageConfig || {};
  const variants = firstImage
    ? Object.keys(firstImage?.attributes?.variants).filter(k => k.startsWith(variantPrefix))
    : [];

  return (
    <div className={css.detailsContainerDesktop} role="complementary">
      {showListingImage && (
        <AspectRatioWrapper
          width={aspectWidth}
          height={aspectHeight}
          className={css.detailsAspectWrapper}
        >
          <ResponsiveImage rootClassName={css.rootForImage} alt="" image={firstImage} variants={variants} />
        </AspectRatioWrapper>
      )}
      <div className={css.listingDetailsWrapper}>
        <div className={classNames(css.avatarWrapper, { [css.noListingImage]: !showListingImage })}>
          <AvatarMedium user={author} disableProfileLink />
        </div>
        <div
          className={classNames(css.detailsHeadings, { [css.noListingImage]: !showListingImage })}
        >
          <H4 as="h2">
            <FormattedMessage
              id="CartDetailsSideCard.itemCount"
              values={{ count: cartItems.length }}
            />
          </H4>
          <ul className={css.cartItemsList}>
            {cartItems.map((item, i) => (
              <li key={`${item.listingId}-${i}`} className={css.cartItemsListItem}>
                <FormattedMessage
                  id="CartDetailsSideCard.itemLine"
                  values={{ title: item.title, quantity: item.quantity }}
                />
              </li>
            ))}
          </ul>
        </div>
        {speculateTransactionErrorMessage}
      </div>

      {!!breakdown ? (
        <div className={css.orderBreakdownHeader}>
          <H6 as="h3" className={css.orderBreakdownTitle}>
            <FormattedMessage id={`CheckoutPage.${processName}.orderBreakdown`} />
          </H6>
          <hr className={css.totalDivider} />
        </div>
      ) : null}
      {breakdown}
    </div>
  );
};

export default CartDetailsSideCard;
