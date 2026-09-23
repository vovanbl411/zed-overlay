# CI и модель безопасности

Этот документ описывает текущий read-only CI и настройки GitHub, которые нужно
включить вручную. В репозитории пока нет publish workflow, автоматических
веток, Pull Request automation, artifact handoff или Manifest generation.

## Read-only CI

Workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) запускается
на `push` и `pull_request`.

```yaml
permissions:
  contents: read
```

`actions/checkout` закреплён полным commit SHA, а
`persist-credentials: false` не оставляет credentials в checkout. CI выполняет:

```sh
python3 scripts/overlay_policy.py
python3 -m unittest discover -s tests -v
```

Имя required status check — `Overlay policy`. Это имя job, а не workflow; его
нельзя менять без одновременного обновления GitHub ruleset.

PR CI не должен получать write-capable token или secrets. Текущий workflow не
создаёт branches, commits или Pull Requests.

## Планируемый ruleset для `main`

Настройте вручную `Settings → Rules → Rulesets`:

```text
Ruleset: Protect main
Enforcement: Active
Target: Default branch
Bypass list: empty

Restrict deletions: ON
Block force pushes: ON

Require pull request before merging: ON
Required approvals: 0
Require conversation resolution: ON

Require status checks: ON
Required check: Overlay policy
Require branches to be up to date: ON

Require signed commits: OFF for now
Require linear history: OFF
Merge queue: OFF
```

`Required approvals: 0` допустим для персонального репозитория: merge всё ещё
проходит через Pull Request, обязательный CI и решение владельца.

## GitHub Actions и Dependabot

- Разрешены только необходимые Actions. Сторонние Actions должны быть
  закреплены полным immutable commit SHA, а не mutable tag.
- Default workflow permissions должны оставаться read-only. PR CI не получает
  repository secrets.
- Dependabot в [`.github/dependabot.yml`](../.github/dependabot.yml) обновляет
  только GitHub Actions раз в неделю. Его Pull Requests проходят обычные review
  и CI; auto-merge не используется.
- Write permissions для Actions и разрешение создавать Pull Requests сейчас не
  нужны. Их можно рассматривать только в отдельном publish automation gate.

## Secret scanning

Рекомендуется вручную включить GitHub Secret Scanning и Push Protection.
Состояние этих GitHub-level настроек нельзя подтвердить из содержимого
репозитория.
