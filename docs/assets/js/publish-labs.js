import {renderReleaseGates} from './handbook.js';

const source = document.getElementById('publish-git-fixtures');
const {baseline, cases} = JSON.parse(source.textContent);
const manifest = 'app-editors/zed/Manifest';
const ebuild = 'app-editors/zed/zed-1.29.0.ebuild';
const patch = 'app-editors/zed/files/zed-1.29.0-wayland-only.patch';
const environment = [
  'GITHUB_TOKEN', 'GITHUB_API_URL', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_OWNER',
  'GITHUB_STEP_SUMMARY', 'RUNNER_TEMP', 'BRANCH', 'CANDIDATE_VERSION',
  'PATCH_CREATED', 'ARCHIVE_MODE', 'PUBLICATION_RESULT', 'DISTRIBUTION_BUNDLE',
];
const missing = {
  unset: 'RUNNER_TEMP', empty: 'BRANCH', token: 'GITHUB_TOKEN',
  bundle: 'DISTRIBUTION_BUNDLE', version: 'CANDIDATE_VERSION', publication: 'PUBLICATION_RESULT',
};
const empty = '(пустой вывод)';
const skipped = 'Команда не выполнена';
const invalidPair = 'ERROR: invalid archive/publication result';

function paths(list) {
  return list.length ? list.join('\n') : empty;
}

function expectedPaths(includePatch) {
  const raw = [manifest, ebuild];
  if (includePatch) raw.push(patch);
  return {raw: paths(raw), expected: paths([...raw].sort())};
}

function environmentResult(scenario) {
  const failure = missing[scenario];
  const last = failure ? environment.indexOf(failure) : environment.length - 1;
  const evaluations = environment.map((name, i) => {
    const expansion = '${' + name + ':?' + name + ' is required}';
    let state = 'непустая строка';
    if (i > last) state = 'SKIP';
    if (name === 'DISTRIBUTION_BUNDLE' && scenario === 'bundle_path') state = 'непустая строка → каталог отсутствует, но здесь не проверяется';
    if (name === failure) state = scenario === 'empty' ? 'пустая строка → ошибка' : 'не задана → ошибка';
    return `${i + 4}. ${expansion}\n    ${state}`;
  }).join('\n');
  return {
    evaluations,
    line: last + 4,
    result: failure
      ? `Строка ${last + 4}: ${failure} is required. Статус 1. Строка 16 не достигнута.`
      : 'Переменные развёрнуты в порядке строк 4–15. Последняя команда «:» вернула 0. Строка 16 достигнута.',
  };
}

function pairResult(archive, publication) {
  const value = `${archive}:${publication}`;
  const accepted = ['generation:generation', 'generation:reuse', 'reuse:reuse'].includes(value);
  const displayed = JSON.stringify(value);
  return {
    pair: `${displayed}\nОбразец: ${accepted ? value : '*'}${accepted ? '' : '\n' + invalidPair}`,
    line: accepted ? 18 : 19,
    result: accepted
      ? 'Строка 18. Статус case — 0. При корректной версии и окружении validate_release_diff() достижима.'
      : 'Строка 19. Выход со статусом 1. validate_release_diff() не достигнута.',
  };
}

function snapshot(state, column) {
  const entries = Object.entries(state)
    .filter(([, contents]) => contents[column] !== null)
    .map(([path, contents]) => `${path}\n  ${contents[column].replace(/ $/, ' [пробел]')}`);
  return entries.length ? entries.join('\n\n') : 'Путь отсутствует в этом слое';
}

function snapshots(state, beforeAdd = false) {
  return {
    head: snapshot(state, 0),
    before: snapshot(state, 1),
    index: snapshot(state, beforeAdd ? 1 : 2),
    work: snapshot(state, 3),
  };
}

const layerExamples = {
  unstaged_layer: ['исходная строка', 'исходная строка', 'правка', 'Обычный diff видит правку, staged diff пуст.'],
  staged_layer: ['исходная строка', 'правка', 'правка', 'Staged diff видит правку, обычный diff пуст.'],
  edited_layer: ['исходная строка', 'первая правка', 'вторая правка', 'Staged diff видит первую правку. Обычный diff показывает переход от первой ко второй.'],
  new_layer: [null, 'новый файл', 'новый файл', 'Staged diff показывает добавление. Путь уже в index.'],
  unchanged_layer: ['исходная строка', 'исходная строка', 'исходная строка', 'Оба diff пусты для этого пути.'],
  untracked_layer: [null, null, 'новый файл', 'Оба diff пусты для этого пути. git ls-files --others --exclude-standard показывает notes.txt.'],
  ignored_layer: [null, null, 'временный файл', 'Оба diff пусты для этого пути. git ls-files --others --exclude-standard пропускает scratch.tmp.'],
};

