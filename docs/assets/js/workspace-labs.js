import {traceReleaseGates} from './handbook.js';

const manifest = 'app-editors/zed/Manifest';
const candidate = 'app-editors/zed/zed-1.29.0.ebuild';
const previous = 'app-editors/zed/zed-1.28.1.ebuild';
const unexpected = 'unexpected.txt';
const cacheError = 'Pregenerated metadata/md5-cache must not be tracked by Git.';
const policyFailure = (reason) => `overlay policy: FAILED: ${reason}`;
const policySuccess = (count) => `overlay policy: OK (${count} Zed ebuild(s))`;
const cleanMessage = 'Source workspace remains clean: OK';
const dirtyMessage = 'ERROR: source workspace was modified';

function setText(lab, attribute, value) {
  lab.querySelector(`[data-${attribute}]`).textContent = value;
}

function policyInput(lab, scenario, highlight, runnerTemp) {
  const pathsFile = runnerTemp + '/zed-overlay-tracked-paths';
  const examples = {
    checkout: {
      origin: 'Индекс исходного checkout',
      input: 'git ls-files -z',
      paths: 'Git вызван, пути прочитаны. Правило кеша выполнено.',
      lines: [28, 31, 38, 148, 149, 174, 176],
    },
    saved: {
      origin: 'Список, сохранённый из исходного индекса',
      input: pathsFile + '\nprofiles/repo_name\\0\nmetadata/layout.conf\\0',
      paths: 'Список прочитан, Git не вызывается. Правило кеша выполнено.',
      lines: [44, 47, 53, 58, 148, 149, 172, 173, 176],
    },
    'no-option': {
      origin: 'Запрос к Git из отдельного каталога',
      input: 'git ls-files -z',
      paths: 'Git вызван, но не нашёл репозиторий. До проверки кеша выполнение не дошло.',
      error: 'Cannot inspect Git-tracked paths.',
      lines: [31, 35, 36, 148, 174, 176],
    },
    unreadable: {
      origin: 'Указанный файл отсутствует',
      input: pathsFile,
      paths: 'Чтение завершилось ошибкой. Git не вызван.',
      error: `Could not read tracked paths file: ${pathsFile}.`,
      lines: [47, 48, 50, 172, 173],
    },
    encoding: {
      origin: 'Указанный файл прочитан как байты',
      input: pathsFile + '\nПример байта: FF (hex)',
      paths: 'Декодирование завершилось ошибкой. Git не вызван.',
      error: `Tracked paths file is not valid UTF-8: ${pathsFile}.`,
      lines: [53, 54, 56, 172, 173],
    },
  };
  const example = examples[scenario];
  const fromCheckout = scenario === 'checkout';
  const loadError = scenario === 'unreadable' || scenario === 'encoding';
  const files = loadError
    ? 'Проверки файлов и кеша пропущены: вызова validate_overlay ещё не было.'
    : 'Структура, ebuild и patch проверены до правила о кеше.';
  setText(lab, 'policy-root', fromCheckout ? 'Исходный checkout' : runnerTemp + '/zed-overlay');
  lab.querySelector('[data-policy-added]').hidden = fromCheckout;
  lab.querySelector('[data-policy-candidate-patch]').hidden = fromCheckout;
  setText(lab, 'policy-previous-patch', (fromCheckout ? '└' : '├') + '── zed-1.28.1-wayland-only.patch');
  setText(lab, 'policy-files-state', files);
  setText(lab, 'policy-paths-origin', example.origin);
  setText(lab, 'policy-paths-input', example.input);
  setText(lab, 'policy-paths-state', example.paths + (scenario === 'saved' ? ' \\0 обозначает NUL.' : ''));
  setText(lab, 'policy-output', example.error ? policyFailure(example.error) : policySuccess(fromCheckout ? 1 : 2));
  highlight(lab, ...example.lines);
  return `${example.error ? 'FAIL' : 'PASS'} · ${example.paths} ${files}`;
}

