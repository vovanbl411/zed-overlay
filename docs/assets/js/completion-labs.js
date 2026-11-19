import {traceReleaseGates} from './handbook.js';

const temp = '/home/runner/work/_temp';
const checkout = '/home/runner/work/zed-overlay/zed-overlay';
const version = '1.29.0';
const ebuild = `zed-${version}.ebuild`;
const manifest = 'app-editors/zed/Manifest';
const json = `zed-${version}-overlay-crates.json`;
const jsonPath = `${temp}/crates-distribution/${json}`;
const digest = '0123456789abcdef'.repeat(4);
const summaryRecord = `Metadata SHA256: ${digest}`;
const bundleSuccess = 'Distribution bundle: OK\nSanitized release handoff and distribution bundle: OK';
const bundleFailure = 'Distribution validation failed: Metadata digest mismatch';
const durationMessage = (elapsed) => `Total candidate preparation and validation: ${elapsed}s`;
const validationMessage = 'Validation-only: release handoff disabled';
const modeError = 'Invalid archive mode';
const distributionFiles = 'crates-distribution/ · архив и JSON';
const independentLogs = 'zed-independent/logs/';

function setValues(lab, values) {
  for (const [name, value] of Object.entries(values)) {
    lab.querySelector(`[data-value="${name}"]`).textContent = value;
  }
}

function highlightFragment(lab, line, text) {
  const code = lab.querySelector(`[data-line="${line}"] code`);
  const source = code.textContent;
  const start = source.indexOf(text);
  const selected = document.createElement('span');
  selected.className = 'shell-expansion';
  selected.textContent = text;
  code.replaceChildren(source.slice(0, start), selected, source.slice(start + text.length));
}

function outputRecords({mode, metadata = false, ready = false} = {}) {
  return [
    'handoff_ready=false',
    mode && `archive_mode=${mode}`,
    metadata && `metadata_sha256=${digest}`,
    ready && 'handoff_ready=true',
  ].filter(Boolean).join('\n');
}

function finish(lab, fields, highlight) {
  const validation = fields.mode.value === 'validation';
  const candidate = fields.result.value === 'new-release';
  const handoff = !validation && candidate;
  highlight(lab, ...(validation ? [160, 161, 162] : handoff
    ? [160, 163, 164, 165, 166, 167, 168] : [160, 163, 169, 170]));

  const messages = validation ? `${durationMessage(75)}\n${validationMessage}`
    : handoff ? `${bundleSuccess}\n${summaryRecord}` : 'На строках 160–170 сообщений нет.';
  const files = [
    candidate ? 'zed-overlay/ · кандидат и Manifest' : 'zed-overlay/ · новых файлов пакета нет',
    'zed-overlay-prepare.log',
    candidate && `${independentLogs} · включая result.txt`,
    candidate && distributionFiles,
    handoff ? 'release-handoff/' : 'release-handoff/ не создаётся',
    `handoff_ready=${handoff}`,
  ].filter(Boolean).join('\n');
  setValues(lab, {messages, files});
  if (validation) return 'Первая ветка печатает время и сообщение. До проверки elif выполнение не доходит.';
  if (handoff) return 'Условие elif выполнено. Bash читает и проверяет archive_mode, записывает выход и вызывает create_release_handoff.';
  return 'Оба условия ложны. Bash доходит до fi, конструкция if возвращает 0.';
}

function duration(lab, fields, highlight) {
  const start = fields.start.valueAsNumber;
  fields.end.min = String(start);
  const end = fields.end.valueAsNumber;
  const elapsed = end - start;
  fields.start.setAttribute('aria-valuetext', `${start} с`);
  fields.end.setAttribute('aria-valuetext', `${end} с`);
  setValues(lab, {start, end, message: durationMessage(elapsed)});
  const comparison = {
    arithmetic: [161, '$((SECONDS - total_started))', `Арифметическое раскрытие подставляет число ${elapsed}.`],
    parameter: [113, '$SECONDS', `При входе в main $SECONDS подставляет ${start}.`],
    command: [165, '$(cat "$RUNNER_TEMP/zed-independent/logs/result.txt")', 'Подстановка команды передаёт stdout cat, например generation.'],
  }[fields.expansion.value];
  highlight(lab, comparison[0]);
  highlightFragment(lab, comparison[0], comparison[1]);
  if (comparison[0] === 165) lab.querySelector('[data-line="165"]').closest('details').open = true;
  return `${end} − ${start} = ${elapsed} с. ${comparison[2]}`;
}

