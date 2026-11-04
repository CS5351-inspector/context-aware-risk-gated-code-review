exports.readId = (items, index) => {
  if (index < 0 || index >= items.length) return null;
  return items[index].id;
};
