import {traceReleaseGates} from './handbook.js';

const runnerTemp = '/home/runner/work/_temp';
const overlay = runnerTemp + '/zed-overlay';
const candidate = overlay + '/app-editors/zed/zed-1.29.0.ebuild';
const patch = overlay + '/app-editors/zed/files/zed-1.29.0-wayland-only.patch';
const ref = 'refs/tags/v1.29.0';
const peeledRef = ref + '^{}';
const tagObject = '1'.repeat(40);
const commit = '2'.repeat(40);
const movedCommit = '3'.repeat(40);
const empty = '""';
const pending = '—';
const remoteResponses = {
  light: [[commit, ref]],
  annotated: [[tagObject, ref], [commit, peeledRef]],
  empty: [],
  unexpected: [[commit, 'refs/tags/other']],
  malformed: [['broken', ref]],
};

function show(lab, values) {
  for (const [name, text] of Object.entries(values)) {
    lab.querySelector(`[data-value="${name}"]`).textContent = text;
  }
}

function openActiveSources(lab, lines) {
  lab.querySelectorAll('[data-source-preview]').forEach((preview) => {
    preview.open = lines.some((line) => preview.querySelector(`[data-line="${line}"]`));
  });
}

function transfer(lab, fields, highlight) {
  const index = fields.stage.selectedIndex;
  lab.querySelectorAll('[data-stage]').forEach((item, position) => {
    item.classList.toggle('shell-focus', position === index);
  });
  highlight(lab, [145, 145, 146, 146][index], 5 + index);
  return [
    '$candidate_version переходит через $1 в version.',
    'Полный путь к ebuild переходит через $2 в candidate.',
    'Полный путь к patch переходит через $3 в patch.',
    'Путь временной копии оверлея переходит через $4 в overlay.',
  ][index];
}

function args(lab, fields, highlight) {
  const scenario = fields.scenario.value;
  const failure = {ok: -1, version: 0, empty: 0, candidate: 1, patch: 2, overlay: 3, temp: 4, format: 5}[scenario];
  const values = {version: '1.29.0', candidate, patch, overlay, temp: runnerTemp};
  if (scenario === 'empty') values.version = empty;
  else if (scenario === 'format') values.version = '1.29';
  else if (scenario !== 'ok') {
    values[scenario] = {version: 'аргумент отсутствует', candidate: 'вызов закончился после $1',
      patch: 'вызов закончился после $2', overlay: 'вызов закончился после $3', temp: 'переменная не задана'}[scenario];
    // A missing positional parameter means there are no later arguments.
    if (failure < 3) Object.keys(values).slice(failure + 1, 4).forEach((key) => { values[key] = 'аргумент отсутствует'; });
  }
  show(lab, values);
  traceReleaseGates(lab, 6, failure);
  highlight(lab, failure === -1 ? 10 : 5 + failure);
  if (failure === -1) return 'Все шесть проверок прошли. Bash доходит до mkdir.';
  const reason = [
    'candidate version required', 'candidate ebuild required', 'candidate patch required',
    'disposable overlay required', 'RUNNER_TEMP: parameter null or not set', 'regex вернула статус 1',
  ][failure];
  return `Первая ошибка на строке ${5 + failure} · ${reason}. До mkdir скрипт не доходит.`;
}

const workspaceNodes = {
  work: [0, 'Первый mkdir'],
  dist: [1, 'Второй mkdir'],
  cache: [1, 'Второй mkdir'],
  logs: [1, 'Второй mkdir'],
  checkout: [3, 'Создаётся при clone', 'checkout'],
  source: [5, 'Создаётся после проверки архива'],
  source_dir: [5, 'Создаётся при распаковке', 'source_dir'],
  source_archive: [4, 'Создаётся при скачивании', 'source_archive'],
  archive: [6, 'Позднее · генерация или повторное использование', 'archive'],
  metadata: [6, 'Позднее · генерация или повторное использование', 'metadata'],
};

