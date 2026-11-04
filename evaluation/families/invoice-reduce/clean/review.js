exports.totalCents = (lines) => lines.reduce((total, line) => total + line.quantity * line.unitPriceCents, 0);
