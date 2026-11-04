const { lookup, GRANTED } = require('./policy.js');
exports.canDownload = (account) => {
  const decision = lookup(account);
  return decision === GRANTED;
};