function policyRules(lab, scenario, highlight, runnerTemp) {
  const root = runnerTemp + '/zed-overlay';
  const missingReference = scenario === 'reference';
  const missingPatch = scenario === 'patch';
  const trackedCache = scenario === 'tracked-cache';
  const diskCache = scenario === 'disk-cache';
  const diskError = missingReference || missingPatch;
  const lines = {
    reference: [138, 139, 140, 141],
    patch: [142, 143],
    'tracked-cache': [148, 149, 150],
    'disk-cache': [148, 149, 152],
    valid: [134, 137, 138, 142, 143, 144, 148, 149, 152],
  };
  const errors = {
    reference: `Ebuild must apply the Wayland-only patch through PATCHES: ${root}/${candidate}.`,
    patch: `Required file is missing: ${root}/app-editors/zed/files/zed-1.29.0-wayland-only.patch.`,
    'tracked-cache': cacheError,
  };
  const summaries = {
    valid: 'PASS · Новый ebuild найден на диске. Он и его patch прошли проверку, правило кеша выполнено.',
    reference: 'FAIL · Строка 138 проверяет содержимое нового ebuild, даже если его нет в списке. Правило кеша пропущено.',
    patch: 'FAIL · Строка 143 требует patch для нового ebuild, даже если его нет в списке. Правило кеша пропущено.',
    'tracked-cache': 'FAIL · Правило на строках 149–150 видит путь md5-cache в списке, даже когда файла нет на диске.',
    'disk-cache': 'PASS · Путь кеша есть на диске, но отсутствует в списке. Правило на строке 149 выполнено.',
  };
  setText(lab, 'rules-ebuild', '├── zed-1.29.0.ebuild' + (missingReference ? ' [без PATCHES]' : ''));
  setText(lab, 'rules-patch', missingPatch ? '· patch 1.29.0 отсутствует' : '└── zed-1.29.0-wayland-only.patch');
  lab.querySelector('[data-rules-disk-cache]').hidden = !diskCache;
  lab.querySelector('[data-rules-tracked-cache]').hidden = !trackedCache;
  setText(lab, 'rules-disk-rule', diskError ? 'Файловое правило нашло ошибку.' : 'Ebuild и patch проверены по файлам.');
  setText(lab, 'rules-path-rule', diskError ? 'До проверки кеша выполнение не дошло.' : 'Правило кеша читает этот список. \\0 обозначает NUL.');
  setText(lab, 'policy-output', errors[scenario] ? policyFailure(errors[scenario]) : policySuccess(2));
  traceReleaseGates(lab, 2, diskError ? 0 : trackedCache ? 1 : -1);
  highlight(lab, ...lines[scenario]);
  return summaries[scenario];
}

const policyTrace = {
  ok: {
    failure: -1,
    code: 0,
    stdout: [policySuccess(2), 'Overlay policy for disposable workspace: OK', 'Git-less workspace after overlay policy: OK'],
    stderr: [],
    lines: [61, 62, 63, 64, 70, 71],
  },
  policy: {
    failure: 0,
    code: 1,
    stdout: [policyFailure(cacheError)],
    stderr: ['ERROR: overlay policy failed for disposable workspace'],
    lines: [61, 62, 63, 66, 67],
  },
  'python-error': {
    failure: 0,
    code: 2,
    stdout: [],
    stderr: ['ERROR: overlay policy failed for disposable workspace'],
    lines: [61, 62, 63, 66, 67],
  },
  'git-path': {
    failure: 1,
    code: 0,
    stdout: [policySuccess(2), 'Overlay policy for disposable workspace: OK'],
    stderr: ['ERROR: disposable workspace gained .git after overlay policy'],
    lines: [61, 62, 63, 64, 70, 73, 74],
  },
};

function showStreams(lab, stdout, stderr) {
  setText(lab, 'workspace-stdout', stdout.join('\n') || '—');
  setText(lab, 'workspace-stderr', stderr.join('\n') || '—');
}

