import React from 'react';
import '@testing-library/jest-dom';

import { types as sdkTypes } from '../../util/sdkLoader';
import { createUser } from '../../util/testData';
import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';

import CartDetailsSideCard from './CartDetailsSideCard';

const { UUID } = sdkTypes;
const { screen } = testingLibrary;

// A minimal image entity in the shape ResponsiveImage expects: it reads
// image.attributes.variants[variantName].{url,width}.
const mockImage = id => ({
  id: new UUID(id),
  type: 'image',
  attributes: {
    variants: {
      'listing-card': { url: `https://example.com/${id}-400.jpg`, width: 400, height: 400 },
      'listing-card-2x': { url: `https://example.com/${id}-800.jpg`, width: 800, height: 800 },
    },
  },
});

const layoutListingImageConfig = { aspectWidth: 1, aspectHeight: 1, variantPrefix: 'listing-card' };

describe('CartDetailsSideCard', () => {
  const cartItems = [
    { listingId: 'listing-1', title: 'Plain t-shirts (S / Black)', quantity: 2 },
    { listingId: 'listing-2', title: 'Plain hoodies (M / Purple)', quantity: 1 },
  ];
  const cartItemImages = [mockImage('img-black'), mockImage('img-purple')];

  it('renders a thumbnail, title, and quantity for every cart item', () => {
    render(
      <CartDetailsSideCard
        cartItems={cartItems}
        cartItemImages={cartItemImages}
        author={createUser('seller-1')}
        layoutListingImageConfig={layoutListingImageConfig}
        processName="default-purchase"
        breakdown={<div>breakdown</div>}
        showListingImage={true}
      />
    );

    // Item count heading
    expect(screen.getByText('CartDetailsSideCard.itemCount')).toBeInTheDocument();

    // One image per item, each wired to its own variant photo srcset
    const blackImg = screen.getByAltText('Plain t-shirts (S / Black)');
    const purpleImg = screen.getByAltText('Plain hoodies (M / Purple)');
    expect(blackImg).toHaveAttribute('srcSet', expect.stringContaining('img-black-400.jpg'));
    expect(purpleImg).toHaveAttribute('srcSet', expect.stringContaining('img-purple-400.jpg'));

    // Titles and quantities
    expect(screen.getByText('Plain t-shirts (S / Black)')).toBeInTheDocument();
    expect(screen.getByText('Plain hoodies (M / Purple)')).toBeInTheDocument();
    expect(screen.getAllByText('CartDetailsSideCard.thumbQuantity')).toHaveLength(2);
  });

  it('renders a no-image placeholder for an item whose image is missing, without crashing', () => {
    render(
      <CartDetailsSideCard
        cartItems={cartItems}
        cartItemImages={[mockImage('img-black'), null]}
        author={createUser('seller-1')}
        layoutListingImageConfig={layoutListingImageConfig}
        processName="default-purchase"
        breakdown={<div>breakdown</div>}
        showListingImage={true}
      />
    );

    // The item with an image still renders it...
    expect(screen.getByAltText('Plain t-shirts (S / Black)')).toBeInTheDocument();
    // ...and the one without falls back to ResponsiveImage's placeholder.
    expect(screen.getByText('ResponsiveImage.noImage')).toBeInTheDocument();
    expect(screen.getByText('Plain hoodies (M / Purple)')).toBeInTheDocument();
  });
});
