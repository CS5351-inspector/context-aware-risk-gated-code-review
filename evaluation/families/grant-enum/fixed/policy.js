// External policy protocol: numeric values are not booleans.
const GRANTED = 0;
const DENIED = 1;
const SUSPENDED = 2;
exports.GRANTED = GRANTED;
exports.lookup = (account) => ({ granted: GRANTED, denied: DENIED, suspended: SUSPENDED })[account.status];
