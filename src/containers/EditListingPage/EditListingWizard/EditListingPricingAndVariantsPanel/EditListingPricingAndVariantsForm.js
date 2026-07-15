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
  FieldCheckbox,
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

// One optional photo per color: shown on the listing page when the buyer picks the color, and
// on their order. The picked File is uploaded (once per size-sibling of the color) at save time.
const FieldColorImage = props => {
  const { colorOption, colorLabel, existingImageUrl, formApi, values, intl } = props;
  const picked = values?.colorImages?.[colorOption];
  const previewUrl = picked?.previewUrl || existingImageUrl;
  const inputId = `colorImage.${colorOption}`;

  const onChange = event => {
    const file = event.target.files?.[0];
    if (file) {
      formApi.change(`colorImages.${colorOption}`, {
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    event.target.value = null;
  };

  return (
    <div className={css.colorImageRow}>
      {previewUrl ? (
        <img className={css.colorImagePreview} src={previewUrl} alt={colorLabel} />
      ) : (
        <div className={css.colorImagePlaceholder} />
      )}
      <span className={css.colorImageLabel}>{colorLabel}</span>
      <label htmlFor={inputId} className={css.colorImageButton}>
        {intl.formatMessage({
          id: previewUrl
            ? 'EditListingPricingAndVariantsForm.replacePhoto'
            : 'EditListingPricingAndVariantsForm.addPhoto',
        })}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        onChange={onChange}
        className={css.colorImageInput}
      />
    </div>
  );
};

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
        existingColorImages = {},
        saveActionMsg,
        updated,
        updateInProgress,
        fetchErrors,
        form: formApi,
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
      const sizeLabelFor = value => sizeOptions.find(o => o.key === value)?.label || value;
      const colorLabelFor = value => colorOptions.find(o => o.key === value)?.label || value;

      // When colors are configured, sizes are picked per color (values.sizesByColor.<color>),
      // so each color can have its own size subset (e.g. Green: S/M/L, White: M/L/XL) instead of
      // every color getting the full cross-product of every selected size.
      const hasColorOptions = colorOptions.length > 0;
      const selectedColors = values.colorOptions || [];
      const sizesByColor = values.sizesByColor || {};
      const selectedSizes = values.sizeOptions || [];
      const combinations = hasColorOptions
        ? selectedColors.flatMap(color => (sizesByColor[color] || []).map(size => ({ size, color })))
        : buildVariantCombinations({ size: selectedSizes });
      const hasCombinations = combinations.length > 0;

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

          {hasColorOptions ? (
            <>
              <div className={css.input}>
                <FieldCheckboxGroup
                  id={`${formId}.colorOptions`}
                  name="colorOptions"
                  label={intl.formatMessage({ id: 'EditListingPricingAndVariantsForm.colorsLabel' })}
                  options={colorOptions}
                />
              </div>

              {selectedColors.map(color => {
                const sizesForColor = sizesByColor[color] || [];
                return (
                  <div className={css.colorGroup} key={color}>
                    <h4 className={css.colorGroupHeading}>{colorLabelFor(color)}</h4>

                    {sizeOptions.length > 0 ? (
                      <div className={css.sizeRows}>
                        <span className={css.sizeRowsLabel}>
                          {intl.formatMessage({
                            id: 'EditListingPricingAndVariantsForm.sizesLabel',
                          })}
                        </span>
                        {sizeOptions.map(size => {
                          const isChecked = sizesForColor.includes(size.key);
                          const comboKey = variantComboKey({ size: size.key, color });
                          return (
                            <div className={css.sizeRow} key={size.key}>
                              <FieldCheckbox
                                id={`${formId}.sizesByColor.${color}.${size.key}`}
                                name={`sizesByColor.${color}`}
                                value={size.key}
                                label={size.label}
                              />
                              {isChecked ? (
                                <FieldTextInput
                                  className={css.sizeRowQuantity}
                                  id={`${formId}.quantities.${comboKey}`}
                                  name={`quantities.${comboKey}`}
                                  placeholder={intl.formatMessage({
                                    id: 'EditListingPricingAndVariantsForm.quantityPlaceholder',
                                  })}
                                  type="number"
                                  min={0}
                                  validate={validators.numberAtLeast(
                                    intl.formatMessage({
                                      id: 'EditListingPricingAndVariantsForm.stockIsRequired',
                                    }),
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
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className={css.colorPhotoSection}>
                      <FieldColorImage
                        colorOption={color}
                        colorLabel={colorLabelFor(color)}
                        existingImageUrl={existingColorImages[color]}
                        formApi={formApi}
                        values={values}
                        intl={intl}
                      />
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <>
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

              {hasCombinations ? (
                <div className={css.combinations}>
                  <FormattedMessage
                    id="EditListingPricingAndVariantsForm.quantitiesLabel"
                    tagName="h4"
                  />
                  {combinations.map(combo => {
                    const comboKey = variantComboKey(combo);
                    return (
                      <FieldTextInput
                        key={comboKey}
                        className={css.comboInput}
                        id={`${formId}.quantities.${comboKey}`}
                        name={`quantities.${comboKey}`}
                        label={sizeLabelFor(combo.size)}
                        type="number"
                        min={0}
                        validate={validators.numberAtLeast(
                          intl.formatMessage({
                            id: 'EditListingPricingAndVariantsForm.stockIsRequired',
                          }),
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
              ) : null}
            </>
          )}

          {!hasCombinations ? (
            <p className={css.hint}>
              <FormattedMessage id="EditListingPricingAndVariantsForm.selectAtLeastOne" />
            </p>
          ) : null}
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