function layerResult(scenario) {
  const [head, index, work, result] = layerExamples[scenario];
  const file = scenario === 'ignored_layer' ? 'scratch.tmp' : 'notes.txt';
  return {...snapshots({[file]: [head, null, index, work]}), result};
}

function gitResult(scenario) {
  const fixture = cases[scenario];
  const expected = expectedPaths(['new', 'unchanged_patch'].includes(scenario)).expected;
  const actual = paths(fixture.staged);
  const tracked = paths(fixture.tracked ?? []);
  const untracked = paths(fixture.untracked ?? []);
  const compared = !fixture.add_error && !fixture.check_error;
  const cmp = compared ? Number(actual !== expected) : null;
  let diagnostic = empty;
  let failure = -1;
  let command;
  let stream = 'stderr';
  if (fixture.add_error) {
    [failure, command, diagnostic] = [6, 'git add', fixture.add_error];
  } else if (fixture.check_error) {
    [failure, command, diagnostic, stream] = [7, 'git diff --cached --check', fixture.check_error, 'stdout'];
  } else if (cmp !== 0) {
    failure = 9;
    command = 'cmp -s';
    diagnostic = `ERROR: staged paths do not match the release handoff allowlist\nExpected:\n${expected}\nActual:\n${fixture.staged.join('\n')}`;
  } else if (fixture.tracked) {
    [failure, command] = [10, 'test -n «вывод git diff --name-only»'];
    diagnostic = `ERROR: unstaged tracked changes remain after handoff apply\n${tracked}`;
  } else if (fixture.untracked) {
    [failure, command] = [11, 'test -n «вывод git ls-files --others --exclude-standard»'];
    diagnostic = `ERROR: unexpected untracked files remain after handoff apply\n${untracked}`;
  }
  return {
    ...snapshots({...baseline, ...fixture.state}),
    diagnostic, stream, failure, command, cmp, tracked, untracked,
    expected: compared ? expected : skipped,
    actual: compared ? actual : skipped,
    staged: actual,
    status: fixture.status,
  };
}

function integratedResult(scenario) {
  const early = {
    unset: [0, '${RUNNER_TEMP:?…}', 'RUNNER_TEMP: RUNNER_TEMP is required'],
    version_invalid: [1, '[[ … =~ … ]]', empty],
    pair_invalid: [2, 'case reuse:generation', invalidPair],
  }[scenario];
  const trace = early
    ? {
      ...snapshots(baseline, true),
      failure: early[0], command: early[1], diagnostic: early[2], status: 1,
      expected: skipped, actual: skipped, stream: 'stderr',
    }
    : gitResult(scenario);
  const {failure, command, status, stream} = trace;
  let stop = `Первая остановка — ${command}.`;
  if (failure === 10 || failure === 11) stop = `Остановка в ветке ${command}. Сам test вернул 0.`;
  const output = trace.diagnostic === empty ? empty : `${stream}\n${trace.diagnostic}`;
  return {
    ...trace,
    diagnostic: output,
    result: failure < 0
      ? 'Локальная функция вернула 0. Следующий вызов find_existing_pr достижим.'
      : `${stop} Статус выхода ${status}. find_existing_pr недостижима.`,
  };
}

