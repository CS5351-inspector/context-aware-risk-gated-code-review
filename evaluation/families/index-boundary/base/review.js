exports.readId = (items, index) => {
  if (index >= 0 && index < items.length) return items[index].id;
  return null;
};
