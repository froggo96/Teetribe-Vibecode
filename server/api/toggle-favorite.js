const { getSdk, serialize, handleError } = require('../api-util/sdk');

module.exports = (req, res) => {
  const { favoriteListingIds } = req.body || {};

  const sdk = getSdk(req, res);

  sdk.currentUser
    .updateProfile({ privateData: { favoriteListingIds } }, { expand: true })
    .then(apiResponse => {
      const { status, statusText, data } = apiResponse;
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(serialize({ status, statusText, data }))
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
