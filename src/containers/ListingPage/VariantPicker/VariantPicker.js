import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { VARIANT_ATTRIBUTE_CONFIG_KEY } from '../../../util/variantHelpers';

import css from './VariantPicker.module.css';

const distinctValues = (combos, key) => [...new Set(combos.map(c => c[key]).filter(Boolean))];

// Human-readable label for a raw option value (e.g. 'medium' -> 'M'), from the marketplace's
// listing fields config. Falls back to the raw value if the option is unknown.
const labelFor = (listingFieldsConfig, attributeKey, value) => {
  const configKey = VARIANT_ATTRIBUTE_CONFIG_KEY[attributeKey];
  const field = (listingFieldsConfig || []).find(f => f.key === configKey);
  return field?.enumOptions?.find(o => o.option === value)?.label || value;
};

/**
 * Lets the buyer pick a size/color combination without ever leaving this listing page - the
 * underlying listing (and its stock) that OrderPanel targets is swapped client-side instead.
 *
 * @component
 * @param {Object} props
 * @param {Array<{size, color}>} props.combos every combination this product offers
 * @param {Object} props.selection the currently selected { size, color }
 * @param {Function} props.onChange called with the new { size, color } selection
 * @param {Array} [props.listingFieldsConfig] listing fields config, for option labels
 * @param {boolean} [props.isUnavailable] whether a complete selection doesn't match a real listing
 * @param {boolean} [props.showSelectionRequired] whether to prompt for a selection (buyer tried to order without one)
 * @returns {JSX.Element}
 */
const VariantPicker = props => {
  const {
    className,
    rootClassName,
    combos,
    selection,
    onChange,
    listingFieldsConfig,
    isUnavailable,
    showSelectionRequired,
  } = props;
  const classes = classNames(rootClassName || css.root, className);

  const attributeGroups = [
    { key: 'size', labelId: 'VariantPicker.sizeLabel' },
    { key: 'color', labelId: 'VariantPicker.colorLabel' },
  ].map(group => ({ ...group, values: distinctValues(combos, group.key) }));

  return (
    <div className={classes}>
      {attributeGroups.map(({ key, labelId, values }) =>
        values.length > 0 ? (
          <div key={key} className={css.group}>
            <span className={css.label}>
              <FormattedMessage id={labelId} />
            </span>
            <div className={css.options}>
              {values.map(value => (
                <button
                  key={value}
                  type="button"
                  className={classNames(css.option, { [css.selected]: selection[key] === value })}
                  onClick={() => onChange({ ...selection, [key]: value })}
                >
                  {labelFor(listingFieldsConfig, key, value)}
                </button>
              ))}
            </div>
          </div>
        ) : null
      )}
      {isUnavailable ? (
        <p className={css.unavailable}>
          <FormattedMessage id="VariantPicker.combinationUnavailable" />
        </p>
      ) : showSelectionRequired ? (
        <p className={css.unavailable}>
          <FormattedMessage id="VariantPicker.selectionRequired" />
        </p>
      ) : null}
    </div>
  );
};

export default VariantPicker;
