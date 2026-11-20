import {renderReleaseGates} from './handbook.js';

const work = '/home/runner/work/_temp/zed-independent';
const stem = 'zed-1.29.0-overlay-crates';
const archive = `dist/${stem}.tar.xz`;
const metadata = `dist/${stem}.json`;
const generated = 'generated-zed.ebuild';
const gitArchive = 'cache/repository-0123456789abcdef0123456789abcdef01234567.gh.tar.gz';

function show(lab, fields) {
  for (const [field, value] of Object.entries(fields)) {
    lab.querySelector(`[data-crates-${field}]`).textContent = value;
  }
}

function gates(lab, states, details = {}) {
  renderReleaseGates(lab, states);
  lab.querySelectorAll('[data-crates-detail]').forEach((node, index) => {
    node.textContent = details[index] ?? '';
    node.parentElement.nextElementSibling.hidden = false;
  });
}

function trace(lab, count, failure, details) {
  gates(lab, Array.from({length: count}, (_, index) => {
    if (failure < 0 || index < failure) return 'PASS';
    return index === failure ? 'FAIL' : 'SKIP';
  }), details);
}

function source(lab, path, ...lines) {
  for (const preview of lab.querySelectorAll('[data-source-preview]')) {
    if (!preview.querySelector('.source-preview-meta code').textContent.endsWith(path)) continue;
    let active = false;
    for (const row of preview.querySelectorAll('[data-line]')) {
      const selected = lines.includes(Number(row.dataset.line));
      row.classList.toggle('shell-current-line', selected);
      active ||= selected;
    }
    if (active) preview.open = true;
  }
}

const shell = 'ci/independent-crates.sh';
const github = 'crates_github.py';
const distribution = 'crates_distribution.py';
const inspector = 'inspect_zed_archive.py';

const lookupStates = [
  [['PASS', 'PASS', 'SKIP', 'PASS', 'PASS'], [200, 'Assets корректны', '', '200 · ref валиден'], [140, 141], 'reuse'],
  [['PASS', 'SKIP', 'PASS', 'PASS', 'PASS'], [404, '', '200 · full_name совпадает', '404 · тег отсутствует'], [144, 148, 154], 'generation'],
  [['PASS', 'FAIL', 'SKIP', 'SKIP', 'SKIP'], [200, 'Состояние отклонено'], [107, 139], 'Invalid release identity or state'],
  [['PASS', 'FAIL', 'SKIP', 'SKIP', 'SKIP'], [200, 'Получен один asset из двух'], [112, 139], 'Release assets are incomplete or unexpected'],
  [['PASS', 'PASS', 'SKIP', 'FAIL', 'SKIP'], [200, 'Assets корректны', '', '404 · тег отсутствует'], [132, 140], 'Published release has no valid matching Git tag'],
  [['PASS', 'SKIP', 'FAIL', 'SKIP', 'SKIP'], [404, '', '404 · доступ не подтверждён'], [144, 147], 'Cannot confirm access to the expected repository'],
  [['PASS', 'SKIP', 'PASS', 'FAIL', 'SKIP'], [404, '', '200 · full_name совпадает', '200 · тег уже есть'], [149, 150], 'A standalone or unpublished tag already exists'],
  [['FAIL', 'SKIP', 'SKIP', 'SKIP', 'SKIP'], [503], [137], 'GitHub request failed: HTTP 503'],
];

function lookup(lab, index) {
  const [states, result, lines, mode] = lookupStates[index];
  const repo = '/repos/vovanbl411/zed-overlay';
  const details = [
    `GET ${repo}/releases/tags/crates-v1.29.0 · HTTP ${result[0]}`,
    result[1],
    result[2] && `GET ${repo} · ${result[2]}`,
    result[3] && `GET ${repo}/git/ref/tags/crates-v1.29.0 · ${result[3]}`,
  ];
  gates(lab, states, details);
  source(lab, github, ...lines);
  source(lab, shell, index < 2 ? 153 : 152);
  return index < 2 ? `Python печатает ${mode}. Bash доходит до строки 153.`
    : `Crates release error: ${mode}. Python возвращает 1. Строка 153 пропущена.`;
}

