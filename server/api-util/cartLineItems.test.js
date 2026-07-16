const { types } = require('sharetribe-flex-sdk');
const { Money } = types;
const {
  cartLineItems,
  validateCartListings,
  CART_MAX_ITEMS_PER_SELLER,
} = require('./cartLineItems');

describe('cartLineItems', () => {
  const listing = (id, priceAmount, shipping = {}) => ({
    id: { uuid: id },
    attributes: {
      price: new Money(priceAmount, 'EUR'),
      publicData: {
        unitType: 'item',
        ...shipping,
      },
    },
  });

  // Cheap tee, one-item fee €5.00 / additional €2.00
  const shirt = listing('listing-shirt', 2000, {
    shippingPriceInSubunitsOneItem: 500,
    shippingPriceInSubunitsAdditionalItems: 200,
  });
  // Pricier hoodie, one-item fee €8.00 / additional €3.00 - should win the shipping anchor
  const hoodie = listing('listing-hoodie', 4000, {
    shippingPriceInSubunitsOneItem: 800,
    shippingPriceInSubunitsAdditionalItems: 300,
  });
  // No shipping fields at all (e.g. pickup-only listing)
  const pickupOnly = listing('listing-pickup-only', 1500);

  const providerCommission = { percentage: 10 };
  const customerCommission = { percentage: 5 };

  describe('happy path', () => {
    it('builds one line-item/item per cart item, in cartItems order, with pickup (no shipping line)', () => {
      const orderData = {
        cartItems: [
          { listingId: 'listing-hoodie', quantity: 1 },
          { listingId: 'listing-shirt', quantity: 2 },
        ],
        deliveryMethod: 'pickup',
      };

      const result = cartLineItems([shirt, hoodie], orderData, providerCommission, customerCommission);

      // hoodie, shirt, provider commission, customer commission (no shipping)
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({
        code: 'line-item/item',
        unitPrice: new Money(4000, 'EUR'),
        quantity: 1,
        includeFor: ['customer', 'provider'],
      });
      expect(result[1]).toEqual({
        code: 'line-item/item',
        unitPrice: new Money(2000, 'EUR'),
        quantity: 2,
        includeFor: ['customer', 'provider'],
      });
      expect(result[2].code).toBe('line-item/provider-commission');
      expect(result[3].code).toBe('line-item/customer-commission');
    });

    it('picks the listing with the highest one-item shipping fee as the anchor', () => {
      const orderData = {
        cartItems: [
          { listingId: 'listing-shirt', quantity: 2 },
          { listingId: 'listing-hoodie', quantity: 1 },
        ],
        deliveryMethod: 'shipping',
      };

      const result = cartLineItems([shirt, hoodie], orderData, providerCommission, customerCommission);

      const shippingLine = result.find(li => li.code === 'line-item/shipping-fee');
      // anchor = hoodie (€8.00/€3.00); totalUnits = 3 => €8.00 + 2 * €3.00 = €14.00
      expect(shippingLine).toEqual({
        code: 'line-item/shipping-fee',
        unitPrice: new Money(1400, 'EUR'),
        quantity: 1,
        includeFor: ['customer', 'provider'],
      });
    });

    it('charges only the anchor one-item fee when the cart has a single unit total', () => {
      const orderData = {
        cartItems: [{ listingId: 'listing-hoodie', quantity: 1 }],
        deliveryMethod: 'shipping',
      };

      const result = cartLineItems([hoodie], orderData, providerCommission, customerCommission);
      const shippingLine = result.find(li => li.code === 'line-item/shipping-fee');
      expect(shippingLine.unitPrice).toEqual(new Money(800, 'EUR'));
    });

    it('omits the shipping line entirely for pickup, even when listings define shipping fees', () => {
      const orderData = {
        cartItems: [{ listingId: 'listing-hoodie', quantity: 2 }],
        deliveryMethod: 'pickup',
      };

      const result = cartLineItems([hoodie], orderData, providerCommission, customerCommission);
      expect(result.find(li => li.code === 'line-item/shipping-fee')).toBeUndefined();
    });

    it('falls back to no shipping line if no cart listing defines a shipping fee', () => {
      const orderData = {
        cartItems: [{ listingId: 'listing-pickup-only', quantity: 1 }],
        deliveryMethod: 'shipping',
      };

      const result = cartLineItems([pickupOnly], orderData, providerCommission, customerCommission);
      expect(result.find(li => li.code === 'line-item/shipping-fee')).toBeUndefined();
    });

    it('computes commissions on the items subtotal only, excluding shipping', () => {
      const orderData = {
        cartItems: [
          { listingId: 'listing-shirt', quantity: 1 },
          { listingId: 'listing-hoodie', quantity: 1 },
        ],
        deliveryMethod: 'shipping',
      };

      const result = cartLineItems([shirt, hoodie], orderData, providerCommission, customerCommission);

      // items subtotal = 2000 + 4000 = 6000; provider commission = -10% = -600
      const providerCommissionLine = result.find(li => li.code === 'line-item/provider-commission');
      expect(providerCommissionLine.includeFor).toEqual(['provider']);
      expect(providerCommissionLine.unitPrice).toEqual(new Money(6000, 'EUR'));
      expect(providerCommissionLine.percentage).toBe(-10);

      const customerCommissionLine = result.find(li => li.code === 'line-item/customer-commission');
      expect(customerCommissionLine.includeFor).toEqual(['customer']);
      expect(customerCommissionLine.unitPrice).toEqual(new Money(6000, 'EUR'));
      expect(customerCommissionLine.percentage).toBe(5);
    });
  });

  describe('validation errors', () => {
    it('throws a 400 when cartItems is empty', () => {
      expect(() => cartLineItems([shirt], { cartItems: [] }, providerCommission, customerCommission)).toThrow();
      try {
        cartLineItems([shirt], { cartItems: [] }, providerCommission, customerCommission);
        fail('expected to throw');
      } catch (e) {
        expect(e.status).toBe(400);
        expect(e.data.code).toBe('cart-empty');
      }
    });

    it('throws a 400 when a cart item references a listing that was not fetched', () => {
      const orderData = { cartItems: [{ listingId: 'does-not-exist', quantity: 1 }] };
      try {
        cartLineItems([shirt], orderData, providerCommission, customerCommission);
        fail('expected to throw');
      } catch (e) {
        expect(e.status).toBe(400);
        expect(e.data.code).toBe('cart-listing-unavailable');
      }
    });

    it('throws a 400 for a non-positive or non-integer quantity', () => {
      const orderData = { cartItems: [{ listingId: 'listing-shirt', quantity: 0 }] };
      try {
        cartLineItems([shirt], orderData, providerCommission, customerCommission);
        fail('expected to throw');
      } catch (e) {
        expect(e.status).toBe(400);
        expect(e.data.code).toBe('cart-invalid-quantity');
      }
    });

    it('throws a 400 when cart listings have mixed currencies', () => {
      const usdListing = listing('listing-usd', 1000);
      usdListing.attributes.price = new Money(1000, 'USD');
      const orderData = {
        cartItems: [
          { listingId: 'listing-shirt', quantity: 1 },
          { listingId: 'listing-usd', quantity: 1 },
        ],
      };
      try {
        cartLineItems([shirt, usdListing], orderData, providerCommission, customerCommission);
        fail('expected to throw');
      } catch (e) {
        expect(e.status).toBe(400);
        expect(e.data.code).toBe('cart-mixed-currency');
      }
    });

    it('throws a 400 when the cart exceeds the per-seller item cap', () => {
      const cartItems = Array.from({ length: CART_MAX_ITEMS_PER_SELLER + 1 }, () => ({
        listingId: 'listing-shirt',
        quantity: 1,
      }));
      try {
        cartLineItems([shirt], { cartItems }, providerCommission, customerCommission);
        fail('expected to throw');
      } catch (e) {
        expect(e.status).toBe(400);
        expect(e.data.code).toBe('cart-too-many-items');
      }
    });

    it('throws when the shipping anchor has no additional-item fee and total units > 1', () => {
      const shippingOneItemOnly = listing('listing-one-item-shipping', 1000, {
        shippingPriceInSubunitsOneItem: 500,
      });
      const orderData = {
        cartItems: [{ listingId: 'listing-one-item-shipping', quantity: 2 }],
        deliveryMethod: 'shipping',
      };
      expect(() =>
        cartLineItems([shippingOneItemOnly], orderData, providerCommission, customerCommission)
      ).toThrow('Shipping fee is not set correctly for multiple items');
    });
  });
});

