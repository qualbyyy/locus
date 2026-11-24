import type { ShortcutActionId } from '../core/shortcuts';
import type { TutorialTargetId } from './targets';

export type TutorialChapterIcon =
  | 'start'
  | 'shapes'
  | 'select'
  | 'curves'
  | 'color'
  | 'text'
  | 'layers'
  | 'paths'
  | 'effects'
  | 'automation'
  | 'ai'
  | 'export';

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  tip?: string;
  target?: TutorialTargetId;
  shortcutActionId?: ShortcutActionId;
}

export interface TutorialLesson {
  id: string;
  title: string;
  summary: string;
  durationMin: number;
  steps: TutorialStep[];
}

export interface TutorialChapter {
  id: string;
  title: string;
  summary: string;
  icon: TutorialChapterIcon;
  lessons: TutorialLesson[];
}

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: 'start',
    title: 'Старт',
    summary: 'Артборд, панели, зум и первый документ.',
    icon: 'start',
    lessons: [
      {
        id: 'start.interface',
        title: 'Интерфейс за минуту',
        summary: 'Где холст, где инструменты и где свойства.',
        durationMin: 2,
        steps: [
          {
            id: 'start.interface.artboard',
            title: 'Артборд',
            body: 'Белый лист в центре — это артборд. Всё, что на нём, попадёт в экспорт; серое вокруг — рабочая область.',
            target: 'canvas.root',
          },
          {
            id: 'start.interface.panels',
            title: 'Три панели',
            body: 'Слева инструменты, справа слои и свойства, сверху меню и имя документа. Панели можно скрыть в меню «Окно».',
            target: 'toolbar.root',
          },
          {
            id: 'start.interface.inspector',
            title: 'Инспектор',
            body: 'Нижняя правая панель показывает свойства выделенного. Без выделения там настройки артборда.',
            target: 'inspector.root',
          },
        ],
      },
      {
        id: 'start.navigate',
        title: 'Зум и панорама',
        summary: 'Двигаться по холсту, не теряя артборд.',
        durationMin: 2,
        steps: [
          {
            id: 'start.navigate.pan',
            title: 'Панорама',
            body: 'Зажми Space и потяни мышью. Средняя кнопка мыши работает так же.',
            target: 'canvas.root',
          },
          {
            id: 'start.navigate.zoom',
            title: 'Зум',
            body: 'Крути колесо над холстом. Масштаб меняется к курсору, интерфейс остаётся на месте.',
            target: 'canvas.root',
          },
          {
            id: 'start.navigate.fit',
            title: 'Вписать артборд',
            body: 'Ctrl+0 вписывает артборд в окно, Ctrl+1 возвращает масштаб 100%.',
            shortcutActionId: 'view.fitArtboard',
            target: 'toolbar.fit',
          },
        ],
      },
    ],
  },
  {
    id: 'shapes',
    title: 'Фигуры',
    summary: 'Пять умных примитивов с живыми параметрами.',
    icon: 'shapes',
    lessons: [
      {
        id: 'shapes.create',
        title: 'Нарисовать фигуру',
        summary: 'Инструмент B, протягивание и Shift.',
        durationMin: 3,
        steps: [
          {
            id: 'shapes.create.tool',
            title: 'Инструмент B',
            body: 'Нажми B или выбери «Умная фигура» на панели слева.',
            shortcutActionId: 'tool.blob',
            target: 'tool.blob',
          },
          {
            id: 'shapes.create.drag',
            title: 'Протяни',
            body: 'Зажми кнопку на холсте и протяни. Фигура создаётся сразу и остаётся редактируемой.',
            target: 'canvas.root',
          },
          {
            id: 'shapes.create.shift',
            title: 'Shift',
            body: 'С зажатым Shift эллипс становится кругом, а прямоугольник — квадратом.',
          },
        ],
      },
      {
        id: 'shapes.tune',
        title: 'Настроить фигуру',
        summary: 'Пресеты, ползунки и заливка в инспекторе.',
        durationMin: 3,
        steps: [
          {
            id: 'shapes.tune.presets',
            title: 'Пять пресетов',
            body: 'В инспекторе переключай кляксу, эллипс, прямоугольник, многоугольник и звезду.',
            target: 'inspector.root',
          },
          {
            id: 'shapes.tune.params',
            title: 'Живые параметры',
            body: 'Ползунки точек, волны, скругления и внутреннего радиуса меняют фигуру без перерисовки.',
          },
          {
            id: 'shapes.tune.fill',
            title: 'Заливка',
            body: 'Цвет заливки задаётся здесь же. Кнопка «Без заливки» оставляет только контур.',
            target: 'inspector.appearance',
          },
        ],
      },
    ],
  },
  {
    id: 'select',
    title: 'Выделение',
    summary: 'Выбирать, двигать, масштабировать и дублировать.',
    icon: 'select',
    lessons: [
      {
        id: 'select.basics',
        title: 'Выделять и двигать',
        summary: 'Клик, рамка и Shift.',
        durationMin: 3,
        steps: [
          {
            id: 'select.basics.pick',
            title: 'Клик',
            body: 'Инструментом V кликни по фигуре. Shift добавляет или убирает слой из выделения.',
            shortcutActionId: 'tool.select',
            target: 'tool.select',
          },
          {
            id: 'select.basics.marquee',
            title: 'Рамка',
            body: 'Протяни по пустому месту, чтобы выделить всё в рамке.',
            target: 'canvas.root',
          },
          {
            id: 'select.basics.move',
            title: 'Двигать',
            body: 'Тяни выделенное мышью или сдвигай стрелками. Shift+стрелка двигает крупнее.',
          },
        ],
      },
      {
        id: 'select.transform',
        title: 'Масштаб и поворот',
        summary: 'Ручки, поворот и дублирование.',
        durationMin: 3,
        steps: [
          {
            id: 'select.transform.scale',
            title: 'Ручки',
            body: 'Тяни угловую ручку. Shift сохраняет пропорции.',
          },
          {
            id: 'select.transform.rotate',
            title: 'Поворот',
            body: 'Наведи на угол и потяни за круглую ручку. Shift фиксирует угол по 45°.',
          },
          {
            id: 'select.transform.duplicate',
            title: 'Дублировать',
            body: 'Ctrl+D копирует выделение со сдвигом. Ctrl+C и Ctrl+V работают как обычно.',
            shortcutActionId: 'edit.duplicate',
          },
        ],
      },
    ],
  },
  {
    id: 'curves',
    title: 'Кривые',
    summary: 'Перо, узлы и усики.',
    icon: 'curves',
    lessons: [
      {
        id: 'curves.pen',
        title: 'Перо P',
        summary: 'Построить контур по точкам.',
        durationMin: 4,
        steps: [
          {
            id: 'curves.pen.start',
            title: 'Первый узел',
            body: 'Нажми P и кликни по холсту. Контур начался.',
            shortcutActionId: 'tool.pen',
            target: 'tool.pen',
          },
          {
            id: 'curves.pen.handles',
            title: 'Усики',
            body: 'Потяни при клике — появятся усики. Они задают изгиб кривой.',
            target: 'canvas.root',
          },
          {
            id: 'curves.pen.close',
            title: 'Замкнуть',
            body: 'Клик по первой точке замыкает контур. Enter или Escape завершает открытый.',
          },
        ],
      },
      {
        id: 'curves.nodes',
        title: 'Узлы A',
        summary: 'Прямое редактирование контура.',
        durationMin: 4,
        steps: [
          {
            id: 'curves.nodes.select',
            title: 'Прямое выделение',
            body: 'Нажми A и кликни по контуру: видны узлы и усики.',
            shortcutActionId: 'tool.node',
            target: 'tool.node',
          },
          {
            id: 'curves.nodes.move',
            title: 'Двигать узел',
            body: 'Тяни узел или усик. Shift фиксирует угол.',
          },
          {
            id: 'curves.nodes.smooth',
            title: 'Сгладить',
            body: 'Двойной клик по узлу переключает сглаживание. Delete удаляет узел, если их больше двух.',
          },
        ],
      },
    ],
  },
  {
    id: 'color',
    title: 'Цвет',
    summary: 'Заливка, обводка, пипетка и палитра.',
    icon: 'color',
    lessons: [
      {
        id: 'color.paint',
        title: 'Заливка и обводка',
        summary: 'Стиль слоя без палитр и градиентов.',
        durationMin: 3,
        steps: [
          {
            id: 'color.paint.fill',
            title: 'Заливка',
            body: 'В инспекторе выбери цвет заливки или сними её кнопкой «Без заливки».',
            target: 'inspector.appearance',
          },
          {
            id: 'color.paint.stroke',
            title: 'Обводка',
            body: 'Задай цвет, толщину и окончания линии. «Без обводки» убирает контур.',
          },
          {
            id: 'color.paint.opacity',
            title: 'Прозрачность',
            body: 'Ползунок прозрачности работает для всего слоя.',
          },
        ],
      },
      {
        id: 'color.pick',
        title: 'Пипетка E',
        summary: 'Брать цвет с холста и из палитры.',
        durationMin: 3,
        steps: [
          {
            id: 'color.pick.tool',
            title: 'Пипетка',
            body: 'Нажми E и кликни по любому месту холста.',
            shortcutActionId: 'tool.eyedropper',
            target: 'tool.eyedropper',
          },
          {
            id: 'color.pick.apply',
            title: 'Куда',
            body: 'Пипетка берёт цвет в заливку или обводку — смотри подсказку внизу.',
          },
          {
            id: 'color.pick.palette',
            title: 'Палитра документа',
            body: 'В инспекторе собраны цвета текущего макета. Клик применяет цвет.',
          },
        ],
      },
    ],
  },
  {
    id: 'text',
    title: 'Текст',
    summary: 'Шесть шрифтов, трекинг и перевод в кривые.',
    icon: 'text',
    lessons: [
      {
        id: 'text.create',
        title: 'Текст T',
        summary: 'Создать и отредактировать надпись.',
        durationMin: 3,
        steps: [
          {
            id: 'text.create.create',
            title: 'Клик',
            body: 'Нажми T и кликни по холсту. Появится текст «Новый текст» и поле редактирования.',
            shortcutActionId: 'tool.text',
            target: 'tool.text',
          },
          {
            id: 'text.create.edit',
            title: 'Правка',
            body: 'Пиши прямо на холсте. Ctrl+Enter или Escape завершает, клик мимо — тоже.',
          },
          {
            id: 'text.create.align',
            title: 'Выравнивание',
            body: 'В инспекторе выбери слева, по центру или справа.',
            target: 'inspector.text',
          },
        ],
      },
      {
        id: 'text.style',
        title: 'Шрифт и трекинг',
        summary: 'Семейство, вес, межбуквенное расстояние.',
        durationMin: 3,
        steps: [
          {
            id: 'text.style.family',
            title: 'Шесть шрифтов',
            body: 'В списке шесть семейств с кириллицей. Вес — Regular или Bold.',
          },
          {
            id: 'text.style.tracking',
            title: 'Трекинг',
            body: 'Межбуквенное расстояние меняется ползунком.',
          },
          {
            id: 'text.style.outlines',
            title: 'В кривые',
            body: 'Ctrl+Shift+O превращает текст в редактируемый контур. Обратно в текст уже нельзя.',
            shortcutActionId: 'vector.textToOutlines',
          },
        ],
      },
    ],
  },
  {
    id: 'layers',
    title: 'Слои и маски',
    summary: 'Порядок, видимость, блокировка и Clipping Mask.',
    icon: 'layers',
    lessons: [
      {
        id: 'layers.stack',
        title: 'Порядок слоёв',
        summary: 'Кто выше и кто кого перекрывает.',
        durationMin: 3,
        steps: [
          {
            id: 'layers.stack.panel',
            title: 'Панель слоёв',
            body: 'Верхняя строка списка — самый верхний слой. Меняй порядок стрелками или перетаскиванием.',
            target: 'layers.root',
          },
          {
            id: 'layers.stack.visibility',
            title: 'Глаз и замок',
            body: 'Глаз скрывает слой, замок запрещает выделение и правку.',
          },
          {
            id: 'layers.stack.rename',
            title: 'Имя',
            body: 'Двойной клик по имени переименовывает слой.',
          },
        ],
      },
      {
        id: 'layers.mask',
        title: 'Обтравочная маска',
        summary: 'Показать только то, что попадает в контур.',
        durationMin: 4,
        steps: [
          {
            id: 'layers.mask.create',
            title: 'Создать',
            body: 'Выдели маску и слой под ней, затем нажми «Создать обтравочную маску».',
            target: 'inspector.vectorOps',
          },
          {
            id: 'layers.mask.behavior',
            title: 'Как работает',
            body: 'Маска показывает только то, что попадает в её контур. Её собственная заливка не рисуется.',
          },
          {
            id: 'layers.mask.release',
            title: 'Снять',
            body: 'Кнопка «Снять маску» возвращает слой к обычному виду.',
          },
        ],
      },
    ],
  },
  {
    id: 'paths',
    title: 'Контуры',
    summary: 'Булевы операции и составные контуры.',
    icon: 'paths',
    lessons: [
      {
        id: 'paths.boolean',
        title: 'Булевы операции',
        summary: 'Объединить, вычесть, пересечь и разделить.',
        durationMin: 4,
        steps: [
          {
            id: 'paths.boolean.unite',
            title: 'Объединить',
            body: 'Выдели два контура и нажми Unite — получится один.',
            target: 'inspector.vectorOps',
          },
          {
            id: 'paths.boolean.subtract',
            title: 'Вычесть',
            body: 'Subtract вырезает верхний контур из нижнего.',
          },
          {
            id: 'paths.boolean.other',
            title: 'Остальные',
            body: 'Intersect оставляет общее, Exclude — необщее, Divide делит на части.',
          },
        ],
      },
      {
        id: 'paths.compound',
        title: 'Составной контур',
        summary: 'Собрать части и сохранить дырки.',
        durationMin: 4,
        steps: [
          {
            id: 'paths.compound.combine',
            title: 'Ctrl+8',
            body: 'Собери выделенные контуры в один составной.',
            shortcutActionId: 'vector.combineCompound',
          },
          {
            id: 'paths.compound.holes',
            title: 'Дырки',
            body: 'Внутренний контур становится отверстием. Правило заливки переключается в инспекторе.',
          },
          {
            id: 'paths.compound.split',
            title: 'Ctrl+Shift+8',
            body: 'Разбивает составной контур обратно на части, сохраняя дырки в буквах.',
            shortcutActionId: 'vector.splitCompound',
          },
        ],
      },
    ],
  },
  {
    id: 'effects',
    title: 'Эффекты',
    summary: 'Деформация, объём, тень и размытие.',
    icon: 'effects',
    lessons: [
      {
        id: 'effects.warp',
        title: 'Деформация',
        summary: 'Живые искажения контура.',
        durationMin: 3,
        steps: [
          {
            id: 'effects.warp.menu',
            title: 'Эффекты → Деформация',
            body: 'Выбери стиль: флаг, волна, дуга, арка, выпуклость и другие.',
            target: 'menu.effects',
          },
          {
            id: 'effects.warp.dialog',
            title: 'Настройки',
            body: 'В окне задай силу и примени. Эффект остаётся живым, пока не разобрать оформление.',
          },
          {
            id: 'effects.warp.expand',
            title: 'Разобрать',
            body: 'Expand превращает эффект в обычные узлы контура.',
          },
        ],
      },
      {
        id: 'effects.depth',
        title: 'Объём и свет',
        summary: '3D, тень и свечение.',
        durationMin: 3,
        steps: [
          {
            id: 'effects.depth.3d',
            title: '3D',
            body: 'Поворот и выдавливание добавляют перспективу.',
          },
          {
            id: 'effects.depth.shadow',
            title: 'Тень',
            body: 'Падающая тень настраивается в «Эффекты → Стилизация».',
          },
          {
            id: 'effects.depth.glow',
            title: 'Свечение и размытие',
            body: 'Внешнее свечение и размытие по Гауссу — там же.',
          },
        ],
      },
    ],
  },
  {
    id: 'automation',
    title: 'Автоматика',
    summary: 'Выравнивание, повтор и привязки.',
    icon: 'automation',
    lessons: [
      {
        id: 'automation.align',
        title: 'Выравнивание',
        summary: 'Края, центры и промежутки.',
        durationMin: 3,
        steps: [
          {
            id: 'automation.align.align',
            title: 'Кнопки',
            body: 'Выдели несколько слоёв и выровняй по левому, центру или правому краю.',
            target: 'inspector.root',
          },
          {
            id: 'automation.align.distribute',
            title: 'Распределение',
            body: 'Распределение уравнивает промежутки по горизонтали или вертикали.',
          },
          {
            id: 'automation.align.artboard',
            title: 'По артборду',
            body: 'Отдельный режим центрирует выделение на артборде.',
          },
        ],
      },
      {
        id: 'automation.repeat',
        title: 'Повтор и зеркало',
        summary: 'Ряды, сетки, кольца и симметрия.',
        durationMin: 3,
        steps: [
          {
            id: 'automation.repeat.repeat',
            title: 'Повтор',
            body: 'Сделай ряд, столбец, сетку или кольцо копий с заданным шагом.',
          },
          {
            id: 'automation.repeat.mirror',
            title: 'Зеркало',
            body: 'Зеркальная копия относительно оси артборда — для симметричных пар.',
          },
          {
            id: 'automation.repeat.rotate',
            title: 'Поворот',
            body: 'Поверни каждый слой на точный угол, а не только на 90°.',
          },
        ],
      },
      {
        id: 'automation.guides',
        title: 'Привязки',
        summary: 'Smart Guides, сетка и каркас.',
        durationMin: 3,
        steps: [
          {
            id: 'automation.guides.smart',
            title: 'Smart Guides',
            body: 'При перетаскивании появляются подсказки по краям и центрам соседних слоёв.',
          },
          {
            id: 'automation.guides.grid',
            title: 'Сетка',
            body: 'Включи сетку и привязку к ней в настройках или на панели.',
            shortcutActionId: 'view.toggleGrid',
          },
          {
            id: 'automation.guides.outline',
            title: 'Каркас',
            body: 'Ctrl+Y показывает только контуры — удобно проверять геометрию.',
          },
        ],
      },
    ],
  },
  {
    id: 'ai',
    title: 'ИИ',
    summary: 'Командная строка и контроль результата.',
    icon: 'ai',
    lessons: [
      {
        id: 'ai.chat',
        title: 'Командная строка',
        summary: 'Промпт вместо ручной рутины.',
        durationMin: 3,
        steps: [
          {
            id: 'ai.chat.open',
            title: 'Ctrl+K',
            body: 'Открой командную строку и напиши, что сделать.',
            shortcutActionId: 'app.commandBar',
            target: 'topbar.commandBar',
          },
          {
            id: 'ai.chat.describe',
            title: 'Промпт',
            body: 'Опиши результат словами: «сделай стикер с обводкой» или «выровняй по центру».',
          },
          {
            id: 'ai.chat.result',
            title: 'Результат',
            body: 'ИИ вызывает инструменты редактора. Всё остаётся вектором и редактируется.',
          },
        ],
      },
      {
        id: 'ai.control',
        title: 'Контроль',
        summary: 'Провайдеры, вложения и откат.',
        durationMin: 3,
        steps: [
          {
            id: 'ai.control.providers',
            title: 'Провайдеры',
            body: 'Gemini, Anthropic, Ollama или OpenAI-совместимый API. Ключ хранится в настройках.',
            target: 'topbar.settings',
          },
          {
            id: 'ai.control.attachments',
            title: 'Вложения',
            body: 'Прикрепи PNG или JPEG, если модель понимает изображения.',
          },
          {
            id: 'ai.control.undo',
            title: 'Один Ctrl+Z',
            body: 'Серия действий ИИ откатывается одним шагом. «Стоп» прерывает задачу.',
          },
        ],
      },
    ],
  },
  {
    id: 'export',
    title: 'Экспорт',
    summary: 'Проект, вектор, растр и PSD.',
    icon: 'export',
    lessons: [
      {
        id: 'export.vector',
        title: 'Векторный экспорт',
        summary: 'SVG, AI и рабочий файл.',
        durationMin: 3,
        steps: [
          {
            id: 'export.vector.svg',
            title: 'SVG',
            body: 'Файл → Экспорт → SVG. Контуры, текст и маски остаются векторными.',
            target: 'menu.file',
          },
          {
            id: 'export.vector.ai',
            title: 'AI',
            body: 'Экспорт в .ai — это PDF-поток с кривыми, текстом и масками.',
          },
          {
            id: 'export.vector.project',
            title: 'Проект',
            body: 'Ctrl+S сохраняет .locus со сценой и картинками. Это не экспорт, а рабочий файл.',
            shortcutActionId: 'file.save',
          },
        ],
      },
      {
        id: 'export.raster',
        title: 'Растр и PSD',
        summary: 'PNG, JPG и многослойный Photoshop.',
        durationMin: 3,
        steps: [
          {
            id: 'export.raster.png',
            title: 'PNG',
            body: 'Быстрый экспорт PNG или окно экспорта в растр с масштабом.',
          },
          {
            id: 'export.raster.jpg',
            title: 'JPG',
            body: 'Для фото и превью без прозрачности.',
          },
          {
            id: 'export.raster.psd',
            title: 'PSD',
            body: 'Многослойный PSD открывается в Photoshop со слоями и текстом.',
          },
        ],
      },
    ],
  },
];

