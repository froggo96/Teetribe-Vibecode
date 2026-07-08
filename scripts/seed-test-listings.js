/**
 * Seeds a handful of test listings using the Sharetribe Integration API.
 *
 * Requires INTEGRATION_CLIENT_ID / INTEGRATION_CLIENT_SECRET (Integration API
 * application credentials, generated separately in the Console) and
 * REACT_APP_SHARETRIBE_SDK_CLIENT_ID in .env.
 *
 * Usage: node scripts/seed-test-listings.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');
const sharetribeSdk = require('sharetribe-flex-sdk');

const {
  REACT_APP_SHARETRIBE_SDK_CLIENT_ID: clientId,
  INTEGRATION_CLIENT_ID: integrationClientId,
  INTEGRATION_CLIENT_SECRET: integrationClientSecret,
} = process.env;

if (!clientId) {
  console.error('Missing REACT_APP_SHARETRIBE_SDK_CLIENT_ID in .env');
  process.exit(1);
}
if (!integrationClientId || !integrationClientSecret) {
  console.error('Missing INTEGRATION_CLIENT_ID / INTEGRATION_CLIENT_SECRET in .env');
  process.exit(1);
}

const integrationSdk = sharetribeIntegrationSdk.createInstance({
  clientId: integrationClientId,
  clientSecret: integrationClientSecret,
});

const publicSdk = sharetribeSdk.createInstance({ clientId });

const TEST_AUTHOR_EMAIL = 'seed-test-provider@teetribe-vibecode.test';
const TEST_AUTHOR_PASSWORD = 'TestSeedPassword123!';

// A few generic sample listings. Title/description are generic since we don't
// know the marketplace's niche; price is per-unit in the listing type's unitType.
const SAMPLE_LISTINGS = [
  {
    title: 'Test Listing One',
    description: 'A seeded test listing, safe to delete. Created via the Integration API.',
    priceAmount: 2500, // in minor currency units (e.g. $25.00)
    geolocation: { lat: 40.7128, lng: -74.006 }, // New York City
  },
  {
    title: 'Test Listing Two',
    description: 'Another seeded test listing, safe to delete. Created via the Integration API.',
    priceAmount: 4000,
    geolocation: { lat: 34.0522, lng: -118.2437 }, // Los Angeles
  },
  {
    title: 'Test Listing Three',
    description: 'A third seeded test listing, safe to delete. Created via the Integration API.',
    priceAmount: 1500,
    geolocation: { lat: 41.8781, lng: -87.6298 }, // Chicago
  },
];

async function getListingTypeConfig() {
  const res = await publicSdk.assetsByAlias({
    paths: ['/listings/listing-types.json'],
    alias: 'latest',
  });
  const asset = res.data.data[0];
  const listingTypes = asset && asset.attributes && asset.attributes.data && asset.attributes.data.listingTypes;
  if (!listingTypes || listingTypes.length === 0) {
    throw new Error(
      'No listing types are configured for this marketplace in Sharetribe Console (Build > Listings > Listing types).'
    );
  }
  return listingTypes[0];
}

async function getOrCreateTestAuthor() {
  try {
    const res = await integrationSdk.users.show({ email: TEST_AUTHOR_EMAIL });
    const user = res.data.data;
    console.log(`Using existing test author: ${TEST_AUTHOR_EMAIL} (${user.id.uuid})`);
    return user.id;
  } catch (err) {
    const status = err && err.status;
    if (status !== 404) {
      throw err;
    }
  }

  console.log(`Creating test author user: ${TEST_AUTHOR_EMAIL}`);
  const res = await publicSdk.currentUser.create({
    email: TEST_AUTHOR_EMAIL,
    password: TEST_AUTHOR_PASSWORD,
    firstName: 'Test',
    lastName: 'Provider',
  });
  const user = res.data.data;
  console.log(`Created test author (${user.id.uuid}). Password: ${TEST_AUTHOR_PASSWORD}`);
  return user.id;
}

async function createListing(authorId, listingTypeConfig, sample) {
  const listingType = listingTypeConfig.id;
  const { name: process, alias } = listingTypeConfig.transactionProcess;
  const unitType = listingTypeConfig.unitType;

  const publicData = {
    listingType,
    transactionProcessAlias: alias,
    unitType,
  };

  const params = {
    title: sample.title,
    description: sample.description,
    authorId,
    state: 'published',
    price: { amount: sample.priceAmount, currency: 'USD' },
    publicData,
  };

  const res = await integrationSdk.listings.create(params, { expand: true });
  const listing = res.data.data;

  if (process === 'default-purchase') {
    try {
      await integrationSdk.stock.compareAndSet(
        { listingId: listing.id, oldTotal: null, newTotal: 10 },
        { expand: true }
      );
    } catch (stockErr) {
      console.warn(`  Could not set stock for "${sample.title}": ${stockErr.message || stockErr}`);
    }
  }

  return listing;
}

async function main() {
  console.log('Fetching listing type configuration from Sharetribe Console...');
  const listingTypeConfig = await getListingTypeConfig();
  console.log(`Using listing type: ${listingTypeConfig.id} (${listingTypeConfig.transactionProcess.name})`);

  const authorId = await getOrCreateTestAuthor();

  console.log(`Creating ${SAMPLE_LISTINGS.length} test listings...`);
  for (const sample of SAMPLE_LISTINGS) {
    const listing = await createListing(authorId, listingTypeConfig, sample);
    console.log(`  Created "${listing.attributes.title}" (${listing.id.uuid})`);
  }

  console.log('Done.');
}

main().catch(err => {
  const data = err && err.data;
  console.error('Failed to seed listings:', data ? JSON.stringify(data, null, 2) : err);
  process.exit(1);
});
