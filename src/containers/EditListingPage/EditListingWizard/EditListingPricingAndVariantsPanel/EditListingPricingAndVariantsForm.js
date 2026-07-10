import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';

// Import configs and util modules
import appSettings from '../../../../config/settings';
import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import { isOldTotalMismatchStockError } from '../../../../util/errors';
import * as validators from '../../../../util/validators';
import { formatMoney } from '../../../../util/currency';
import { types as sdkTypes } from '../../../../util/sdkLoader';
import { buildVariantCombinations, variantComboKey } from '../../../../util/variantHelpers';

// Import shared components
import {
  Button,
  Form,
  FieldCurrencyInput,
  FieldCheckboxGroup,
  FieldTextInput,
} from '../../../../components';

// Import modules from this directory
import css from './EditListingPricingAndVariantsForm.module.css';

const { Money } = sdkTypes;

const getPriceValidators = (listingMinimumPriceSubUnits, marketplaceCurrency, intl) => {
  const priceRequiredMsgId = { id: 'EditListingPricingAndVariantsForm.priceRequired' };
  const priceRequiredMsg = intl.formatMessage(priceRequiredMsgId);
  const priceRequired = validators.required(priceRequiredMsg);

  const minPriceRaw = new Money(listingMinimumPriceSubUnits, marketplaceCurrency);
  const minPrice = formatMoney(intl, minPriceRaw);
  const priceTooLowMsgId = { id: 'EditListingPricingAndVariantsForm.priceTooLow' };
  const priceTooLowMsg = intl.formatMessage(priceTooLowMsgId, { minPrice });
  const minPriceRequired = validators.moneySubUnitAmountAtLeast(
    priceTooLowMsg,
    listingMinimumPriceSubUnits
  );

  return listingMinimumPriceSubUnits
    ? validators.composeValidators(priceRequired, minPriceRequired)
    : priceRequired;
};

const optionsFor = enumOptions => (enumOptions || []).map(o => ({ key: o.option, label: o.label }));

/**
 * The EditListingPricingAndVariantsForm component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.formId] - The form id
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {Object} [props.sizeFieldConfig] - The "size" listing field config (enumOptions)
 * @param {Object} [props.colorFieldConfig] - The "color" listing field config (enumOptions)
 * @param {string} props.marketplaceCurrency - The marketplace currency (e.g. 'USD')
 * @param {number} props.listingMinimumPriceSubUnits - The listing minimum price sub units
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {boolean} props.updated - Whether the form is updated
 * @param {boolean} props.updateInProgress - Whether the form is updating
 * @param {Object} props.fetchErrors - The fetch errors
 * @param {Function} props.onSubmit - The submit function
 * @param {string} props.saveActionMsg - The save action message
 * @returns {JSX.Element}
 */
export const EditListingPricingAndVariantsForm = props => (
  <FinalForm
    {...props}
    mutators={{ ...arrayMutators }}
    render={formRenderProps => {
      const {
        formId = 'EditListingPricingAndVariantsForm',
        className,
        rootClassName,
        disabled,
        ready,
        handleSubmit,
        invalid,
        pristine,
        marketplaceCurrency,
        listingMinimumPriceSubUnits = 0,
        sizeFieldConfig,
        colorFieldConfig,
        saveActionMsg,
        updated,
        updateInProgress,
        fetchErrors,
        values,
      } = formRenderProps;

      const intl = useIntl();
      const priceValidators = getPriceValidators(
        listingMinimumPriceSubUnits,
        marketplaceCurrency,
        intl
      );

      const sizeOptions = optionsFor(sizeFieldConfig?.enumOptions);
      const colorOptions = optionsFor(colorFieldConfig?.enumOptions);

      const selectedSizes = values.sizeOptions || [];
      const selectedColors = values.colorOptions || [];
      const hasCombinations = selectedSizes.length > 0 || selectedColors.length > 0;
      const combinations = hasCombinations
        ? buildVariantCombinations({ size: selectedSizes, color: selectedColors })
        : [];

      const classes = classNames(rootClassName || css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      const submitDisabled = invalid || disabled || submitInProgress || !hasCombinations;
      const { updateListingError, showListingsError, setStockError } = fetchErrors || {};

      const stockErrorMessage = isOldTotalMismatchStockError(setStockError)
        ? intl.formatMessage({ id: 'EditListingPricingAndVariantsForm.oldStockTotalWasOutOfSync' })
        : intl.formatMessage({ id: 'EditListingPricingAndVariantsForm.stockUpdateFailed' });

      return (
        <Form onSubmit={handleSubmit} className={classes}>
          {updateListingError ? (
            <p className={css.error}>
              <FormattedMessage id="EditListingPricingAndVariantsForm.updateFailed" />
            </p>
          ) : null}
          {showListingsError ? (
            <p className={css.error}>
              <FormattedMessage id="EditListingPricingAndVariantsForm.showListingFailed" />
            </p>
          ) : null}

          <FieldCurrencyInput
            id={`${formId}.price`}
            name="price"
            className={css.input}
            label={intl.formatMessage({ id: 'EditListingPricingAndVariantsForm.pricePerProduct' })}
            placeholder={intl.formatMessage({
              id: 'EditListingPricingAndVariantsForm.priceInputPlaceholder',
            })}
            currencyConfig={appSettings.getCurrencyFormatting(marketplaceCurrency)}
            validate={priceValidators}
          />

          {sizeOptions.length > 0 ? (
            <div className={css.input}>
              <FieldCheckboxGroup
                id={`${formId}.sizeOptions`}
                name="sizeOptions"
                label={intl.formatMessage({ id: 'EditListingPricingAndVariantsForm.sizesLabel' })}
                options={sizeOptions}
              />
            </div>
          ) : null}

          {colorOptions.length > 0 ? (
            <div className={css.input}>
              <FieldCheckboxGroup
                id={`${formId}.colorOptions`}
                name="colorOptions"
                label={intl.formatMessage({ id: 'EditListingPricingAndVariantsForm.colorsLabel' })}
                options={colorOptions}
              />
            </div>
          ) : null}

          {!hasCombinations ? (
            <p className={css.hint}>
              <FormattedMessage id="EditListingPricingAndVariantsForm.selectAtLeastOne" />
            </p>
          ) : (
            <div className={css.combinations}>
              <FormattedMessage id="EditListingPricingAndVariantsForm.quantitiesLabel" tagName="h4" />
              {combinations.map(combo => {
                const comboKey = variantComboKey(combo);
                const comboLabel = [combo.size, combo.color].filter(Boolean).join(' / ');
                return (
                  <FieldTextInput
                    key={comboKey}
                    className={css.comboInput}
                    id={`${formId}.quantities.${comboKey}`}
                    name={`quantities.${comboKey}`}
                    label={comboLabel}
                    type="number"
                    min={0}
                    validate={validators.numberAtLeast(
                      intl.formatMessage({ id: 'EditListingPricingAndVariantsForm.stockIsRequired' }),
                      0
                    )}
                    onWheel={e => {
                      if (e.target === document.activeElement) {
                        e.target.blur();
                        setTimeout(() => {
                          e.target.focus();
                        }, 0);
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
          {setStockError ? <p className={css.error}>{stockErrorMessage}</p> : null}

          <Button
            className={css.submitButton}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
            ready={submitReady}
          >
            {saveActionMsg}
          </Button>
        </Form>
      );
    }}
  />
);

export default EditListingPricingAndVariantsForm;
