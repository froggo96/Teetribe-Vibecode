import React from 'react';
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { propTypes } from '../../util/types';

import css from './OrderBreakdown.module.css';

/**
 * Renders one row per item in a cart order (a single-seller checkout covering multiple
 * listings from the shopping cart - see src/util/cartHelpers.js), labeled with each
 * listing's title. Line items don't carry listing ids, so titles come from
 * transaction.attributes.protectedData.cartItems, zipped with the unit line items by
 * index - the server builds both arrays in the same order (see
 * server/api-util/cartLineItems.js). Falls back to a plain quantity-only label (matching
 * a regular single-item purchase) if the counts ever don't match.
 *
 * @component
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems - The line items to render
 * @param {propTypes.lineItemUnitType} props.code - The unit line item code, e.g. 'line-item/item'
 * @param {Array<{listingId: string, title: string, quantity: number}>} props.cartItems
 * @param {intlShape} props.intl - The intl object
 * @returns {JSX.Element}
 */
const LineItemCartItemsMaybe = props => {
  const { lineItems, code, cartItems, intl } = props;
  const unitLines = lineItems.filter(item => item.code === code && !item.reversal);

  if (unitLines.length === 0) {
    return null;
  }

  const canLabelByTitle = cartItems?.length === unitLines.length;

  return (
    <React.Fragment>
      {unitLines.map((line, i) => {
        const quantity = line.quantity ? line.quantity.toString() : null;
        const unitPrice = formatMoney(intl, line.unitPrice);
        const total = formatMoney(intl, line.lineTotal);
        const title = canLabelByTitle ? cartItems[i]?.title : null;

        return (
          <div key={`${i}-${line.code}`} className={css.lineItem}>
            <span className={css.itemLabel}>
              {title ? (
                <FormattedMessage
                  id="OrderBreakdown.cartItemLine"
                  values={{ title, unitPrice, quantity }}
                />
              ) : (
                <FormattedMessage
                  id="OrderBreakdown.baseUnitQuantity"
                  values={{ unitPrice, quantity }}
                />
              )}
            </span>
            <span className={css.itemValue}>{total}</span>
          </div>
        );
      })}
    </React.Fragment>
  );
};

export default LineItemCartItemsMaybe;
