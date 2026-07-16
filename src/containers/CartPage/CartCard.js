import React from 'react';
import { useDispatch } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { createSlug } from '../../util/urlHelpers';
import { toggleCart } from '../../ducks/cart.duck';

import {
  AspectRatioWrapper,
  NamedLink,
  ResponsiveImage,
  InlineTextButton,
  AddToCartButton,
} from '../../components';

import css from './CartCard.module.css';

const VARIANT_PREFIX = 'listing-card';

/**
 * One cart row: a listing's thumbnail, title, unit price, quantity stepper, and any
 * stock/availability warnings. Handles the case where the listing is no longer
 * available (deleted or closed) by rendering a dimmed placeholder with only a
 * remove action.
 *
 * @component
 * @param {Object} props
 * @param {string} props.authorId
 * @param {string} props.listingId
 * @param {number} props.quantity
 * @param {Object?} props.listing - denormalised listing entity, or null if unavailable
 * @param {Array?} props.images - images to render (the listing's own, or the grafted
 *   primary's for an imageless variant sibling)
 * @param {string?} props.currentUserId
 * @param {string} props.renderSizes
 * @returns {JSX.Element}
 */
const CartCard = props => {
  const { authorId, listingId, quantity, listing, images, currentUserId, renderSizes } = props;
  const intl = useIntl();
  const dispatch = useDispatch();

  const handleRemove = () => {
    dispatch(toggleCart(listingId, authorId, -quantity));
  };

  if (!listing) {
    return (
      <div className={css.root} data-unavailable>
        <div className={css.unavailablePlaceholder} />
        <div className={css.details}>
          <p className={css.unavailableText}>
            <FormattedMessage id="CartCard.listingUnavailable" />
          </p>
          <InlineTextButton className={css.removeButton} onClick={handleRemove}>
            <FormattedMessage id="CartCard.remove" />
          </InlineTextButton>
        </div>
      </div>
    );
  }

  const { title } = listing.attributes;
  const price = listing.attributes.price;
  const currentStock = listing.currentStock?.attributes?.quantity;
  const slug = createSlug(title);
  const isOwnListing = currentUserId && listing.author?.id?.uuid === currentUserId;
  const isOutOfStock = typeof currentStock === 'number' && currentStock === 0;
  const isOverStock = typeof currentStock === 'number' && quantity > currentStock;

  const firstImage = images?.[0] || null;
  const variants = firstImage
    ? Object.keys(firstImage?.attributes?.variants || {}).filter(k => k.startsWith(VARIANT_PREFIX))
    : [];

  return (
    <div className={css.root}>
      <NamedLink
        className={css.thumbnailLink}
        name="ListingPage"
        params={{ id: listingId, slug }}
      >
        <AspectRatioWrapper className={css.aspectRatioWrapper} width={1} height={1}>
          <ResponsiveImage
            rootClassName={css.rootForImage}
            alt={title}
            image={firstImage}
            variants={variants}
            sizes={renderSizes}
          />
        </AspectRatioWrapper>
      </NamedLink>

      <div className={css.details}>
        <NamedLink className={css.title} name="ListingPage" params={{ id: listingId, slug }}>
          {title}
        </NamedLink>
        {price ? <div className={css.price}>{formatMoney(intl, price)}</div> : null}

        {isOwnListing ? (
          <p className={css.warning}>
            <FormattedMessage id="CartCard.ownListing" />
          </p>
        ) : isOutOfStock ? (
          <p className={css.warning}>
            <FormattedMessage id="CartCard.outOfStock" />
          </p>
        ) : isOverStock ? (
          <p className={css.warning}>
            <FormattedMessage id="CartCard.onlyXLeft" values={{ count: currentStock }} />
          </p>
        ) : null}

        <div className={css.controls}>
          <AddToCartButton
            rootClassName={css.stepper}
            listing={listing}
            currentStock={currentStock}
          />
          <InlineTextButton className={css.removeButton} onClick={handleRemove}>
            <FormattedMessage id="CartCard.remove" />
          </InlineTextButton>
        </div>
      </div>
    </div>
  );
};

export default CartCard;
