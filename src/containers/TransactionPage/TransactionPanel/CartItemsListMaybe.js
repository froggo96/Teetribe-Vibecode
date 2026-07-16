import React from 'react';
import { FormattedMessage } from '../../../util/reactIntl';

import css from './TransactionPanel.module.css';

/**
 * Lists every item in a cart order (a single-seller checkout covering multiple listings -
 * see src/util/cartHelpers.js) below the transacted (primary) listing's own detail card.
 * Only rendered when there's more than one cart item - a "buy now" purchase (a cart of
 * one) shows exactly as a regular single-listing purchase always has.
 *
 * @component
 * @param {Object} props
 * @param {Array<{listingId: string, title: string, quantity: number}>} props.cartItems
 * @returns {JSX.Element}
 */
const CartItemsListMaybe = props => {
  const { cartItems } = props;
  if (!Array.isArray(cartItems) || cartItems.length <= 1) {
    return null;
  }

  return (
    <div className={css.cartItemsList}>
      <h3 className={css.cartItemsListHeading}>
        <FormattedMessage
          id="TransactionPanel.cartItemsHeading"
          values={{ count: cartItems.length }}
        />
      </h3>
      <ul className={css.cartItemsListItems}>
        {cartItems.map((item, i) => (
          <li key={`${item.listingId}-${i}`} className={css.cartItemsListItem}>
            <FormattedMessage
              id="TransactionPanel.cartItemLine"
              values={{ title: item.title, quantity: item.quantity }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CartItemsListMaybe;
