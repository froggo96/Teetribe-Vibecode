/**
 * Seeds realistic t-shirt listings (with images, stock, and delivery methods)
 * for a given author, using the Sharetribe Integration API. Images are real
 * t-shirt/shirt photos pulled from LoremFlickr (a free public
 * keyword-matched Flickr photo proxy) - stock photography, not actual
 * product photography of items this seller owns.
 *
 * Requires INTEGRATION_CLIENT_ID / INTEGRATION_CLIENT_SECRET and
 * REACT_APP_SHARETRIBE_SDK_CLIENT_ID in .env.
 *
 * Usage: node scripts/seed-teetribe-listings.js <authorId>
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');
const sharetribeSdk = require('sharetribe-flex-sdk');

const {
  REACT_APP_SHARETRIBE_SDK_CLIENT_ID: clientId,
  INTEGRATION_CLIENT_ID: integrationClientId,
  INTEGRATION_CLIENT_SECRET: integrationClientSecret,
} = process.env;

const authorId = process.argv[2];

if (!authorId) {
  console.error('Usage: node scripts/seed-teetribe-listings.js <authorId>');
  process.exit(1);
}
if (!clientId || !integrationClientId || !integrationClientSecret) {
  console.error('Missing required env vars (REACT_APP_SHARETRIBE_SDK_CLIENT_ID / INTEGRATION_CLIENT_ID / INTEGRATION_CLIENT_SECRET) in .env');
  process.exit(1);
}

const integrationSdk = sharetribeIntegrationSdk.createInstance({
  clientId: integrationClientId,
  clientSecret: integrationClientSecret,
});

const publicSdk = sharetribeSdk.createInstance({ clientId });

// Delivery presets, cycled across listings for variety.
const PICKUP_ONLY = city => ({
  pickupEnabled: true,
  shippingEnabled: false,
  location: { address: city.address, building: city.building },
  geolocation: city.geolocation,
});
const SHIPPING_ONLY = () => ({
  pickupEnabled: false,
  shippingEnabled: true,
  shippingPriceInSubunitsOneItem: 595,
  shippingPriceInSubunitsAdditionalItems: 195,
});
const BOTH = city => ({
  pickupEnabled: true,
  shippingEnabled: true,
  location: { address: city.address, building: city.building },
  geolocation: city.geolocation,
  shippingPriceInSubunitsOneItem: 450,
  shippingPriceInSubunitsAdditionalItems: 150,
});

const CITIES = [
  { address: '123 5th Ave, New York, NY 10160, USA', building: 'Suite 4B', geolocation: { lat: 40.7128, lng: -74.006 } },
  { address: '456 Sunset Blvd, Los Angeles, CA 90028, USA', building: '', geolocation: { lat: 34.0522, lng: -118.2437 } },
  { address: '789 Michigan Ave, Chicago, IL 60611, USA', building: 'Unit 2', geolocation: { lat: 41.8781, lng: -87.6298 } },
  { address: '321 Congress Ave, Austin, TX 78701, USA', building: '', geolocation: { lat: 30.2672, lng: -97.7431 } },
];

const TSHIRTS = [
  {
    title: 'Classic White Crewneck Tee',
    description: '100% combed cotton crewneck in a clean, everyday white. Pre-shrunk and built to last wash after wash.',
    priceAmount: 2200,
    imageKeywords: 'white,tshirt',
    stock: 25,
    delivery: PICKUP_ONLY(CITIES[0]),
  },
  {
    title: 'Heather Grey Essential Tee',
    description: 'Soft heather grey tee with a relaxed fit. A wardrobe staple that pairs with anything.',
    priceAmount: 2000,
    imageKeywords: 'grey,tshirt',
    stock: 18,
    delivery: SHIPPING_ONLY(),
  },
  {
    title: 'Vintage Wash Black Tee',
    description: 'Garment-dyed black tee with a slightly worn-in look and feel straight out of the bag.',
    priceAmount: 2600,
    imageKeywords: 'black,tshirt',
    stock: 12,
    delivery: BOTH(CITIES[1]),
  },
  {
    title: 'Navy Striped Sailor Tee',
    description: 'Breton-inspired navy and white stripes on a mid-weight cotton tee.',
    priceAmount: 2800,
    imageKeywords: 'striped,shirt',
    stock: 9,
    delivery: PICKUP_ONLY(CITIES[2]),
  },
  {
    title: 'Sunfaded Orange Graphic Tee',
    description: 'Warm sunfaded orange tee with a subtle distressed print. Limited run.',
    priceAmount: 3000,
    imageKeywords: 'orange,tshirt',
    stock: 5,
    delivery: SHIPPING_ONLY(),
  },
  {
    title: 'Forest Green Pocket Tee',
    description: 'Deep forest green tee with a chest pocket. Heavyweight cotton for a structured drape.',
    priceAmount: 2400,
    imageKeywords: 'green,tshirt',
    stock: 20,
    delivery: BOTH(CITIES[3]),
  },
  {
    title: 'Faded Denim Blue Tee',
    description: 'Denim-blue dyed tee with a soft, lived-in hand feel.',
    priceAmount: 2300,
    imageKeywords: 'blue,tshirt',
    stock: 15,
    delivery: PICKUP_ONLY(CITIES[3]),
  },
  {
    title: 'Mustard Yellow Oversized Tee',
    description: 'Oversized fit tee in a bold mustard yellow. Dropped shoulders, boxy silhouette.',
    priceAmount: 2700,
    imageKeywords: 'yellow,shirt',
    stock: 7,
    delivery: SHIPPING_ONLY(),
  },
];

function downloadImage(keywords, lock, destPath) {
  const url = `https://loremflickr.com/1024/1024/${encodeURIComponent(keywords)}?lock=${lock}`;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = getUrl => {
      https
        .get(getUrl, response => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            request(new URL(response.headers.location, getUrl).toString());
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download image (${response.statusCode}) from ${getUrl}`));
            return;
          }
          response.pipe(file);
          file.on('finish', () => file.close(() => resolve(destPath)));
        })
        .on('error', reject);
    };
    request(url);
  });
}

async function getListingTypeConfig() {
  const res = await publicSdk.assetsByAlias({
    paths: ['/listings/listing-types.json'],
    alias: 'latest',
  });
  const asset = res.data.data[0];
  const listingTypes = asset && asset.attributes && asset.attributes.data && asset.attributes.data.listingTypes;
  if (!listingTypes || listingTypes.length === 0) {
    throw new Error('No listing types configured for this marketplace in Sharetribe Console.');
  }
  return listingTypes[0];
}

async function createListingWithImage(listingTypeConfig, item, index, tmpDir) {
  const listingType = listingTypeConfig.id;
  const { name: process, alias } = listingTypeConfig.transactionProcess;
  const unitType = listingTypeConfig.unitType;

  const imagePath = path.join(tmpDir, `tee-${index}.jpg`);
  await downloadImage(item.imageKeywords, index + 1, imagePath);

  const imageRes = await integrationSdk.images.upload({ image: fs.createReadStream(imagePath) });
  const imageId = imageRes.data.data.id;

  const params = {
    title: item.title,
    description: item.description,
    authorId,
    state: 'published',
    price: { amount: item.priceAmount, currency: 'USD' },
    images: [imageId],
    publicData: {
      listingType,
      transactionProcessAlias: alias,
      unitType,
      pickupEnabled: item.delivery.pickupEnabled,
      shippingEnabled: item.delivery.shippingEnabled,
      ...(item.delivery.location ? { location: item.delivery.location } : {}),
      ...(item.delivery.shippingPriceInSubunitsOneItem != null
        ? {
            shippingPriceInSubunitsOneItem: item.delivery.shippingPriceInSubunitsOneItem,
            shippingPriceInSubunitsAdditionalItems: item.delivery.shippingPriceInSubunitsAdditionalItems,
          }
        : {}),
    },
    ...(item.delivery.geolocation ? { geolocation: item.delivery.geolocation } : {}),
  };

  const res = await integrationSdk.listings.create(params, { expand: true });
  const listing = res.data.data;

  if (process === 'default-purchase') {
    try {
      await integrationSdk.stock.compareAndSet(
        { listingId: listing.id, oldTotal: null, newTotal: item.stock },
        { expand: true }
      );
    } catch (stockErr) {
      console.warn(`  Could not set stock for "${item.title}": ${stockErr.message || stockErr}`);
    }
  }

  fs.unlink(imagePath, () => {});

  return listing;
}

async function main() {
  const listingTypeConfig = await getListingTypeConfig();
  console.log(`Using listing type: ${listingTypeConfig.id} (${listingTypeConfig.transactionProcess.name})`);
  console.log(`Author: ${authorId}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teetribe-seed-'));

  console.log(`Creating ${TSHIRTS.length} t-shirt listings with images...`);
  for (let i = 0; i < TSHIRTS.length; i++) {
    const item = TSHIRTS[i];
    const listing = await createListingWithImage(listingTypeConfig, item, i, tmpDir);
    console.log(`  Created "${listing.attributes.title}" (${listing.id.uuid}) - stock ${item.stock}, pickup=${item.delivery.pickupEnabled}, shipping=${item.delivery.shippingEnabled}`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('Done.');
}

main().catch(err => {
  const data = err && err.data;
  console.error('Failed to seed listings:', data ? JSON.stringify(data, null, 2) : err);
  process.exit(1);
});
