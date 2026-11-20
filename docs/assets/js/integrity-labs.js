import {renderReleaseGates} from './handbook.js';

const sourcePaths = {
  bash: 'scripts/ci/independent-crates.sh',
  dist: 'scripts/crates_distribution.py',
  sync: 'scripts/sync_zed_git_crates.py',
  snapshot: 'scripts/check_zed_cargo_snapshot.py',
};

function highlightSources(lab, sources) {
  for (const preview of lab.querySelectorAll('[data-source-preview]')) {
    const path = preview.querySelector('.source-preview-meta code').textContent;
    const match = Object.keys(sources).find((key) => sourcePaths[key] === path);
    const lines = sources[match] ?? [];
    for (const row of preview.querySelectorAll('[data-line]')) {
      row.classList.toggle('shell-current-line', lines.includes(Number(row.dataset.line)));
    }
    if (preview.querySelector('.shell-current-line')) preview.open = true;
  }
}

export function integrityLabs() {
  const entries = document.querySelectorAll('[data-integrity-cases]');
  return Object.fromEntries(Array.from(entries, (entry) => {
    const lab = entry.closest('[data-shell-lab]');
    const cases = JSON.parse(entry.textContent);
    const panels = lab.querySelectorAll('[data-integrity-panel]');
    const gates = lab.querySelectorAll('[data-gate-state]');
    return [lab.dataset.shellLab, (_lab, {scenario}) => {
      const selection = cases[scenario.value];
      panels.forEach((panel, index) => {
        panel.textContent = selection.values[index];
        if (selection.active_panel !== undefined) {
          panel.parentElement.classList.toggle('integrity-output', index === selection.active_panel);
        }
      });
      const states = selection.states ?? Array.from(gates, (_, index) => {
        if (selection.fail === undefined || index < selection.fail) return 'PASS';
        if (selection.cleanup && index === gates.length - 1) return 'PASS';
        return index === selection.fail ? 'FAIL' : 'SKIP';
      });
      renderReleaseGates(lab, states);
      highlightSources(lab, selection.lines);
      return selection.result;
    }];
  }));
}