export const TUTORIAL_CHAPTER_BY_ID: Record<string, TutorialChapter> =
  Object.fromEntries(TUTORIAL_CHAPTERS.map((chapter) => [chapter.id, chapter]));

export const TUTORIAL_LESSON_BY_ID: Record<string, TutorialLesson> =
  Object.fromEntries(
    TUTORIAL_CHAPTERS.flatMap((chapter) =>
      chapter.lessons.map((lesson) => [lesson.id, lesson])
    )
  );

export const TUTORIAL_STEP_BY_ID: Record<string, TutorialStep> = Object.fromEntries(
  TUTORIAL_CHAPTERS.flatMap((chapter) =>
    chapter.lessons.flatMap((lesson) =>
      lesson.steps.map((step) => [step.id, step])
    )
  )
);

export const TUTORIAL_LESSONS_BY_CHAPTER: Record<string, TutorialLesson[]> =
  Object.fromEntries(
    TUTORIAL_CHAPTERS.map((chapter) => [chapter.id, chapter.lessons])
  );

export const TUTORIAL_STATS = {
  chapters: TUTORIAL_CHAPTERS.length,
  lessons: Object.keys(TUTORIAL_LESSON_BY_ID).length,
  steps: Object.keys(TUTORIAL_STEP_BY_ID).length,
};