function workspace(lab, fields, highlight) {
  const step = fields.step.selectedIndex;
  const exists = fields.scenario.value === 'exists';
  lab.querySelectorAll('[data-node]').forEach((item) => {
    const name = item.dataset.node;
    const [created, action, variable] = workspaceNodes[name];
    const present = exists ? name === 'work' : step >= created;
    item.classList.toggle('shell-path-current', exists ? name === 'work' : created === step || (step === 2 && !!variable));
    item.dataset.present = String(present);
    item.querySelector('[data-state]').textContent = exists
      ? (present ? 'Уже существовал до mkdir' : 'Содержимое прежнего каталога не проверялось')
      : present ? 'На диске' : `${variable && step >= 2 ? `Путь в ${variable} задан. ` : ''}Ещё нет · ${action}`;
  });
  const lines = exists ? [11] : [[11], [12], [13, 14, 15, 16, 17, 18, 19, 20], [41], [44, 45, 46], [51, 52], []][step];
  highlight(lab, ...lines);
  openActiveSources(lab, lines);
  if (exists) return 'Первый mkdir вернул ошибку. Дальнейшие шаги остановлены. Прежний каталог остаётся.';
  return [
    'Первый mkdir создал zed-independent. Вложенные пути ещё впереди.',
    'Второй mkdir создал dist, cache и logs.',
    'Переменные получили пути и теги, SECONDS записан в start_total. Новых файлов нет.',
    'На строке 41 Git создаёт checkout.',
    'Строки 44–46 записывают исходный tar.gz в dist.',
    'После успешной сверки строки 51–52 создают source и распаковывают zed-1.29.0.',
    'Crates-архив и JSON появляются на более позднем этапе.',
  ][step];
}

const timedExamples = {
  actual: ['Upstream source acquisition', ['acquire_source'], 19],
  print: ['Печать двух значений', ['printf', '<%s>\\n', 'один аргумент', 'второй'], 12],
  fail: ['Сравнение строк', ['test', 'один аргумент', '=', 'другой'], null],
};

function timing(lab, fields, highlight) {
  const step = fields.step.selectedIndex;
  const scenario = fields.scenario.value;
  const [label, command, end] = timedExamples[scenario];
  const params = (args) => args.map((arg, index) => `$${index + 1} = ${arg}`).join('\n');
  const started = 12;
  const success = end !== null;
  show(lab, {
    before: params([label, ...command]),
    label: step >= 1 ? label : pending,
    after: step >= 1 ? params(command) : pending,
    command: step >= 2 ? command.map((arg) => command.length === 1 ? arg : JSON.stringify(arg)).join(' ') : pending,
    timer: step < 2 ? pending : `${started} → ${success ? (step === 3 ? end : '…') : 'не прочитан'}`,
    summary: step < 3 ? pending : success ? `${label}: ${end - started}s` : 'Не вызвана',
  });
  const code = lab.querySelector('[data-line="22"] code');
  const original = code.textContent;
  const wrappedCommand = 'local started=$SECONDS; "$@"';
  const fragment = ['', 'local label="$1"; shift', wrappedCommand,
    success ? 'summary "$label: $((SECONDS - started))s"' : wrappedCommand][step];
  const marker = document.createElement('span');
  marker.className = 'acq-code-fragment';
  marker.textContent = fragment;
  const index = original.indexOf(fragment);
  if (fragment) code.replaceChildren(original.slice(0, index), marker, original.slice(index + fragment.length));
  else code.textContent = original;
  highlight(lab, ...(step === 0 ? (scenario === 'actual' ? [151] : []) : step === 3 && success ? [21, 22] : [22]));
  return [
    scenario === 'actual' ? 'Строка 151 передаёт timed два аргумента.' : 'Учебный вызов. Каждая строка показывает один отдельный параметр.',
    'Первый аргумент остаётся в label. shift сдвигает остальные на одну позицию.',
    success ? (scenario === 'actual' ? 'Bash вызывает функцию acquire_source.' : 'printf получает «один аргумент» целиком и печатает <один аргумент> и <второй> на отдельных строках.')
      : 'test вернул 1. Errexit останавливает выполнение.',
    success ? `summary дописывает время · ${end} − ${started} = ${end - started} с.` : 'Вычисление длительности пропущено, summary не вызвана.',
  ][step];
}

function git(lab, fields, highlight) {
  const scenario = fields.scenario.value;
  lab.querySelectorAll('[data-tag-type]').forEach((row) => {
    row.classList.toggle('shell-focus', row.dataset.tagType === scenario);
  });
  const lines = [26, scenario === 'light' ? 29 : 30];
  highlight(lab, ...lines);
  openActiveSources(lab, lines);
  return scenario === 'light'
    ? 'Прямая запись содержит ID коммита. Отдельной peeled-записи нет. Все ID учебные.'
    : 'Прямая запись содержит ID объекта тега. Peeled-запись показывает ID коммита.';
}

const recordText = ([object, name]) => name ? `${object}⇥${name}` : '⟨пустая строка⟩';
const rawText = (records) => records.length ? records.map(recordText).join('\n') : '⟨пустой stdout⟩';