const dockerStates = [
  ['Образ доступен. Контейнеров и запущенных процессов пока нет.', 59],
  ['До docker create имеются образы, а точки монтирования донора ещё не созданы.', 59],
  ['Донор в состоянии Created, подключён том. /bin/true записан в конфигурацию, процессов нет.', 59],
  ['Донор остаётся в Created. В stage3 работает cat, оба контейнера ссылаются на общий том.', 66],
  ['cat завершился, --rm удалил stage3. Образы и донор с томом остаются.', 66],
  ['Stage3 уже удалён. Донор в Created. Том остаётся доступен для следующего потребителя.', 66],
  ['EXIT вызывает docker rm -f. При успехе донор удаляется. Команда не запрашивает удаление тома или образов.', 71],
  ['Пример сбоя — имя уже занято. Новый донор не создан, stderr виден. EXIT попытается удалить контейнер под этим именем.', 59],
];

function docker(lab, index) {
  const [message, line] = dockerStates[index];
  gates(lab, [
    'PASS', index === 7 ? 'FAIL' : index >= 2 ? 'PASS' : 'SKIP',
    index >= 3 && index <= 6 ? 'PASS' : 'SKIP', index >= 4 && index <= 6 ? 'PASS' : 'SKIP',
    index === 6 || index === 7 ? 'PASS' : 'SKIP',
  ], ['Образ Portage уже доступен', 'Имя · zed-independent-portage', 'cat · /var/db/repos/gentoo', '--rm', 'docker rm -f · исход зависит от Docker']);
  show(lab, {
    'docker-donor': ['Контейнера нет', 'Контейнера нет', 'Created · /bin/true не запущен',
      'Created · процессов нет', 'Created', 'Created', 'Удалён при успехе rm', 'Конфликт имени · новый донор не создан'][index],
    'docker-stage3': index === 3 ? 'Running · cat' : index >= 4 && index <= 6 ? 'Удалён через --rm' : 'Контейнера нет',
    mount: index >= 2 && index <= 5 ? '/var/db/repos/gentoo' : index === 6 ? 'rm не запрашивает удаление тома' : 'Новый mount не создан',
  });
  source(lab, shell, line);
  return message;
}

function cleanup(lab, index) {
  const installed = index !== 6;
  const called = installed && index !== 7;
  const removed = [0, 2, 3].includes(index);
  const status = ['0', '1 · сбой acquisition', '3 · сбой генератора', '1 · сбой reuse',
    '0', '0', '1 · ошибка аргумента', '137 · SIGKILL (128 + 9 при ожидании в Bash)'][index];
  const skip = called ? 'PASS' : 'SKIP';
  gates(lab, [installed ? 'PASS' : 'SKIP', skip, skip, called ? removed ? 'PASS' : 'FAIL' : 'SKIP'], [
    '', '', called ? 'stdout и stderr → /dev/null' : 'Перенаправления не выполняются',
    called && !removed ? index === 5 ? 'Ошибка Docker; true гасит её статус' : 'Контейнера нет; true гасит ошибку' : '',
  ]);
  source(lab, shell, ...(called ? [71, 72] : installed ? [72] : [5]));
  return `Итог выполнения: ${status}. ${called ? 'При обычном выходе обработчик сохраняет исходный статус.' : 'Команда удаления не выполняется.'}`;
}

const venvStates = [
  ['Созданы pyvenv.cfg, bin/python и отдельный site-packages. Следующая команда запускает pip.', 64, ['PASS', 'SKIP', 'SKIP', 'SKIP', 'SKIP']],
  ['Первая ошибка в python3 -m venv. Установка пропущена. Может остаться часть каталога venv.', 63, ['FAIL', 'SKIP', 'SKIP', 'SKIP', 'SKIP']],
  ['Первая ошибка в pip install. Вызов проверки версии пропущен, venv уже создан.', 64, ['PASS', 'FAIL', 'SKIP', 'SKIP', 'SKIP']],
  ['Проверка вернула 0. Следующая команда читает лицензионное отображение через docker run.', 65, ['PASS', 'PASS', 'PASS', 'PASS', 'SKIP']],
  ['test сравнил установленную версию 0.15.0 с 0.16.0 и вернул 1. Docker для чтения отображения не запускается.', 65, ['PASS', 'PASS', 'PASS', 'FAIL', 'SKIP']],
];

