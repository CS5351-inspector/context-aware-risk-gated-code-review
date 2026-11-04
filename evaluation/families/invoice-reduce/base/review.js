exports.totalCents = (lines) => {
  let total = 0;
  for (const line of lines) total += line.quantity * line.unitPriceCents;
  return total;
};