function remote(lab, fields, highlight) {
  const records = remoteResponses[fields.scenario.value];
  show(lab, {raw: rawText(records)});
  const body = lab.querySelector('[data-remote-fields]');
  body.replaceChildren();
  for (const record of records) {
    const row = body.insertRow();
    for (const value of record) {
      const code = document.createElement('code');
      code.textContent = value;
      row.insertCell().append(code);
    }
  }
  highlight(lab, 26);
  return {
    light: 'Одна прямая запись.',
    annotated: 'Две записи. Первая указывает на объект тега, вторая — на разыменованную цель.',
    empty: 'Сам по себе пустой stdout возможен при успешном ls-remote без совпадений.',
    unexpected: 'Учебный ответ с именем вне двух ожидаемых ссылок. Решение принимает case.',
    malformed: 'Учебный ответ с некорректным ID. Захват stdout сам по себе его не проверяет.',
  }[fields.scenario.value];
}

function read(lab, fields, highlight) {
  const records = remoteResponses[fields.scenario.value];
  const input = records.length ? records : [['', '']];
  const step = fields.step.selectedIndex;
  const count = Math.min(Math.floor((step + 1) / 2), input.length);
  const current = input[count - 1];
  const returning = step >= 2 && current && current[1] !== ref && current[1] !== peeledRef;
  const eof = !returning && step > input.length * 2;
  const branch = current?.[1] === ref ? 'direct' : current?.[1] === peeledRef ? 'peeled' : '*';
  // These are the values after any completed case branches.
  const direct = input.slice(0, Math.floor(step / 2)).find((record) => record[1] === ref)?.[0] ?? empty;
  const peeled = input.slice(0, Math.floor(step / 2)).find((record) => record[1] === peeledRef)?.[0] ?? empty;
  show(lab, {
    raw: rawText(records),
    line: eof ? 'EOF' : current ? recordText(current) : pending,
    object: eof ? empty : current ? current[0] || empty : pending,
    ref: eof ? empty : current ? current[1] || empty : pending,
    branch: step === 0 || eof || step % 2 && !returning ? pending : branch === '*' ? '* → return 1' : `${current[1]} → ${branch}`,
    direct, peeled,
    remaining: input.slice(count).map(recordText).join('\n') || 'EOF',
  });
  if (!step) {
    highlight(lab, 33);
    return records.length ? 'Here-string подаёт строки и добавляет завершающий перевод строки.' : 'Пустая строка refs плюс добавленный перевод строки дают одну пустую запись.';
  }
  if (returning) {
    highlight(lab, 31);
    return step === 2 ? 'case выбирает *. Unexpected upstream tag reference → stderr, return 1.'
      : 'Функция уже вернула 1. Дальнейшие попытки read пропущены.';
  }
  if (eof) {
    highlight(lab, 27);
    return 'read достиг EOF и вернул 1. Тело цикла больше не выполняется.';
  }
  if (step % 2) {
    highlight(lab, 27);
    return current[1] ? 'read вернул 0. Поля разделены табуляцией.' : 'read вернул 0. Строка прочитана, оба поля пусты.';
  }
  highlight(lab, 28, branch === 'direct' ? 29 : 30);
  return `case выполнил присваивание в ${branch}.`;
}

function resolve(lab, fields, highlight) {
  const scenario = fields.scenario.value;
  const inherit = fields.inherit.checked;
  const records = remoteResponses[scenario];
  const direct = records.find((record) => record[1] === ref)?.[0];
  const peeled = records.find((record) => record[1] === peeledRef)?.[0];
  const rejection = scenario === 'empty' || scenario === 'unexpected';
  const malformed = scenario === 'malformed';
  const failed = rejection || malformed && inherit;
  const stdout = failed ? empty : peeled ?? direct;
  show(lab, {direct: direct ?? empty, peeled: peeled ?? empty, stdout, commit: stdout});
  highlight(lab, ...(rejection ? [31, 40] : malformed ? (failed ? [34, 40] : [34, 36, 40]) : [35, 36, 40]));
  if (rejection) return 'Явный return 1 прерывает функцию. Статус присваивания 1, до clone скрипт не доходит.';
  if (malformed) return inherit ? 'Regex вернула 1. Унаследованный -e прерывает подстановку до printf. Присваивание возвращает 1.'
    : 'Regex вернула 1. В подстановке -e снят, printf пишет broken и возвращает 0. Присваивание получает broken и статус 0.';
  return `${peeled ? 'Выбрана непустая peeled' : 'peeled пуста, выбрана direct'}. Статус присваивания 0.`;
}