function venv(lab, index) {
  const [result, line, states] = venvStates[index];
  gates(lab, states, [
    'python3 -m venv "$work/venv"', 'env -u GITHUB_TOKEN "$work/venv/bin/python" -m pip install pycargoebuild==0.16.0',
    'lib/pythonX.Y/site-packages и bin/pycargoebuild', 'python -c → importlib.metadata → test',
    index === 3 ? 'Далее: строка 66 · docker run --rm …' : '',
  ]);
  show(lab, {python: [
    'Отдельный site-packages готов к установке', 'Окружение не готово', 'pip прервался',
    'site-packages · pycargoebuild 0.16.0 → bin/pycargoebuild',
    'site-packages · pycargoebuild 0.15.0 → проверка отклонила версию',
  ][index]});
  source(lab, shell, line);
  return result;
}

function mapping(lab, index) {
  const failure = [-1, 1, 3, 0][index];
  trace(lab, 5, failure, [
    index === 3 ? 'Bash получил ошибку открытия до запуска Docker' : 'Bash создаёт новый файл или обнуляет существующий',
    index === 3 ? '' : 'Stage3 запущен. Донор остаётся в Created.',
    ['Байты файла попадают на runner', 'До ошибки возможна частичная запись', 'Файл создан с размером 0', ''][index],
  ]);
  show(lab, {
    'mapping-edge': ['stdout →', 'часть stdout возможна →', 'stdout пуст', 'запуск пропущен'][index],
    'mapping-file': ['Непустой файл', 'Файл может остаться', 'Пустой файл', 'Открытие не удалось'][index],
  });
  source(lab, shell, index === 0 ? 68 : index === 2 ? 67 : 66);
  return [
    'Файл непустой. test -s и запись сводки достижимы. Stage3 удалён.',
    'Статус cat ненулевой. Stage3 удалён, файл может остаться. test -s и summary пропущены.',
    'cat успешен, stage3 удалён. Пустой файл остаётся, test -s возвращает 1. Summary пропущена.',
    'Контейнер не стартует. Назначение не открыто и не усечено. test -s и summary пропущены.',
  ][index];
}

function branch(lab, index) {
  const states = [
    ['PASS', 'PASS', 'PASS', 'PASS', 'SKIP', 'PASS'],
    ['PASS', 'PASS', 'SKIP', 'SKIP', 'PASS', 'PASS'],
    ['PASS', 'FAIL', 'SKIP', 'SKIP', 'SKIP', 'SKIP'],
  ];
  gates(lab, states[index]);
  source(lab, shell, ...[[157, 158], [160], [161]][index]);
  return [
    'Выполнены prepare_generator и generate. verify_inputs достижим.',
    'Выполнен reuse. Генератор пропущен. verify_inputs достижим.',
    'stderr: ERROR: invalid archive selection. Выход 1 после успешной подготовки Portage.',
  ][index];
}

const argumentsList = [
  ['$work/venv/bin/pycargoebuild', 'binary', 'venv/bin/pycargoebuild', 76, 'Точка входа pycargoebuild из venv.'],
  ['$source_dir', 'source_dir', 'source/zed-1.29.0', 77, 'Рабочий каталог для cd и относительного пути crates/zed.'],
  ['$archive', 'archive', archive, 77, 'Выходной путь --crate-tarball-path.'],
  ['$work/cache', 'cache', 'cache', 77, 'Каталог скачанных зависимостей для --distdir.'],
  ['$work/license-mapping.conf', 'mapping', 'license-mapping.conf', 77, 'Файл соответствий для --license-mapping.'],
  ['$work/generated-zed.ebuild', 'ebuild', generated, 78, 'Промежуточный ebuild для --output.'],
  ['$work', 'home', '', 78, 'Значение HOME только для процесса генератора и его потомков.'],
];

