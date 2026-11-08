const { lookup } = require('./cache');
exports.readProfile = (cache, tenant, user) => lookup(cache, tenant, user);
