import React, { useState, useEffect } from 'react';
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
  PRIMARY_VARIANT_IMAGE_KEY,
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

// Groups existing combos by color, e.g. { Green: ['S', 'M'], White: ['M', 'L', 'XL'] } - each
// color remembers only the sizes it actually has, rather than every color being assumed to have
// every size ever used across the whole product (which is what the old flat sizeOptions/
// colorOptions union did, and is exactly the bug that made re-editing a listing produce
// unwanted extra combinations).
const sizesByColorOf = existingCombos =>
  existingCombos.reduce((acc, c) => {
    if (!c.color) return acc;
    const sizes = acc[c.color] || [];
    acc[c.color] = c.size && !sizes.includes(c.size) ? [...sizes, c.size] : sizes;
    return acc;
  }, {});

const getInitialValues = (listing, variantSiblings) => {
  const price = listing?.attributes?.price;
  const existingCombos = existingCombosOf(listing, variantSiblings);

  const sizeOptions = [...new Set(existingCombos.map(c => c.size).filter(Boolean))];
  const colorOptions = [...new Set(existingCombos.map(c => c.color).filter(Boolean))];
  const sizesByColor = sizesByColorOf(existingCombos);
  const quantities = existingCombos.reduce((acc, c) => {
    acc[variantComboKey(c)] = c.currentStock != null ? c.currentStock : 0;
    return acc;
  }, {});

  return { price, sizeOptions, colorOptions, sizesByColor, quantities };
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

  // Sibling listings are fetched asynchronously (loadData doesn't await them), so they can land
  // after this panel has mounted and snapshotted its combos. Without this refresh, a save made
  // from that stale snapshot would treat every existing combination as new and create duplicate
  // sibling listings. Only refresh while the snapshot has no sibling combos yet - once it does
  // (or after the first save in this session), the snapshot is authoritative.
  const siblingCount = props.variantSiblings?.length || 0;
  useEffect(() => {
    setState(prev => {
      const hasSiblingCombos = prev.existingCombos.some(c => !c.isPrimary);
      return hasSiblingCombos || siblingCount === 0
        ? prev
        : {
            initialValues: getInitialValues(props.listing, props.variantSiblings),
            existingCombos: existingCombosOf(props.listing, props.variantSiblings),
          };
    });
  }, [siblingCount]);

  const {
    className,
    rootClassName,
    listing,
    variantSiblings,
    listingFieldsConfig,
    listingImageConfig,
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
  const labelOf = (fieldConfig, value) =>
    fieldConfig?.enumOptions?.find(o => o.option === value)?.label || value;

  // Existing per-color photo (if any sibling of that color already carries one), for display
  // in the form. Sibling images were fetched with the listing-card variants included.
  const variantPrefix = listingImageConfig?.variantPrefix || 'listing-card';
  const firstImageUrlOf = l => {
    const imageVariants = l?.images?.[0]?.attributes?.variants;
    return imageVariants?.[variantPrefix]?.url || Object.values(imageVariants || {})[0]?.url;
  };
  const siblingColorImages = (variantSiblings || []).reduce((acc, sibling) => {
    const color = sibling.attributes?.publicData?.[VARIANT_ATTRIBUTE_CONFIG_KEY.color];
    const url = firstImageUrlOf(sibling);
    if (color && url && !acc[color]) {
      acc[color] = url;
    }
    return acc;
  }, {});
  // The primary's own color photo lives in its gallery, marked by publicData.variantImageId
  // (which may dangle if that image was removed on the Photos tab - hence the existence check).
  const primaryCombo = existingCombos.find(c => c.isPrimary);
  const primaryColor = primaryCombo?.color;
  const primaryVariantImageId =
    listing?.attributes?.publicData?.[PRIMARY_VARIANT_IMAGE_KEY];
  const primaryVariantImage = (listing?.images || []).find(
    img => img.id?.uuid === primaryVariantImageId
  );
  const primaryVariantImageUrl =
    primaryVariantImage?.attributes?.variants?.[variantPrefix]?.url ||
    Object.values(primaryVariantImage?.attributes?.variants || {})[0]?.url;
  const existingColorImages = {
    ...(primaryColor && primaryVariantImageUrl ? { [primaryColor]: primaryVariantImageUrl } : {}),
    ...siblingColorImages,
  };

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
            const {
              price,
              sizeOptions = [],
              colorOptions = [],
              sizesByColor = {},
              quantities = {},
              colorImages = {},
            } = values;

            // The combination currently assigned to this exact listing (the page being edited)
            // can't be removed here - it isn't a closeable sibling, it's this listing itself.
            // Guarantee it always survives into the submitted combinations regardless of
            // checkbox state.
            const currentPrimary = existingCombos.find(c => c.isPrimary);
            const hasColorOptions = !!colorFieldConfig;

            // Grouped case: each color keeps only its own picked sizes (sizesByColor), instead of
            // every selected color getting the full cross-product of every selected size.
            // Fallback case (no color field configured for this listing type at all): unchanged
            // flat size-only behavior.
            const effectiveColors =
              currentPrimary?.color && !colorOptions.includes(currentPrimary.color)
                ? [...colorOptions, currentPrimary.color]
                : colorOptions;
            const effectiveSizesByColor = { ...sizesByColor };
            if (currentPrimary?.color) {
              const sizesForPrimaryColor = effectiveSizesByColor[currentPrimary.color] || [];
              effectiveSizesByColor[currentPrimary.color] =
                currentPrimary.size && !sizesForPrimaryColor.includes(currentPrimary.size)
                  ? [...sizesForPrimaryColor, currentPrimary.size]
                  : sizesForPrimaryColor;
            }
            const effectiveSizes =
              currentPrimary?.size && !sizeOptions.includes(currentPrimary.size)
                ? [...sizeOptions, currentPrimary.size]
                : sizeOptions;

            const combinations = hasColorOptions
              ? effectiveColors.flatMap(color =>
                  (effectiveSizesByColor[color] || []).map(size => ({ size, color }))
                )
              : buildVariantCombinations({ size: effectiveSizes });

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
              const isPrimary = !!existing?.isPrimary;

              return {
                ...combo,
                isPrimary,
                existingListingId: existing ? existing.listingId : undefined,
                stockUpdate: { oldTotal, newTotal: quantity },
                // Human-readable labels, used to build sibling listing titles like
                // "Plain t-shirts (M / White)" so the variant shows up on orders.
                sizeLabel: combo.size ? labelOf(sizeFieldConfig, combo.size) : null,
                colorLabel: combo.color ? labelOf(colorFieldConfig, combo.color) : null,
                // Per-color photo picked in this session, if any. Siblings get it attached as
                // their own image; for the primary combo it's appended to the gallery and
                // tracked via publicData.variantImageId (see EditListingPage.duck.js).
                newColorImageFile: colorImages[combo.color]?.file || null,
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
              initialValues: {
                price,
                sizeOptions: effectiveSizes,
                colorOptions: effectiveColors,
                sizesByColor: effectiveSizesByColor,
                quantities,
              },
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
          existingColorImages={existingColorImages}
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
