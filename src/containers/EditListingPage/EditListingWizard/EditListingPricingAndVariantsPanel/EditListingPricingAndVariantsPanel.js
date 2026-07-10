import React, { useState } from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT } from '../../../../util/types';
import { types as sdkTypes } from '../../../../util/sdkLoader';
import { isValidCurrencyForTransactionProcess } from '../../../../util/fieldHelpers';
import {
  pickVariantAttributeFields,
  buildVariantCombinations,
  variantComboKey,
  VARIANT_ATTRIBUTE_CONFIG_KEY,
} from '../../../../util/variantHelpers';

// Import shared components
import { H3, ListingLink } from '../../../../components';

// Import modules from this directory
import EditListingPricingAndVariantsForm from './EditListingPricingAndVariantsForm';
import css from './EditListingPricingAndVariantsPanel.module.css';

const { Money } = sdkTypes;

const getListingTypeConfig = (publicData, listingTypes) => {
  const selectedListingType = publicData.listingType;
  return listingTypes.find(conf => conf.listingType === selectedListingType);
};

// One entry per real listing behind this product: the primary listing itself plus every
// sibling, each carrying its own size/color combination and stock. A brand-new listing has no
// size/color yet, so it isn't a real combination until the seller picks one.
const existingCombosOf = (listing, variantSiblings) => {
  const publicData = listing?.attributes?.publicData || {};
  const primaryCombo = {
    size: publicData[VARIANT_ATTRIBUTE_CONFIG_KEY.size],
    color: publicData[VARIANT_ATTRIBUTE_CONFIG_KEY.color],
    listingId: listing?.id,
    currentStock: listing?.currentStock?.attributes?.quantity,
    isPrimary: true,
  };
  const siblingCombos = (variantSiblings || []).map(sibling => ({
    size: sibling.attributes?.publicData?.[VARIANT_ATTRIBUTE_CONFIG_KEY.size],
    color: sibling.attributes?.publicData?.[VARIANT_ATTRIBUTE_CONFIG_KEY.color],
    listingId: sibling.id,
    currentStock: sibling.currentStock?.attributes?.quantity,
    isPrimary: false,
  }));

  return [primaryCombo, ...siblingCombos].filter(c => c.size || c.color);
};

const getInitialValues = (listing, variantSiblings) => {
  const price = listing?.attributes?.price;
  const existingCombos = existingCombosOf(listing, variantSiblings);

  const sizeOptions = [...new Set(existingCombos.map(c => c.size).filter(Boolean))];
  const colorOptions = [...new Set(existingCombos.map(c => c.color).filter(Boolean))];
  const quantities = existingCombos.reduce((acc, c) => {
    acc[variantComboKey(c)] = c.currentStock != null ? c.currentStock : 0;
    return acc;
  }, {});

  return { price, sizeOptions, colorOptions, quantities };
};

/**
 * The EditListingPricingAndVariantsPanel component. Like EditListingPricingAndStockPanel, but for
 * listing types that offer size/color style variants: each combination is backed by its own
 * sibling listing (see src/util/variantHelpers.js), so it gets native, atomic stock reservation.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {propTypes.ownListing} props.listing - The listing object (the primary of its variant group)
 * @param {Array<propTypes.ownListing>} [props.variantSiblings] - The other combinations, when editing
 * @param {Array} props.listingFieldsConfig - The marketplace's listing fields config
 * @param {string} props.marketplaceCurrency - The marketplace currency (e.g. 'USD')
 * @param {number} props.listingMinimumPriceSubUnits - The listing minimum price sub units
 * @param {Array<propTypes.listingType>} props.listingTypes - The listing types
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {Function} props.onSubmit - The submit function
 * @param {string} props.submitButtonText - The submit button text
 * @param {boolean} props.panelUpdated - Whether the panel is updated
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {Object} props.errors - The errors object
 * @returns {JSX.Element}
 */
