exports.get = (cache, key, fallback) => Object.hasOwn(cache, key) ? cache[key] : fallback;
