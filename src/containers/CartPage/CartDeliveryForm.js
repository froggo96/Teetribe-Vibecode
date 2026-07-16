import React from 'react';

import { FormattedMessage, useIntl } from '../../util/reactIntl';

import css from './CartDeliveryForm.module.css';

/**
 * Delivery method selector for one seller group in the cart. Only one delivery method
 * applies to the whole group (the group is checked out as a single order), so only the
 * methods every listing in the group supports are offered.
 *
 * @component
 * @param {Object} props
 * @param {Array<'pickup'|'shipping'>} props.sharedMethods - methods every listing in the group supports
 * @param {'pickup'|'shipping'|null} props.selectedMethod
 * @param {Function} props.onChange - (method) => void
 * @param {boolean?} props.disabled
 * @returns {JSX.Element}
 */
const CartDeliveryForm = props => {
  const { sharedMethods, selectedMethod, onChange, disabled } = props;
  const intl = useIntl();

  if (sharedMethods.length === 0) {
    return (
      <p className={css.noSharedMethod}>
        <FormattedMessage id="CartDeliveryForm.noSharedDeliveryMethod" />
      </p>
    );
  }

  if (sharedMethods.length === 1) {
    const onlyMethod = sharedMethods[0];
    return (
      <div className={css.root}>
        <span className={css.label}>
          <FormattedMessage id="ProductOrderForm.deliveryMethodLabel" />
        </span>
        <p className={css.singleMethod}>
          {onlyMethod === 'shipping' ? (
            <FormattedMessage id="ProductOrderForm.shippingOption" />
          ) : (
            <FormattedMessage id="ProductOrderForm.pickupOption" />
          )}
        </p>
      </div>
    );
  }

  return (
    <div className={css.root}>
      <label className={css.label} htmlFor="cartDeliveryMethod">
        <FormattedMessage id="ProductOrderForm.deliveryMethodLabel" />
      </label>
      <select
        id="cartDeliveryMethod"
        className={css.select}
        value={selectedMethod || ''}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      >
        <option disabled value="">
          {intl.formatMessage({ id: 'ProductOrderForm.selectDeliveryMethodOption' })}
        </option>
        {sharedMethods.includes('shipping') ? (
          <option value="shipping">
            {intl.formatMessage({ id: 'ProductOrderForm.shippingOption' })}
          </option>
        ) : null}
        {sharedMethods.includes('pickup') ? (
          <option value="pickup">{intl.formatMessage({ id: 'ProductOrderForm.pickupOption' })}</option>
        ) : null}
      </select>
    </div>
  );
};

export default CartDeliveryForm;