function policyResult(lab, scenario, highlight) {
  const {failure, code, stdout, stderr, lines} = policyTrace[scenario];
  const pythonPassed = code === 0;
  setText(lab, 'python-branch', pythonPassed ? '0 → then · 64' : `${code} → else · 66–67`);
  setText(lab, 'git-path-branch', {
    ok: 'then · 71',
    'git-path': 'else · 73–74',
  }[scenario] ?? 'До условия выполнение не дошло');
  traceReleaseGates(lab, 3, failure);
  showStreams(lab, stdout, stderr);
  highlight(lab, ...lines);
  return {
    ok: 'Python вернул 0. Обе ветки then выполнены, следующая функция вызывается на строке 158.',
    policy: 'Python вернул 1. Выполняется else. Проверка .git и вызов на строке 158 пропущены.',
    'python-error': 'В этом примере Python вернул 2 из-за ошибки запуска скрипта. Возможная диагностика интерпретатора здесь не приведена. Выполняется else и дальнейшие проверки пропущены.',
    'git-path': 'Python вернул 0 и Bash уже сообщил об успехе политики. В гипотетическом сценарии .git появился и проверка на строке 70 отклоняет копию. Вызов на строке 158 пропущен.',
  }[scenario];
}

const statusExamples = {
  clean: {path: manifest, versions: ['Версия A', 'Версия A', 'Версия A'], columns: ''},
  unstaged: {path: manifest, versions: ['Версия A', 'Версия A', 'Версия B'], columns: ' M'},
  staged: {path: manifest, versions: ['Версия A', 'Версия B', 'Версия B'], columns: 'M '},
  both: {path: manifest, versions: ['Версия A', 'Версия B', 'Версия C'], columns: 'MM'},
  added: {path: candidate, versions: ['Пути нет', 'Версия A', 'Версия A'], columns: 'A '},
  deleted: {path: previous, versions: ['Версия A', 'Версия A', 'Файл удалён'], columns: ' D'},
  untracked: {path: unexpected, versions: ['Пути нет', 'Пути нет', 'Файл вне Git'], columns: '??'},
  ignored: {path: 'scratch.tmp', versions: ['Пути нет', 'Пути нет', 'Файл совпал с правилом *.tmp'], columns: ''},
};

function statusLine({path, columns}) {
  return columns ? `${columns} ${path}` : '';
}

function shortStatus(lab, scenario, highlight) {
  const example = statusExamples[scenario];
  const line = statusLine(example);
  const columns = example.columns;
  const x = {' ': 'пробел · индекс совпадает с HEAD', M: 'M · правка в индексе', A: 'A · новый файл в индексе'};
  const y = {' ': 'пробел · рабочее дерево совпадает с индексом', M: 'M · правка в рабочем дереве', D: 'D · файл удалён с диска'};
  const pair = columns === '??';
  setText(lab, 'status-path', example.path);
  for (const [index, state] of ['head', 'index', 'worktree'].entries()) {
    setText(lab, `status-${state}`, example.versions[index]);
  }
  setText(lab, 'status-line', line || '—');
  setText(lab, 'status-x', pair ? 'X и Y · пара ?? обозначает неотслеживаемый путь' : `X · ${x[columns[0]] ?? 'строки нет'}`);
  setText(lab, 'status-y', pair ? '' : `Y · ${y[columns[1]] ?? 'строки нет'}`);
  setText(lab, 'status-captured', `"${line}"`);
  setText(lab, 'status-test', `test -z → ${line ? 1 : 0}`);
  highlight(lab, 81, 82, ...(line ? [85, 86, 87] : [83]));
  if (line) return `FAIL · test -z вернул 1. Bash печатает ${dirtyMessage} в stderr. Затем Bash выводит строку статуса и завершает скрипт с кодом 1.`;
  return `PASS · test -z вернул 0. Bash печатает ${cleanMessage}`;
}

