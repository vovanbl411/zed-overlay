import {renderReleaseGates, traceReleaseGates} from './handbook.js';

const packageDir = 'app-editors/zed/';
const oldEbuild = packageDir + 'zed-1.28.1.ebuild';
const oldPatch = packageDir + 'files/zed-1.28.1-wayland-only.patch';
const candidate = packageDir + 'zed-1.29.0.ebuild';
const patch = packageDir + 'files/zed-1.29.0-wayland-only.patch';
const extra = packageDir + 'notes.txt';
const original = [packageDir + 'Manifest', oldPatch, oldEbuild];
const ebuildPattern = /^app-editors\/zed\/zed-[0-9]+\.[0-9]+\.[0-9]+\.ebuild$/;

function write(lab, selector, value) {
  lab.querySelector(selector).textContent = value;
}

function onlyIn(first, second) {
  return first.filter((path) => !second.includes(path));
}

function listed(rows, separator = '') {
  return rows.map((row) => row + separator).join('\n') || '∅';
}

function stage(lab, selected) {
  for (const item of lab.querySelectorAll('[data-stage]')) {
    const active = item.dataset.stage === selected;
    item.classList.toggle('shell-focus', active);
    if (active) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
  for (const part of lab.querySelectorAll('[data-fragment]')) {
    part.classList.toggle('candidate-highlight', part.dataset.fragment === selected);
  }
}

function branch(lab, scenario, highlight) {
  const newRelease = 'Result: new-release';
  const upToDate = 'Result: up-to-date';
  const log = {
    new: [newRelease],
    current: [upToDate],
    missing: ['Пример: подготовка завершена'],
    similar: ['Result: new-release (пример)'],
    both: [upToDate, newRelease],
  }[scenario];
  const firstMatch = log.includes(newRelease);
  const secondMatch = !firstMatch && log.includes(upToDate);
  const matched = firstMatch ? newRelease : secondMatch ? upToDate : '';
  const logView = lab.querySelector('[data-branch-log]');
  logView.replaceChildren();
  log.forEach((line, index) => {
    if (index) logView.append('\n');
    if (line !== matched) {
      logView.append(line);
      return;
    }
    const mark = document.createElement('mark');
    mark.textContent = line;
    logView.append(mark);
  });

  write(lab, '[data-first-grep]', firstMatch ? '0 · совпадение' : '1 · совпадений нет');
  write(lab, '[data-second-grep]', firstMatch ? 'Пропущен' : secondMatch ? '0 · совпадение' : '1 · совпадений нет');
  renderReleaseGates(lab, [
    firstMatch ? 'PASS' : 'FAIL',
    firstMatch ? 'SKIP' : secondMatch ? 'PASS' : 'FAIL',
    firstMatch || secondMatch ? 'PASS' : 'SKIP',
  ]);
  if (firstMatch) {
    highlight(lab, 142, 143, 144, 145, 146, 147);
    write(lab, '[data-branch-next]', 'Проверить пути → запустить контейнерную проверку → проверить Manifest');
    return scenario === 'both'
      ? 'Оба маркера есть. Строка 142 проверяет new-release первой, поэтому ветка else и второй grep пропущены.'
      : 'Первая проверка вернула 0. Открыта ветка нового релиза.';
  }
  if (secondMatch) {
    highlight(lab, 148, 149, 150, 151, 152, 153, 154);
    write(lab, '[data-branch-next]', 'Записать сводку → собрать массив → проверить, что он пуст');
    return 'Первая проверка вернула 1. В else второй grep нашёл up-to-date, ветка продолжается.';
  }
  highlight(lab, 142, 149);
  write(lab, '[data-branch-next]', 'Запись сводки и проверка массива пропущены');
  return 'Гипотетический журнал. Оба grep вернули 1. В else errexit останавливает скрипт на строке 149.';
}

function fileComparison(lab, fields) {
  const scenario = fields.scenario.value;
  const after = {
    pair: [...original, candidate, patch],
    ebuild: [...original, candidate],
    patch: [...original, patch],
    unexpected: [...original, candidate, patch, extra],
    removed: [...original.filter((path) => path !== oldEbuild), candidate, patch],
    edited: [...original],
  }[scenario].sort();
  const columns = [onlyIn(original, after), onlyIn(after, original), original.filter((path) => after.includes(path))];
  const suppressed = [];
  const output = [];
  lab.querySelectorAll('[data-column]').forEach((column, index) => {
    const number = index + 1;
    const enabled = fields['column' + number].checked;
    column.dataset.suppressed = String(!enabled);
    write(column, '[data-column-state]', enabled ? 'В выводе' : 'Скрыта ключом -' + number);
    write(column, '[data-column-records]', listed(columns[index]));
    if (enabled) output.push(...columns[index]);
    else suppressed.push(number);
  });

  const options = '-z' + (suppressed.length ? ' -' + suppressed.join('') : '');
  write(lab, '[data-compare-command]', 'comm ' + options + ' "$before_paths" <(find app-editors/zed -type f -print0 | sort -z)');
  write(lab, '[data-compare-after]', listed(after.map((path) =>
    scenario === 'edited' && path === oldEbuild ? path + ' [изменилось содержимое]' : path)));
  write(lab, '[data-compare-output]', listed(output.sort(), ' ␀'));
  return `comm ${options} · записей на выходе: ${output.length}.` +
    (scenario === 'edited' ? ' Изменились байты ebuild, а его путь по-прежнему в общей колонке.' : '');
}

function processSubstitution(lab, selected) {
  stage(lab, selected);
  return {
    find: 'find перечисляет обычные файлы и отправляет записи с NUL в stdin sort.',
    sort: 'sort читает stdin и выдаёт упорядоченные NUL-разделённые записи.',
    inner: 'Внутреннее <(…) подставляет читаемый путь. comm получает этот путь вторым аргументом после before_paths.',
    comm: 'comm читает два отсортированных списка по двум путям и отправляет добавленные записи в stdout.',
    outer: 'Внешнее <(…) даёт читаемый путь к stdout comm. Bash использует его в перенаправлении.',
    redirect: 'Первый < открывает путь из внешней подстановки как stdin для mapfile.',
    mapfile: 'mapfile читает записи с NUL из stdin. Каждая запись становится элементом candidate_paths.',
  }[selected];
}

function arrays(lab, scenario, highlight) {
  const rows = {
    pair: [patch, candidate], empty: [], one: [candidate], three: [patch, extra, candidate],
    spaces: [packageDir + 'notes for review.txt', candidate],
  }[scenario];
  write(lab, '[data-array-input]', listed(rows, ' ␀'));
  write(lab, '[data-array-length]', rows.length);
  write(lab, '[data-array-first]', rows[0] ?? 'Элемент отсутствует');
  write(lab, '[data-array-words]', listed(rows.map((row, index) => (index + 1) + ' → «' + row + '»')));
  const cells = rows.map((value, index) => {
    const cell = document.createElement('li');
    const name = document.createElement('strong');
    const path = document.createElement('code');
    cell.className = 'flow-node';
    name.textContent = `candidate_paths[${index}]`;
    path.textContent = value;
    cell.append(name, path);
    return cell;
  });
  lab.querySelector('[data-array-cells]').replaceChildren(...cells);
  highlight(lab, 17, 20);

  if (rows.length === 0) return 'Вход пуст. Длина массива 0. Элемента [0] нет, а раскрытие "${candidate_paths[@]}" даёт ноль аргументов.';
  if (scenario === 'spaces') return 'Путь с пробелами остаётся одним элементом и передаётся в printf одним аргументом.';
  return `mapfile прочитал записи: ${rows.length}. Индексы начинаются с 0, а printf получит отдельный аргумент для каждой записи.`;
}

function regex(lab, scenario, highlight) {
  const [path, reason] = {
    stable: [candidate, 'каталог, имя пакета, три числовых компонента и суффикс совпали.'],
    revision: [candidate.replace('.ebuild', '-r1.ebuild'), 'после версии ожидается сразу .ebuild, а здесь есть -r1.'],
    pre: [candidate.replace('.ebuild', '_pre1.ebuild'), 'суффикс _pre1 не входит в шаблон.'],
    short: [packageDir + 'zed-1.29.ebuild', 'отсутствует третий числовой компонент.'],
    dots: [packageDir + 'zed-1x29x0.ebuild', 'между числами нужны буквальные точки.'],
    patch: [patch, 'после каталога пакета нужен zed-, а не files/.'],
    directory: [candidate.replace('/zed/', '/other/'), 'буквальный префикс app-editors/zed/ не совпадает.'],
  }[scenario];
  const match = ebuildPattern.test(path);
  write(lab, '[data-regex-path]', path);
  lab.dataset.match = String(match);
  highlight(lab, 20);
  return `${match ? 'MATCH' : 'NO MATCH'} · ${reason}`;
}

function patchPath(lab, selected) {
  stage(lab, selected);
  return {
    input: 'Вход — полный относительный путь ebuild кандидата.',
    suffix: 'Подстановка %.ebuild удаляет суффикс из строки пути.',
    basename: 'basename получает путь без .ebuild и оставляет имя после последнего /.',
    patch: 'Каталог files/ и суффикс -wayland-only.patch обрамляют имя версии.',
  }[selected];
}

function tree(paths, added = []) {
  const files = paths.filter((path) => path.startsWith(packageDir + 'files/'));
  const root = paths.filter((path) => !files.includes(path));
  const display = (path) => path.split('/').at(-1) + (added.includes(path) ? ' [новый]' : '');
  return [
    '├── ' + display(root[0]),
    '├── files/',
    ...files.map((path, index) => '│   ' + (index === files.length - 1 ? '└── ' : '├── ') + display(path)),
    ...root.slice(1).map((path, index) => (index === root.length - 2 ? '└── ' : '├── ') + display(path)),
  ].join('\n');
}

function candidateValidation(lab, scenario, highlight) {
  const before = (['existing', 'unrelated'].includes(scenario) ? [...original, patch] : [...original]).sort();
  const added = {
    existing: [candidate], pair: [candidate, patch], missing: [candidate],
    unrelated: [candidate, extra], three: [candidate, patch, extra],
    'two-ebuilds': [candidate, packageDir + 'zed-1.29.1.ebuild'], 'no-ebuild': [extra],
  }[scenario].sort();
  const after = [...before, ...added].sort();
  const matched = added.filter((path) => ebuildPattern.test(path)).join('\n');
  const derived = matched ? packageDir + 'files/' + matched.split('/').at(-1).replace(/\.ebuild$/, '') + '-wayland-only.patch' : '';
  const statuses = Array(8).fill('SKIP');
  const one = added.length === 1;
  const gates = [20, 21, 22, 23, 25, 27, 28, 33];
  let branchText = 'До выбора ветки по числу путей скрипт не дошёл.';
  let compared = false;
  let failure = -1;

  if (!matched) failure = 0;
  else if (!after.includes(matched)) failure = 2;
  else if (!after.includes(derived)) failure = 3;
  else if (one) {
    branchText = 'Ветка одного пути · проверка равенства на строке 25.';
    statuses[4] = added[0] === matched ? 'PASS' : 'FAIL';
    if (statuses[4] === 'FAIL') failure = 4;
  } else {
    branchText = 'Ветка двух путей · проверка количества на строке 27.';
    if (added.length !== 2) failure = 5;
    else {
      compared = true;
      statuses[5] = 'PASS';
      const expected = [matched, derived].sort();
      statuses[6] = added.every((path, index) => path === expected[index]) ? 'PASS' : 'FAIL';
      if (statuses[6] === 'FAIL') failure = 6;
    }
  }

  for (let index = 0; index < 4; index++) {
    if (failure === -1 || index < failure) statuses[index] = 'PASS';
  }
  if (failure !== -1) statuses[failure] = 'FAIL';
  else statuses[7] = 'PASS';
  renderReleaseGates(lab, statuses);
  const comparedLines = [28, 29, 30];
  const lines = failure === -1
    ? [24, ...(one ? [25] : [27, ...comparedLines]), 33, 34, 35, 36]
    : failure === 6 ? comparedLines : [gates[failure]];
  highlight(lab, ...lines);
  write(lab, '[data-validation-before]', tree(before));
  write(lab, '[data-validation-after]', tree(after, added));
  write(lab, '[data-validation-array]', listed(added.map((path, index) => `[${index}] ${path}`)));
  write(lab, '[data-validation-ebuild]', matched || 'Нет совпадений');
  write(lab, '[data-validation-patch]', derived || 'Не вычислялся');
  write(lab, '[data-validation-branch]', branchText);
  write(lab, '[data-validation-actual]', compared ? listed(added) : 'Не вычислялся');
  write(lab, '[data-validation-expected]', compared ? listed([matched, derived].sort()) : 'Не вычислялся');
  const filename = matched.split('/').at(-1).replace(/\.ebuild$/, '');
  write(lab, '[data-validation-identifiers]',
    failure === -1 ? '=app-editors/' + filename + '::zed-overlay\n' + filename.slice('zed-'.length) : 'Пропущены');

  return {
    existing: 'PASS · добавлен только ebuild. Ожидаемый patch уже был в дереве. Можно вычислить atom и версию.',
    pair: 'PASS · cmp вернул 0. Добавлены ровно ebuild и ожидаемый patch. Можно вычислить atom и версию.',
    missing: 'FAIL · строка 23. Ожидаемого patch нет. Проверки числа путей и идентификаторы пропущены.',
    unrelated: 'FAIL · строки 28–30. cmp вернул 1. Вместо нового patch в массиве посторонний файл. Идентификаторы пропущены.',
    three: 'FAIL · строка 27. В массиве три пути. cmp и вычисление идентификаторов пропущены.',
    'two-ebuilds': 'FAIL · строка 22. grep выдал две строки, а test -f получил их одним аргументом. Поздние проверки пропущены.',
    'no-ebuild': 'FAIL · строка 20. grep вернул 1. Присваивание завершилось ошибкой, следующие команды пропущены.',
  }[scenario];
}

function identifiers(lab, selected, highlight) {
  const filename = 'zed-1.29.0.ebuild';
  const atom = '=app-editors/' + filename;
  const [line, input, removed, pattern, output, explanation] = {
    'atom-prefix': [33, candidate, packageDir, '${candidate_ebuild##*/}', filename,
      'Шаблон */ захватывает префикс до последнего /, остаётся имя файла.'],
    'atom-category': [33, filename, '', '=app-editors/', atom,
      'Префикс =app-editors/ добавляется к имени файла.'],
    'atom-repository': [34, atom, '.ebuild', '${candidate_atom%.ebuild}::zed-overlay', '=app-editors/zed-1.29.0::zed-overlay',
      'Bash снимает суффикс .ebuild и добавляет ограничение репозитория ::zed-overlay.'],
    'version-prefix': [35, candidate, packageDir + 'zed-', '${candidate_ebuild##*/zed-}', '1.29.0.ebuild',
      'Шаблон */zed- снимает путь к каталогу и начало имени пакета.'],
    'version-suffix': [36, '1.29.0.ebuild', '.ebuild', '${candidate_version%.ebuild}', '1.29.0',
      'Удаление .ebuild оставляет три числовых компонента версии.'],
  }[selected];

  const start = removed ? input.indexOf(removed) : input.length;
  const mark = document.createElement('mark');
  mark.textContent = removed;
  lab.querySelector('[data-transform-input]').replaceChildren(input.slice(0, start), mark, input.slice(start + removed.length));
  write(lab, '[data-transform-pattern]', pattern);
  write(lab, '[data-transform-output]', output);
  stage(lab, selected);
  highlight(lab, line);
  return explanation;
}

function transfer(lab, selected, highlight) {
  const [caller, callee, message] = {
    version: [145, 5, 'candidate_version передаёт версию через $1 в переменную version.'],
    ebuild: [145, 6, 'Полный путь ebuild становится вторым аргументом и записывается в candidate.'],
    patch: [146, 7, 'Полный путь patch становится третьим аргументом и записывается в patch.'],
    overlay: [146, 8, 'Временный каталог становится четвёртым аргументом и записывается в overlay.'],
  }[selected];
  stage(lab, selected);
  highlight(lab, caller, callee);
  return message;
}

function manifest(lab, scenario, highlight) {
  const [failure, prepared, primary, after, note, status] = {
    updated: [-1, 'aaaa…aaaa', '140 · равен исходному', 'bbbb…bbbb', 'Manifest изменился, .git отсутствует',
      'PASS · первичная подготовка сохранила Manifest, контейнер обновил его. Следующие проверки достижимы.'],
    early: [0, 'bbbb…bbbb', '140 · отличается от исходного', '—', 'Контейнер не запущен',
      'FAIL · строка 140. Manifest изменился слишком рано. Вызов контейнера и проверки после него пропущены.'],
    'container-error': [1, 'aaaa…aaaa', '140 · равен исходному', '—', 'Состояние после ошибки не проверялось',
      'FAIL · строки 144–146. Скрипт контейнера вернул ошибку. Функция validate_manifest_update не вызвана.'],
    git: [2, 'aaaa…aaaa', '140 · равен исходному', 'bbbb…bbbb', '.git появился. Сравнение хешей пропущено',
      'FAIL · строка 42. Проверка обнаружила .git. Строка 49 и следующая фаза пропущены.'],
    same: [3, 'aaaa…aaaa', '140 · равен исходному', 'aaaa…aaaa', 'Manifest прежний, .git отсутствует',
      'FAIL · строка 49. Manifest остался прежним после контейнера. Следующая фаза пропущена.'],
  }[scenario];
  const lines = [140, 144, 42, 49];
  const gitOK = 'Git-less workspace after container validation: OK';
  const messages = {
    updated: gitOK + '\nManifest update after container validation: OK',
    git: 'ERROR: disposable workspace gained .git',
    same: gitOK + '\nERROR: app-editors/zed/Manifest was not updated by container validation',
  };
  traceReleaseGates(lab, lines.length, failure);
  highlight(lab, ...(failure === -1 ? lines : [lines[failure]]));
  write(lab, '[data-manifest-prepared]', prepared);
  write(lab, '[data-manifest-primary]', primary);
  write(lab, '[data-manifest-container]', after);
  write(lab, '[data-manifest-container-note]', note);
  write(lab, '[data-manifest-message]', messages[scenario] ?? 'Функция не вызвана');
  return status;
}

export function candidateLabs(highlight) {
  return {
    'result-branch': (lab, fields) => branch(lab, fields.scenario.value, highlight),
    'file-comparison': fileComparison,
    process: (lab, fields) => processSubstitution(lab, fields.stage.value),
    arrays: (lab, fields) => arrays(lab, fields.scenario.value, highlight),
    regex: (lab, fields) => regex(lab, fields.scenario.value, highlight),
    'patch-path': (lab, fields) => patchPath(lab, fields.stage.value),
    'candidate-validation': (lab, fields) => candidateValidation(lab, fields.scenario.value, highlight),
    identifiers: (lab, fields) => identifiers(lab, fields.stage.value, highlight),
    transfer: (lab, fields) => transfer(lab, fields.stage.value, highlight),
    'manifest-lifecycle': (lab, fields) => manifest(lab, fields.scenario.value, highlight),
    'up-to-date': (lab, fields) => {
      const added = fields.scenario.value === 'extra';
      write(lab, '[data-current-paths]', added ? '[0] ' + extra + ' · длина 1' : '∅ · длина 0');
      highlight(lab, 154);
      return added
        ? 'FAIL · строка 154. Добавился один путь. Маркер уже записан в сводку, дальнейшие проверки пропущены.'
        : 'PASS · новых путей нет, условие на строке 154 выполнено.';
    },
  };
}
