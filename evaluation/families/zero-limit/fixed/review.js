// Zero disables processing; null/undefined use the default.
exports.batchLimit = (limit) => limit == null ? 20 : limit;
