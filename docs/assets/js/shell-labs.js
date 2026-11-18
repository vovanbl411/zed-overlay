import {traceReleaseGates} from './handbook.js';

const checkout = '/home/runner/work/zed-overlay/zed-overlay';
const runnerTemp = '/home/runner/work/_temp';
const packageFiles = ['app-editors/zed/Manifest', 'app-editors/zed/zed-1.28.1.ebuild'];

function highlight(lab, ...numbers) {
  lab.querySelectorAll('.source-line').forEach((row) => {
    row.classList.toggle('shell-current-line', numbers.includes(Number(row.dataset.line)));
  });
}

function environment(lab, fields) {
  const values = [
    checkout,
    runnerTemp + '/_runner_file_commands/set_output_demo',
    runnerTemp + '/_runner_file_commands/step_summary_demo',
    '0123456789abcdef0123456789abcdef01234567',
    runnerTemp,
    'example.invalid/gentoo/portage:demo',
    'example.invalid/gentoo/stage3:demo',
  ];
  const selected = Number(fields.variable.value);
  const name = fields.variable.selectedOptions[0].textContent;
  const presence = fields.presence.value;
  const failure = presence === 'valid' ? -1 : selected;
  traceReleaseGates(lab, values.length, failure);
  highlight(lab, 4 + selected);

  if (failure === -1) {
    return `${name} задана. Раскрытие даёт «${values[selected]}». Команда : выполняется и возвращает 0. Ошибок и пропущенных проверок нет, main достижима.`;
  }
  const state = presence === 'empty' ? 'пустая строка' : 'переменная не задана';
  const remaining = values.length - selected - 1;
  const skipped = remaining === 0
    ? 'Это последняя проверка.'
    : `Следующие проверки пропущены (строки ${5 + selected}–10).`;
  return `${name}: ${state}. Раскрытие завершается ошибкой «${name} is required», команда : не вызывается. Это первая ошибка. ${skipped} До main скрипт не дойдёт.`;
}

function functionTrace(lab, fields) {
  const step = Number(fields.step.value);
  const lines = [[1], [2], [4], [12, 111], [172], [112]];
  const explanations = [
    'Ядро читает shebang и запускает интерпретатор.',
    'Bash включает опции обработки ошибок.',
    'В этой модели окружение прошло все семь проверок. Показана первая строка блока.',
    'Bash регистрирует пять вспомогательных функций и main. Команды в их телах отложены до вызова.',
    'Строка 172 вызывает main и передаёт аргументы скрипта.',
    'Bash входит в тело main. Первая команда читает режим из окружения.',
  ];
  lab.querySelectorAll('[data-phase]').forEach((node, index) => {
    node.classList.toggle('shell-focus', step === index);
    if (step === index) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');
  });
  lab.querySelectorAll('[data-source-preview]').forEach((preview) => {
    preview.hidden = !lines[step].some((line) => preview.querySelector(`[data-line="${line}"]`));
    if (!preview.hidden) preview.open = true;
  });
  highlight(lab, ...lines[step]);
  return explanations[step];
}

function mode(lab, fields) {
  const input = fields.mode.value;
  const event = fields.event.value;
  const modeValue = {unset: 'false', empty: 'false', true: 'true', false: 'false', invalid: 'yes'}[input];
  const compare = modeValue === 'true';
  const valid = modeValue === 'false' || compare;
  const branch = valid ? modeValue : '*';
  const line = {false: 115, true: 116, '*': 117}[branch];
  const inputLabel = {unset: 'Не задана', empty: 'Пустая строка'}[input] ?? modeValue;
  const eventValue = event === 'unset' ? '""' : event;
  lab.querySelector('[data-mode-expansion]').textContent = `${inputLabel} → ${modeValue}`;
  lab.querySelector('[data-mode-local]').textContent = modeValue;
  lab.querySelector('[data-mode-branch]').textContent = compare
    ? `true · test сравнивает ${eventValue} с workflow_dispatch`
    : `${branch} · test не вызывается`;
  highlight(lab, 112, line);
  if (!valid) return 'Статус 1 · echo пишет в stderr «ERROR: invalid independent validation mode», затем выполняется exit 1.';
  if (compare && event !== 'workflow_dispatch') return 'test вернул 1. Errexit останавливает скрипт до объявления путей.';
  return 'Статус 0. Скрипт переходит к объявлению путей.';
}

