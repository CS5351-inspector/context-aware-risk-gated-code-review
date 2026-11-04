const { lookup, GRANTED } = require('./policy.js');
exports.canDownload = (account) => Boolean(lookup(account));