function archiveMode(lab, fields, highlight) {
  const scenario = fields.scenario.value;
  const input = {
    generation: 'generation\n',
    reuse: 'reuse\n',
    empty: '',
    unexpected: 'download\n',
    multiline: 'generation\nreuse\n',
    missing: null,
  }[scenario];
  const missing = input === null;
  const captured = missing ? '' : input.replace(/\n+$/, '');
  const accepted = captured === 'generation' || captured === 'reuse';
  highlight(lab, ...(missing ? [165] : accepted ? [165, 166, 167, 168] : [165, 166]));
  const branch = accepted ? 'generation|reuse' : missing ? 'case пропущен' : '*';
  setValues(lab, {
    diagnostic: missing ? `cat: ${temp}/zed-independent/logs/result.txt: No such file or directory`
      : accepted ? '' : modeError,
    input: missing ? 'Файл отсутствует' : JSON.stringify(input),
    captured: JSON.stringify(captured),
    test: `Статус присваивания: ${missing ? 1 : 0}\nШаблон: ${branch}`,
    effects: accepted ? `archive_mode=${captured}\ncreate_release_handoff вызвана`
      : 'Записи нет.\nВызов пропущен.',
  });
  lab.querySelector('[data-diagnostic]').hidden = accepted;
  if (missing) return 'cat сообщает об отсутствующем файле в stderr. Bash останавливается на присваивании.';
  if (accepted) return 'Перевод строки снят. Ветка generation|reuse разрешает запись и вызов.';
  return `${modeError} · stderr, выход 1.`;
}

function construct(lab, fields, highlight) {
  const scenario = fields.scenario.value;
  const sourcePath = `${temp}/zed-overlay/app-editors/zed/${ebuild}`;
  const success = scenario === 'ok';
  const state = {ok: '', exists: '', missing: ' [отсутствует]', symlink: ' [симлинк]'}[scenario];
  const errors = {
    exists: `Handoff destination already exists: ${temp}/release-handoff`,
    missing: `Missing handoff source file: ${sourcePath}`,
    symlink: `handoff source file must be a regular file: ${sourcePath}`,
  };
  const destination = {
    ok: `release-handoff/
├── release.json [создан]
└── app-editors/
    └── zed/
        ├── Manifest
        ├── ${ebuild}
        └── files/
            └── zed-${version}-wayland-only.patch`,
    exists: 'release-handoff/ [существовал до вызова]\nНовых файлов нет',
    missing: 'release-handoff/ не создан',
    symlink: 'release-handoff/ не создан',
  }[scenario];
  highlight(lab, ...(scenario === 'exists' ? [95, 96] : [95, 96, 97, 98]));
  setValues(lab, {
    workspace: `app-editors/zed/
├── Manifest
├── ${ebuild}${state}
└── files/
    └── zed-${version}-wayland-only.patch`,
    handoff: destination,
    transfer: success ? 'Три файла пакета скопированы из workspace' : 'Копирование не началось',
    diagnostic: success ? '' : `Release handoff error: ${errors[scenario]}`,
  });
  lab.querySelector('[data-diagnostic]').hidden = success;
  if (success) return 'Метаданные и три исходных файла проверены. Python создал и проверил handoff, затем вернул 0 без сообщения в stdout.';
  if (scenario === 'exists') return 'Метаданные сформированы. Python отклоняет занятый путь до проверки исходных файлов. Статус 1.';
  return 'Метаданные сформированы, путь назначения свободен. Проверка ebuild через lstat завершилась до mkdir. Статус 1.';
}

function checksum(lab, fields, highlight) {
  const step = Number(fields.step.value);
  const scenario = fields.scenario.value;
  const shaStatus = scenario === 'sha' ? 1 : 0;
  const cutStatus = scenario === 'cut' ? 1 : 0;
  const status = cutStatus || shaStatus;
  const full = shaStatus ? 'stdout пуст' : `${digest}  ${jsonPath}\n`;
  const fragments = [
    ['Байты метаданных на входе', jsonPath, 'sha256sum'],
    ['Имя после раскрытия', jsonPath, '${candidate_version}'],
    ['Стандартный вывод sha256sum', full, 'sha256sum'],
    ['Разделитель поля', "Один пробел U+0020. В строке sha256sum два таких пробела подряд.", "-d' '"],
    ['Стандартный вывод cut', status ? 'stdout пуст' : `${digest}\n`, '-f1'],
    ['Значение metadata_hash', JSON.stringify(status ? '' : digest), 'metadata_hash='],
  ];
  const [detail, intermediate, fragment] = fragments[step];
  setValues(lab, {detail, intermediate});
  highlight(lab, 99);
  highlightFragment(lab, 99, fragment);
  lab.querySelectorAll('[data-point]').forEach((node) => {
    node.classList.toggle('shell-focus', node.dataset.point.split(' ').includes(String(step)));
  });
  const next = status === 0 ? 'Строка 100 достижима.' : 'Errexit останавливает скрипт перед строкой 100.';
  return `sha256sum: ${shaStatus} · cut: ${cutStatus} · присваивание: ${status}. ${next}`;
}