function paths(lab, fields) {
  const path = fields.path.value;
  const descriptions = {
    GITHUB_WORKSPACE: [4, checkout, 'Checkout уже существует. Git читает здесь индекс и HEAD.'],
    RUNNER_TEMP: [8, runnerTemp, 'Каталог runner уже существует. Из его пути получаются четыре локальных пути.'],
    tracked_paths: [119, runnerTemp + '/zed-overlay-tracked-paths', 'При присваивании это строка. Позже перенаправление в строке 126 открывает файл для списка из индекса.'],
    disposable_workspace: [120, runnerTemp + '/zed-overlay', 'При присваивании это строка. mkdir в строке 127 создаёт каталог.'],
    before_paths: [121, runnerTemp + '/zed-overlay-before-paths', 'При присваивании это строка. Перенаправление в строке 135 открывает файл снимка.'],
    prepare_log: [122, runnerTemp + '/zed-overlay-prepare.log', 'При присваивании это строка. Первый tee в строке 136 открывает файл журнала.'],
  };
  const [line, absolutePath, description] = descriptions[path];
  lab.querySelectorAll('[data-path]').forEach((item) => {
    item.classList.toggle('shell-path-current', item.dataset.path === path);
  });
  lab.querySelectorAll('[data-source-preview]').forEach((preview) => {
    preview.hidden = !preview.querySelector(`[data-line="${line}"]`);
  });
  highlight(lab, line);
  return `${path} → ${absolutePath}. ${description}`;
}

function filesystem(lab, fields) {
  const step = Number(fields.step.value);
  const lines = [[], [125], [126], [127], [130], [131]];
  const explanations = [
    'До первой команды существует checkout. Во временной области копии и списка путей ещё нет.',
    'echo дописывает handoff_ready=false в файл GITHUB_OUTPUT.',
    'Git читает индекс checkout. Bash направляет NUL-разделённый вывод в tracked_paths.',
    'mkdir создаёт пустой каталог $RUNNER_TEMP/zed-overlay.',
    'Git пишет архив HEAD в канал, tar распаковывает его во временный каталог.',
    'test возвращает 0. В распакованном дереве путь .git отсутствует.',
  ];
  lab.querySelector('[data-fs-tree]').textContent = step >= 4
    ? '└── app-editors/zed/\n    ├── Manifest\n    └── zed-1.28.1.ebuild'
    : step === 3 ? 'Каталог создан, пока пуст' : 'Каталог ещё не создан';
  lab.querySelector('[data-fs-content]').hidden = step < 4;
  lab.querySelector('[data-fs-output]').textContent = step >= 1 ? 'handoff_ready=false' : 'Ещё нет записи handoff_ready';
  lab.querySelector('[data-fs-index]').textContent = step >= 2
    ? packageFiles.map((path) => path + ' ␀').join('\n') : 'Файл ещё не создан';
  lab.querySelector('.workspace-transfer').classList.toggle('shell-transfer-active', step === 4);
  highlight(lab, ...lines[step]);
  return explanations[step];
}

function snapshot(lab, fields) {
  const nul = fields.separator.value === 'nul';
  const filename = 'app-editors/zed/report\nlocal.txt';
  const paths = [packageFiles[0], filename, packageFiles[1]];
  const visible = (text) => text.replaceAll('\n', '⏎');
  const boundary = nul ? '␀' : '⏎';
  const records = (nul ? paths : paths.flatMap((path) => path.split('\n'))).map((path) => {
    const record = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = visible(path);
    record.append(code);
    return record;
  });
  lab.querySelector('[data-record-bytes]').textContent = paths.map((path) => visible(path) + ' ' + boundary).join('\n');
  lab.querySelector('[data-records]').replaceChildren(...records);
  highlight(lab, 135);
  lab.dataset.separator = nul ? 'nul' : 'newline';
  return nul
    ? 'Три записи. В условном имени остаётся перевод строки. ␀ — NUL, ⏎ — перевод строки.'
    : 'Четыре записи. По байтам нельзя отличить перевод строки внутри имени от разделителя. ⏎ — перевод строки.';
}

function streams(lab, fields) {
  const event = fields.message.value;
  const line = {info: 'Пример: подготовка началась', release: 'Result: new-release', error: 'Пример: подготовка прервана'}[event];
  const stderr = event === 'error';
  const outputs = {
    stderr: stderr ? line : '—',
    console: stderr ? '—' : line,
    log: stderr ? 'Пустой файл' : line,
    summary: stderr ? 'Заголовок сводки' : 'Заголовок сводки\n' + line,
  };
  for (const [name, content] of Object.entries(outputs)) {
    lab.querySelector(`[data-output="${name}"]`).textContent = content;
  }
  lab.querySelectorAll('[data-stream]').forEach((node) => {
    node.classList.toggle('shell-focus', node.dataset.stream === (stderr ? 'stderr' : 'stdout'));
  });
  highlight(lab, 136);
  lab.dataset.outputChannel = stderr ? 'stderr' : 'stdout';
  return stderr
    ? 'FD 2 · строка идёт в поток ошибок runner мимо обоих tee. Журнал уже обнулён, сводка сохранила заголовок.'
    : 'FD 1 · строку получают оба tee, оба файла и консоль runner. Прежний журнал заменён, заголовок сводки сохранён.';
}