function transfer(lab, index) {
  const [input, name, path, line, result] = argumentsList[index];
  show(lab, {input, target: `$${index + 1} → ${name}`, path: path ? `${work}/${path}` : work});
  source(lab, shell, line);
  source(lab, 'run-pycargoebuild.sh', 3 + index, [11, 10, 12, 12, 12, 13, 11][index]);
  return result;
}

function streams(lab, index) {
  const combined = index !== 1;
  const message = 'Начало упаковки';
  const warning = ['','Учебное предупреждение','Учебное предупреждение','Учебная ошибка генератора',''][index];
  const output = combined && warning ? `${message}\n${warning}` : message;
  const producer = index === 3 ? 3 : 0;
  const tee = index === 4 ? 1 : 0;
  const status = tee || producer;
  show(lab, {
    pipe: combined ? '1 + 2 →' : '1 → · 2 ↓ stderr runner',
    console: output,
    errors: tee ? 'tee: не удалось открыть журнал (учебный пример)' : combined ? '—' : warning,
    log: tee ? 'Назначение не открыто' : output,
  });
  source(lab, shell, 78, ...(status ? [] : [79]));
  return `Производитель: ${producer} · tee: ${tee} · pipefail: ${status}. ${status ? 'Строка 79 пропущена.' : 'Строка 79 достижима.'}`;
}

const namesMismatch = 'Archive registry crate names or package checksums differ from Cargo.lock';
const memberError = 'Unsafe or duplicate archive member: ';
const registryCases = [
  [-1, 47, 'package: aa… и bb…'],
  [3, 46, 'В архиве отсутствует example-b-2.0.0', namesMismatch],
  [3, 46, 'В архив добавлен example-c-3.0.0', namesMismatch],
  [3, 46, 'package для example-b-2.0.0: cc… вместо bb…', namesMismatch],
  [2, 36, 'Есть путь с компонентом ..', memberError + 'cargo_home/gentoo/../Cargo.toml'],
  [2, 36, 'Cargo.toml для example-a встречается дважды', memberError + 'cargo_home/gentoo/example-a-1.0.0/Cargo.toml'],
  [2, 36, 'src/lib.rs оказался символической ссылкой', memberError + 'cargo_home/gentoo/example-a-1.0.0/src/lib.rs'],
  [0, 23, 'Чтение tar ещё не началось', 'xz -t отклонил поток (пересказ)'],
];

const registryTree = `cargo_home/
└── gentoo/
    ├── example-a-1.0.0/
    │   ├── Cargo.toml
    │   ├── src/lib.rs
    │   └── .cargo-checksum.json
    └── example-b-2.0.0/
        ├── Cargo.toml
        └── .cargo-checksum.json`;

function registry(lab, index) {
  const [failure, line, records, error] = registryCases[index];
  const trees = [
    registryTree,
    registryTree.split('\n').slice(0, 6).join('\n').replace('    ├── example-a', '    └── example-a'),
    registryTree.replace('└── example-b', '├── example-b').replaceAll('        ', '    │   ') + '\n    └── example-c-3.0.0/\n        └── .cargo-checksum.json',
    registryTree, registryTree + '\n    + запись gentoo/../Cargo.toml',
    registryTree.replace('    │   ├── src/lib.rs', '    │   ├── Cargo.toml (повтор)\n    │   ├── src/lib.rs'),
    registryTree.replace('src/lib.rs', 'src/lib.rs → ссылка'), 'Нет прочитанных записей',
  ];
  show(lab, {records, tree: trees[index]});
  trace(lab, 5, failure);
  source(lab, shell, 80);
  source(lab, inspector, line);
  return error ? `${index < 7 ? 'Archive validation failed: ' : ''}${error}. Создание metadata пропущено.`
    : 'Registry crate count: 2. Размер и SHA256 добавляются в сводку. Создание metadata достижимо.';
}

function timing(lab, index) {
  const [grep, tee] = [[0, 0], [1, 0], [2, 0], [0, 1]][index];
  gates(lab, [grep === 2 ? 'FAIL' : 'PASS', tee ? 'FAIL' : 'PASS', 'PASS'], [
    grep === 1 ? 'Нет совпадения' : `grep=${grep}`, tee ? 'Сводка не открылась' : 'tee=0',
  ]);
  source(lab, shell, 81);
  return `grep=${grep} · tee=${tee} · конвейер=${tee || grep}. Итог списка 0. Bash переходит к create.`;
}

