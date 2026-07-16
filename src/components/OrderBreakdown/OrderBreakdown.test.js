import React from 'react';
import '@testing-library/jest-dom';
import Decimal from 'decimal.js';

import { types as sdkTypes } from '../../util/sdkLoader';
import { fakeIntl, createBooking } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import { getProcess, TX_TRANSITION_ACTOR_CUSTOMER } from '../../transactions/transaction';

import { OrderBreakdownComponent } from './OrderBreakdown';

const { UUID, Money } = sdkTypes;
const { screen, within } = testingLibrary;

const marketplaceName = 'MarketplaceX';

const exampleTransaction = params => {
  const transitions = getProcess('default-purchase')?.transitions;
  const created = new Date(Date.UTC(2017, 1, 1));
  return {
    id: new UUID('example-transaction'),
    type: 'transaction',
    attributes: {
      processName: 'default-purchase',
      processVersion: 1,
      createdAt: created,
      lastTransitionedAt: created,
      lastTransition: transitions.REQUEST_PAYMENT,
      transitions: [
        {
          createdAt: created,
          by: TX_TRANSITION_ACTOR_CUSTOMER,
          transition: transitions.REQUEST_PAYMENT,
        },
      ],

      // payinTotal, payoutTotal, and lineItems required in params
      ...params,
    },
  };
};

