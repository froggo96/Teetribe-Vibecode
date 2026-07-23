/**
 * CSV parsing + validation for the bulk listing importer (src/containers/BulkImportListingsPage).
 * Pure/synchronous by design: turning a validated row into real listings (fetching image URLs,
 * calling the Marketplace API) is the importer duck's job, not this module's - this file only
 * parses a CSV file into rows, groups rows into products, and validates+shapes each group against
 * this marketplace's *actual* hosted config (config.listing.listingTypes/listingFields and
 * config.categoryConfiguration, read via useConfiguration() - never hardcoded here).
 *
 * One CSV row = one listing (one size/color combination, or the sole row of a plain product).
 * Rows sharing a `groupKey` become one primary listing + sibling listings (see variantImport.js).
 */
import Papa from 'papaparse';
import { types as sdkTypes } from './sdkLoader';
import { unitDivisor, convertUnitToSubUnit } from './currency';
import { isValidField, pickCategoryFields } from './fieldHelpers';
import { displayDescription, displayPrice, displayDeliveryShipping, requireListingImage } from './configHelpers';
import { SCHEMA_TYPE_MULTI_ENUM, SCHEMA_TYPE_LONG, SCHEMA_TYPE_BOOLEAN, STOCK_INFINITE_ITEMS } from './types';
import { VARIANT_ATTRIBUTE_CONFIG_KEY, hasVariants, excludeVariantAttributeFields } from './variantHelpers';

const { Money } = sdkTypes;

// A stock value used for listing types whose stockType is one of the "infinite" variants -
// mirrors EditListingPricingAndStockPanel's own BILLIARD constant for the same stock types.
const BILLIARD = 1e15;

const MULTI_VALUE_SEPARATOR = '|';

// Columns with fixed meaning - never treated as a dynamic custom listing field column.
const RESERVED_COLUMNS = [
  'groupKey',
  'isPrimary',
  'title',
  'description',
  'listingType',
  'categoryLevel1',
  'categoryLevel2',
  'categoryLevel3',
  'price',
  'stock',
  'size',
  'color',
  'imageUrl',
  'additionalImageUrls',
  'shippingEnabled',
  'shippingPriceInSubunitsOneItem',
  'shippingPriceInSubunitsAdditionalItems',
];

const truthy = value => /^(yes|true|1)$/i.test((value || '').toString().trim());

const splitMultiValue = value =>
  (value || '')
    .split(MULTI_VALUE_SEPARATOR)
    .map(s => s.trim())
    .filter(Boolean);

/**
 * Parse a File (from an <input type=file>) into an array of row objects keyed by header.
 * @param {File} file
 * @returns {Promise<Array<Object>>}
 */
export const parseCsvFile = file =>
  new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      transform: v => (typeof v === 'string' ? v.trim() : v),
      complete: results => resolve(results.data),
      error: reject,
    });
  });

/**
 * Group parsed rows by groupKey (rows without one are treated as their own single-row group),
 * tagging each row with a 1-based rowNumber for user-facing error messages (header is row 1).
 *
 * @param {Array<Object>} rows as returned by parseCsvFile
 * @returns {Array<{groupKey: string, rows: Array, primaryRow: Object, usedFallbackPrimary: boolean}>}
 */