describe('validateCartListings', () => {
  // Raw (non-denormalised) listing resources, as returned by sdk.listings.query.
  const rawListing = (id, authorId, { state = 'published', unitType = 'item' } = {}) => ({
    id: { uuid: id },
    attributes: { state, publicData: { unitType } },
    relationships: { author: { data: { id: { uuid: authorId } } } },
  });

  it('does not throw when every listing shares one author, is published, and is a product', () => {
    const listings = [rawListing('l1', 'author1'), rawListing('l2', 'author1')];
    expect(() => validateCartListings(listings)).not.toThrow();
  });

  it('throws when listings belong to different authors', () => {
    const listings = [rawListing('l1', 'author1'), rawListing('l2', 'author2')];
    try {
      validateCartListings(listings);
      fail('expected to throw');
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.data.code).toBe('cart-mixed-authors');
    }
  });

  it('throws when a listing is not published', () => {
    const listings = [
      rawListing('l1', 'author1'),
      rawListing('l2', 'author1', { state: 'closed' }),
    ];
    try {
      validateCartListings(listings);
      fail('expected to throw');
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.data.code).toBe('cart-listing-unavailable');
    }
  });

  it('throws when a listing is not a purchasable product', () => {
    const listings = [
      rawListing('l1', 'author1'),
      rawListing('l2', 'author1', { unitType: 'day' }),
    ];
    try {
      validateCartListings(listings);
      fail('expected to throw');
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.data.code).toBe('cart-invalid-listing-type');
    }
  });
});
