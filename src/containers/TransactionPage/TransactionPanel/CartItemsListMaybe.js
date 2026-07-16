import React from 'react';
import { FormattedMessage } from '../../../util/reactIntl';
import { createSlug } from '../../../util/urlHelpers';

import { H6, NamedLink } from '../../../components';

import css from './TransactionPanel.module.css';

/**
 * Lists every item in a cart order (a single-seller checkout covering multiple listings -
 * see src/util/cartHelpers.js). Only rendered when there's more than one cart item - a
 * "buy now" purchase (a cart of one) shows exactly as a regular single-listing purchase
 * always has.
 *
 * Each item links to its browsable listing page: for products with variants that's the
 * primary listing (the transacted sibling itself is hidden), which is what
 * item.imageListingId points to; for other products it's the listing itself.
 *
 * @component
 * @param {Object} props
 * @param {Array<{listingId: string, title: string, quantity: number, imageListingId: string?}>} props.cartItems
 * @param {boolean} [props.showHeading] - set false where a surrounding heading already
 *   says "N items in this order" (e.g. the desktop detail card title)
 * @returns {JSX.Element}
 */
const CartItemsListMaybe = props => {
  const { cartItems, showHeading = true } = props;
  if (!Array.isArray(cartItems) || cartItems.length <= 1) {
    return null;
  }

  return (
    <div className={css.cartItemsList}>
      {showHeading ? (
        <>
          <H6 as="h3" className={css.cartItemsListHeading}>
            <FormattedMessage
              id="TransactionPanel.cartItemsHeading"
              values={{ count: cartItems.length }}
            />
          </H6>
          <hr className={css.totalDivider} />
        </>
      ) : null}
      <ul className={css.cartItemsListItems}>
        {cartItems.map((item, i) => {
          const browsableListingId = item.imageListingId || item.listingId;
          return (
            <li key={`${item.listingId}-${i}`} className={css.cartItemsListItem}>
              <NamedLink
                className={css.cartItemsListItemLink}
                name="ListingPage"
                params={{ id: browsableListingId, slug: createSlug(item.title || '') }}
              >
                <FormattedMessage
                  id="TransactionPanel.cartItemLine"
                  values={{ title: item.title, quantity: item.quantity }}
                />
              </NamedLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default CartItemsListMaybe;
