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


const api = JSON.parse(document.getElementById('publish-api-fixtures').textContent);
const apiBase = 'https://api.github.example';
const repository = 'fixture/overlay';
const automationBranch = 'automation/zed-v1.29.0';
const pullsUrl = `${apiBase}/repos/${repository}/pulls`;
const refUrl = `${apiBase}/repos/${repository}/git/ref/heads/${automationBranch}`;
const pullFile = '$RUNNER_TEMP/zed-release-pulls.json';
const refFile = '$RUNNER_TEMP/zed-release-branch.json';
const query = {
  state: 'open',
  base: 'main',
  head: `fixture:${automationBranch}`,
  per_page: '1',
};

function apiArguments(scenario) {
  const wrapper = [
    '--silent', '--show-error',
    '--header', 'Accept: application/vnd.github+json',
    '--header', 'Authorization: Bearer <REDACTED>',
    '--header', 'X-GitHub-Api-Version: 2022-11-28',
  ];
  const forwarded = {
    wrapper: [],
    pulls: ['--fail', '--get', ...Object.entries(query).flatMap(([key, value]) => ['--data-urlencode', `${key}=${value}`]), pullsUrl],
    refs: ['--output', refFile.replace('$RUNNER_TEMP', '/tmp/runner'), '--write-out', '%{http_code}', refUrl],
  }[scenario];
  return {
    args: ['curl', ...wrapper.map(arg => JSON.stringify(arg))].join('\n'),
    forwarded: forwarded.length ? forwarded.map(arg => JSON.stringify(arg)).join('\n') : 'Пустой список аргументов',
    result: 'Читать сверху вниз. Каждая строка после curl — один аргумент. Значение токена скрыто.',
    line: scenario === 'wrapper' ? 22 : scenario === 'pulls' ? 69 : 97,
    last: scenario === 'wrapper' ? 28 : scenario === 'pulls' ? 74 : 99,
  };
}

function apiRequest(scenario) {
  const encoded = api.get_query.split('&');
  const index = Object.keys(query).indexOf(scenario);
  return {
    endpoint: `API: ${apiBase}\nПуть: /repos/${repository}/pulls\nGET ${pullsUrl}?${api.get_query}\nstdout → ${pullFile}`,
    encoding: Object.entries(query).map(([key, value], i) => `${key}=${value} → ${encoded[i]}`).join('\n'),
    result: `Параметр ${scenario} в URL: ${encoded[index]}.`,
    line: 70 + index,
  };
}

function parserResult(scenario) {
  const parsed = api.parser[scenario];
  const captured = parsed.stdout.replace(/\n+$/, '');
  const [line, last = line] = {
    empty: [84], found: [88], many: [85, 88], object: [82, 83], malformed: [81],
    missing_url: [85, 87], null_url: [86, 87], number_url: [86, 87],
    blank_url: [88], invalid_item: [85], missing_file: [80],
  }[scenario];
  const variable = `existing_pr_url=${JSON.stringify(captured)}`;
  const next = parsed.status ? 'main() не продолжится'
    : captured ? 'main() перейдёт к summary и пропустит запрос ветки'
      : 'main() перейдёт к проверке ветки';
  return {
    ...parsed,
    json: parsed.body ?? 'Файл response.json отсутствует',
    parse: `${parsed.operation}\nСтатус Python: ${parsed.status}\nstdout: ${JSON.stringify(parsed.stdout)}\nstderr: ${parsed.stderr || empty}`,
    variable,
    captured, line, last,
    result: `${variable}. Присваивание вернуло ${parsed.status}, ${next}.`,
  };
}

function apiBranch(scenario) {
  const received = api.branch[scenario.slice(4)];
  const sample = scenario === 'no_connection' ? api.transport.branch
    : received ?? {curl: 0, writeout: scenario === 'empty_writeout' ? '' : 'oops'};
  const {curl, writeout} = sample;
  const caseLabel = curl ? 'case пропущен' : writeout === '404' ? '404)' : writeout === '200' ? '200)' : '*)';
  const status = curl || Number(writeout !== '404');
  const diagnostic = received?.stderr ?? (curl
    ? 'curl: (7) … (отказ соединения в локальной проверке)'
    : `ERROR: could not determine remote branch state (HTTP ${writeout})`);
  const variable = `branch_status=${JSON.stringify(writeout)}`;
  const line = curl || scenario === 'http404' || scenario === 'http200'
    ? (curl ? 97 : scenario === 'http404' ? 101 : 102)
    : 106;
  return {
    response: received ? `HTTP ${received.http}\nТело → ${refFile}\n${received.body}`
      : 'В этом сценарии тело в файл не записано',
    writeout: `stdout curl: ${JSON.stringify(writeout)}\n${variable}`,
    stderr: curl ? diagnostic : empty,
    branch: `Код curl: ${curl}\nСтатус присваивания: ${curl}\nВетвь: ${caseLabel}\nstderr функции: ${diagnostic || empty}`,
    variable, status, failure: curl ? 'ref' : status ? 'ref_case' : '',
    diagnostic, line, last: curl ? 99 : caseLabel === '200)' ? 105 : caseLabel === '*)' ? 109 : 101,
    result: status ? `${curl ? 'Присваивание' : 'Проверка статуса'} останавливает скрипт с кодом ${status}. commit_and_push_branch недостижима.`
      : 'Функция вернула 0. Вызов commit_and_push_branch достижим.',
  };
}

