const key = (tenant, user) => JSON.stringify([tenant, user]);
exports.lookup = (cache, tenant, user) => cache[key(tenant, user)] ?? null;
