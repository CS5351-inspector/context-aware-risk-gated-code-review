const { lookup } = require('./cache');
exports.readProfile = (cache, tenant, user) => lookup(cache, user, tenant);
