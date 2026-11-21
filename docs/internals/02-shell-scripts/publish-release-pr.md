---
layout: handbook
title: Bash — контролируемая публикация релиза
description: Как скрипт проверяет окружение, Git index и рабочее дерево перед первым запросом о Draft PR.
chapter: 2
eyebrow: Глава 02 / Shell scripts
permalink: /internals/02-shell-scripts/publish-release-pr/
shell_labs: true
scroll_page_nav: true
sections:
  - { id: publish-handoff, label: "5.1. От проверенного handoff к публикации" }
  - { id: write-permissions, label: "5.2. Почему этот job имеет права записи" }
  - { id: required-environment, label: "5.3. Проверяем обязательное окружение" }
  - { id: archive-publication, label: "5.4. Проверяем версию и результат публикации crates" }
  - { id: function-entry, label: "5.5. Функции и точка входа" }
  - { id: candidate-paths, label: "5.6. Откуда берутся пути кандидата" }
  - { id: git-layers, label: "5.7. HEAD, working tree и Git index" }
  - { id: git-add, label: "5.8. Добавляем разрешённые файлы в index" }
  - { id: staged-check, label: "5.9. Проверяем staged diff на ошибки" }
  - { id: expected-paths, label: "5.10. Формируем список разрешённых путей" }
  - { id: compare-paths, label: "5.11. Сравниваем ожидаемый и фактический staged diff" }
  - { id: unstaged-tracked, label: "5.12. Проверяем unstaged tracked changes" }
  - { id: untracked-files, label: "5.13. Проверяем untracked files" }
  - { id: local-boundary, label: "5.14. Полная карта проверки release diff" }
---

{% assign revision = '38531d4e4cfe0506f0f5f6b551c60897b6bea83c' %}
{% assign workflow = '.github/workflows/zed-release-watcher.yml' %}
{% assign script = 'scripts/ci/publish-release-pr.sh' %}
{% assign handoff = 'scripts/release_handoff.py' %}
{% assign yaml = '/internals/01-release-watcher/yaml/' | relative_url %}
<script type="module" src="{{ '/assets/js/publish-labs.js' | relative_url }}"></script>
<script type="application/json" id="publish-git-fixtures">{{ site.data.publish_git | jsonify }}</script>
{% assign parent = '/internals/02-shell-scripts/validate-release-candidate/' | relative_url %}

{% capture job %}{% raw %}  # PR создаётся только после успешной проверки handoff и при запуске из main;
  # остальные события не доходят до job с правами на запись.
  publish-draft-release-pr:
    name: Publish Draft release PR
    needs: [check, validate-release-handoff]
    if: >-
      needs.check.outputs.handoff_ready == 'true' &&
      !(github.event_name == 'workflow_dispatch' && inputs.independent_validation) &&
      needs['validate-release-handoff'].result == 'success' &&
      github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      pull-requests: write
    steps:{% endraw %}{% endcapture %}

{% capture checkout %}{% raw %}      - name: Check out main
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          ref: main
          persist-credentials: false

      - name: Download release handoff
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: release-handoff
          path: ${{ runner.temp }}/release-handoff

      - name: Download crates distribution bundle
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333
        with:
          name: crates-distribution
          path: ${{ runner.temp }}/crates-distribution{% endraw %}{% endcapture %}

{% capture apply %}{% raw %}      - name: Apply validated release handoff
        id: apply-handoff
        shell: bash
        run: |
          set -euo pipefail
          checkout_status="$(git status --short)"
          if test -n "$checkout_status"; then
            echo "ERROR: fresh main checkout is not clean" >&2
            printf '%s\n' "$checkout_status" >&2
            exit 1
          fi
          base_commit="$(git rev-parse HEAD)"
          cp "$GITHUB_WORKSPACE/app-editors/zed/Manifest" "$RUNNER_TEMP/base-Manifest"
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
            --apply-handoff "$RUNNER_TEMP/release-handoff" \
            --repository-root "$GITHUB_WORKSPACE" \
            --expected-base-commit "$base_commit" \
            --github-output "$GITHUB_OUTPUT"{% endraw %}{% endcapture %}

{% capture policy %}{% raw %}      - name: Check overlay policy after handoff apply
        run: PYTHONDONTWRITEBYTECODE=1 python3 scripts/overlay_policy.py{% endraw %}{% endcapture %}

{% capture publish %}{% raw %}      - name: Publish validated crates release
        id: publish-crates
        env:
          GITHUB_TOKEN: ${{ github.token }}
          CANDIDATE_VERSION: ${{ steps.apply-handoff.outputs.candidate_version }}
          ARCHIVE_MODE: ${{ needs.check.outputs.archive_mode }}
          EXPECTED_METADATA_SHA256: ${{ needs.check.outputs.metadata_sha256 }}
          INDEPENDENT_VALIDATION: ${{ github.event_name == 'workflow_dispatch' && inputs.independent_validation && 'true' || 'false' }}
        shell: bash
        run: |
          set -euo pipefail
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_github.py publish \
            --version "$CANDIDATE_VERSION" --expected-mode "$ARCHIVE_MODE" \
            --base-commit "$GITHUB_SHA" --bundle "$RUNNER_TEMP/crates-distribution" \
            --handoff "$RUNNER_TEMP/release-handoff" \
            --base-manifest "$RUNNER_TEMP/base-Manifest" \
            --metadata-sha256 "$EXPECTED_METADATA_SHA256" | tee -a "$GITHUB_STEP_SUMMARY"{% endraw %}{% endcapture %}