function statusDiagnostics(lab, fields, highlight) {
  const length = Number(fields.length.value);
  const quiet = fields.quiet.checked;
  const input = Array.from({length}, (_, index) => `?? unexpected-${index + 1}.txt`);
  const selected = Math.min(length, 25);
  const output = quiet
    ? input.slice(0, selected)
    : input.flatMap((line, index) => index < selected ? [line, line] : [line]);
  const omitted = quiet && length > 25 ? `В stderr отсутствуют входные строки 26–${length}.` : 'Пропущенных строк нет.';
  setText(lab, 'sed-command', quiet ? "sed -n '1,25p'" : "sed '1,25p'");
  setText(lab, 'sed-input-count', `Строк на входе: ${length}`);
  setText(lab, 'sed-range', selected ? `Адрес 1,25 · выбрано 1–${selected}` : 'Адрес 1,25 · нет входных строк');
  setText(lab, 'sed-output-count', `Строк выведено: ${output.length}`);
  setText(lab, 'sed-input', input.map((line, i) => `${i + 1}  ${line}`).join('\n') || '—');
  setText(lab, 'sed-output', output.join('\n') || '—');
  highlight(lab, ...(quiet && length ? [86] : []));
  setText(lab, 'sed-omitted', omitted);
  lab.querySelectorAll('.workspace-report').forEach((report) => { report.scrollTop = 0; });
  return `Строк на входе: ${length}. Строк в stderr: ${output.length}.`;
}

function workspaceGates(lab, scenario, highlight, checkout) {
  const trace = policyTrace[scenario] ?? policyTrace.ok;
  const checkoutFailure = {'git-error': 2, tracked: 3, untracked: 3}[scenario];
  const failure = checkoutFailure ?? trace.failure;
  const stdout = [...trace.stdout];
  const stderr = [...trace.stderr];
  const lines = [...trace.lines];
  if (failure === -1) {
    stdout.push(cleanMessage);
    lines.push(81, 82, 83, 160);
  } else if (failure === 2) {
    stderr.push(`fatal: cannot change to '${checkout}': No such file or directory`);
    lines.push(81);
  } else if (failure === 3) {
    stderr.push(dirtyMessage, statusLine(statusExamples[scenario === 'tracked' ? 'unstaged' : 'untracked']));
    lines.push(81, 82, 85, 86, 87);
  }
  showStreams(lab, stdout, stderr);
  traceReleaseGates(lab, 5, failure);
  highlight(lab, ...lines);
  const step = {
    policy: '61 · Python вернул ошибку политики для временной копии',
    'git-path': '70 · во временной копии обнаружен .git',
    'git-error': '81 · в этом примере каталог исходного checkout отсутствует. Git вернул 128, Bash остановился на присваивании',
    tracked: '82 · Git сообщил об изменении отслеживаемого файла в исходном checkout',
    untracked: '82 · Git сообщил о неотслеживаемом файле в исходном checkout',
  }[scenario];
  if (!step) return 'Все проверки выполнены. Скрипт доходит до условия на строке 160.';
  return `Первая ошибка — строка ${step}. До строки 160 скрипт не дойдёт.`;
}

export function workspaceLabs(highlight, runnerTemp, checkout) {
  return {
    'policy-input': (lab, {scenario}) => policyInput(lab, scenario.value, highlight, runnerTemp),
    'policy-rules': (lab, {scenario}) => policyRules(lab, scenario.value, highlight, runnerTemp),
    'policy-result': (lab, {scenario}) => policyResult(lab, scenario.value, highlight),
    'short-status': (lab, {scenario}) => shortStatus(lab, scenario.value, highlight),
    'status-diagnostics': (lab, fields) => statusDiagnostics(lab, fields, highlight),
    'workspace-gates': (lab, {scenario}) => workspaceGates(lab, scenario.value, highlight, checkout),
  };
}
