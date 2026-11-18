function initTheme(control) {
  const select = control.querySelector('select');
  const key = 'zed-overlay-handbook-theme';

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    select.value = theme;
  }

  try {
    const saved = localStorage.getItem(key);
    if (saved === 'dark' || saved === 'light') apply(saved);
  } catch {
    // The theme switch still works when browser storage is blocked.
  }

  select.addEventListener('change', () => {
    apply(select.value);
    try {
      localStorage.setItem(key, select.value);
    } catch {
      // Keep the selection for this page.
    }
  });
  control.hidden = false;
}

function initSelector(container) {
  const panels = [...container.querySelectorAll(':scope > [data-panel]')];
  const source = container.querySelector(':scope > [data-source-lines]');
  const authored = container.querySelector(':scope > [data-selection-controls]');
  const controls = source ?? authored ?? document.createElement('div');
  const lines = source ? [...source.querySelectorAll('[data-line]')] : [];
  const authoredControls = new Map(
    [...(authored?.querySelectorAll('[data-select]') ?? [])].map((item) => [item.dataset.select, item])
  );
  const highlights = authored?.querySelectorAll('[data-highlight-for]') ?? [];

  if (!source && !authored) {
    controls.className = 'selection-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', container.dataset.label);
    container.append(controls);
  }

  const buttons = panels.map((panel, index) => {
    const item = authoredControls.get(panel.id);
    const button = item?.tagName === 'BUTTON' ? item : document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', () => select(index));

    if (source) {
      const [first, last = first] = panel.dataset.lines.split('-').map(Number);
      const rows = lines.filter((row) => Number(row.dataset.line) >= first && Number(row.dataset.line) <= last);
      const code = rows.map((row) => row.querySelector('code').textContent.trim()).join(' ');
      button.setAttribute('aria-label', panel.dataset.label + '. ' + code);
      rows[0].before(button);
      button.append(...rows);
    } else if (item && item !== button) {
      button.textContent = item.textContent;
      if (item.hasAttribute('aria-label')) button.setAttribute('aria-label', item.getAttribute('aria-label'));
      item.replaceWith(button);
    } else if (!item) {
      button.textContent = panel.dataset.label;
      controls.append(button);
    }
    return button;
  });

  function select(active) {
    panels.forEach((panel, index) => {
      panel.hidden = index !== active;
      buttons[index].setAttribute('aria-pressed', String(index === active));
    });
    highlights.forEach((item) => {
      item.classList.toggle('is-selected', item.dataset.highlightFor === panels[active].id);
    });
  }

  const content = document.createElement('div');
  content.setAttribute('aria-live', 'polite');
  content.append(...panels);
  container.append(content);
  select(0);
  if (authored) authored.hidden = false;
}

export function simulate(scenario, validationOnly, branch) {
  const pass = (reason) => ({ status: 'PASS', reason });
  const fail = (reason) => ({ status: 'FAIL', reason });
  const skip = (reason) => ({ status: 'SKIP', reason });

  if (scenario === 'candidate-error') {
    const blocked = skip('Подготовка кандидата завершилась ошибкой.');
    return {
      jobs: [fail('Кандидат не прошёл подготовку или проверку.'), blocked, blocked],
      outcome: 'Ошибка подготовки кандидата.'
    };
  }
  if (scenario === 'current') {
    const absent = skip('Нового релиза для передачи нет.');
    return {
      jobs: [pass('Версия актуальна. Подготовка архива пропущена.'), absent, absent],
      outcome: 'Up-to-date · пакет уже актуален.'
    };
  }

  const reuse = scenario === 'reuse' || scenario === 'existing';
  const mode = reuse ? 'Reuse' : 'Generation';
  const prepared = reuse ? 'Проверен опубликованный архив.' : 'Сгенерирован и проверен новый архив.';

  if (validationOnly) {
    const disabled = skip('Validation-only mode отключает передачу handoff и публикацию.');
    return {
      jobs: [pass(prepared + ' Кандидат прошёл проверку без создания handoff.'), disabled, disabled],
      outcome: mode + ' · проверка завершена без публикации.'
    };
  }

  const check = pass(prepared + ' Оба артефакта загружены.');
  if (scenario === 'handoff-error') {
    return {
      jobs: [check, fail('Переданные данные не прошли независимую проверку.'), skip('Проверка handoff завершилась ошибкой.')],
      outcome: mode + ' · ошибка проверки handoff.'
    };
  }

  const validation = pass('Состав handoff, базовый коммит и комплект crates согласованы.');
  if (branch !== 'main') {
    return {
      jobs: [check, validation, skip('Публикация разрешена только для main.')],
      outcome: mode + ' · публикация недоступна вне main.'
    };
  }
  const publicationFailures = {
    'main-drift': 'HEAD свежего checkout отличается от базы handoff.',
    'release-conflict': 'После применения handoff найден конфликтующий draft release.',
    'public-error': 'Release опубликован. Проверка публичного скачивания завершилась ошибкой.',
  };
  if (Object.hasOwn(publicationFailures, scenario)) {
    const reason = publicationFailures[scenario];
    return {
      jobs: [check, validation, fail(reason)],
      outcome: mode + ' · ' + reason
    };
  }
  if (scenario === 'pr-error') {
    return {
      jobs: [check, validation, fail('Архив опубликован. Проверка git diff --cached --check остановила job до создания ветки.')],
      outcome: mode + ' · опубликованный архив сохранился после сбоя на этапе PR.'
    };
  }
  if (scenario === 'existing') {
    return {
      jobs: [check, validation, pass('Публичные файлы проверены. Открытый automation PR найден.')],
      outcome: mode + ' · использован существующий PR.'
    };
  }
  return {
    jobs: [check, validation, pass('Публичные файлы проверены. Открыт новый Draft PR.')],
    outcome: mode + ' · создан новый Draft PR.'
  };
}

function initSimulator(form) {
  const statuses = form.querySelectorAll('[data-status]');
  const reasons = form.querySelectorAll('[data-reason]');
  const outcomeText = form.querySelector('[data-outcome]');

  function render() {
    const { scenario, validation, branch } = form.elements;
    const { jobs, outcome } = simulate(scenario.value, validation.checked, branch.value);
    jobs.forEach(({ status, reason }, index) => {
      statuses[index].dataset.status = status;
      statuses[index].textContent = status;
      reasons[index].textContent = reason;
    });
    outcomeText.textContent = outcome;
  }

  form.addEventListener('change', render);
  form.addEventListener('submit', (event) => event.preventDefault());
  render();
  form.hidden = false;
}

