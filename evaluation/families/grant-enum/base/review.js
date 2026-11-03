const { lookup, GRANTED } = require('./policy.js');
exports.canDownload = (account) => lookup(account) === GRANTED;
