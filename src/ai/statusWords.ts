export const AI_STATUS_WORDS = [
  'Pondering',
  'Cogitating',
  'Noodling',
  'Sketching',
  'Composing',
  'Tinkering',
  'Mulling',
  'Percolating',
  'Doodling',
  'Conjuring',
  'Crafting',
  'Elucidating',
  'Hatching',
  'Puttering',
  'Ruminating',
  'Reticulating',
  'Spelunking',
  'Wrangling',
  'Finessing',
  'Germinating',
];

export function pickStatusWordIndex(previous: number): number {
  const total = AI_STATUS_WORDS.length;
  if (total <= 1) return 0;
  let next = Math.floor(Math.random() * total);
  if (next === previous) {
    next = (next + 1) % total;
  }
  return next;
}