function gitLabResult(lab, scenario) {
  const trace = gitResult(scenario);
  const {failure, status, cmp} = trace;
  switch (lab) {
    case 'staging':
      return {...trace, diagnostic: cases[scenario].add_error ?? empty, line: 33, result: failure === 6
        ? `git add вернул ${status}. Ни одна новая запись в этом примере не добавлена.`
        : 'git add вернул 0. Здесь показан index сразу после этой команды.'};
    case 'whitespace':
      return {...trace, line: 34, hunk: cases[scenario].hunk?.replace(/ $/gm, ' [пробел]') || 'Нет фрагментов с изменениями', result: failure === 7
        ? `Git вернул ${status}. Строка 38 с expected_paths не достигнута.`
        : 'Git вернул 0. Строка 38 с expected_paths достигнута.'};
    case 'allowlist': {
      const line = failure === 6 ? 33 : failure === 7 ? 34 : cmp === 1 ? 46 : 45;
      const outcome = cmp === null
        ? `Первая ошибка — ${trace.command}, статус ${status}. Списки ещё не сравнивались.`
        : cmp === 1 ? 'cmp -s вернул 1. Строки 47–52 печатают диагностику и завершают скрипт со статусом 1.'
          : 'cmp -s вернул 0. Списки совпали.';
      return {...trace, line, result: `${outcome} Проверка unstaged ${cmp === 0 ? 'достигнута' : 'пропущена'}.`};
    }
    case 'tracked':
      return {...trace, line: 54, result: failure === 10
        ? 'Git вернул 0 и напечатал пути. test -n вернул 0. Скрипт завершился со статусом 1.'
        : 'Git вернул 0 с пустым stdout. test -n вернул 1 и Bash перешёл к untracked-проверке.'};
    case 'untracked':
      return {...trace, line: 59, result: failure === 11
        ? 'Git вернул 0 со списком. test -n вернул 0. Скрипт завершился со статусом 1.'
        : 'Git вернул 0 с пустым stdout. test -n вернул 1, локальная функция завершилась успешно.'};
  }
}

function highlight(lab, first, last = first) {
  for (const preview of lab.querySelectorAll('[data-source-preview]')) {
    for (const row of preview.querySelectorAll('[data-line]')) {
      const number = Number(row.dataset.line);
      row.classList.toggle('shell-current-line', number >= first && number <= last);
    }
    if (preview.querySelector('.shell-current-line')) preview.open = true;
  }
}

function initLab(lab) {
  const kind = lab.dataset.publishLab;
  const controls = lab.querySelector('[data-publish-controls]');
  const scenario = controls.querySelector('[name="scenario"]');
  const gates = [...lab.querySelectorAll('[data-publish-gate]')];
  const panels = lab.querySelector('[data-publish-panels]');
  const status = lab.querySelector('[role="status"]');
  const outputs = lab.querySelectorAll('[data-publish-output]');

  function selectGate(button) {
    for (const gate of gates) gate.setAttribute('aria-pressed', String(gate === button));
    const [first, last] = button.dataset.publishGate.split(':').map(Number);
    if (first === 4 && scenario.value === 'unset') highlight(lab, environmentResult(scenario.value).line);
    else highlight(lab, first, last);
  }

  function render() {
    let trace;
    switch (kind) {
      case 'environment':
        trace = environmentResult(scenario.value);
        break;
      case 'pair':
        trace = pairResult(controls.querySelector('[name="archive"]').value, controls.querySelector('[name="publication"]').value);
        break;
      case 'layers':
        trace = layerResult(scenario.value);
        break;
      case 'expected': {
        const includePatch = scenario.value === 'true';
        trace = {
          ...expectedPaths(includePatch),
          branch: `test "${scenario.value}" = true → ${includePatch ? 0 : 1}`,
          line: includePatch ? 42 : 41,
          result: includePatch ? 'В staged diff ожидаются три пути.' : 'Тело if пропущено. В staged diff ожидаются два пути.',
        };
        break;
      }
      case 'integrated':
        trace = integratedResult(scenario.value);
        renderReleaseGates(lab, gates.map((_, index) => {
          if (trace.failure < 0 || index < trace.failure) return 'PASS';
          return index === trace.failure ? 'FAIL' : 'SKIP';
        }));
        selectGate(gates[trace.failure < 0 ? gates.length - 1 : trace.failure]);
        break;
      default:
        trace = gitLabResult(kind, scenario.value);
    }
    if (trace.line) highlight(lab, trace.line);
    for (const output of outputs) output.textContent = trace[output.dataset.publishOutput];
    status.textContent = trace.result;
  }

  for (const button of gates) {
    button.addEventListener('click', () => selectGate(button));
    button.previousElementSibling.hidden = true;
    button.hidden = false;
  }
  controls.addEventListener(kind === 'pair' ? 'input' : 'change', render);
  render();
  controls.hidden = false;
  panels.hidden = false;
}

document.querySelectorAll('[data-publish-lab]').forEach(initLab);