const fields = [
  ['Константа в create_metadata', {schema_version: 1}, [57, 106], 'Версия 1 определяет набор полей и проверок.'],
  ['--version и производное v{version}', {zed_version: '1.29.0', upstream_tag: 'v1.29.0'}, [59, 106], 'Версия и тег должны описывать один релиз исходников.'],
  ['--commit · результат acquisition', {upstream_commit: '2'.repeat(40)}, [61, 107], 'Схема проверяет форму SHA. При reuse значение сравнивается с локальным коммитом.'],
  ['--source-archive → sha256', {source_sha256: 'a'.repeat(64)}, [61, 107], 'Отпечаток сжатого файла исходников.'],
  ['--lock → sha256', {cargo_lock_sha256: 'b'.repeat(64)}, [61, 108], 'Отпечаток конкретного Cargo.lock.'],
  ['Константа в create_metadata; pin проверен Bash', {generator: {name: 'pycargoebuild', version: '0.16.0'}}, [64, 108], 'Схема сверяет имя инструмента и версию.'],
  ['--archive → имя, stat и sha256', {archive: {filename: stem + '.tar.xz', size: 8192, sha256: 'c'.repeat(64)}}, [67, 109], 'Три поля связывают JSON с конкретным локальным архивом registry crates.'],
  ['--generated → sync.parse_entries', {git_crates: [{name: 'example', repository: 'https://github.com/example/repository', revision: '0123456789abcdef0123456789abcdef01234567', unpack_path: 'repository-%commit%'}]}, [74, 110], 'Записи содержат пакет, репозиторий, ревизию и путь внутри Git-архива.'],
  ['--generated → license_expressions', {licenses: ['Apache-2.0', 'MIT']}, [84, 110, 115, 117, 118], 'Выражения нормализованы и отсортированы для ручной проверки.'],
];

function provenance(lab, index) {
  const [input, example, lines, result] = fields[index];
  show(lab, {input, json: JSON.stringify(example, null, 2)});
  source(lab, distribution, ...lines);
  source(lab, shell, [82, 83, 83, 84, 84, 82, 84, 85, 85][index]);
  return result;
}

const reuseCases = [
  [-1, github, 191, 'Обе загрузки и все проверки завершены. verify_inputs достижим.'],
  [0, github, 167, 'Crates release error: Release disappeared before reuse'],
  [4, github, 173, 'Crates release error: Published metadata asset size or digest mismatch'],
  [6, distribution, 124, 'Crates release error: Archive does not match metadata'],
  [7, github, 178, 'Crates release error: Published archive asset size or digest mismatch'],
  [8, distribution, 130, 'Crates release error: Upstream commit, source archive or Cargo.lock mismatch'],
  [9, inspector, 46, 'Crates release error: ' + namesMismatch],
  [11, github, 188, 'Crates release error: Asset download failed: HTTP 404 (один из возможных ответов)'],
  [12, 'sync_zed_git_crates.py', 96, "Crates release error: Crate identity mismatch for 'example'."],
];

function reuse(lab, index) {
  const [failure, path, line, result] = reuseCases[index];
  trace(lab, 14, failure, [
    index === 1 ? 'Повторный lookup получил generation, функция отклонила режим' : 'Релиз и Git ref проверены',
    '', metadata, '', '', archive, '', '', '', '', '', gitArchive, '', generated,
  ].map((detail, position) => failure < 0 || position <= failure ? detail : ''));
  const files = ['dist/zed-1.29.0.tar.gz и source/zed-1.29.0/ · уже были'];
  if (failure >= 4 || failure < 0) files.push(metadata);
  if (failure >= 6 || failure < 0) files.push(archive);
  if (failure >= 12 || failure < 0) files.push(gitArchive);
  if (failure === 11) files.push('Ранее скачанные Git-архивы сохраняются; при обрыве записи возможен частичный файл.');
  if (failure < 0) files.push(generated);
  show(lab, {files: files.join('\n')});
  source(lab, shell, 89);
  source(lab, github, [191, 167, 173, 175, 178, 179, 180, 188, 189][index]);
  source(lab, path, line);
  return failure < 0 ? result : `${result} · generated-zed.ebuild не записан, verify_inputs недостижим.`;
}