function digestFormat(lab, fields, highlight) {
  const [input, fragment] = {
    ok: [digest, '^[0-9a-f]{64}$'],
    short: [digest.slice(1), '{64}'],
    long: [digest + '0', '{64}$'],
    upper: [digest.toUpperCase(), '[0-9a-f]'],
    nonhex: ['g' + digest.slice(1), '[0-9a-f]'],
    space: [' ' + digest, '^[0-9a-f]'],
    empty: ['', '{64}'],
  }[fields.scenario.value];
  const matches = input.length === 64 && /^[0-9a-f]+$/.test(input);
  setValues(lab, {input: JSON.stringify(input), length: `Символов: ${input.length}`});
  highlight(lab, 100);
  highlightFragment(lab, 100, fragment);
  return matches ? 'MATCH · статус 0. Вся строка совпала с шаблоном. Строка 101 достижима.'
    : `NO MATCH · статус 1. Фрагмент ${fragment} помогает найти причину. Errexit останавливает Bash перед строкой 101.`;
}

function bundle(lab, fields, highlight) {
  const argument = fields.argument.value;
  const [line, fragment, origin, example, property] = {
    bundle: [102, '--bundle "$RUNNER_TEMP/crates-distribution"', 'Результат independent-crates.sh', `${temp}/crates-distribution`, 'Проверяет состав каталога и согласованность архива с метаданными.'],
    handoff: [102, '--handoff "$handoff_directory"', 'Результат --create-handoff', `${temp}/release-handoff`, 'Проверяет минимальную структуру handoff и читает файлы кандидата.'],
    'base-commit': [103, '--base-commit "$GITHUB_SHA"', 'Ревизия overlay из события', '0123456789abcdef0123456789abcdef01234567', 'Сверяет базовую ревизию handoff с ревизией события.'],
    'base-manifest': [103, '--base-manifest "$GITHUB_WORKSPACE/app-editors/zed/Manifest"', 'Два Manifest для сравнения', `Базовый: ${checkout}/${manifest}\nКандидат: ${temp}/release-handoff/${manifest}`, 'Сверяет старые DIST-записи с Manifest кандидата из handoff.'],
    'metadata-sha256': [104, '--metadata-sha256 "$metadata_hash"', 'Вымышленный пример digest из строки 99', digest, 'Пересчитывает SHA256 JSON и сравнивает со значением из аргумента.'],
  }[argument];
  highlight(lab, line);
  highlightFragment(lab, line, fragment);
  lab.querySelectorAll('[data-input]').forEach((node) => node.classList.toggle('shell-focus', node.dataset.input === argument));
  setValues(lab, {origin, example});
  return property;
}

function outputs(lab, fields, highlight) {
  const step = Number(fields.step.value);
  const lines = [[125], [167], [95, 96, 97, 98], [99, 100], [101, 102, 103, 104, 105], [106], [107], [108]];
  highlight(lab, ...lines[step]);
  if (step >= 2 && step <= 4) lab.querySelector('[data-line="95"]').closest('details').open = true;
  const summary = [
    step >= 1 && 'Result: new-release\n[отчёт independent-crates.sh]',
    step >= 5 && summaryRecord,
  ].filter(Boolean).join('\n') || 'Записей пока нет.';
  const files = [
    step >= 1 && 'zed-overlay/ и снимки путей\nzed-overlay-prepare.log',
    step >= 1 && independentLogs,
    step >= 1 && distributionFiles,
    step >= 2 && 'release-handoff/ · четыре файла',
  ].filter(Boolean).join('\n') || 'Временные файлы подготовки ещё не созданы.';
  setValues(lab, {
    output: outputRecords({mode: step >= 1 && 'generation', metadata: step >= 6, ready: step === 7}),
    summary,
    files,
  });
  const next = [
    'Подготовить кандидата, проверить копию и прочитать режим.',
    'Создать handoff, проверить digest и комплект, записать сводку и выходы.',
    'Получить и проверить digest, проверить комплект, записать сводку и выходы.',
    'Проверить комплект, записать сводку и выходы.',
    'Записать сводку и выходы.',
    'Записать metadata_sha256 и handoff_ready=true.',
    'Записать handoff_ready=true.',
    'Runner должен завершить шаг, обработать выходы и проверить условия загрузки.',
  ][step];
  return `Последняя запись handoff_ready: ${step === 7}. ${next}`;
}