const discoveryScenarios = {
  found_pr: {parser: 'found', remote: 'Есть подходящий открытый PR. Git ref отдельно не запрашивается.'},
  absent_pr: {},
  closed_pr: {ref: 'http200', remote: 'Закрытый PR вне state=open. Git ref найден.'},
  other_head: {remote: 'Открытый PR из другой ветки вне head=fixture:automation/zed-v1.29.0. Искомая ветка не найдена.'},
  other_base: {ref: 'http200', remote: 'Открытый PR с base=develop вне base=main. Automation-ветка найдена.'},
  pr_http: {curl: 22},
  pr_transport: {curl: api.transport.pr.curl},
  pr_bad_json: {parser: 'malformed'},
  pr_object: {parser: 'object'},
  pr_no_url: {parser: 'missing_url'},
  pr_empty_url: {parser: 'blank_url', remote: 'API вернул объект с пустым URL. Git ref не найден.'},
  ref_conflict: {ref: 'http200'},
  ref_unexpected: {ref: 'http403'},
  ref_transport: {ref: 'no_connection'},
  response_write: {openFailed: true},
  summary_write: {parser: 'found', summaryFailed: true, remote: 'Подходящий открытый PR найден до ошибки записи.'},
};

function apiDiscovery(scenario) {
  const example = discoveryScenarios[scenario];
  const gates = {local: 'PASS'};
  const curl = example.curl ?? 0;
  let failure;
  let status;
  let diagnostic = empty;
  let parsed;
  let branch;
  let summary = skipped;
  let wire = skipped;
  let file = skipped;
  let remote = example.remote ?? 'Наличие подходящего открытого PR и Git ref не установлено.';
  if (example.openFailed) {
    [failure, status] = ['redirect', 1];
    diagnostic = 'No such file or directory (конец сообщения Bash при открытии файла)';
    file = `${pullFile}\nОткрытие на запись не удалось`;
  } else {
    gates.redirect = gates.request = 'PASS';
    if (curl) {
      [failure, status] = ['response', curl];
      wire = curl === 22 ? 'HTTP 503 · curl завершился с 22' : 'HTTP-ответа нет · curl завершился с 7';
      diagnostic = curl === 22 ? api.pr_http_error : 'curl: (7) … (отказ соединения в локальной проверке)';
      file = `${pullFile}\nФайл открыт, тело не записано`;
    } else {
      gates.response = gates.body = 'PASS';
      parsed = parserResult(example.parser ?? 'empty');
      wire = 'HTTP 200 · curl завершился с 0';
      file = `${pullFile}\n${parsed.json}`;
      if (parsed.status) {
        [failure, status, diagnostic] = ['parse', parsed.status, parsed.stderr];
      } else {
        gates.parse = gates.url = gates.decision = 'PASS';
        if (parsed.captured) {
          if (example.summaryFailed) {
            [failure, status] = ['summary', 1];
            diagnostic = 'Is a directory (конец сообщения Bash при записи summary)';
            summary = 'Открытие $GITHUB_STEP_SUMMARY через >> завершилось ошибкой';
          } else {
            gates.summary = gates.done = 'PASS';
            status = 0;
            summary = `>> $GITHUB_STEP_SUMMARY\nExisting automation PR: ${parsed.captured}`;
          }
        } else {
          branch = apiBranch(example.ref ?? 'http404');
          if (branch.failure !== 'ref') gates.ref = 'PASS';
          if (branch.failure) {
            [failure, status, diagnostic] = [branch.failure, branch.status, branch.diagnostic];
          } else {
            gates.ref_case = gates.next = 'PASS';
          }
          if (!example.remote) {
            remote = {
              'branch_status="404"': 'Подходящего открытого PR нет. Git ref не найден на момент ответа.',
              'branch_status="200"': 'Подходящего открытого PR нет. Git ref существует.',
            }[branch.variable] ?? 'Подходящего открытого PR нет. Состояние Git ref не установлено.';
          }
        }
      }
    }
  }
  if (failure) gates[failure] = 'FAIL';
  const first = {
    redirect: 'перенаправление > для файла ответа (строка 75)',
    response: 'curl для списка PR (строки 69–75)',
    parse: `${parsed?.operation} (Python, строка ${parsed?.line})`,
    summary: 'перенаправление >> для summary (строка 213)',
    ref: 'присваивание branch_status (строки 97–99)',
    ref_case: `case для ${branch?.variable} (строки ${branch?.line}–${branch?.last})`,
  }[failure];
  const result = failure ? `Первая ошибка — ${first}. Выход со статусом ${status}. commit_and_push_branch недостижима.`
    : status === 0 ? 'Summary записан. Скрипт завершился с 0 и пропустил проверку ветки и новый push.'
      : 'Проверка ветки вернула 0. Следующий вызов commit_and_push_branch достижим.';
  return {
    gates, result, failure, diagnostic, summary, remote, wire, file,
    parse: parsed?.parse ?? skipped,
    variable: `${parsed?.variable ?? 'existing_pr_url ещё не присвоена'}\n${branch?.variable ?? 'branch_status ещё не присвоена'}`,
    ref: branch ? `${branch.response}\n${branch.branch}` : skipped,
    local: `HEAD — исходный коммит\nStaged diff:\n${paths(cases.existing.staged)}\nUnstaged и видимых untracked изменений нет в этой фикстуре`,
    focus: failure ?? (status === 0 ? 'done' : 'next'),
    ranges: {
      parse: parsed?.status ? [parsed.line, parsed.last] : [76, 90],
      ref_case: branch && branch.failure !== 'ref' ? [branch.line, branch.last] : [100, 110],
    },
  };
}