const acquisitionScenarios = {
  ok: [-1, 'Все этапы выполнены. Checkout, архив, извлечённое дерево и отпечатки готовы.'],
  moved: [2, 'Между запросом и clone тег переместился. Clone готов, HEAD не совпал.'],
  clone: [1, 'Git завершил clone с ошибкой. В примере checkout не создан, HEAD не проверяется.'],
  head: [2, 'Clone завершился. Фактический HEAD не совпал с ожидаемым ID, checkout остался.'],
  ebuild: [3, 'grep нашёл 0 совпавших строк. Checkout остался, curl пропущен.'],
  download: [4, 'В этом примере скачивание прервалось после записи части файла. Checkout и неполный tar.gz остались.'],
  second: [5, 'Архив скачан, второй запрос дал другой ID. Checkout и tar.gz остались.'],
  returned: [-1, 'Тег сместился и вернулся между запросами. Оба запроса дали один ID. В этом примере архив прошёл отдельную проверку дерева.'],
  verify: [6, 'Оба запроса дали один ID, но Python нашёл отличие. Checkout и tar.gz остались. Распаковка пропущена.'],
};

const acquisitionLines = [[40], [41], [42], [43], [44, 45, 46], [47], [48, 49, 50], [51, 52], [53, 54, 55], [22]];

function acquisition(lab, fields, highlight) {
  const scenario = fields.scenario.value;
  const [failure, result] = acquisitionScenarios[scenario];
  const timeline = !!fields.stage;
  const count = timeline ? 10 : 3;
  const state = [];
  const step = !timeline || fields.stage.value === 'result' ? (failure === -1 ? count - 1 : failure) : Number(fields.stage.value);
  const reached = (index) => step >= index && (failure === -1 || failure >= index);
  const passed = (index) => reached(index) && failure !== index;
  if (passed(1)) state.push('checkout/');
  if (timeline && passed(4)) state.push('dist/zed-1.29.0.tar.gz');
  if (timeline && reached(4) && failure === 4) state.push('dist/zed-1.29.0.tar.gz · неполный файл');
  if (timeline && passed(7)) state.push('source/zed-1.29.0/');
  if (timeline && passed(8)) state.push('source_hash, lock_hash');
  show(lab, {
    initial: `${ref} → ${commit}`,
    expected: commit,
    clone: !reached(1) || scenario === 'clone' ? pending : scenario === 'moved' ? movedCommit : commit,
    head: !passed(1) ? pending : scenario === 'moved' || scenario === 'head' ? movedCommit : commit,
    state: state.join('\n') || 'Новых результатов нет',
    ...(timeline ? {second: !reached(5) ? pending : scenario === 'second' ? movedCommit : commit} : {}),
  });
  traceReleaseGates(lab, count, failure);
  lab.querySelectorAll('[data-gate-state]').forEach((gate, index) => {
    gate.classList.toggle('shell-focus', step === index);
    if (step === index) gate.setAttribute('aria-current', 'step');
    else gate.removeAttribute('aria-current');
  });
  const lines = acquisitionLines[step];
  highlight(lab, ...lines);
  if (timeline) openActiveSources(lab, lines);
  if (!timeline) return failure === -1 ? 'HEAD совпал. Следующий шаг проверит ebuild.' : result;
  if (!reached(step)) return 'Выбранная операция пропущена. ' + result;
  if (fields.stage.value === 'result' || failure === step) return result;
  return [
    'Первый запрос устанавливает upstream_commit.',
    'Clone создаёт checkout. Сверка HEAD ещё впереди.',
    'HEAD совпал с upstream_commit.',
    'В ebuild найдена ровно одна подходящая строка.',
    'Файл tar.gz скачан. Второй запрос ещё впереди.',
    'Второй запрос дал исходный ID. Сверка содержимого ещё впереди.',
    'Архив совпал с Git tree. Распаковка ещё впереди.',
    'Архив распакован. Контрольные суммы ещё не вычислены.',
    'Оба отпечатка вычислены и записаны в summary.',
    result,
  ][step];
}

const pattern = 'https://github.com/zed-industries/zed/archive/refs/tags/v${PV/_/-}.tar.gz -> ${P}.tar.gz';
function grep(lab, fields, highlight) {
  const [body, count] = {
    one: [pattern, 1], none: ['https://example.invalid/source.tar.gz', 0],
    two: [`${pattern}\n  ${pattern}`, 2], same: [`${pattern} ${pattern}`, 1],
  }[fields.scenario.value];
  show(lab, {fragment: `SRC_URI="${body}"`, count, comparison: `test "${count}" = 1`});
  traceReleaseGates(lab, 2, count === 1 ? -1 : 0);
  highlight(lab, 43);
  return count === 1 ? 'test вернул 0. Загрузка достижима.' : 'test вернул 1. До curl скрипт не доходит.';
}