function readiness(lab, fields) {
  const scenario = fields.scenario.value;
  const failure = {ok: -1, read: 0, mode: 1, handoff: 3, checksum: 4, digest: 5, bundle: 6, summary: 7, output: 8}[scenario];
  traceReleaseGates(lab, 10, failure);
  const success = failure === -1;
  const handoff = success || failure > 3 ? 'release-handoff/ · четыре файла'
    : failure === 3 ? 'release-handoff/ · может отсутствовать или остаться после ошибки' : 'release-handoff/ ещё не создавался';
  setValues(lab, {
    output: outputRecords({mode: (success || failure > 2) && 'generation', metadata: success, ready: success}),
    files: `${distributionFiles}\n${independentLogs}\n${handoff}`,
  });
  const cause = {
    read: 'Строка 165 · cat не прочитал result.txt.',
    mode: `Строка 166 · ${modeError}.`,
    handoff: 'Строка 95 · Python завершился с ошибкой.',
    checksum: 'Строка 99 · присваивание получило ненулевой статус конвейера.',
    digest: 'Строка 100 · условие вернуло 1.',
    bundle: `Строка 101 · ${bundleFailure}.`,
    summary: 'Строка 106 · tee не открыл файл сводки.',
    output: 'Строка 107 · Bash не открыл файл выходов для дописывания.',
  }[scenario];
  return success ? 'Bash завершился успешно. Записано handoff_ready=true. Обычные upload-шаги допускаются при успешных предыдущих шагах.'
    : `${cause} Последняя запись handoff_ready: false. Обычные upload-шаги пропускаются.`;
}

function executionMap(lab, fields) {
  const scenario = fields.scenario.value;
  const current = ['current', 'validation-current'].includes(scenario);
  const validation = scenario.startsWith('validation-');
  const route = [
    'boot', 'workspace', 'prepare',
    ...(current ? ['current'] : ['paths', 'container']),
    'policy', 'dirty',
    ...(validation ? ['timing'] : current ? ['noop'] : ['handoff', 'bundle', 'complete']),
  ];
  const failed = ['prepare', 'paths', 'container', 'policy', 'dirty', 'handoff', 'bundle'].includes(scenario);
  const failure = failed ? route.indexOf(scenario) : -1;
  const reached = (stage) => {
    const position = route.indexOf(stage);
    return position !== -1 && (failure === -1 || position <= failure);
  };
  lab.querySelectorAll('[data-map-state]').forEach((node) => {
    const stage = node.dataset.mapState;
    const state = reached(stage) ? failed && stage === scenario ? 'FAIL' : 'PASS' : 'SKIP';
    node.dataset.status = state;
    node.textContent = state;
  });
  const ready = reached('complete');
  const mode = scenario === 'reuse' ? 'reuse' : 'generation';
  const files = [
    'zed-overlay/ и снимки путей',
    'zed-overlay-prepare.log',
    reached('container') && independentLogs,
    reached('container') && scenario !== 'container' && distributionFiles,
    reached('handoff') && (scenario === 'handoff' ? 'release-handoff/ · может остаться после ошибки' : 'release-handoff/ · четыре файла'),
  ].filter(Boolean).join('\n');
  setValues(lab, {
    files,
    output: outputRecords({mode: reached('handoff') && mode, metadata: ready, ready}),
  });
  const failedAt = {
    prepare: 'первичной подготовке',
    paths: 'проверке путей кандидата',
    container: 'контейнерной проверке до создания crates-distribution/',
    policy: 'проверке одноразовой копии',
    dirty: 'проверке исходного checkout',
    handoff: 'создании handoff после записи archive_mode',
    bundle: 'валидации комплекта после создания handoff',
  }[scenario];
  if (failure !== -1) return `Скрипт завершился с ошибкой на ${failedAt}. Итоговая готовность false.`;
  if (ready) return `Скрипт завершился успешно. Режим ${mode}, итоговая готовность true.`;
  return `Скрипт завершился успешно. ${validation ? 'Время выведено в сводку.' : 'Новый релиз не обнаружен.'} Итоговая готовность false.`;
}

export function completionLabs(highlight) {
  const renderers = {
    finish, duration, 'archive-mode': archiveMode, construct, checksum,
    digest: digestFormat, bundle, outputs, readiness, 'execution-map': executionMap,
  };
  return Object.fromEntries(Object.entries(renderers).map(([name, render]) => [
    name, (lab, fields) => render(lab, fields, highlight),
  ]));
}