{% capture invoke %}{% raw %}      - name: Publish Draft release PR
        env:
          GITHUB_TOKEN: ${{ github.token }}
          BRANCH: ${{ steps.apply-handoff.outputs.branch }}
          CANDIDATE_VERSION: ${{ steps.apply-handoff.outputs.candidate_version }}
          PATCH_CREATED: ${{ steps.apply-handoff.outputs.patch_created }}
          ARCHIVE_MODE: ${{ needs.check.outputs.archive_mode }}
          PUBLICATION_RESULT: ${{ steps.publish-crates.outputs.publication_result }}
          DISTRIBUTION_BUNDLE: ${{ runner.temp }}/crates-distribution
        run: scripts/ci/publish-release-pr.sh{% endraw %}{% endcapture %}

{% capture wf_check %}{% raw %}  check:
    name: Check stable Zed release
    runs-on: ubuntu-24.04
    timeout-minutes: 90
    permissions:
      contents: read
    outputs:
      handoff_ready: ${{ steps.prepare-and-validate.outputs.handoff_ready }}
      archive_mode: ${{ steps.prepare-and-validate.outputs.archive_mode }}
      metadata_sha256: ${{ steps.prepare-and-validate.outputs.metadata_sha256 }}
      started_at: ${{ steps.run-clock.outputs.started_at }}{% endraw %}{% endcapture %}

{% capture wf_upload %}{% raw %}      # Между jobs передаём только handoff с ограниченным списком файлов;
      # временный workspace и остальные результаты проверки остаются внутри job.
      - name: Upload release handoff
        if: steps.prepare-and-validate.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation)
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: release-handoff
          path: ${{ runner.temp }}/release-handoff
          if-no-files-found: error
          retention-days: 14

      - name: Upload crates distribution bundle
        if: steps.prepare-and-validate.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation)
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
        with:
          name: crates-distribution
          path: ${{ runner.temp }}/crates-distribution
          if-no-files-found: error
          retention-days: 14{% endraw %}{% endcapture %}

{% capture wf_validate %}{% raw %}  validate-release-handoff:
    name: Validate release handoff
    needs: check
    if: needs.check.outputs.handoff_ready == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.independent_validation)
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:{% endraw %}{% endcapture %}

{% capture wf_validate_steps %}{% raw %}      - name: Validate release handoff boundary
        env:
          EXPECTED_METADATA_SHA256: ${{ needs.check.outputs.metadata_sha256 }}
        shell: bash
        run: |
          set -euo pipefail
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/release_handoff.py \
            --validate-handoff "$RUNNER_TEMP/release-handoff" \
            --expected-base-commit "$GITHUB_SHA"
          PYTHONDONTWRITEBYTECODE=1 python3 scripts/crates_distribution.py bundle \
            --bundle "$RUNNER_TEMP/crates-distribution" \
            --handoff "$RUNNER_TEMP/release-handoff" --base-commit "$GITHUB_SHA" \
            --base-manifest "$GITHUB_WORKSPACE/app-editors/zed/Manifest" \
            --metadata-sha256 "$EXPECTED_METADATA_SHA256"
          echo "Release handoff and distribution boundaries: OK"{% endraw %}{% endcapture %}

{% capture environment %}{% raw %}#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_API_URL:?GITHUB_API_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${BRANCH:?BRANCH is required}"
: "${CANDIDATE_VERSION:?CANDIDATE_VERSION is required}"
: "${PATCH_CREATED:?PATCH_CREATED is required}"
: "${ARCHIVE_MODE:?ARCHIVE_MODE is required}"
: "${PUBLICATION_RESULT:?PUBLICATION_RESULT is required}"
: "${DISTRIBUTION_BUNDLE:?DISTRIBUTION_BUNDLE is required}"{% endraw %}{% endcapture %}

{% capture pair %}{% raw %}[[ "$CANDIDATE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
case "$ARCHIVE_MODE:$PUBLICATION_RESULT" in
  generation:generation|generation:reuse|reuse:reuse) ;;
  *) echo "ERROR: invalid archive/publication result" >&2; exit 1 ;;
esac{% endraw %}{% endcapture %}