const convergenceCases = [
  ['generation', -1, 163, 'generation завершена.', 3],
  ['reuse', -1, 163, 'reuse завершена.', 3],
  ['', 0, 152, 'lookup вернул ошибку.', 0],
  ['', 1, 154, 'lookup выбрал generation, затем docker create вернул ошибку до case.', 0],
  ['generation', 2, 157, 'В примере pip вернул ошибку после создания venv.', 0],
  ['generation', 3, 158, 'Конвейер генератора вернул ошибку.', 1],
  ['generation', 4, 158, 'Инспектор отклонил registry-архив.', 2],
  ['generation', 5, 158, 'create отклонил Git-источники до записи JSON.', 2],
  ['reuse', 7, 160, 'Upstream identity расходится.', 1],
  ['reuse', 8, 160, 'Git-архив не загрузился после проверок registry-архива.', 1],
];

function convergence(lab, index) {
  const [mode, failure, line, message, progress] = convergenceCases[index];
  const stages = mode === 'generation' ? [0, 1, 2, 3, 4, 5, 9] : mode === 'reuse' ? [0, 1, 6, 7, 8, 9] : [0, 1];
  gates(lab, Array.from({length: 10}, (_, position) => {
    if (position === failure) return 'FAIL';
    return stages.includes(position) && (failure < 0 || position < failure) ? 'PASS' : 'SKIP';
  }));
  lab.querySelectorAll('[data-crates-branch]').forEach((node) => {
    node.classList.toggle('shell-focus', node.dataset.cratesBranch === mode);
  });
  const files = ['zed-independent/', '├── dist/', '│   ├── zed-1.29.0.tar.gz'];
  if (progress >= 2 || mode === 'reuse') files.push(`│   ${progress === 3 || mode === 'reuse' ? '├' : '└'}── ${stem}.tar.xz`);
  else files[2] = '│   └── zed-1.29.0.tar.gz';
  if (progress === 3 || mode === 'reuse') files.push(`│   └── ${stem}.json`);
  files.push('├── source/zed-1.29.0/', '├── cache/');
  if (progress >= 2 || index === 9) files.push(index === 9 ? '│   └── возможны ранее скачанные Git-архивы' : '│   └── архивы Git-зависимостей');
  if ((progress >= 2 && mode === 'generation') || progress === 3) files.push(`└── ${generated}`);
  const extra = index === 4 ? 'venv/ уже создан; таблицы лицензий и журнала ещё нет.'
    : mode === 'generation' ? 'Только generation · venv/, license-mapping.conf, logs/generator.log'
    : 'venv, таблица лицензий и журнал генератора не создавались.';
  show(lab, {files: files.join('\n'), extra: index === 5 ? extra + '. Уже созданные файлы архива, кеша и ebuild могут остаться.' : extra,
    donor: failure < 0 ? 'Донор остаётся доступен до выхода Bash.'
      : failure === 0 ? 'Донор не создавался. EXIT всё равно пытается удалить контейнер по имени.'
      : failure === 1 ? 'Создание донора завершилось ошибкой. EXIT пытается удалить контейнер по имени.'
      : 'При выходе EXIT попытается удалить донора. Файлы работы сохраняются.'});
  source(lab, shell, line);
  return `${message} ${failure < 0 ? 'verify_inputs достижим.' : 'verify_inputs пропущен.'}`;
}

export function cratesLabs() {
  const labs = {lookup, docker, cleanup, venv, mapping, branch, arguments: transfer,
    streams, registry, timing, metadata: provenance, reuse, convergence};
  return Object.fromEntries(Object.entries(labs).map(([name, render]) => [
    `crates-${name}`, (lab, controls) => {
      lab.querySelectorAll('.shell-current-line').forEach((row) => row.classList.remove('shell-current-line'));
      return render(lab, Number(controls.scenario.value));
    },
  ]));
}
