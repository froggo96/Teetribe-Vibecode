import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';

import css from './VariantPicker.module.css';

const distinctValues = (combos, key) => [...new Set(combos.map(c => c[key]).filter(Boolean))];

/**
 * Lets the buyer pick a size/color combination without ever leaving this listing page - the
 * underlying listing (and its stock) that OrderPanel targets is swapped client-side instead.
 *
 * @component
 * @param {Object} props
 * @param {Array<{size, color}>} props.combos every combination this product offers
 * @param {Object} props.selection the currently selected { size, color }
 * @param {Function} props.onChange called with the new { size, color } selection
 * @param {boolean} [props.isUnavailable] whether the current selection doesn't match a real listing
 * @returns {JSX.Element}
 */
const VariantPicker = props => {
  const { className, rootClassName, combos, selection, onChange, isUnavailable } = props;
  const classes = classNames(rootClassName || css.root, className);

  const sizes = distinctValues(combos, 'size');
  const colors = distinctValues(combos, 'color');

  return (
    <div className={classes}>
      {sizes.length > 0 ? (
        <div className={css.group}>
          <span className={css.label}>
            <FormattedMessage id="VariantPicker.sizeLabel" />
          </span>
          <div className={css.options}>
            {sizes.map(size => (
              <button
                key={size}
                type="button"
                className={classNames(css.option, { [css.selected]: selection.size === size })}
                onClick={() => onChange({ ...selection, size })}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {colors.length > 0 ? (
        <div className={css.group}>
          <span className={css.label}>
            <FormattedMessage id="VariantPicker.colorLabel" />
          </span>
          <div className={css.options}>
            {colors.map(color => (
              <button
                key={color}
                type="button"
                className={classNames(css.option, { [css.selected]: selection.color === color })}
                onClick={() => onChange({ ...selection, color })}
              >
                {color}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {isUnavailable ? (
        <p className={css.unavailable}>
          <FormattedMessage id="VariantPicker.combinationUnavailable" />
        </p>
      ) : null}
    </div>
  );
};

export default VariantPicker;