function initQuiz(form) {
  const questions = [...form.querySelectorAll('fieldset')];
  const score = form.querySelector('[data-score]');

  function render() {
    const answers = questions.map((question) => {
      const answer = question.querySelector('input:checked');
      const output = question.querySelector('[data-feedback-output]');
      const correct = answer?.hasAttribute('data-correct');
      output.textContent = answer
        ? (correct ? 'Верно. ' : 'Неверно. ') + answer.dataset.feedback
        : '';
      output.dataset.status = answer ? (correct ? 'PASS' : 'FAIL') : '';
      return answer;
    });

    score.textContent = answers.every(Boolean)
      ? 'Результат: ' + answers.filter((answer) => answer.hasAttribute('data-correct')).length + ' из ' + answers.length
      : '';
  }

  form.addEventListener('change', render);
  form.addEventListener('reset', () => {
    // Read checked states after the browser performs the native reset.
    setTimeout(render, 0);
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  render();
  form.hidden = false;
}

function initCron(form) {
  const controls = form.querySelector('[data-cron-controls]');
  const result = form.querySelector('[data-cron-result]');
  const fields = form.querySelectorAll('[data-cron-field]');

  function render() {
    const { minute, hour } = form.elements;
    const time = [hour.value, minute.value].map((part) => part.padStart(2, '0')).join(':');
    fields[0].textContent = minute.value;
    fields[1].textContent = hour.value;
    result.querySelector('code').textContent = `${minute.value} ${hour.value} * * *`;
    result.querySelector('span').textContent = `Ежедневно в ${time} UTC.`;
  }

  form.addEventListener('input', render);
  form.addEventListener('reset', () => setTimeout(render, 0));
  form.addEventListener('submit', (event) => event.preventDefault());
  render();
  controls.hidden = false;
}

function initConcurrency(container) {
  const controls = container.querySelector('[data-concurrency-controls]');
  const cancel = controls.querySelector('select');
  const third = controls.querySelector('input');
  const scenarios = container.querySelectorAll('[data-concurrency-scenario]');

  function render() {
    const active = `${cancel.value}-${third.checked ? 3 : 2}`;
    scenarios.forEach((scenario) => {
      scenario.hidden = scenario.dataset.concurrencyScenario !== active;
    });
  }

  controls.addEventListener('change', render);
  render();
  controls.hidden = false;
}

function initSourceCopy(preview) {
  if (!navigator.clipboard?.writeText) return;
  const button = preview.querySelector('[data-copy-source]');
  const status = preview.querySelector('[data-copy-status]');
  button.addEventListener('click', async () => {
    const code = Array.from(preview.querySelectorAll('.source-line code'), (line) => line.textContent).join('\n');
    try {
      await navigator.clipboard.writeText(code);
      status.textContent = 'Код скопирован.';
    } catch {
      status.textContent = 'Не удалось скопировать код. Выделите его вручную.';
    }
  });
  button.hidden = false;
}

function initTimeout(form) {
  const { limit, required } = form.elements;
  const limitLabel = form.querySelector('[data-timeout-limit]');
  const requiredLabel = form.querySelector('[data-timeout-required]');
  const track = form.querySelector('[data-timeout-track]');
  const result = form.querySelector('[data-timeout-result]');

  function render() {
    const timeout = limit.valueAsNumber;
    const duration = required.valueAsNumber;
    const completed = Math.min(timeout, duration);
    const remaining = duration - completed;
    const percent = (minutes) => `${minutes * 100 / Number(required.max)}%`;
    limitLabel.textContent = `${timeout} мин`;
    requiredLabel.textContent = `${duration} мин`;
    track.style.setProperty('--timeout', percent(timeout));
    track.style.setProperty('--required', percent(duration));
    track.style.setProperty('--completed', percent(completed));
    result.dataset.status = remaining ? 'FAIL' : 'PASS';
    const outcome = remaining
      ? `Остаётся ${remaining} мин работы. GitHub Actions может остановить задание.`
      : 'Задание укладывается в лимит.';
    result.textContent = `Нужно ${duration} мин при лимите ${timeout} мин. Выполнено ${completed} мин из ${duration}. ${outcome}`;
  }

  form.addEventListener('input', render);
  form.addEventListener('reset', () => setTimeout(render, 0));
  render();
  form.querySelector('[data-timeout-controls]').hidden = false;
}

function initOutputFlow(figure) {
  const control = figure.querySelector('[data-handoff-ready]');
  const write = figure.querySelector('[data-handoff-write]');
  const values = figure.querySelectorAll('[data-handoff-value]');
  const decision = figure.querySelector('[data-output-decision]');

  function render() {
    const ready = control.checked;
    write.hidden = !ready;
    values.forEach((value) => { value.textContent = `"${ready}"`; });
    decision.dataset.status = ready ? 'PASS' : 'SKIP';
    decision.textContent = ready
      ? 'Результат true. Требование к handoff выполнено.'
      : 'Результат false. Проверка handoff пропускается.';
  }

  control.addEventListener('change', render);
  render();
  figure.querySelector('[data-output-controls]').hidden = false;
}

function initImageReference(figure) {
  const controls = figure.querySelector('[data-image-controls]');
  const address = figure.querySelector('[data-image-address]');
  const published = figure.querySelector('[data-image-published]');
  const reference = figure.querySelector('[data-image-ref]');
  const result = figure.querySelector('[data-image-result]');
  const arrows = figure.querySelectorAll('[data-image-arrow]');
  const images = figure.querySelectorAll('[data-image-target]');

  function render() {
    const tag = address.value === 'tag';
    const tagTarget = published.checked ? 'B' : 'A';
    const selected = tag ? tagTarget : 'A';
    reference.textContent = tag ? 'gentoo/stage3:latest' : 'gentoo/stage3@sha256:aaa...';
    arrows.forEach((arrow) => { arrow.hidden = arrow.dataset.imageArrow !== selected; });
    images.forEach((image) => { image.classList.toggle('artifact', image.dataset.imageTarget === selected); });
    const tagState = published.checked ? 'Издатель перевёл тег latest на B.' : 'Тег latest пока указывает на A.';
    const selection = tag ? `Ссылка по тегу выбирает образ ${selected}.` : 'Закреплённый дайджест выбирает образ A.';
    result.textContent = `${tagState} ${selection}`;
  }

  controls.addEventListener('change', render);
  render();
  controls.hidden = false;
}

function initElapsed(figure) {
  const control = figure.querySelector('[data-elapsed-control]');
  const slider = control.querySelector('input');
  const startedAt = Number(figure.querySelector('.elapsed-axis strong').textContent);
  const current = figure.querySelector('[data-current-time]');
  const seconds = figure.querySelector('[data-elapsed-seconds]');
  const equation = figure.querySelector('[data-elapsed-equation]');
  const duration = figure.querySelector('[data-elapsed-duration]');

  function render() {
    const elapsed = slider.valueAsNumber;
    const now = startedAt + elapsed;
    const minutes = Math.floor(elapsed / 60);
    const formatted = `${minutes} мин ${elapsed % 60} с`;
    current.textContent = now;
    seconds.textContent = elapsed;
    equation.textContent = `${now} − ${startedAt} = ${elapsed} с`;
    duration.textContent = formatted;
    slider.setAttribute('aria-valuetext', formatted);
  }

  slider.addEventListener('input', render);
  render();
  control.hidden = false;
}

function initSelectLab(figure, render) {
  const controls = figure.querySelector('[data-lab-controls]');
  const select = controls.querySelector('select');
  const update = () => render(select.value);
  select.addEventListener('change', update);
  update();
  controls.hidden = false;
}

function initToggleLab(figure, render) {
  const controls = figure.querySelector('[data-lab-controls]');
  controls.addEventListener('input', render);
  render();
  controls.hidden = false;
}

function initCredentials(figure) {
  const lane = figure.querySelector('[data-auth-lane]');
  const state = figure.querySelector('[data-auth-state]');
  const result = figure.querySelector('[data-auth-result]');
  initSelectLab(figure, (value) => {
    const persist = value === 'true';
    lane.dataset.path = persist ? 'open' : 'closed';
    state.textContent = persist ? 'Настройка Git доступна' : 'Настройка не передана';
    result.textContent = persist
      ? 'Следующая команда Git может использовать настройку checkout с прежними правами токена.'
      : 'Checkout оставляет файлы. Следующая команда Git не получает аутентификацию из настройки checkout.';
  });
}

function setLessonStatus(label, status) {
  label.dataset.status = status;
  label.textContent = status;
}

function initDiagnosticFlow(figure) {
  const preparation = figure.querySelector('[data-preparation]');
  const logCondition = figure.querySelector('[data-log-condition]');
  const labels = figure.querySelectorAll('.lesson-status');
  const result = figure.querySelector('[data-lab-result]');

  initToggleLab(figure, () => {
    const passed = preparation.value === 'pass';
    const always = logCondition.value === 'always';
    const statuses = [
      passed ? 'PASS' : 'FAIL',
      passed ? 'PASS' : always ? 'RUN' : 'SKIP',
      passed ? 'RUN' : 'SKIP',
      passed ? 'RUN' : 'SKIP',
      'RUN'
    ];
    labels.forEach((label, index) => {
      const status = statuses[index];
      setLessonStatus(label, status);
      label.parentElement.dataset.gateState = status;
    });
    result.textContent = passed
      ? 'Кандидат и сохранение логов прошли. Если загрузка handoff завершится успешно, попытка загрузки crates bundle тоже допущена. Отчёт допущен в любом случае.'
      : always
        ? 'Обе загрузки для публикации пропущены. Сохранение логов и отчёт допущены благодаря always().'
        : 'Обе загрузки для публикации и сохранение логов пропущены. Отчёт допущен благодаря собственному always().';
  });
}

function initUploadGates(figure) {
  const priorSuccess = figure.querySelector('[data-prior-success]');
  const handoff = figure.querySelector('[data-handoff-true]');
  const validationOnly = figure.querySelector('[data-validation-only]');
  const checks = figure.querySelectorAll('[data-upload-check]');
  const readiness = figure.querySelector('[data-upload-expr="ready"]');
  const guard = figure.querySelector('[data-upload-expr="guard"]');
  const result = figure.querySelector('[data-lab-result]');

  initToggleLab(figure, () => {
    const conditions = [priorSuccess.checked, handoff.checked, !validationOnly.checked];
    const firstFailure = conditions.indexOf(false);
    checks.forEach((label, index) => {
      label.dataset.status = conditions[index] ? 'PASS' : 'FAIL';
      label.textContent = String(conditions[index]);
      label.parentElement.dataset.gateState = firstFailure !== -1 && index > firstFailure
        ? 'SKIP' : label.dataset.status;
    });
    readiness.dataset.eval = conditions[0] ? 'read' : 'skip';
    guard.dataset.eval = conditions[0] && conditions[1] ? 'read' : 'skip';
    const failedConditions = ['неявный success() ложен', 'handoff ещё не готов', 'включён режим только проверки'];
    result.textContent = firstFailure === -1
      ? 'Все три условия истинны. Шаг допущен к попытке загрузки.'
      : `Загрузка пропущена. Первое закрытое условие — ${failedConditions[firstFailure]}.`;
  });
}

function initMissingArtifact(figure) {
  const scenarios = {
    logs: ['Диагностические логи', 'ignore', 'PASS', 'Шаг завершился без ошибки и без артефакта. Обычные шаги могут продолжиться при выполнении их условий.'],
    handoff: ['Release handoff', 'error', 'FAIL', 'Шаг завершился ошибкой. Загрузка crates bundle и зависимые jobs пропускаются. Отчёт о времени остаётся допущен.'],
    distribution: ['Crates distribution', 'error', 'FAIL', 'Шаг завершился ошибкой. Уже загруженный handoff может остаться, но зависимые jobs пропускаются. Отчёт о времени остаётся допущен.']
  };
  const name = figure.querySelector('[data-missing-name]');
  const policy = figure.querySelector('[data-missing-policy]');
  const label = figure.querySelector('.lesson-status');
  const result = figure.querySelector('[data-lab-result]');

  initSelectLab(figure, (value) => {
    const [artifact, missingPolicy, status, message] = scenarios[value];
    name.textContent = artifact;
    policy.textContent = `if-no-files-found: ${missingPolicy}`;
    setLessonStatus(label, status);
    label.parentElement.dataset.gateState = status;
    result.textContent = message;
  });
}

function initSummaryLab(figure) {
  const timestamp = figure.querySelector('[data-valid-timestamp]');
  const handoff = figure.querySelector('[data-handoff-true]');
  const seconds = figure.querySelector('[data-example-seconds]');
  const [formatCheck, handoffCheck] = figure.querySelectorAll('[data-summary-check]');
  const result = figure.querySelector('[data-summary-result]');

  initToggleLab(figure, () => {
    const valid = timestamp.checked;
    const includeTotal = !handoff.checked;
    formatCheck.dataset.status = valid ? 'PASS' : 'FAIL';
    formatCheck.textContent = String(valid);
    formatCheck.parentElement.dataset.gateState = formatCheck.dataset.status;
    handoffCheck.dataset.status = valid ? (includeTotal ? 'PASS' : 'FAIL') : 'SKIP';
    handoffCheck.textContent = valid ? String(includeTotal) : 'SKIP';
    handoffCheck.parentElement.dataset.gateState = handoffCheck.dataset.status;
    handoffCheck.previousElementSibling.dataset.eval = valid ? 'read' : 'skip';

    if (!valid || !seconds.validity.valid) {
      result.textContent = valid ? 'Укажите целое число секунд от 0.' : 'Блок не дописывает строки.';
      return;
    }
    if (seconds.value === '') {
      result.textContent = 'Укажите пример времени.';
      return;
    }
    const elapsed = seconds.valueAsNumber;
    const checkLine = document.createElement('code');
    checkLine.textContent = `Check processing: ${elapsed}s`;
    result.replaceChildren(checkLine);
    if (includeTotal) {
      const totalLine = document.createElement('code');
      totalLine.textContent = `Total workflow processing: ${elapsed}s`;
      result.append(totalLine);
    }
  });
}

function initPolicyLab(figure) {
  const notes = {
    name: 'Имя должно совпадать с zed-overlay.',
    layout: 'Для этого оверлея требуется thin-manifests = true.',
    manifest: 'Пакету нужен Manifest.',
    patch: 'Добавление X11 нарушает правило о Wayland-патче.',
    cache: 'Сгенерированный кеш должен оставаться за пределами Git.'
  };
  const rules = [...figure.querySelectorAll('[data-rule]')].map((row) => {
    const state = row.querySelector('[data-rule-state]');
    return { row, state, normal: state.textContent, badge: row.querySelector('[data-status]') };
  });
  const result = figure.querySelector('[data-policy-result]');
  const exit = figure.querySelector('[data-policy-exit]');
  const note = figure.querySelector('[data-policy-note]');

  initSelectLab(figure, (value) => {
    rules.forEach(({ row, state, normal, badge }) => {
      const failed = row.dataset.rule === value;
      row.classList.toggle('rule-failed', failed);
      setLessonStatus(badge, failed ? 'FAIL' : 'PASS');
      state.textContent = failed ? row.dataset.failure : normal;
    });
    result.textContent = value ? 'overlay policy: FAILED' : 'overlay policy: OK';
    exit.textContent = value ? 'Exit code: 1' : 'Exit code: 0';
    note.textContent = value
      ? `${notes[value]} Код 1 останавливает обычную цепочку шагов.`
      : 'Код 0 позволяет перейти к unit tests.';
  });
}

function initGates(figure) {
  const scenarios = {
    pass: ['PASS', 'PASS', 'PASS', 'START'],
    policy: ['PASS', 'FAIL', 'SKIP', 'SKIP'],
    tests: ['PASS', 'PASS', 'FAIL', 'SKIP']
  };
  const outcomes = {
    pass: 'Подготовка может начаться. START обозначает вход в следующий шаг.',
    policy: 'Overlay policy завершилась ошибкой. Unit tests и подготовка пропущены.',
    tests: 'Unit tests завершились с ошибкой. Подготовка пропущена.'
  };
  const labels = figure.querySelectorAll('.lesson-status');
  const outcome = figure.querySelector('[data-gate-result]');
  initSelectLab(figure, (value) => {
    labels.forEach((label, index) => {
      const status = scenarios[value][index];
      setLessonStatus(label, status);
      label.parentElement.dataset.gateState = status;
    });
    outcome.textContent = outcomes[value];
  });
}

function initExpression(figure) {
  const controls = figure.querySelector('[data-lab-controls]');
  const event = controls.querySelector('[data-expression-event]');
  const input = controls.querySelector('[data-expression-input]');
  const manualControl = input.closest('label');
  const scheduleNote = controls.querySelector('[data-schedule-note]');
  const eventValue = figure.querySelector('[data-event-value]');
  const inputValue = figure.querySelector('[data-input-value]');
  const result = figure.querySelector('[data-expression-result]');
  const mode = figure.querySelector('[data-expression-mode]');
  const note = figure.querySelector('[data-expression-note]');
  const operand = (key) => figure.querySelector(`[data-part="${key}"]`);
  const inputNode = figure.querySelector('.trace-input');
  const trueNode = figure.querySelector('.trace-true');
  const falseNode = figure.querySelector('.trace-false');
  const notes = {
    schedule: 'Сравнение ложно. Ветка с input пропущена, поэтому результат даёт ||.',
    fallback: 'Сравнение истинно, input ложен. Второй && пропускает строку «true», и || выбирает «false».',
    enabled: 'Обе проверки истинны. Второй && возвращает строку «true», поэтому || пропускает запасное значение.'
  };

  function render() {
    const manual = event.value === 'workflow_dispatch';
    const enabled = manual && input.checked;
    const route = manual ? (enabled ? 'enabled' : 'fallback') : 'schedule';

    input.disabled = !manual;
    manualControl.hidden = !manual;
    scheduleNote.hidden = manual;
    figure.dataset.route = route;
    eventValue.textContent = `${event.value} → ${manual}`;
    inputValue.textContent = manual ? String(input.checked) : 'Не вычисляется';
    operand('input').dataset.eval = inputNode.dataset.eval = manual ? 'read' : 'skip';
    operand('true').dataset.eval = trueNode.dataset.eval = enabled ? 'result' : 'skip';
    operand('false').dataset.eval = falseNode.dataset.eval = enabled ? 'skip' : 'result';
    result.textContent = `INDEPENDENT_VALIDATION="${enabled}"`;
    mode.textContent = enabled ? 'Validation-only mode' : 'Production mode';
    note.textContent = notes[route];
  }

  controls.addEventListener('change', render);
  render();
  controls.hidden = false;
}

export function traceReleaseGates(figure, count, failure) {
  const states = Array.from({length: count}, (_, index) => {
    if (failure === -1 || index < failure) return 'PASS';
    return index === failure ? 'FAIL' : 'SKIP';
  });
  renderReleaseGates(figure, states);
}

function renderReleaseGates(figure, states) {
  figure.querySelectorAll('.flow-node[data-gate-state]').forEach((node, index) => {
    const status = states[index];
    node.dataset.gateState = status;
    setLessonStatus(node.querySelector('.lesson-status'), status);
  });
}

function initHandoffTimeline(figure) {
  const timeline = figure.querySelector('.needs-timeline');
  const waiting = figure.querySelector('[data-wait]');
  const result = figure.querySelector('[data-lab-result]');
  initSelectLab(figure, (dependency) => {
    timeline.dataset.dependency = dependency;
    waiting.hidden = dependency === 'off';
    result.textContent = dependency === 'on'
      ? 'Job 2 получает допуск после Job 1, если выполнены остальные условия.'
      : 'Без зависимости дорожки могут пересекаться: Job 2 может выполняться одновременно с Job 1.';
  });
}

function initHandoffAdmission(figure) {
  const check = figure.querySelector('[data-check-result]');
  const ready = figure.querySelector('[data-ready]');
  const manual = figure.querySelector('[data-manual]');
  const result = figure.querySelector('[data-lab-result]');
  initToggleLab(figure, () => {
    const conditions = [check.value === 'success', ready.checked, !manual.checked];
    const failure = conditions.indexOf(false);
    traceReleaseGates(figure, conditions.length, failure);
    const reasons = [
      `Job 1 завершился со статусом ${check.value}.`,
      'Handoff не готов.',
      'Включён ручной режим независимой проверки.',
    ];
    result.textContent = failure === -1 ? 'RUN · Job 2 допущен к запуску.' : 'SKIP · ' + reasons[failure];
  });
}

function initHandoffRevision(figure) {
  const advances = figure.querySelector('[data-main-advance]');
  const ref = figure.querySelector('[data-checkout-ref]');
  const graph = figure.querySelector('.commit-graph');
  const commitC = figure.querySelector('[data-commit-c]');
  const markerB = figure.querySelector('[data-main-b]');
  const target = figure.querySelector('[data-job2-target]');
  const result = figure.querySelector('[data-lab-result]');
  initToggleLab(figure, () => {
    const branch = advances.checked ? 'C' : 'B';
    const selected = ref.value === 'sha' ? 'B' : branch;
    graph.dataset.job2At = selected;
    commitC.hidden = !advances.checked;
    markerB.hidden = advances.checked;
    target.textContent = '→ ' + selected;
    result.textContent = selected === 'B'
      ? 'Оба runner используют B.'
      : 'Ревизии разошлись: Job 1 использует B, Job 2 выбирает C.';
  });
}

const handoffBashExamples = {
  e: {
    code: 'false\necho "Продолжаем"',
    on: 'Код 1 · Bash прерывает скрипт после false, echo пропущен.',
    off: 'Код 0 · Выполняется echo и печатает «Продолжаем».',
  },
  u: {
    code: 'echo "$UNDEFINED_VARIABLE"',
    on: 'Ненулевой код · Bash сообщает о незаданной переменной. echo не выполняется.',
    off: 'Код 0 · echo печатает пустую строку.',
  },
  pipefail: {
    code: 'false | cat',
    on: 'Код 1 · Его возвращает false, хотя cat завершился со статусом 0.',
    off: 'Код 0 · Статус конвейера равен статусу cat.',
  },
};

function initHandoffBash(figure) {
  const option = figure.querySelector('[data-bash-option]');
  const enabled = figure.querySelector('[data-bash-enabled]');
  const code = figure.querySelector('[data-bash-code]');
  const result = figure.querySelector('[data-lab-result]');
  initToggleLab(figure, () => {
    const example = handoffBashExamples[option.value];
    code.textContent = example.code;
    result.textContent = enabled.checked ? example.on : example.off;
  });
}

function initHandoffJson(figure) {
  const rows = [...figure.querySelectorAll('[data-json-field]')];
  const result = figure.querySelector('[data-lab-result]');
  initSelectLab(figure, (field) => {
    rows.forEach((row) => row.classList.toggle('is-selected', row.dataset.jsonField === field));
    result.textContent = rows.find((row) => row.dataset.jsonField === field).dataset.purpose;
  });
}

const handoffLayoutErrors = {
  extra: 'Handoff artifact contains unexpected file: unexpected.txt',
  symlink: 'Handoff artifact contains symlink: app-editors/zed/Manifest',
  missing: 'Handoff artifact is missing an expected file',
  commit: 'release.json base_commit does not match the expected commit',
};

function initHandoffLayout(figure) {
  const extra = figure.querySelector('[data-handoff-extra]');
  const symlink = figure.querySelector('[data-handoff-symlink]');
  const patch = figure.querySelector('[data-handoff-patch]');
  const base = figure.querySelector('[data-handoff-base]');
  const result = figure.querySelector('[data-lab-result]');
  initSelectLab(figure, (scenario) => {
    extra.hidden = scenario !== 'extra';
    symlink.hidden = scenario !== 'symlink';
    patch.hidden = scenario === 'missing';
    base.classList.toggle('release-change', scenario === 'commit');
    base.textContent = scenario === 'commit' ? base.dataset.mismatch : base.dataset.expected;
    result.dataset.gateState = scenario === 'valid' ? 'PASS' : 'FAIL';
    result.textContent = scenario === 'valid'
      ? 'PASS · код 0. Структура и базовый коммит совпадают.'
      : 'FAIL · код 1. Release handoff error: ' + handoffLayoutErrors[scenario];
  });
}

function initHandoffBundle(figure) {
  const rows = [...figure.querySelectorAll('[data-bundle-lines]')];
  const source = document.querySelectorAll('#bundle-order [data-line]');
  const result = figure.querySelector('[data-lab-result]');
  const status = figure.querySelector('[data-bundle-status]');
  const message = figure.querySelector('[data-bundle-message]');
  const reason = figure.querySelector('[data-bundle-reason]');
  const jump = figure.querySelector('[data-bundle-jump]');
  initSelectLab(figure, (scenario) => {
    const failure = Number(scenario);
    traceReleaseGates(figure, rows.length, failure);
    const failed = rows[failure];
    const [start, end = start] = failed?.dataset.bundleLines.split('–').map(Number) ?? [];
    source.forEach((line) => {
      const number = Number(line.dataset.line);
      line.classList.toggle('release-source-focus', number >= start && number <= end);
    });
    result.dataset.gateState = failed ? 'FAIL' : 'PASS';
    status.textContent = failed ? 'FAIL · код 1' : 'PASS · код 0';
    message.textContent = failed ? 'Distribution validation failed: ' + failed.dataset.error : 'Distribution bundle: OK';
    reason.textContent = failed ? failed.dataset.reason : 'Все десять проверок пройдены.';
    jump.hidden = !failed;
    if (failed) {
      jump.href = '#' + failed.id;
      jump.textContent = 'К проверке ' + (failure + 1);
    }
  });
}

function initHandoffManifest(figure) {
  const original = figure.querySelector('[data-manifest-original]');
  const candidate = figure.querySelector('[data-manifest-copy]');
  const size = figure.querySelector('[data-manifest-size]');
  const absent = figure.querySelector('[data-manifest-absent]');
  const added = figure.querySelector('[data-manifest-added]');
  const result = figure.querySelector('[data-lab-result]');
  initSelectLab(figure, (scenario) => {
    candidate.hidden = scenario === 'remove';
    absent.hidden = scenario !== 'remove';
    added.hidden = scenario !== 'add';
    original.classList.toggle('release-change', scenario !== 'add');
    candidate.classList.toggle('release-change', scenario === 'edit');
    size.textContent = scenario === 'edit' ? '121' : '120';
    result.textContent = scenario === 'add'
      ? 'PASS · исходные строки сохранены. Появилась новая запись.'
      : 'FAIL · Existing Manifest distfile changed: zed-1.27.0.tar.gz';
  });
}

function initHandoffFinal(figure) {
  const first = figure.querySelector('[data-first-ok]');
  const second = figure.querySelector('[data-second-ok]');
  const result = figure.querySelector('[data-lab-result]');
  initToggleLab(figure, () => {
    const ok = first.checked && second.checked;
    second.disabled = !first.checked;
    renderReleaseGates(figure, [
      first.checked ? 'PASS' : 'FAIL',
      first.checked ? (second.checked ? 'PASS' : 'FAIL') : 'SKIP',
      ok ? 'ВЫПОЛНЕН' : 'SKIP',
      ok ? 'SUCCESS' : 'FAILURE',
      ok ? 'PASS' : 'BLOCKED',
    ]);
    result.textContent = ok
      ? 'Job 2: success. Условие успеха в Job 3 выполнено.'
      : 'Job 2: failure. Job 3 не получает допуск.';
  });
}


function initPublishAdmission(figure) {
  const [job1, job2] = figure.querySelectorAll('[data-dependency]');
  const ready = figure.querySelector('[data-ready]');
  const validation = figure.querySelector('[data-validation-only]');
  const ref = figure.querySelector('[data-ref]');
  const result = figure.querySelector('[data-lab-result]');
  const lines = document.querySelectorAll('#publish-admission-source [data-line]');
  initToggleLab(figure, () => {
    const dependencies = job1.value === 'success' && job2.value === 'success';
    const conditions = [dependencies, ready.checked, !validation.checked, job2.value === 'success', ref.value === 'main'];
    const failure = conditions.indexOf(false);
    traceReleaseGates(figure, conditions.length, failure);
    const reasons = [
      `неявная success() отклонила зависимости (Job 1: ${job1.value}, Job 2: ${job2.value}).`,
      "handoff_ready не равен 'true'.",
      'ручной запуск в режиме validation-only.',
      'Job 2 не завершился успешно.',
      'ref запуска отличается от refs/heads/main.',
    ];
    const job2Reached = job2.value !== 'skipped';
    const hypothesis = (job2Reached && (job1.value !== 'success' || !ready.checked || validation.checked))
      || (!job2Reached && job1.value === 'success' && ready.checked && !validation.checked)
      || (validation.checked && ready.checked);
    result.textContent = (failure === -1
      ? 'RUN · Job 3 допущен к запуску.'
      : `SKIP · ${reasons[failure]} Job с правами на запись не запущен.`)
      + (hypothesis ? ' Гипотетическое сочетание результатов и входов.' : '');
    lines.forEach((line) => {
      const index = [153, 155, 156, 157, 158].indexOf(Number(line.dataset.line));
      if (index >= 0) {
        line.dataset.publicationEval = failure === -1 || index < failure ? 'PASS' : index === failure ? 'FAIL' : 'SKIP';
      }
    });
  });
}

function initPublishDrift(figure) {
  const advances = figure.querySelector('[data-main-advance]');
  const result = figure.querySelector('[data-lab-result]');
  const graph = figure.querySelector('.commit-graph');
  initToggleLab(figure, () => {
    const head = advances.checked ? 'C' : 'B';
    graph.dataset.publishAt = head;
    figure.querySelector('[data-main-b]').hidden = advances.checked;
    figure.querySelector('[data-main-c]').hidden = !advances.checked;
    figure.querySelectorAll('[data-head]').forEach((node) => { node.textContent = head; });
    result.dataset.gateState = advances.checked ? 'FAIL' : 'PASS';
    result.textContent = advances.checked
      ? 'FAIL · checkout C отличается от базы B. Применение handoff завершается ошибкой. Публикация пропущена.'
      : 'PASS · база совпала. Job 3 продолжает применять handoff.';
  });
}

const applyFailures = [
  '', '',
  'ERROR: fresh main checkout is not clean',
  'Release handoff error: release.json base_commit does not match the expected commit',
  'Release handoff error: Candidate ebuild already exists: /workspace/app-editors/zed/zed-1.28.1.ebuild',
  'Release handoff error: Existing candidate patch differs from handoff: /workspace/app-editors/zed/files/zed-1.28.1-wayland-only.patch',
];

function initPublishApply(figure) {
  const oldPatch = figure.querySelector('[data-old-patch]');
  const result = figure.querySelector('[data-lab-result]');
  initSelectLab(figure, (value) => {
    const example = Number(value);
    const error = applyFailures[example];
    const reuse = example === 1;
    const effects = [
      ['ebuild', 'создан'],
      ['patch', reuse ? 'переиспользован, байты совпадают' : 'создан'],
      ['manifest', 'заменён после записи package files'],
    ];
    figure.querySelector('[data-old-ebuild]').hidden = example !== 4;
    figure.querySelector('[data-checkout-manifest]').textContent = example === 2 ? 'локальная правка' : 'исходный';
    oldPatch.hidden = !reuse && example !== 5;
    oldPatch.querySelector('span').textContent = reuse ? 'байты совпадают' : 'байты отличаются';
    traceReleaseGates(figure, 5, error ? example - 2 : -1);
    effects.forEach(([file, operation]) => {
      const label = figure.querySelector(`[data-${file}-effect]`);
      label.textContent = error ? 'записи не было' : operation;
      label.closest('li').classList.toggle('is-selected', !error && !(file === 'patch' && reuse));
    });
    figure.querySelector('[data-apply-outputs]').hidden = Boolean(error);
    figure.querySelector('[data-patch-created]').textContent = String(!reuse);
    result.dataset.gateState = error ? 'FAIL' : 'PASS';
    result.textContent = error
      ? `FAIL · ${error}. Выходов шага нет.`
      : 'PASS · handoff применён. Выходы доступны следующим шагам.';
  });
}

function initPublishDecision(figure) {
  const mode = figure.querySelector('[data-mode]');
  const remote = figure.querySelector('[data-remote]');
  const result = figure.querySelector('[data-lab-result]');
  initToggleLab(figure, () => {
    const reuse = mode.value === 'reuse';
    const state = remote.selectedIndex;
    const missing = reuse ? 'Previously published release disappeared before publication' : '';
    const errors = [
      missing,
      '',
      'Remote asset SHA256 mismatch: zed-1.28.1-overlay-crates.tar.xz',
      'Conflicting draft release requires manual recovery',
      missing || 'Conflicting standalone tag or failed tag lookup',
      'Multiple releases use the requested tag',
      'Cannot list releases including drafts',
    ];
    const error = errors[state];
    const failure = error ? [1, -1, 2, 1, 1, 1, 0][state] : -1;
    traceReleaseGates(figure, 4, failure);
    figure.querySelectorAll('.flow-node strong')[2].textContent = state === 1 || state === 2
      ? 'Проверить существующий release' : 'Создать draft и опубликовать';
    result.dataset.gateState = error ? 'FAIL' : 'PASS';
    result.textContent = error ? `FAIL · Crates release error: ${error}` : state === 1
      ? 'PASS · проверен и переиспользован существующий release. publication_result=reuse.'
      : 'PASS · draft создан, проверен и опубликован. publication_result=generation.';
  });
}

const raceFailures = [
  null,
  [2, 'Asset upload failed: zed-1.28.1-overlay-crates.json HTTP 404', 'Draft может содержать только первый asset — архив.'],
  [3, 'Remote asset SHA256 mismatch: zed-1.28.1-overlay-crates.tar.xz', 'Может остаться draft с двумя загруженными assets.'],
  [4, 'Release state changed during draft upload', 'Состояние изменил другой участник. Может остаться draft с assets.'],
  [4, 'Tag appeared during draft upload', 'Могут остаться draft с assets и конфликтующий тег.'],
];

const publicFailures = [
  null,
  [0, 'Asset download failed: HTTP 404', 'Публичный URL архива вернул 404.'],
  [3, 'Asset download failed: HTTP 404', 'Публичный URL metadata вернул 404 после проверки архива.'],
  [1, 'Public asset does not match validated bundle: zed-1.28.1-overlay-crates.tar.xz', 'Размер или SHA256 публичного архива отличается.'],
  [2, '', 'Гипотеза: скачанный архив совпал с локальным, но проверка записи Manifest вернула ошибку.'],
];

function initPublishRace(figure) {
  const race = figure.querySelector('[data-race]');
  const download = figure.querySelector('[data-public]');
  const [release, publicChecks] = figure.querySelectorAll('.gate-flow');
  const result = figure.querySelector('[data-lab-result]');
  const remote = figure.querySelector('[data-remote-outcome]');
  initToggleLab(figure, (event) => {
    const scenario = race.selectedIndex;
    const failure = raceFailures[scenario];
    if (event?.target === race) download.selectedIndex = scenario === 5 ? 1 : 0;
    download.disabled = Boolean(failure) || scenario === 5;
    const publicFailure = publicFailures[download.selectedIndex];
    traceReleaseGates(release, 6, failure ? failure[0] : -1);
    if (failure) renderReleaseGates(publicChecks, Array(6).fill('SKIP'));
    else traceReleaseGates(publicChecks, 6, publicFailure ? publicFailure[0] : -1);
    const blocked = failure || publicFailure;
    result.dataset.gateState = blocked ? 'FAIL' : 'PASS';
    if (blocked) {
      const error = blocked[1] ? `Crates release error: ${blocked[1]}. ` : '';
      const context = publicFailure && !failure ? publicFailure[2] + ' ' : '';
      result.textContent = `FAIL · ${context}${error}Выход publication_result недоступен. Шаг PR пропущен.`;
    } else {
      result.textContent = 'PASS · release опубликован, публичные файлы проверены. publication_result=generation. Шаг PR допущен.';
    }
    remote.textContent = failure ? failure[2] : publicFailure
      ? 'Release уже переведён в опубликованное состояние. Публичная проверка не завершилась успешно.'
      : 'Публичный release с двумя проверенными assets.';
  });
}

const stagedFailures = [
  null, null,
  [1, 'ERROR: staged paths do not match the release handoff allowlist', '+ metadata/layout.conf · лишний staged-путь'],
  [1, 'ERROR: staged paths do not match the release handoff allowlist', '− app-editors/zed/Manifest · нет staged-изменения'],
  [2, 'ERROR: unstaged tracked changes remain after handoff apply', ' M metadata/layout.conf · осталось в рабочем дереве'],
  [3, 'ERROR: unexpected untracked files remain after handoff apply', '?? notes.txt · осталось в рабочем дереве'],
  [0, 'git diff --cached --check вернул ненулевой код', 'zed-1.28.1.ebuild · +SLOT="0"␠ (␠ обозначает пробел в конце строки)'],
];

function initPublishStaged(figure) {
  const detail = figure.querySelector('[data-staged-detail]');
  const result = figure.querySelector('[data-lab-result]');
  initSelectLab(figure, (value) => {
    const example = Number(value);
    const failure = stagedFailures[example];
    const expected = [true, true, example !== 1, false];
    const actual = [example !== 3, true, example !== 1, example === 2];
    figure.querySelectorAll('[data-expected]').forEach((file, i) => {
      file.hidden = !expected[i];
      file.classList.toggle('release-change', expected[i] && !actual[i]);
    });
    figure.querySelectorAll('[data-actual]').forEach((file, i) => {
      file.hidden = !actual[i];
      file.classList.toggle('release-change', actual[i] && (!expected[i] || (example === 6 && i === 1)));
    });
    detail.hidden = !failure;
    detail.textContent = failure ? failure[2] : '';
    traceReleaseGates(figure, 5, failure ? failure[0] : -1);
    result.dataset.gateState = failure ? 'FAIL' : 'PASS';
    result.textContent = failure
      ? `FAIL · ${failure[1]}. До поиска PR выполнение не дошло.`
      : 'PASS · staged diff разрешён. Можно искать существующий PR.';
  });
}

function initPublishBranch(figure) {
  const routes = ['existing', 'absent', 'exists', 'unknown'];
  const outcomes = [
    'PASS · URL открытого PR записан. Создание ветки и PR пропущено.',
    'HTTP 404 · можно перейти к созданию ветки.',
    'FAIL · ERROR: remote automation branch exists without an open PR: automation/zed-v1.28.1',
    'FAIL · ERROR: could not determine remote branch state (HTTP 503)',
  ];
  const result = figure.querySelector('[data-lab-result]');
  initSelectLab(figure, (value) => {
    const example = Number(value);
    figure.querySelectorAll('[data-branch-route]').forEach((node) => {
      const route = node.dataset.branchRoute;
      const active = route === routes[example] || (example > 0 && route === 'lookup');
      node.classList.toggle('is-selected', active);
    });
    result.dataset.gateState = example >= 2 ? 'FAIL' : 'PASS';
    result.textContent = outcomes[example];
  });
}

const publicationMap = [
  ['current', false, 'Job 3 пропущен.', 'Для нового кандидата не созданы.', 'Без изменений для этого запуска.', 'Новая ветка не создана.', 'Новый PR не требуется.'],
  ['new', true, 'Job 3 пропущен.', 'Публикационные наборы не созданы.', 'Без изменений для этого запуска.', 'Новая ветка не создана.', 'Шаг PR пропущен.'],
  ['new', false, 'Кандидат применён и закоммичен в automation-ветку.', 'Оба job скачали два набора.', 'Новый release опубликован. Оба публичных файла проверены.', 'Создана automation/zed-v1.28.1.', 'Открыт новый Draft PR в main.'],
  ['reuse', false, 'Кандидат применён и закоммичен в automation-ветку.', 'Оба job скачали два набора.', 'Существующий release переиспользован, публичная проверка прошла.', 'Создана automation/zed-v1.28.1.', 'Открыт новый Draft PR в main.'],
  ['handoff-error', false, 'Job 3 пропущен.', 'Загружены Job 1, скачаны Job 2.', 'Новой публикации не было.', 'Новая ветка не создана.', 'Шаг PR пропущен.'],
  ['main-drift', false, 'Checkout получен, handoff не применён.', 'Оба job скачали два набора.', 'Новой публикации не было.', 'Новая ветка не создана.', 'Шаг PR пропущен.'],
  ['release-conflict', false, 'Кандидат применён, commit не создан.', 'Оба job скачали два набора.', 'На GitHub остаётся конфликтующий draft.', 'Новая ветка не создана.', 'Шаг PR пропущен.'],
  ['public-error', false, 'Кандидат применён, commit не создан.', 'Оба job скачали два набора.', 'Release опубликован, публичная проверка завершилась ошибкой.', 'Новая ветка не создана.', 'Шаг PR пропущен.'],
  ['existing', false, 'Кандидат применён и индекс проверен. Нового commit нет.', 'Оба job скачали два набора.', 'Существующий release переиспользован, публичная проверка прошла.', 'Существующая ветка PR. Нового push нет.', 'Найден открытый PR, записан его URL.'],
  ['pr-error', false, 'Кандидат применён. Проверка staged diff завершилась ошибкой.', 'Оба job скачали два набора.', 'Новый release опубликован. Оба публичных файла проверены.', 'Новая ветка не создана.', 'Новый PR не открыт.'],
];

function initPublishMap(figure) {
  const states = figure.querySelectorAll('[data-map-state]');
  const reasons = figure.querySelectorAll('[data-map-reason]');
  const result = figure.querySelector('[data-lab-result]');
  initSelectLab(figure, (value) => {
    const [scenario, validation, ...objects] = publicationMap[Number(value)];
    const { jobs, outcome } = simulate(scenario, validation, 'main');
    renderReleaseGates(figure, jobs.map((job) => job.status));
    jobs.forEach((job, index) => { reasons[index].textContent = job.reason; });
    const manual = jobs[2].status === 'PASS'
      ? (scenario === 'existing' ? 'Действует обычный процесс ревью существующего PR.' : 'Ожидает проверки владельцем.')
      : 'В этом запуске новый PR на приёмку не передан.';
    [...objects, manual].forEach((state, index) => { states[index].textContent = state; });
    result.dataset.gateState = jobs[2].status;
    result.textContent = outcome;
  });
}

if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-theme-control]').forEach(initTheme);
  document.querySelectorAll('[data-selector]').forEach(initSelector);
  document.querySelectorAll('[data-simulator]').forEach(initSimulator);
  document.querySelectorAll('[data-quiz]').forEach(initQuiz);
  document.querySelectorAll('[data-cron]').forEach(initCron);
  document.querySelectorAll('[data-concurrency]').forEach(initConcurrency);
  document.querySelectorAll('[data-source-preview]').forEach(initSourceCopy);
  document.querySelectorAll('[data-timeout]').forEach(initTimeout);
  document.querySelectorAll('[data-output-flow]').forEach(initOutputFlow);
  document.querySelectorAll('[data-image-reference]').forEach(initImageReference);
  document.querySelectorAll('[data-elapsed]').forEach(initElapsed);
  document.querySelectorAll('[data-credentials]').forEach(initCredentials);
  document.querySelectorAll('[data-policy-lab]').forEach(initPolicyLab);
  document.querySelectorAll('[data-gates]').forEach(initGates);
  document.querySelectorAll('[data-expression]').forEach(initExpression);
  document.querySelectorAll('[data-diagnostic-flow]').forEach(initDiagnosticFlow);
  document.querySelectorAll('[data-upload-gates]').forEach(initUploadGates);
  document.querySelectorAll('[data-missing-artifact]').forEach(initMissingArtifact);
  document.querySelectorAll('[data-summary-lab]').forEach(initSummaryLab);
  document.querySelectorAll('[data-handoff-timeline]').forEach(initHandoffTimeline);
  document.querySelectorAll('[data-handoff-admission]').forEach(initHandoffAdmission);
  document.querySelectorAll('[data-handoff-revision]').forEach(initHandoffRevision);
  document.querySelectorAll('[data-handoff-bash]').forEach(initHandoffBash);
  document.querySelectorAll('[data-handoff-json]').forEach(initHandoffJson);
  document.querySelectorAll('[data-handoff-layout]').forEach(initHandoffLayout);
  document.querySelectorAll('[data-handoff-bundle]').forEach(initHandoffBundle);
  document.querySelectorAll('[data-handoff-manifest]').forEach(initHandoffManifest);
  document.querySelectorAll('[data-handoff-final]').forEach(initHandoffFinal);
  document.querySelectorAll('[data-publish-admission]').forEach(initPublishAdmission);
  document.querySelectorAll('[data-publish-drift]').forEach(initPublishDrift);
  document.querySelectorAll('[data-publish-apply]').forEach(initPublishApply);
  document.querySelectorAll('[data-publish-decision]').forEach(initPublishDecision);
  document.querySelectorAll('[data-publish-race]').forEach(initPublishRace);
  document.querySelectorAll('[data-publish-staged]').forEach(initPublishStaged);
  document.querySelectorAll('[data-publish-branch]').forEach(initPublishBranch);
  document.querySelectorAll('[data-publish-map]').forEach(initPublishMap);
}
