const { lookup } = require('./cache');
exports.readProfile = (cache, tenant, user) => {
  return lookup(cache, tenant, user);
};