function pipeline(lab, fields) {
  const statuses = ['python', 'first', 'second'].map((name) => Number(fields[name].value));
  const pipefail = fields.pipefail.checked;
  const decidingProcess = pipefail ? statuses.findLastIndex((status) => status !== 0) : 2;
  const result = statuses[decidingProcess] ?? 0;
  lab.querySelectorAll('[data-process-status]').forEach((node, index) => {
    node.textContent = `${statuses[index]} · ${statuses[index] === 0 ? 'успех' : 'ошибка'}`;
    node.parentElement.classList.toggle('shell-focus', index === decidingProcess);
  });
  highlight(lab, 136, ...(result === 0 ? [137] : []));
  const names = ['Python', 'первый tee', 'второй tee'];
  const reason = decidingProcess === -1 ? 'все три команды успешны' : `статус определяет ${names[decidingProcess]}`;
  const next = result === 0 ? 'Строка 137 достижима.' : 'Errexit останавливает скрипт. Строка 137 пропущена.';
  return `Конвейер вернул ${result}, ${reason}. ${next}`;
}

function boundary(lab, fields) {
  const scenario = fields.scenario.value;
  const failure = {ok: -1, pipeline: 0, git: 1, manifest: 2}[scenario];
  const lines = [136, 137, 140];
  traceReleaseGates(lab, lines.length, failure);
  highlight(lab, ...(failure === -1 ? lines : [lines[failure]]));
  const manifest = scenario === 'manifest' ? 'изменён' : 'исходный';
  const candidate = scenario === 'pipeline' ? '' : '\n└── zed-1.29.0.ebuild [новый]';
  const previous = scenario === 'pipeline' ? '└' : '├';
  const git = scenario === 'git' ? '.git/ появился' : '.git отсутствует';
  lab.querySelector('[data-boundary-tree]').textContent =
    `app-editors/zed/\n├── Manifest [${manifest}]\n${previous}── zed-1.28.1.ebuild${candidate}\n\n${git}`;
  return {
    ok: 'Все три проверки прошли. Скрипт доходит до чтения результата в журнале.',
    pipeline: 'Первая ошибка на строке 136. Проверки .git и Manifest пропущены. В этом сценарии Python завершился до записи ebuild.',
    git: 'Первая ошибка на строке 137: найден .git. Сравнение Manifest пропущено.',
    manifest: 'Первая ошибка на строке 140: контрольная строка Manifest изменилась.',
  }[scenario];
}

const labs = {environment, function: functionTrace, mode, paths, filesystem, snapshot, streams, pipeline, boundary};

for (const lab of document.querySelectorAll('[data-shell-lab]')) {
  const box = lab.querySelector('[data-lab-controls]');
  const elements = Object.fromEntries([...box.querySelectorAll('select, input')].map((input) => [input.name, input]));
  const status = lab.querySelector('[role="status"].model-result');
  const step = elements.step;
  const buttons = [...box.querySelectorAll('[data-step]')];
  const render = () => {
    for (const button of buttons) {
      const next = step.selectedIndex + Number(button.dataset.step);
      button.setAttribute('aria-disabled', String(next < 0 || next >= step.options.length));
    }
    status.textContent = labs[lab.dataset.shellLab](lab, elements);
  };

  if (lab.dataset.shellLab === 'streams') {
    const code = lab.querySelector('.source-line code');
    const text = code.textContent;
    const pipe = text.indexOf(' | ');
    const command = document.createElement('span');
    command.className = 'shell-python-fragment';
    command.textContent = text.slice(2, pipe);
    const logging = document.createElement('span');
    logging.className = 'shell-logging-fragment';
    logging.textContent = text.slice(pipe);
    code.replaceChildren(text.slice(0, 2), command, logging);
  }

  if (lab.dataset.shellLab === 'environment') {
    lab.querySelectorAll('.source-line code').forEach((code) => {
      const text = code.textContent;
      const expansion = document.createElement('span');
      expansion.className = 'shell-expansion';
      expansion.textContent = text.slice(3, -1);
      code.replaceChildren(text.slice(0, 3), expansion, text.slice(-1));
    });
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      step.selectedIndex += Number(button.dataset.step);
      render();
    });
  }
  box.addEventListener('change', render);
  render();
  box.hidden = false;
}
