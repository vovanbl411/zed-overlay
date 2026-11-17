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
  const controls = source ?? document.createElement('div');
  const lines = source ? [...source.querySelectorAll('[data-line]')] : [];

  if (!source) {
    controls.className = 'selection-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', container.dataset.label);
    container.append(controls);
  }

  const buttons = panels.map((panel, index) => {
    const button = document.createElement('button');
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
    } else {
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
  }

  const content = document.createElement('div');
  content.setAttribute('aria-live', 'polite');
  content.append(...panels);
  container.append(content);
  select(0);
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

if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-theme-control]').forEach(initTheme);
  document.querySelectorAll('[data-selector]').forEach(initSelector);
  document.querySelectorAll('[data-simulator]').forEach(initSimulator);
  document.querySelectorAll('[data-quiz]').forEach(initQuiz);
  document.querySelectorAll('[data-cron]').forEach(initCron);
  document.querySelectorAll('[data-concurrency]').forEach(initConcurrency);
}