{% capture api %}{% raw %}github_api() {
  curl --silent --show-error \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer $GITHUB_TOKEN" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}{% endraw %}{% endcapture %}

{% capture function %}{% raw %}validate_release_diff() {
  candidate_ebuild="app-editors/zed/zed-${CANDIDATE_VERSION}.ebuild"
  candidate_patch="app-editors/zed/files/zed-${CANDIDATE_VERSION}-wayland-only.patch"
  git add app-editors/zed/Manifest "$candidate_ebuild" "$candidate_patch"
  git diff --cached --check

  # Manifest и ebuild обязательны; patch входит в allowlist только если handoff
  # создал его. Любой другой staged-файл должен остановить публикацию.
  expected_paths="$RUNNER_TEMP/zed-release-expected-paths"
  {
    printf '%s\n' app-editors/zed/Manifest "$candidate_ebuild"
    if test "$PATCH_CREATED" = true; then
      printf '%s\n' "$candidate_patch"
    fi
  } | sort > "$expected_paths"
  actual_paths="$(git diff --cached --name-only | sort)"
  if ! printf '%s\n' "$actual_paths" | cmp -s "$expected_paths" -; then
    echo "ERROR: staged paths do not match the release handoff allowlist" >&2
    echo "Expected:" >&2
    cat "$expected_paths" >&2
    echo "Actual:" >&2
    printf '%s\n' "$actual_paths" >&2
    exit 1
  fi
  if test -n "$(git diff --name-only)"; then
    echo "ERROR: unstaged tracked changes remain after handoff apply" >&2
    git diff --name-only >&2
    exit 1
  fi
  if test -n "$(git ls-files --others --exclude-standard)"; then
    echo "ERROR: unexpected untracked files remain after handoff apply" >&2
    git ls-files --others --exclude-standard >&2
    exit 1
  fi
}{% endraw %}{% endcapture %}

{% capture main %}{% raw %}main() {
  validate_release_diff
  find_existing_pr{% endraw %}{% endcapture %}

{% capture entry %}{% raw %}main "$@"{% endraw %}{% endcapture %}

{% capture paths %}{% raw %}validate_release_diff() {
  candidate_ebuild="app-editors/zed/zed-${CANDIDATE_VERSION}.ebuild"
  candidate_patch="app-editors/zed/files/zed-${CANDIDATE_VERSION}-wayland-only.patch"
  git add app-editors/zed/Manifest "$candidate_ebuild" "$candidate_patch"{% endraw %}{% endcapture %}

{% capture python_apply %}{% raw %}def apply_release_handoff(
    repository_root: Path, handoff_directory: Path, *, expected_base_commit: str
) -> AppliedHandoff:
    """Apply only validated package files to a fresh base checkout."""
    metadata = validate_release_handoff(
        handoff_directory, expected_base_commit=expected_base_commit
    )
    candidate_version = metadata["candidate_version"]
    release_tag = metadata["release_tag"]
    if not isinstance(candidate_version, str) or not isinstance(release_tag, str):
        raise HandoffError("Validated handoff metadata has an invalid release identity")
    manifest_path, candidate_ebuild_path, candidate_patch_path = _artifact_paths(
        candidate_version
    )

    package_directory = repository_root / "app-editors/zed"
    files_directory = package_directory / "files"
    _require_directory(repository_root / "app-editors", "package parent directory")
    _require_directory(package_directory, "package directory")
    _require_directory(files_directory, "package files directory")
    _require_regular_file(repository_root / manifest_path, "destination Manifest")

    destination_ebuild = repository_root / candidate_ebuild_path
    destination_patch = repository_root / candidate_patch_path
    if _path_exists(destination_ebuild):
        raise HandoffError(f"Candidate ebuild already exists: {destination_ebuild}")

    artifact_manifest = handoff_directory / manifest_path
    artifact_ebuild = handoff_directory / candidate_ebuild_path
    artifact_patch = handoff_directory / candidate_patch_path
    _require_regular_file(artifact_manifest, "handoff Manifest")
    _require_regular_file(artifact_ebuild, "handoff candidate ebuild")
    _require_regular_file(artifact_patch, "handoff candidate patch")
    manifest_content = artifact_manifest.read_bytes()
    ebuild_content = artifact_ebuild.read_bytes()
    patch_content = artifact_patch.read_bytes()

    patch_created = not _path_exists(destination_patch)
    if not patch_created:
        _require_regular_file(destination_patch, "destination candidate patch")
        if destination_patch.read_bytes() != patch_content:
            raise HandoffError(
                f"Existing candidate patch differs from handoff: {destination_patch}"
            )

    # Сначала размещаем ebuild и patch, затем копируем соответствующий им Manifest;
    # так Manifest не объявляет candidate до появления обоих package files.
    _write_new_file(destination_ebuild, ebuild_content)
    if patch_created:
        _write_new_file(destination_patch, patch_content)
    (repository_root / manifest_path).write_bytes(manifest_content)
    return AppliedHandoff(
        release_tag=release_tag,
        candidate_version=candidate_version,
        branch=f"automation/zed-{release_tag}",
        patch_created=patch_created,
    ){% endraw %}{% endcapture %}

{% capture python_output %}{% raw %}def _write_github_output(path: Path, result: AppliedHandoff) -> None:
    values = {
        "release_tag": result.release_tag,
        "candidate_version": result.candidate_version,
        "branch": result.branch,
        "patch_created": str(result.patch_created).lower(),
    }
    with path.open("a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n"){% endraw %}{% endcapture %}

{% capture staging %}{% raw %}  git add app-editors/zed/Manifest "$candidate_ebuild" "$candidate_patch"{% endraw %}{% endcapture %}

{% capture whitespace %}{% raw %}  git diff --cached --check{% endraw %}{% endcapture %}

{% capture expected %}{% raw %}  # Manifest и ebuild обязательны; patch входит в allowlist только если handoff
  # создал его. Любой другой staged-файл должен остановить публикацию.
  expected_paths="$RUNNER_TEMP/zed-release-expected-paths"
  {
    printf '%s\n' app-editors/zed/Manifest "$candidate_ebuild"
    if test "$PATCH_CREATED" = true; then
      printf '%s\n' "$candidate_patch"
    fi
  } | sort > "$expected_paths"{% endraw %}{% endcapture %}

{% capture allowlist %}{% raw %}  actual_paths="$(git diff --cached --name-only | sort)"
  if ! printf '%s\n' "$actual_paths" | cmp -s "$expected_paths" -; then
    echo "ERROR: staged paths do not match the release handoff allowlist" >&2
    echo "Expected:" >&2
    cat "$expected_paths" >&2
    echo "Actual:" >&2
    printf '%s\n' "$actual_paths" >&2
    exit 1
  fi{% endraw %}{% endcapture %}

{% capture tracked %}{% raw %}  if test -n "$(git diff --name-only)"; then
    echo "ERROR: unstaged tracked changes remain after handoff apply" >&2
    git diff --name-only >&2
    exit 1
  fi{% endraw %}{% endcapture %}

{% capture untracked %}{% raw %}  if test -n "$(git ls-files --others --exclude-standard)"; then
    echo "ERROR: unexpected untracked files remain after handoff apply" >&2
    git ls-files --others --exclude-standard >&2
    exit 1
  fi{% endraw %}{% endcapture %}

{% capture startup %}{% raw %}#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GITHUB_API_URL:?GITHUB_API_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${BRANCH:?BRANCH is required}"
: "${CANDIDATE_VERSION:?CANDIDATE_VERSION is required}"
: "${PATCH_CREATED:?PATCH_CREATED is required}"
: "${ARCHIVE_MODE:?ARCHIVE_MODE is required}"
: "${PUBLICATION_RESULT:?PUBLICATION_RESULT is required}"
: "${DISTRIBUTION_BUNDLE:?DISTRIBUTION_BUNDLE is required}"
[[ "$CANDIDATE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
case "$ARCHIVE_MODE:$PUBLICATION_RESULT" in
  generation:generation|generation:reuse|reuse:reuse) ;;
  *) echo "ERROR: invalid archive/publication result" >&2; exit 1 ;;
esac{% endraw %}{% endcapture %}

{% capture next %}{% raw %}  find_existing_pr{% endraw %}{% endcapture %}

## 5.1. От проверенного handoff к публикации {#publish-handoff}

{% include source-preview.html source=job label="Допуск и права задания · строки 149–163" path=workflow revision=revision start=149 open=true comment="#" %}

Задание `publish-draft-release-pr` зависит от двух заданий. `check`
должен успешно подготовить [release handoff]({{ parent }}#construct-handoff)
и выставить `handoff_ready=true`. Затем `validate-release-handoff` должен
успешно проверить handoff и distribution bundle относительно коммита
запуска. Режим ручного запуска `independent_validation` исключён, а
`github.ref` должен совпасть с `refs/heads/main`.

Задание получает свежий checkout `main` с `persist-credentials: false`:
checkout не сохраняет свои учётные данные для последующих Git-команд.
После скачивания обоих артефактов шаг применения проверяет чистоту checkout,
берёт текущий `HEAD` и передаёт его Python как ожидаемый базовый коммит.
Если `main` успела уйти вперёд относительно handoff, сверка базы
останавливает применение. Шаг также сохраняет исходный Manifest для
проверки distribution bundle при публикации.

{% include source-preview.html source=checkout label="Checkout main и скачивание артефактов · строки 164–180" path=workflow revision=revision start=164 open=true comment="#" %}
<div id="apply-source">
{% include source-preview.html source=apply label="Применение handoff · строки 182–200" path=workflow revision=revision start=182 trailing_blank=true open=true comment="#" %}
</div>

## 5.2. Почему этот job имеет права записи {#write-permissions}

У `check` и `validate-release-handoff` токен с `contents: read`. Они
читают содержимое репозитория и обмениваются артефактами Actions, не меняя
ветки, релизы или PR репозитория. У третьего задания `contents: write` даёт
доступ к операциям с релизами и к отправке ветки, а
`pull-requests: write` нужен для открытия Draft PR.

{% include publish-workflow.html %}

После применения handoff workflow проверяет политику overlay, затем
публикует crates release или проверяет уже опубликованный. Только после
успеха этого шага запускается `publish-release-pr.sh`. Новый crates
release уже может быть опубликован к этому моменту. Сам Bash-скрипт
начинает с локальных проверок: он опирается на предыдущие проверки
артефактов и не повторяет их целиком. Наличие токена с правами записи и
локальное изменение Git index ещё не означают, что этот Bash-скрипт
что-либо изменил на GitHub.

<div id="policy-source">
{% include source-preview.html source=policy label="Проверка политики overlay · строки 201–203" path=workflow revision=revision start=201 trailing_blank=true open=true comment="#" %}
</div>
<div id="crates-source">
{% include source-preview.html source=publish label="Публикация crates · строки 204–221" path=workflow revision=revision start=204 trailing_blank=true open=true comment="#" %}
</div>
<div id="invoke-source">
{% include source-preview.html source=invoke label="Окружение и запуск Bash · строки 222–231" path=workflow revision=revision start=222 open=true comment="#" %}
</div>

Draft PR передаёт изменения на ревью. Слияние и обновление пакета для
пользователей происходят отдельно. Ручная приёмка Gentoo по-прежнему
включает полную сборку, проверку линковки через `scanelf` и `lddtree` и
проверку запуска по нативному Wayland без нежелательных связей с X11.

## 5.3. Проверяем обязательное окружение {#required-environment}

{% capture lab_previews %}
{% include source-preview.html source=environment label="Обязательное окружение · строки 1–15" path=script revision=revision start=1 open=true comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="environment" title="Порядок развёртывания переменных" options="existing|unset|empty|token|bundle|bundle_path|version|publication" panels="evaluations:Развёртывания по порядку" initial="Если все строки непустые, Bash доходит до строки 16." previews=lab_previews %}

При прямом запуске shebang `#!/usr/bin/env bash` выбирает Bash через
`PATH`. В `set -euo pipefail` параметр `-e` завершает скрипт при
необработанном ненулевом статусе с оговорками для условий и других
контекстов. `-u` требует установленных параметров при обычных
подстановках. `pipefail` возвращает статус крайней справа
неуспешной команды конвейера, либо `0`, если успешны все команды.

Встроенная команда `:` ничего не делает и при успешном вызове возвращает
`0`. Bash сперва вычисляет её аргумент: `${VARIABLE:?message}` выдаёт
ошибку, если переменная отсутствует или пуста. Двоеточие в `:?` включает
проверку пустой строки. При первой ошибке развёртывания неинтерактивный
Bash заканчивает работу до вызова `:`. Следующие строки уже не
проверяются. Значения приходят в окружении запущенного процесса.
Позднее скрипт создаёт собственные переменные Bash для путей и списков.
Присваивание само по себе не экспортирует переменную, а для ограничения
области видимости телом функции нужно отдельное объявление `local`.

| Переменная | Откуда берётся и для чего нужна |
| --- | --- |
| `GITHUB_TOKEN` | Workflow передаёт `github.token` для авторизации запросов и последующего push. |
| `GITHUB_API_URL` | Actions задаёт базовый URL REST API. |
| `GITHUB_REPOSITORY` | Actions передаёт имя репозитория в виде `владелец/репозиторий`. |
| `GITHUB_REPOSITORY_OWNER` | Actions передаёт владельца для адресации head-ветки при поиске PR. |
| `GITHUB_STEP_SUMMARY` | Actions задаёт путь к файлу, куда шаг запишет URL PR. |
| `RUNNER_TEMP` | Runner задаёт временный каталог, в том числе для списка ожидаемых путей. |
| `BRANCH` | Выход `apply-handoff.outputs.branch` задаёт имя automation-ветки. |
| `CANDIDATE_VERSION` | Выход `apply-handoff.outputs.candidate_version` задаёт версию и имена файлов кандидата. |
| `PATCH_CREATED` | Выход `apply-handoff.outputs.patch_created` сообщает, был ли создан файл патча. |
| `ARCHIVE_MODE` | `needs.check.outputs.archive_mode` сообщает режим подготовки архива. |
| `PUBLICATION_RESULT` | `publish-crates.outputs.publication_result` сообщает результат публикации или переиспользования. |
| `DISTRIBUTION_BUNDLE` | Workflow указывает каталог скачанного distribution bundle. Позднее скрипт читает оттуда метаданные для текста PR. |

Пустой `DISTRIBUTION_BUNDLE` остановит запуск. Непустая строка проходит
эту проверку даже при отсутствующем каталоге. То же ограничение относится
к остальным ссылкам на файлы и к смыслу строк. Связь между `$GITHUB_OUTPUT`
и `steps.…outputs` уже разобрана [в главе о workflow]({{ yaml }}#job-outputs).

## 5.4. Проверяем версию и результат публикации crates {#archive-publication}

{% capture lab_previews %}
{% include source-preview.html source=pair label="Версия и пара режимов · строки 16–20" path=script revision=revision start=16 open=true comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="pair" title="Какая ветка case сработает?" options="" panels="pair:Строка для case и совпавший образец" initial="При корректной версии generation:reuse доходит до локальной проверки." previews=lab_previews %}

`=~` внутри `[[ … ]]` сопоставляет строку с расширенным регулярным
выражением Bash. Якоря `^` и `$` охватывают всю строку. Три группы
`[0-9]+` требуют по одной или больше цифр, а `\.` требует буквальную
точку между ними. Например, `1.29.0` проходит, `v1.29.0`, `1.29` и
`1.29.0-rc1` дают статус `1`; верхнеуровневая команда останавливает
скрипт через `-e`, без собственного сообщения.

В `case "$ARCHIVE_MODE:$PUBLICATION_RESULT"` Bash соединяет две строки
через двоеточие. Ветка на строке 18 перечисляет три образца через `|`.
Ветка `*` на строке 19 пишет ошибку в stderr и явно завершает скрипт
со статусом `1`.

| Режим подготовки | Результат публикации | Допуск |
| --- | --- | --- |
| `generation` | `generation` | Да |
| `generation` | `reuse` | Да |
| `reuse` | `reuse` | Да |
| `reuse` | `generation` | Нет |

Между подготовкой в `check` и публикацией другой участник может
опубликовать подходящий crates release. Тогда шаг публикации проверяет
найденный релиз и его файлы и возвращает `reuse` даже после
`generation`. В Bash проверяется допустимость пары. Проверки самого
релиза, включая скачивание публичных файлов, выполняет предыдущий шаг.

## 5.5. Функции и точка входа {#function-entry}

{% include source-preview.html source=api label="Обёртка curl · строки 22–28" path=script revision=revision start=22 open=true comment="#" %}
{% include source-preview.html source=function label="Определение локальной проверки · строки 30–64" path=script revision=revision start=30 comment="#" %}
{% include source-preview.html source=main label="Первые вызовы main · строки 207–209" path=script revision=revision start=207 open=true comment="#" %}
{% include source-preview.html source=entry label="Точка входа · строка 224" path=script revision=revision start=224 open=true comment="#" %}

Bash читает определения функций по порядку и запоминает их тела.
Определение не вызывает функцию. `github_api()` оборачивает `curl`,
добавляет общие заголовки, включая авторизацию Bearer, и передаёт
`"$@"`, сохраняя каждый аргумент отдельным. Поведение HTTP-запросов
разберём в следующей фазе.

Последняя строка `main "$@"` передаёт аргументы скрипта в `main()`.
Первой вызывается `validate_release_diff()`. Карта показывает путь,
который откроется после успешного локального допуска.

<ol class="publish-chain" aria-label="Порядок выполнения main">
  <li class="flow-node"><code>main "$@"</code><small>Строка 224 запускает <code>main()</code>.</small></li>
  <li class="flow-node"><code>validate_release_diff</code><small>Строка 208. Локально обновляет index и проверяет Git diff.</small></li>
  <li class="flow-node"><code>find_existing_pr</code><small>Строка 209. Поиск открытого PR. Если он найден, скрипт записывает URL и завершает работу.</small></li>
  <li class="flow-node"><code>assert_remote_branch_absent</code><small>Строка 219. Продолжение при отсутствии открытого PR.</small></li>
  <li class="flow-node"><code>commit_and_push_branch</code><small>Строка 220. Создаёт локальную ветку, коммитит и отправляет её. <code>restore_origin()</code> восстанавливает локальный URL origin.</small></li>
  <li class="flow-node"><code>create_draft_pr</code><small>Строка 221. Открывает черновик PR после успешного push.</small></li>
</ol>

## 5.6. Откуда берутся пути кандидата {#candidate-paths}

{% include source-preview.html source=paths label="Пути кандидата и staging · строки 30–33" path=script revision=revision start=30 open=true comment="#" %}

Например, версия `1.29.0` даёт два пути:

```text
app-editors/zed/zed-1.29.0.ebuild
app-editors/zed/files/zed-1.29.0-wayland-only.patch
```

Версия здесь учебная. Python сначала валидирует handoff относительно
ожидаемой базы и проверяет место назначения. Существующий ebuild
кандидата приводит к отказу. Если патч уже есть, это должен быть обычный
файл с теми же байтами, что в проверенном handoff. Новый патч записывается
только при отсутствии файла. `patch_created` передаётся в
`AppliedHandoff`, а запись в `$GITHUB_OUTPUT` превращает Python
`True` или `False` в строки `true` или `false`.

{% include source-preview.html source=python_apply label="Применение проверенного handoff · строки 297–353" path=handoff revision=revision start=297 %}
{% include source-preview.html source=python_output label="Запись выходов шага · строки 356–365" path=handoff revision=revision start=356 open=true %}

При `PATCH_CREATED=true` handoff создал патч, поэтому путь должен
появиться в staged diff. При `false` патч уже совпадал с handoff и его
путь должен остаться за пределами diff. Обоим вариантам нужен
версионный патч. Условие в Bash различает точное `true` и все прочие
непустые строки, которые прошли строку 12. Поэтому, например, `TRUE` ведёт себя так же, как `false`.

## 5.7. HEAD, working tree и Git index {#git-layers}

В разборе [Git-объектов]({{ '/internals/02-shell-scripts/independent-crates/' | relative_url }}#git-objects)
мы видели, что коммит хранит ссылку на дерево. Здесь `HEAD` задаёт
исходный коммит, Git index содержит снимок для следующего коммита, а
working tree состоит из файлов на диске. `git diff --cached` сравнивает
index с `HEAD`, обычный `git diff` сравнивает working tree с index.

{% capture lab_previews %}

{% endcapture %}
{% include publish-lab.html lab="layers" title="Один путь в трёх слоях" options="unstaged_layer|staged_layer|edited_layer|new_layer|unchanged_layer|untracked_layer|ignored_layer" panels="head:HEAD|index:Index|work:Working tree" initial="Если изменён только файл на диске, HEAD и index сохраняют прежнее содержимое." previews=lab_previews %}

У одного пути может быть три версии. Например, после `git add` и
ещё одной правки следующий коммит получит версию из index, а в
редакторе останется более свежая версия. У нового staged-файла запись
уже есть в index, хотя её ещё нет в `HEAD`. У untracked-файла записи
в index ещё нет. Ignored-файл в примере тоже вне index, но его скрывает
правило исключения. Такое правило не перестаёт отслеживать уже
добавленный файл.

## 5.8. Добавляем разрешённые файлы в index {#git-add}

{% capture lab_previews %}
{% include source-preview.html source=staging label="Git staging · строка 33" path=script revision=revision start=33 open=true comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="staging" title="Индекс до и после git add" options="existing|new|modified_patch|missing_ebuild|absent_manifest|deleted_manifest|extra_staged" panels="head:HEAD|before:Index до git add|index:Index после git add|work:Working tree|staged:Фактический staged diff по именам|diagnostic:Диагностика Git" initial="В базовом примере git add записывает новый ebuild и изменившийся Manifest. Патч остаётся без diff." previews=lab_previews %}

Три аргумента явно называют Manifest, ebuild и патч. Кавычки сохраняют
каждый вычисленный путь одним аргументом. Для существующего или нового
файла `git add` переносит текущее содержимое в index. Команда
затрагивает все три пути и при `PATCH_CREATED=false`. Если патч
совпадает с `HEAD`, Git не выведет его в staged diff. Ранее добавленная
посторонняя запись сохранится, и сравнение списков обнаружит её позже.

Это локальная запись в index. В этот момент скрипт ещё не создаёт
коммит и не делает push. Если указанный путь отсутствует и Git его не
отслеживает, команда завершится с ошибкой. Удаление ранее отслеживаемого
Manifest Git, напротив, может застейджить. Сравнение имён ниже увидит
путь удаления, поэтому наличие и корректность Manifest обеспечиваются
на предшествующей границе. В частности, Python требует существующий
обычный Manifest перед применением и записывает содержимое из handoff.

## 5.9. Проверяем staged diff на ошибки {#staged-check}

{% capture lab_previews %}
{% include source-preview.html source=whitespace label="Проверка staged diff · строка 34" path=script revision=revision start=34 open=true comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="whitespace" title="Что найдёт git diff --cached --check?" options="existing|whitespace|marker|no_diff" panels="hunk:Фрагмент staged diff для ebuild|diagnostic:Вывод Git (stdout)" initial="Корректный staged diff проходит проверку со статусом 0." previews=lab_previews %}

`--cached` направляет `git diff` к снимку в index относительно
`HEAD`. `--check` сообщает о введённых ошибках пробельных символов и
оставшихся маркерах конфликта. В показанных временных репозиториях Git
вернул статус `2` для обеих ошибок и `0` для корректного и пустого
diff. Диагностика в этих примерах пришла в stdout. В учебном фрагменте diff
пометка `[пробел]` отмечает конечный пробел. Ненулевой статус
прерывает скрипт через `-e`, поэтому файл `expected_paths` ещё не
создан. Пустой diff проходит эту команду и будет отклонён только при
сравнении списков. Смысл ebuild, патча и политики overlay эта команда
не проверяет.

## 5.10. Формируем список разрешённых путей {#expected-paths}

{% capture lab_previews %}
{% include source-preview.html source=expected label="Построение ожидаемого списка · строки 36–44" path=script revision=revision start=36 open=true comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="expected" title="Что попадёт в expected_paths?" options="false|true|TRUE" panels="branch:Ветка test|raw:Строки до сортировки|expected:Содержимое файла в порядке sort" initial="При PATCH_CREATED=false ожидаются Manifest и ebuild." previews=lab_previews %}

`expected_paths` получает путь к временному файлу под `$RUNNER_TEMP`.
Фигурные скобки группируют команды, чтобы весь их stdout пошёл в один
вход `sort`. `printf '%s\n'` печатает по строке на аргумент.
`if test "$PATCH_CREATED" = true` добавляет строку патча только при
точном совпадении. `>` создаёт или перезаписывает файл результатом
сортировки. Закрывающая `}` отделена переводом строки после `fi`;
при записи в одну строку перед ней нужен разделитель `;`.

**Существующий неизменённый патч**

```text
app-editors/zed/Manifest
app-editors/zed/zed-1.29.0.ebuild
```

**Новый патч**

```text
app-editors/zed/Manifest
app-editors/zed/files/zed-1.29.0-wayland-only.patch
app-editors/zed/zed-1.29.0.ebuild
```

Это список ожидаемых имён в staged diff. Проверка не занимается
произвольными файловыми путями или проверкой их содержимого.

## 5.11. Сравниваем ожидаемый и фактический staged diff {#compare-paths}

{% capture lab_previews %}
{% include source-preview.html source=staging label="Git staging · строка 33" path=script revision=revision start=33 comment="#" %}
{% include source-preview.html source=whitespace label="Проверка staged diff · строка 34" path=script revision=revision start=34 comment="#" %}
{% include source-preview.html source=expected label="Построение ожидаемого списка · строки 36–44" path=script revision=revision start=36 comment="#" %}
{% include source-preview.html source=allowlist label="Сравнение списков · строки 45–53" path=script revision=revision start=45 comment="#" %}
{% include source-preview.html source=tracked label="Проверка unstaged tracked · строки 54–58" path=script revision=revision start=54 comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="allowlist" title="Полное совпадение staged-списков" options="existing|new|extra_staged|missing_ebuild|unchanged_manifest|modified_patch|unchanged_patch|whitespace" panels="expected:Ожидаемый список|actual:Фактический список|diagnostic:Диагностика Git или Bash" initial="В базовом примере оба списка состоят из Manifest и ebuild, cmp возвращает 0." previews=lab_previews %}

`git diff --cached --name-only` печатает имена изменённых путей в
index относительно `HEAD`. `sort` даёт тот же порядок, что и в
`expected_paths`. [Подстановка команды]({{ yaml }}#cmd-substitution)
`$(…)` удаляет все завершающие переводы строки, оставляя внутренние.
`printf '%s\n' "$actual_paths"` сохраняет эти внутренние переводы и
добавляет один в конце. При пустом выводе Git `printf` передаёт один
перевод строки.

Тихий `cmp -s "$expected_paths" -` читает файл и stdin и сравнивает
их побайтно. Статус `0` означает совпадение, `1` — различие, `2` —
проблему сравнения. `!` инвертирует статус конвейера, поэтому
несовпадение или ошибка сравнения ведут в `then`. Скрипт печатает
обе стороны в stderr и завершается с `1`. Списки должны совпасть
целиком: пропуск ожидаемого имени и добавление лишнего одинаково
останавливают проверку. В лаборатории отсутствие нового ebuild
обнаруживает ещё `git add`. До `cmp` этот сценарий не доходит.

## 5.12. Проверяем unstaged tracked changes {#unstaged-tracked}

{% capture lab_previews %}
{% include source-preview.html source=tracked label="Проверка unstaged tracked · строки 54–58" path=script revision=revision start=54 open=true comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="tracked" title="Сравниваем index и working tree" options="existing|tracked|manifest_after|patch_after" panels="head:HEAD|index:Index|work:Working tree|tracked:stdout команды git diff --name-only|diagnostic:Диагностика скрипта" initial="После ожидаемого staging обычный git diff --name-only ничего не выводит." previews=lab_previews %}

`git diff --name-only` без `--cached` перечисляет отслеживаемые
пути, для которых working tree расходится с index. Даже точное
совпадение staged-списков оставляет возможность таких изменений.
`$(…)` подставляет вывод как один аргумент `test -n`, и тест
проверяет его длину. Когда вывод непуст, скрипт печатает сообщение,
повторно запрашивает перечень путей для stderr и завершает работу с `1`.

Статус `test -n` определяется длиной строки из stdout. Код возврата
вложенного Git напрямую в `test` не передаётся. В этом условии `errexit` не превращает
любую ошибку вложенного Git в гарантированный отказ. Например, если
Git выдаст ошибку и ничего не напечатает в stdout, тест увидит пустую
строку. Лаборатория показывает штатный вывод сравнения.

## 5.13. Проверяем untracked files {#untracked-files}

{% capture lab_previews %}
{% include source-preview.html source=untracked label="Проверка untracked · строки 59–63" path=script revision=revision start=59 open=true comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="untracked" title="Какие файлы увидит git ls-files?" options="existing|untracked|multiple|ignored|package_untracked" panels="work:Working tree|untracked:stdout команды git ls-files|diagnostic:Диагностика скрипта" initial="В чистом сценарии git ls-files --others --exclude-standard ничего не выводит." previews=lab_previews %}

`git ls-files --others` находит пути вне index. Обычный
`git diff` не покажет новый файл, пока Git его не отслеживает,
поэтому здесь нужна отдельная команда. `--exclude-standard` учитывает
обычные правила исключения Git, в том числе `.gitignore`,
`.git/info/exclude` и пользовательский файл исключений. Например,
`scratch.tmp` в лаборатории существует, но совпадает с правилом
`.gitignore` и не попадает в stdout. Файл внутри каталога пакета
проверяется так же, как файл в корне.

При непустом списке скрипт повторяет команду для диагностики в stderr
и явно завершает работу. Как и на строке 54, условие проверяет текст
из подстановки. Практическая граница этой проверки — видимые Git
неотслеживаемые файлы в свежем checkout после применения проверенного
handoff. Игнорируемые файлы могут оставаться на диске.

## 5.14. Полная карта проверки release diff {#local-boundary}

В карте PASS означает пройденную проверку или выполненный шаг, FAIL
показывает первую остановку, SKIP обозначает шаг, до которого выполнение
не дошло. Выберите сценарий, затем нажмите на этап, чтобы подсветить
его строки. Списки отражают снятые во временных репозиториях состояния.
Проверка может остановиться после записи в index; в этой части скрипта
нет отката staging.

{% capture lab_previews %}
{% include source-preview.html source=startup label="Верхнеуровневые проверки · строки 1–21" path=script revision=revision start=1 trailing_blank=true comment="#" %}
{% include source-preview.html source=api label="Обёртка curl · строки 22–29" path=script revision=revision start=22 trailing_blank=true comment="#" %}
{% include source-preview.html source=function label="Определение локальной проверки · строки 30–64" path=script revision=revision start=30 comment="#" %}
{% include source-preview.html source=main label="Первые вызовы main · строки 207–209" path=script revision=revision start=207 comment="#" %}
{% include source-preview.html source=entry label="Точка входа · строка 224" path=script revision=revision start=224 comment="#" %}
{% endcapture %}
{% include publish-lab.html lab="integrated" title="Когда достижим find_existing_pr?" options="existing|new|pair_invalid|unset|version_invalid|missing_ebuild|whitespace|extra_staged|unchanged_manifest|tracked|untracked|ignored" panels="before:Index до git add|index:Index при остановке / допуске|work:Working tree|expected:Ожидаемый список|actual:Фактический список|diagnostic:Диагностика локальной проверки" initial="В базовом сценарии локальные этапы пройдены и строка 209 достижима." previews=lab_previews %}

При успехе управление возвращается в `main()` со статусом `0` от
локальной функции. Поиск открытого PR теперь достижим. Его результат и
успех дальнейшей публикации зависят от удалённого состояния и следующих
проверок. Следующая фаза начнётся с вызова на строке 209.

```bash
find_existing_pr
```
