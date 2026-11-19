/**
 * Seat layout templates (186): 9, 11 and 16 seats. Returned as a ready body for POST /manage/seat-layouts;
 * the admin can move seats on the grid, rename them or change their class before saving.
 * Cell (0,0) is the driver seat: not sellable.
 */
const seat = (id, row, col, seatClass = 'standard', isSellable = true) => ({ id, label: id, row, col, seatClass, isSellable });

const TEMPLATES = {
  9: {
    name: 'Limousine 9 chỗ', rows: 4, cols: 3,
    seats: [
      seat('TX', 0, 0, 'standard', false), seat('A1', 0, 1, 'front'), seat('A2', 0, 2, 'front'),
      seat('B1', 1, 0, 'vip'), seat('B2', 1, 2, 'vip'),
      seat('C1', 2, 0, 'vip'), seat('C2', 2, 2, 'vip'),
      seat('D1', 3, 0), seat('D2', 3, 1), seat('D3', 3, 2),
    ],
  },
  11: {
    name: 'Limousine 11 chỗ', rows: 5, cols: 3,
    seats: [
      seat('TX', 0, 0, 'standard', false), seat('A1', 0, 1, 'front'), seat('A2', 0, 2, 'front'),
      seat('B1', 1, 0, 'vip'), seat('B2', 1, 2, 'vip'),
      seat('C1', 2, 0, 'vip'), seat('C2', 2, 2, 'vip'),
      seat('D1', 3, 0), seat('D2', 3, 2),
      seat('E1', 4, 0), seat('E2', 4, 1), seat('E3', 4, 2),
    ],
  },
  16: {
    name: 'Xe 16 chỗ', rows: 6, cols: 4,
    seats: [
      seat('TX', 0, 0, 'standard', false), seat('A1', 0, 2, 'front'), seat('A2', 0, 3, 'front'),
      ...[1, 2, 3, 4].flatMap((r) => [seat(`${'BCDE'[r - 1]}1`, r, 0), seat(`${'BCDE'[r - 1]}2`, r, 2), seat(`${'BCDE'[r - 1]}3`, r, 3)]),
      seat('F1', 5, 2), seat('F2', 5, 3),
    ],
  },
};

function templates() {
  return {
    items: Object.entries(TEMPLATES).map(([key, t]) => ({ key, ...t, sellableSeats: t.seats.filter((s) => s.isSellable).length })),
  };
}

module.exports = { templates, TEMPLATES };