export const groupRows = rows => {
  const taggedRows = rows.map((row, index) => ({ ...row, __rowNumber: index + 2 }));
  const groups = [];
  const byKey = new Map();
  taggedRows.forEach(row => {
    const key = row.groupKey || `__ungrouped_${row.__rowNumber}`;
    if (!byKey.has(key)) {
      const group = { groupKey: key, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).rows.push(row);
  });
  return groups.map(group => {
    const explicitPrimary = group.rows.find(r => truthy(r.isPrimary));
    const primaryRow = explicitPrimary || group.rows[0];
    return {
      ...group,
      primaryRow,
      usedFallbackPrimary: !explicitPrimary && group.rows.length > 1,
    };
  });
};

const coerceCustomFieldValue = (fieldConfig, rawValue) => {
  if (rawValue === '' || rawValue == null) {
    return undefined;
  }
  switch (fieldConfig.schemaType) {
    case SCHEMA_TYPE_MULTI_ENUM:
      return splitMultiValue(rawValue);
    case SCHEMA_TYPE_LONG: {
      const n = Number(rawValue);
      return Number.isFinite(n) ? Math.trunc(n) : rawValue;
    }
    case SCHEMA_TYPE_BOOLEAN:
      return truthy(rawValue);
    default:
      return rawValue;
  }
};

const parseMoney = (priceString, currency) =>
  new Money(convertUnitToSubUnit(priceString, unitDivisor(currency)), currency);

const isNonNegativeInteger = value => {
  const n = Number(value);
  return value !== '' && value != null && Number.isInteger(n) && n >= 0;
};

/**
 * Validate one product group against the marketplace's live config and, if valid, build the
 * plan the importer duck needs to actually create it (see BulkImportListingsPage.duck.js).
 *
 * @param {Object} group one entry from groupRows()
 * @param {Object} config app config from useConfiguration()
 * @returns {{groupKey: string, errors: Array<{rowNumber:number, field:string, message:string}>, plan: Object|null}}
 */
export const validateGroup = (group, config) => {
  const { primaryRow, rows, usedFallbackPrimary } = group;
  const errors = [];
  const addError = (row, field, message) => errors.push({ rowNumber: row.__rowNumber, field, message });

  if (usedFallbackPrimary) {
    addError(primaryRow, 'isPrimary', 'No row in this group is marked isPrimary - defaulted to the first row.');
  }

  const listingTypeConfig = (config.listing.listingTypes || []).find(
    t => t.listingType === primaryRow.listingType
  );
  if (!listingTypeConfig) {
    addError(primaryRow, 'listingType', `Unknown listingType "${primaryRow.listingType}".`);
    return { groupKey: group.groupKey, rowCount: rows.length, errors, plan: null };
  }

  if (!primaryRow.title) {
    addError(primaryRow, 'title', 'Title is required.');
  }
  if (displayDescription(listingTypeConfig) && !primaryRow.description) {
    addError(primaryRow, 'description', 'Description is required for this listing type.');
  }

  // Categories: validate categoryLevel1/2/3 against the live category tree, level by level.
  const { key: categoryKey, categoryLevelKeys, categories } = config.categoryConfiguration;
  const categoryInput = Object.fromEntries(
    categoryLevelKeys.map(k => [k, primaryRow[k]]).filter(([, v]) => v)
  );
  const pickedCategories = pickCategoryFields(categoryInput, categoryKey, 1, categories);
  categoryLevelKeys.forEach(k => {
    if (categoryInput[k] && !(k in pickedCategories)) {
      addError(primaryRow, k, `"${categoryInput[k]}" is not a valid category for ${k}.`);
    }
  });

  // Price: shared across the whole product group (every combination shares one listing price -
  // createOrUpdateVariantGroup in variantImport.js applies a single `price` to every sibling), so
  // it's read from the primary row only; other rows must leave it blank or match exactly.
  let price = null;
  if (displayPrice(listingTypeConfig)) {
    if (!primaryRow.price) {
      addError(primaryRow, 'price', 'Price is required for this listing type.');
    } else {
      try {
        price = parseMoney(primaryRow.price, config.currency);
      } catch (e) {
        addError(primaryRow, 'price', `Invalid price "${primaryRow.price}": ${e.message}`);
      }
    }
    rows
      .filter(r => r !== primaryRow && r.price && r.price !== primaryRow.price)
      .forEach(r =>
        addError(
          r,
          'price',
          'Every row in a product group shares one price - set it on the primary row and leave other rows blank.'
        )
      );
  }

  // Delivery: v1 only supports shipping (pickup needs a geocoded location, out of scope).
  const shippingEnabled = truthy(primaryRow.shippingEnabled);
  if (displayDeliveryShipping(listingTypeConfig) && !shippingEnabled) {
    addError(
      primaryRow,
      'shippingEnabled',
      'This importer only supports shipping-enabled listings - set shippingEnabled to "yes".'
    );
  }
  if (truthy(primaryRow.pickupEnabled)) {
    addError(primaryRow, 'pickupEnabled', 'Pickup listings are not supported by this importer yet - use the regular listing editor.');
  }
  // Unlike `price` (a top-level Money-typed attribute), these two are publicData fields whose
  // name says exactly what they store - a plain subunit integer (e.g. 500 for a $5.00 fee), not
  // an sdkTypes.Money instance (confirmed against EditListingDeliveryPanel.js, which unwraps its
  // own Money-typed form field back to `.amount` before saving - the Marketplace API rejects a
  // Money object here with a "some-matching-condition?" validation error).
  let shippingPriceOneItem = null;
  let shippingPriceAdditional = null;
  if (shippingEnabled) {
    if (!isNonNegativeInteger(primaryRow.shippingPriceInSubunitsOneItem)) {
      addError(
        primaryRow,
        'shippingPriceInSubunitsOneItem',
        `Must be a non-negative whole number of subunits (e.g. 500 for $5.00), got "${primaryRow.shippingPriceInSubunitsOneItem}".`
      );
    } else {
      shippingPriceOneItem = Number(primaryRow.shippingPriceInSubunitsOneItem);
    }
    if (primaryRow.shippingPriceInSubunitsAdditionalItems) {
      if (!isNonNegativeInteger(primaryRow.shippingPriceInSubunitsAdditionalItems)) {
        addError(
          primaryRow,
          'shippingPriceInSubunitsAdditionalItems',
          `Must be a non-negative whole number of subunits, got "${primaryRow.shippingPriceInSubunitsAdditionalItems}".`
        );
      } else {
        shippingPriceAdditional = Number(primaryRow.shippingPriceInSubunitsAdditionalItems);
      }
    }
  }

  // Custom listing fields: any CSV column matching a configured field key that isn't one of this
  // importer's own reserved columns and isn't a variant-managed key (size/color/bookkeeping).
  const customFieldConfigs = excludeVariantAttributeFields(config.listing.listingFields || []).filter(
    f => !RESERVED_COLUMNS.includes(f.key)
  );
  const publicCustom = {};
  const privateCustom = {};
  customFieldConfigs.forEach(fieldConfig => {
    if (!(fieldConfig.key in primaryRow)) return;
    const coerced = coerceCustomFieldValue(fieldConfig, primaryRow[fieldConfig.key]);
    if (coerced === undefined) return;
    (fieldConfig.scope === 'private' ? privateCustom : publicCustom)[fieldConfig.key] = coerced;
  });
  const candidatePublicData = { listingType: primaryRow.listingType, ...pickedCategories, ...publicCustom };
  customFieldConfigs.forEach(fieldConfig => {
    const fieldData = fieldConfig.scope === 'private' ? privateCustom : candidatePublicData;
    if (!isValidField(fieldConfig, fieldData, candidatePublicData, config)) {
      addError(
        primaryRow,
        fieldConfig.key,
        `"${fieldConfig.saveConfig?.label || fieldConfig.key}" is required for this listing type/category.`
      );
    }
  });

  // Variants: this marketplace's product-variants feature (variantHelpers.js) is a hard opt-in
  // per listingType. If this listing type supports it, every row needs a size AND color (there's
  // no supported "some combos have a color, some don't" state - the seller UI itself requires
  // picking at least one size per chosen color).
  const variantsSupported = hasVariants(listingTypeConfig);
  const sizeKey = VARIANT_ATTRIBUTE_CONFIG_KEY.size;
  const colorKey = VARIANT_ATTRIBUTE_CONFIG_KEY.color;
  const sizeField = (config.listing.listingFields || []).find(f => f.key === sizeKey);
  const colorField = (config.listing.listingFields || []).find(f => f.key === colorKey);
  const labelFor = (field, value) => field?.enumOptions?.find(o => o.option === value)?.label;

  const rowsWithVariantValue = rows.filter(r => r[sizeKey] || r[colorKey] || r.size || r.color);
  if (!variantsSupported && rowsWithVariantValue.length > 0) {
    rowsWithVariantValue.forEach(r =>
      addError(r, 'size', `listingType "${primaryRow.listingType}" does not support size/color variants.`)
    );
  }
  const isVariantGroup = variantsSupported && (rows.length > 1 || rowsWithVariantValue.length > 0);

  let combos = null;
  if (isVariantGroup) {
    const imageUrlByColor = new Map();
    combos = rows.map(row => {
      const size = row.size || row[sizeKey] || '';
      const color = row.color || row[colorKey] || '';
      if (!size) {
        addError(row, 'size', 'Size is required for every row of a variant-enabled listing type.');
      } else if (sizeField && !sizeField.enumOptions?.some(o => o.option === size)) {
        addError(row, 'size', `"${size}" is not a valid size option.`);
      }
      if (!color) {
        addError(row, 'color', 'Color is required for every row of a variant-enabled listing type.');
      } else if (colorField && !colorField.enumOptions?.some(o => o.option === color)) {
        addError(row, 'color', `"${color}" is not a valid color option.`);
      }
      if (color) {
        const seenUrl = imageUrlByColor.get(color);
        if (seenUrl && row.imageUrl && seenUrl !== row.imageUrl) {
          addError(
            row,
            'imageUrl',
            `Rows sharing color "${color}" must use the same imageUrl - sizes of one color share one photo.`
          );
        }
        if (!seenUrl && row.imageUrl) {
          imageUrlByColor.set(color, row.imageUrl);
        }
      }
      return {
        rowNumber: row.__rowNumber,
        isPrimary: row === primaryRow,
        size: size || undefined,
        color: color || undefined,
        sizeLabel: labelFor(sizeField, size),
        colorLabel: labelFor(colorField, color),
        imageUrl: row.imageUrl || null,
        stockRaw: row.stock,
      };
    });
  }

  // Stock + image requirement (per-row for variant groups, primary-row-only for plain products).
  const isInfiniteStock = STOCK_INFINITE_ITEMS.includes(listingTypeConfig.stockType);
  const imageRequired = requireListingImage(listingTypeConfig);
  const rowsNeedingStockAndImage = isVariantGroup
    ? combos.map(c => ({ rowNumber: c.rowNumber, stockRaw: c.stockRaw, imageUrl: c.imageUrl }))
    : [{ rowNumber: primaryRow.__rowNumber, stockRaw: primaryRow.stock, imageUrl: primaryRow.imageUrl }];
  rowsNeedingStockAndImage.forEach(r => {
    if (!isInfiniteStock && !isNonNegativeInteger(r.stockRaw)) {
      errors.push({ rowNumber: r.rowNumber, field: 'stock', message: `Stock must be a non-negative whole number, got "${r.stockRaw}".` });
    }
    if (imageRequired && !r.imageUrl) {
      errors.push({ rowNumber: r.rowNumber, field: 'imageUrl', message: 'An image URL is required for this listing type.' });
    }
  });

  if (errors.length > 0) {
    return { groupKey: group.groupKey, rowCount: rows.length, errors, plan: null };
  }

  const additionalImageUrls = splitMultiValue(primaryRow.additionalImageUrls);
  const stockFor = raw => (isInfiniteStock ? BILLIARD : Number(raw));

  return {
    groupKey: group.groupKey,
    rowCount: rows.length,
    errors: [],
    plan: {
      title: primaryRow.title,
      description: primaryRow.description || undefined,
      listingTypeConfig,
      price,
      publicData: {
        listingType: primaryRow.listingType,
        transactionProcessAlias: listingTypeConfig.transactionType.alias,
        unitType: listingTypeConfig.transactionType.unitType,
        ...pickedCategories,
        shippingEnabled,
        ...(shippingEnabled
          ? {
              shippingPriceInSubunitsOneItem: shippingPriceOneItem,
              ...(shippingPriceAdditional
                ? { shippingPriceInSubunitsAdditionalItems: shippingPriceAdditional }
                : {}),
            }
          : {}),
        ...publicCustom,
      },
      privateData: privateCustom,
      // Only meaningful for a plain (non-variant) product - a variant group's per-combo photos
      // live in combos[].imageUrl instead (see createOrUpdateVariantGroup in variantImport.js).
      imageUrl: isVariantGroup ? null : primaryRow.imageUrl || null,
      additionalImageUrls,
      isVariantGroup,
      stock: isVariantGroup ? undefined : stockFor(primaryRow.stock),
      combos: isVariantGroup
        ? combos.map(c => ({
            isPrimary: c.isPrimary,
            size: c.size,
            color: c.color,
            sizeLabel: c.sizeLabel,
            colorLabel: c.colorLabel,
            imageUrl: c.imageUrl,
            stock: stockFor(c.stockRaw),
          }))
        : null,
    },
  };
};

/**
 * Parse+group+validate every row of an already-parsed CSV in one call.
 * @param {Array<Object>} rows as returned by parseCsvFile
 * @param {Object} config app config from useConfiguration()
 * @returns {Array<{groupKey, errors, plan}>} one entry per product group, in file order
 */
export const validateRows = (rows, config) => groupRows(rows).map(group => validateGroup(group, config));
