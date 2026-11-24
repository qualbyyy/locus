export const AI_STATUS_WORDS = [
  'Размышляю',
  'Соображаю',
  'Компоную',
  'Набрасываю',
  'Колдую',
  'Мудрю',
  'Кумекаю',
  'Шлифую',
  'Ваяю',
  'Прикидываю',
  'Подбираю',
  'Сверяю',
  'Додумываю',
  'Раскладываю',
  'Примеряю',
  'Дорисовываю',
  'Собираю',
  'Настраиваю',
  'Плету',
  'Чиню',
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