describe('OrderBreakdown', () => {
  it('shows base price, shipping fee and total to customer (product)', () => {
    render(
      <OrderBreakdownComponent
        userRole="customer"
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={exampleTransaction({
          payinTotal: new Money(3000, 'USD'),
          payoutTotal: new Money(3000, 'USD'),
          lineItems: [
            {
              code: 'line-item/item',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(2),
              lineTotal: new Money(2000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
            {
              code: 'line-item/shipping-fee',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(1),
              unitPrice: new Money(1000, 'USD'),
              lineTotal: new Money(1000, 'USD'),
              reversal: false,
            },
          ],
        })}
        intl={fakeIntl}
      />
    );

    // Base price
    const unitPriceXQuantity = screen.getByText('OrderBreakdown.baseUnitQuantity');
    expect(unitPriceXQuantity).toBeInTheDocument();
    const lineItemBasePrice = within(unitPriceXQuantity.parentNode.parentNode);
    expect(lineItemBasePrice.getByText('20')).toBeInTheDocument();

    // Shipping fee
    const shippingFee = screen.getByText('OrderBreakdown.shippingFee');
    expect(shippingFee).toBeInTheDocument();
    const lineItemShippingFee = within(shippingFee.parentNode.parentNode);
    expect(lineItemShippingFee.getByText('10')).toBeInTheDocument();

    // Total
    const total = screen.getByText('OrderBreakdown.total');
    expect(total).toBeInTheDocument();
    const totalPayIn = within(total.parentNode.parentNode);
    expect(totalPayIn.getByText('30')).toBeInTheDocument();
  });

  it('shows a buy-now (cart of one) the same way as a regular single-item purchase', () => {
    render(
      <OrderBreakdownComponent
        userRole="customer"
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={exampleTransaction({
          payinTotal: new Money(1000, 'USD'),
          payoutTotal: new Money(1000, 'USD'),
          protectedData: {
            cartItems: [{ listingId: 'listing-1', title: 'Solo tee', quantity: 1 }],
          },
          lineItems: [
            {
              code: 'line-item/item',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(1),
              lineTotal: new Money(1000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
          ],
        })}
        intl={fakeIntl}
      />
    );

    expect(screen.getByText('OrderBreakdown.baseUnitQuantity')).toBeInTheDocument();
    expect(screen.queryByText('OrderBreakdown.cartItemLine')).not.toBeInTheDocument();
  });

  it('labels each item by title for a multi-item cart order', () => {
    render(
      <OrderBreakdownComponent
        userRole="customer"
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={exampleTransaction({
          payinTotal: new Money(3000, 'USD'),
          payoutTotal: new Money(3000, 'USD'),
          protectedData: {
            cartItems: [
              { listingId: 'listing-1', title: 'Red tee', quantity: 1 },
              { listingId: 'listing-2', title: 'Blue tee', quantity: 2 },
            ],
          },
          lineItems: [
            {
              code: 'line-item/item',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(1),
              lineTotal: new Money(1000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
            {
              code: 'line-item/item',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(2),
              lineTotal: new Money(2000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
          ],
        })}
        intl={fakeIntl}
      />
    );

    const cartItemLines = screen.getAllByText('OrderBreakdown.cartItemLine');
    expect(cartItemLines).toHaveLength(2);
    expect(screen.queryByText('OrderBreakdown.baseUnitQuantity')).not.toBeInTheDocument();

    // Each item line's own total ($10, then $20), plus the overall transaction total ($30).
    expect(screen.getAllByText('10')).toHaveLength(1);
    expect(screen.getAllByText('20')).toHaveLength(1);
    expect(screen.getAllByText('30')).toHaveLength(1);
  });

  it('shows base price, booking dates, customer-commission and total to customer (booking)', () => {
    render(
      <OrderBreakdownComponent
        userRole="customer"
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={exampleTransaction({
          payinTotal: new Money(2200, 'USD'),
          payoutTotal: new Money(2000, 'USD'),
          lineItems: [
            {
              code: 'line-item/night',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(2),
              lineTotal: new Money(2000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
            {
              code: 'line-item/customer-commission',
              includeFor: ['customer'],
              lineTotal: new Money(200, 'USD'),
              unitPrice: new Money(200, 'USD'),
              reversal: false,
            },
          ],
        })}
        booking={createBooking('example-booking', {
          start: new Date(Date.UTC(2017, 3, 14)),
          end: new Date(Date.UTC(2017, 3, 16)),
        })}
        intl={fakeIntl}
        timeZone="Etc/UTC"
      />
    );

    // Booking: start
    const bookingStart = screen.getByText('OrderBreakdown.bookingStart');
    expect(bookingStart).toBeInTheDocument();
    const bookingStartInfo = within(bookingStart.parentNode.parentNode);
    expect(bookingStartInfo.getByText('Friday')).toBeInTheDocument();
    expect(bookingStartInfo.getByText('Apr 14')).toBeInTheDocument();

    // Booking: end
    const bookingEnd = screen.getByText('OrderBreakdown.bookingEnd');
    expect(bookingEnd).toBeInTheDocument();
    const bookingEndInfo = within(bookingEnd.parentNode.parentNode);
    expect(bookingEndInfo.getByText('Sunday')).toBeInTheDocument();
    expect(bookingEndInfo.getByText('Apr 16')).toBeInTheDocument();

    // Base price
    const unitPriceXQuantity = screen.getByText('OrderBreakdown.baseUnitNight');
    expect(unitPriceXQuantity).toBeInTheDocument();
    const lineItemBasePrice = within(unitPriceXQuantity.parentNode.parentNode);
    expect(lineItemBasePrice.getByText('20')).toBeInTheDocument();

    // Commission
    const commission = screen.getByText('OrderBreakdown.commission');
    expect(commission).toBeInTheDocument();
    const lineItemCommission = within(commission.parentNode.parentNode);
    expect(lineItemCommission.getByText('2')).toBeInTheDocument();

    // Total
    const total = screen.getByText('OrderBreakdown.total');
    expect(total).toBeInTheDocument();
    const totalPayIn = within(total.parentNode.parentNode);
    expect(totalPayIn.getByText('22')).toBeInTheDocument();
  });

  it('shows base price, provider-commission and total to provider (booking)', () => {
    render(
      <OrderBreakdownComponent
        userRole="provider"
        currency="USD"
        marketplaceName={marketplaceName}
        transaction={exampleTransaction({
          payinTotal: new Money(2000, 'USD'),
          payoutTotal: new Money(1800, 'USD'),
          lineItems: [
            {
              code: 'line-item/night',
              includeFor: ['customer', 'provider'],
              quantity: new Decimal(2),
              lineTotal: new Money(2000, 'USD'),
              unitPrice: new Money(1000, 'USD'),
              reversal: false,
            },
            {
              code: 'line-item/provider-commission',
              includeFor: ['provider'],
              lineTotal: new Money(-200, 'USD'),
              unitPrice: new Money(-200, 'USD'),
              reversal: false,
            },
          ],
        })}
        booking={createBooking('example-booking', {
          start: new Date(Date.UTC(2017, 3, 14)),
          end: new Date(Date.UTC(2017, 3, 16)),
        })}
        intl={fakeIntl}
        timeZone="Etc/UTC"
      />
    );

    // Booking: start
    const bookingStart = screen.getByText('OrderBreakdown.bookingStart');
    expect(bookingStart).toBeInTheDocument();
    const bookingStartInfo = within(bookingStart.parentNode.parentNode);
    expect(bookingStartInfo.getByText('Friday')).toBeInTheDocument();
    expect(bookingStartInfo.getByText('Apr 14')).toBeInTheDocument();

    // Booking: end
    const bookingEnd = screen.getByText('OrderBreakdown.bookingEnd');
    expect(bookingEnd).toBeInTheDocument();
    const bookingEndInfo = within(bookingEnd.parentNode.parentNode);
    expect(bookingEndInfo.getByText('Sunday')).toBeInTheDocument();
    expect(bookingEndInfo.getByText('Apr 16')).toBeInTheDocument();

    // Base price
    const unitPriceXQuantity = screen.getByText('OrderBreakdown.baseUnitNight');
    expect(unitPriceXQuantity).toBeInTheDocument();
    const lineItemBasePrice = within(unitPriceXQuantity.parentNode.parentNode);
    expect(lineItemBasePrice.getByText('20')).toBeInTheDocument();

    // Commission
    const commission = screen.getByText('OrderBreakdown.commission');
    expect(commission).toBeInTheDocument();
    const lineItemCommission = within(commission.parentNode.parentNode);
    expect(lineItemCommission.getByText('-2')).toBeInTheDocument();

    // Total
    const providerTotal = screen.getByText('OrderBreakdown.providerTotalDefault');
    expect(providerTotal).toBeInTheDocument();
    const totalPayIn = within(providerTotal.parentNode.parentNode);
    expect(totalPayIn.getByText('18')).toBeInTheDocument();
  });
});