const branchCases = JSON.parse(document.getElementById('publish-branch-fixtures').textContent);

function branchPublish(scenario, stages) {
  const example = branchCases[scenario];
  const stoppedAt = stages.indexOf(example.failure);
  const gates = stages.map((stage, index) => {
    if (stage === 'exit_restore') return example.exit_restore ?? 'SKIP';
    if (index === stoppedAt) return 'FAIL';
    return stoppedAt === -1 || index < stoppedAt ? 'PASS' : 'SKIP';
  });
  return {...example, gates, focus: stoppedAt === -1 ? stages.indexOf('disarm') : stoppedAt};
}

function highlight(lab, first, last = first) {
  for (const preview of lab.querySelectorAll('[data-source-preview]')) {
    const sourcePath = preview.querySelector('.source-preview-meta code').textContent;
    for (const row of preview.querySelectorAll('[data-line]')) {
      const number = Number(row.dataset.line);
      row.classList.toggle('shell-current-line', sourcePath === 'scripts/ci/publish-release-pr.sh' && number >= first && number <= last);
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

  let trace;
  function selectGate(button) {
    for (const gate of gates) gate.setAttribute('aria-pressed', String(gate === button));
    const stage = button.closest('[data-api-stage]')?.dataset.apiStage;
    const [first, last] = trace.ranges?.[stage] ?? button.dataset.publishGate.split(':').map(Number);
    if (first === 4 && scenario.value === 'unset') highlight(lab, environmentResult(scenario.value).line);
    else highlight(lab, first, last);
  }

  function render() {
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
      case 'api-arguments':
        trace = apiArguments(scenario.value);
        break;
      case 'api-request':
        trace = apiRequest(scenario.value);
        break;
      case 'api-parser':
        trace = parserResult(scenario.value);
        break;
      case 'api-streams':
        trace = {...apiBranch(scenario.value), line: 97, last: 99};
        break;
      case 'api-branch':
        trace = apiBranch(scenario.value);
        break;
      case 'branch-publish':
        trace = branchPublish(scenario.value, gates.map(button => button.closest('[data-api-stage]').dataset.apiStage));
        renderReleaseGates(lab, trace.gates);
        selectGate(gates[trace.focus]);
        break;
      case 'api-retry':
      case 'api-errors':
      case 'api-timeline':
      case 'api-decision': {
        trace = apiDiscovery(scenario.value);
        const stages = gates.map(button => button.closest('[data-api-stage]').dataset.apiStage);
        if (gates.length) {
          renderReleaseGates(lab, stages.map(stage => trace.gates[stage] ?? 'SKIP'));
          const active = stages.indexOf(trace.focus);
          selectGate(gates[active < 0 ? gates.length - 1 : active]);
        }
        break;
      }
      default:
        trace = gitLabResult(kind, scenario.value);
    }
    if (trace.line) highlight(lab, trace.line, trace.last);
    for (const output of outputs) output.textContent = trace[output.dataset.publishOutput];
    status.textContent = trace.result;
  }

  for (const button of gates) {
    button.addEventListener('click', () => selectGate(button));
    button.previousElementSibling.hidden = true;
    button.hidden = false;
    button.nextElementSibling.hidden = false;
  }
  controls.addEventListener(kind === 'pair' ? 'input' : 'change', render);
  render();
  controls.hidden = false;
  panels.hidden = false;
}

document.querySelectorAll('[data-publish-lab]').forEach(initLab);
