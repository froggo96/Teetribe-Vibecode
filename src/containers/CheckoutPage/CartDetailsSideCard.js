import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';

import { AspectRatioWrapper, AvatarMedium, H4, H6, ResponsiveImage } from '../../components';

import css from './CheckoutPage.module.css';

/**
 * A card that displays every item in a cart order (a single-seller checkout covering
 * multiple listings - see src/util/cartHelpers.js) plus the order breakdown, on the
 * checkout page. Used instead of DetailsSideCard whenever the order has more than one
 * cart item; a plain "buy now" purchase (a cart of one) keeps using DetailsSideCard.
 *
 * The items are shown as a horizontal, scrollable strip of thumbnails so every variant's
 * photo is visible without the card growing unbounded.
 *
 * @component
 * @param {Object} props
 * @param {Array<{listingId: string, title: string, quantity: number}>} props.cartItems
 * @param {Array<propTypes.image>} props.cartItemImages - one image per cart item, aligned
 *   to cartItems by index (the same per-variant image the cart row showed); may contain nulls
 * @param {propTypes.user} props.author - The seller
 * @param {Object} props.layoutListingImageConfig - The layout listing image config
 * @param {ReactNode} props.speculateTransactionErrorMessage - The speculate transaction error message
 * @param {string} props.processName - The process name
 * @param {ReactNode} props.breakdown - The breakdown
 * @param {boolean} props.showListingImage
 */
const CartDetailsSideCard = props => {
  const {
    cartItems = [],
    cartItemImages = [],
    author,
    layoutListingImageConfig,
    speculateTransactionErrorMessage,
    processName,
    breakdown,
    showListingImage,
  } = props;

  const { aspectWidth = 1, aspectHeight = 1, variantPrefix = 'listing-card' } =
    layoutListingImageConfig || {};
  const variantsOf = image =>
    image ? Object.keys(image?.attributes?.variants || {}).filter(k => k.startsWith(variantPrefix)) : [];

  return (
    <div className={css.detailsContainerDesktop} role="complementary">
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
        </div>
        {speculateTransactionErrorMessage}
      </div>

      {showListingImage ? (
        <div className={css.cartItemsStrip}>
          {cartItems.map((item, i) => {
            const image = cartItemImages[i] || null;
            return (
              <div key={`${item.listingId}-${i}`} className={css.cartItemThumb}>
                <AspectRatioWrapper
                  className={css.cartItemThumbImage}
                  width={aspectWidth}
                  height={aspectHeight}
                >
                  <ResponsiveImage
                    rootClassName={css.rootForImage}
                    alt={item.title}
                    image={image}
                    variants={variantsOf(image)}
                  />
                </AspectRatioWrapper>
                <p className={css.cartItemThumbTitle} title={item.title}>
                  {item.title}
                </p>
                <p className={css.cartItemThumbQty}>
                  <FormattedMessage
                    id="CartDetailsSideCard.thumbQuantity"
                    values={{ quantity: item.quantity }}
                  />
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

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