const treeCases = {
  ok: [['lock', 'toml', 'rust', 'exec', 'link'], [79, 84, 86], 'Типы, пути, признак исполнения и Git blob ID', 'Все пять Git-путей с исходными данными', 'Все пять путей совпали'],
  content: [['lock'], [79, 80], 'Git blob ID обычного файла', 'Cargo.lock · исходные байты', 'Cargo.lock · изменённые байты', "Git blob differs: 'Cargo.lock'"],
  missing: [['rust'], [86, 87, 88], 'Полнота после чтения архива', 'src/main.rs · запись 100644', 'Записи src/main.rs нет', "Archive is missing Git paths: ['src/main.rs']"],
  extra: [['extra'], [64, 65, 66], 'Относительный путь входит в Git tree', 'Путь extra.txt отсутствует в Git', 'В архиве есть extra.txt', "Unexpected archive path: 'extra.txt'"],
  root: [['root'], [52, 53, 54, 55, 56], 'Корень имени записи', 'zed-1.29.0/', 'other-root/', "Unsafe or duplicate archive member: 'other-root'"],
  duplicate: [['lock', 'duplicate'], [54, 55, 56], 'Имя встречается один раз', 'Одна запись Cargo.lock', 'Вторая запись с тем же именем', "Unsafe or duplicate archive member: 'zed-1.29.0/Cargo.lock'"],
  mode: [['exec'], [70, 71, 72], 'Маска 0o111 для обычного файла', 'scripts/build.sh · режим Git 100755', 'mode 0644 · ни одного бита исполнения', "Executable mode differs: 'scripts/build.sh'"],
  type: [['lock'], [68, 70, 82, 83], 'Тип записи соответствует режиму Git', 'Cargo.lock · обычный файл 100644', 'Символическая ссылка на Cargo.toml', "File type differs: 'Cargo.lock'"],
  link: [['link'], [68, 69, 84, 85], 'Git blob ID строки цели', 'lock-link → Cargo.lock', 'lock-link → Cargo.toml', "Git blob differs: 'lock-link'"],
};

function tree(lab, fields, highlight) {
  const scenario = fields.scenario.value;
  const [entries, lines, check, expected, actual, error] = treeCases[scenario];
  lab.querySelectorAll('[data-entry]').forEach((item) => {
    const entry = item.dataset.entry;
    item.classList.toggle('shell-path-current', entries.includes(entry) && (scenario !== 'ok' || entry === 'lock'));
    if (entry === 'extra' || entry === 'duplicate') item.hidden = scenario !== entry;
  });
  lab.querySelector('[data-value="archive-rust"]').closest('li').hidden = scenario === 'missing';
  show(lab, {
    check, expected, actual,
    'archive-root': scenario === 'root' ? 'other-root/' : 'zed-1.29.0/',
    'archive-lock': scenario === 'content' ? 'Файл · изменённые байты' : scenario === 'type' ? 'Symlink → Cargo.toml' : 'Файл · исходные байты',
    'archive-exec': scenario === 'mode' ? 'Файл · mode 0644' : 'Файл · mode 0755',
    'archive-link': scenario === 'link' ? 'Symlink → Cargo.toml' : 'Symlink → Cargo.lock',
    diagnostic: error ? `Source archive verification failed: ${error}` : 'Source archive matches the upstream Git commit tree: OK',
  });
  traceReleaseGates(lab, 2, error ? 0 : -1);
  highlight(lab, ...lines);
  return error ? 'Первая ошибка показана выше. Распаковка пропущена. Checkout и скачанный архив остаются.'
    : 'Все пять записей совпали. Скрипт доходит до распаковки.';
}

function fingerprints(lab, fields, highlight) {
  const scenario = fields.scenario.value;
  lab.querySelectorAll('[data-fingerprint]').forEach((item) => {
    item.classList.toggle('shell-focus', item.dataset.fingerprint === scenario);
  });
  highlight(lab, scenario === 'archive' ? 54 : 53, 55);
  return scenario === 'archive' ? 'Строка 54 читает сжатый файл целиком. cut записывает первый столбец в source_hash.'
    : 'Строка 53 читает только извлечённый Cargo.lock. cut записывает первый столбец в lock_hash.';
}

export function acquisitionLabs(highlight) {
  const labs = {transfer, arguments: args, workspace, timing, git, remote, read, resolve,
    checkout: acquisition, grep, timeline: acquisition, tree, fingerprints};
  return Object.fromEntries(Object.entries(labs).map(([name, render]) =>
    [`acq-${name}`, (lab, fields) => render(lab, fields, highlight)]));
}