const EditListingPricingAndVariantsPanel = props => {
  const [state, setState] = useState({
    initialValues: getInitialValues(props.listing, props.variantSiblings),
    existingCombos: existingCombosOf(props.listing, props.variantSiblings),
  });

  const {
    className,
    rootClassName,
    listing,
    listingFieldsConfig,
    marketplaceCurrency,
    listingMinimumPriceSubUnits,
    listingTypes,
    disabled,
    ready,
    onSubmit,
    submitButtonText,
    panelUpdated,
    updateInProgress,
    errors,
    updatePageTitle: UpdatePageTitle,
    intl,
  } = props;

  const classes = classNames(rootClassName || css.root, className);
  const initialValues = state.initialValues;
  const existingCombos = state.existingCombos;

  const publicData = listing?.attributes?.publicData;
  const unitType = publicData.unitType;
  const listingTypeConfig = getListingTypeConfig(publicData, listingTypes);
  const transactionProcessAlias = listingTypeConfig.transactionType.alias;

  const variantFields = pickVariantAttributeFields(listingFieldsConfig);
  const sizeFieldConfig = variantFields.find(f => f.key === VARIANT_ATTRIBUTE_CONFIG_KEY.size);
  const colorFieldConfig = variantFields.find(f => f.key === VARIANT_ATTRIBUTE_CONFIG_KEY.color);

  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;

  const isStripeCompatibleCurrency = isValidCurrencyForTransactionProcess(
    transactionProcessAlias,
    marketplaceCurrency,
    'stripe'
  );
  const priceCurrencyValid = !isStripeCompatibleCurrency
    ? false
    : marketplaceCurrency && initialValues.price instanceof Money
    ? initialValues.price?.currency === marketplaceCurrency
    : !!marketplaceCurrency;

  const panelHeadingProps = isPublished
    ? {
        id: 'EditListingPricingAndVariantsPanel.title',
        values: { listingTitle: <ListingLink listing={listing} />, lineBreak: <br /> },
        messageProps: { listingTitle: listing.attributes.title },
      }
    : {
        id: 'EditListingPricingAndVariantsPanel.createListingTitle',
        values: { lineBreak: <br /> },
        messageProps: {},
      };

  return (
    <main className={classes}>
      <UpdatePageTitle
        panelHeading={intl.formatMessage(
          { id: panelHeadingProps.id },
          { ...panelHeadingProps.messageProps }
        )}
      />
      <H3 as="h1">
        <FormattedMessage id={panelHeadingProps.id} values={{ ...panelHeadingProps.values }} />
      </H3>
      {priceCurrencyValid ? (
        <EditListingPricingAndVariantsForm
          className={css.form}
          initialValues={initialValues}
          onSubmit={values => {
            const { price, sizeOptions = [], colorOptions = [], quantities = {} } = values;

            // The combination currently assigned to this exact listing (the page being edited)
            // can't be removed here - it isn't a closeable sibling, it's this listing itself.
            // Guarantee it always survives into the submitted combinations regardless of
            // checkbox state.
            const currentPrimary = existingCombos.find(c => c.isPrimary);
            const effectiveSizes =
              currentPrimary?.size && !sizeOptions.includes(currentPrimary.size)
                ? [...sizeOptions, currentPrimary.size]
                : sizeOptions;
            const effectiveColors =
              currentPrimary?.color && !colorOptions.includes(currentPrimary.color)
                ? [...colorOptions, currentPrimary.color]
                : colorOptions;

            const combinations = buildVariantCombinations({
              size: effectiveSizes,
              color: effectiveColors,
            });
            const existingByKey = existingCombos.reduce((acc, c) => {
              acc[variantComboKey(c)] = c;
              return acc;
            }, {});

            const variantCombinations = combinations.map(combo => {
              const comboKey = variantComboKey(combo);
              const existing = existingByKey[comboKey];
              const quantity = Number.parseInt(quantities[comboKey], 10) || 0;
              const hasNoCurrentStock = existing?.currentStock == null;
              const oldTotal = existing ? (hasNoCurrentStock ? null : existing.currentStock) : null;

              return {
                ...combo,
                isPrimary: !!existing?.isPrimary,
                existingListingId: existing ? existing.listingId : undefined,
                stockUpdate: { oldTotal, newTotal: quantity },
              };
            });

            // Brand-new listing: nothing is primary yet, so the first combination takes over
            // this listing's own identity.
            if (!variantCombinations.some(c => c.isPrimary) && variantCombinations.length > 0) {
              variantCombinations[0] = { ...variantCombinations[0], isPrimary: true };
            }

            const removedVariantListingIds = existingCombos
              .filter(c => !c.isPrimary)
              .filter(c => !combinations.some(combo => variantComboKey(combo) === variantComboKey(c)))
              .map(c => c.listingId);

            setState({
              initialValues: { price, sizeOptions: effectiveSizes, colorOptions: effectiveColors, quantities },
              existingCombos: variantCombinations.map(c => ({
                size: c.size,
                color: c.color,
                listingId: c.existingListingId || (c.isPrimary ? listing.id : null),
                currentStock: c.stockUpdate.newTotal,
                isPrimary: c.isPrimary,
              })),
            });

            onSubmit({ price, variantCombinations, removedVariantListingIds });
          }}
          listingMinimumPriceSubUnits={listingMinimumPriceSubUnits}
          marketplaceCurrency={marketplaceCurrency}
          listingType={listingTypeConfig}
          unitType={unitType}
          sizeFieldConfig={sizeFieldConfig}
          colorFieldConfig={colorFieldConfig}
          saveActionMsg={submitButtonText}
          disabled={disabled}
          ready={ready}
          updated={panelUpdated}
          updateInProgress={updateInProgress}
          fetchErrors={errors}
        />
      ) : (
        <div className={css.priceCurrencyInvalid}>
          <FormattedMessage
            id="EditListingPricingAndVariantsPanel.listingPriceCurrencyInvalid"
            values={{ marketplaceCurrency }}
          />
        </div>
      )}
    </main>
  );
};

export default EditListingPricingAndVariantsPanel;
