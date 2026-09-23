# zed-overlay

`zed-overlay` — оверлей Gentoo для нативной сборки Zed через Portage. Текущий
пакет — `app-editors/zed-1.15.0`. Он основан на официальном ebuild Gentoo и
адаптирован для сборки только с Wayland.

## Структура репозитория

```text
app-editors/zed/
  files/zed-1.15.0-wayland-only.patch
  Manifest
  metadata.xml
  zed-1.15.0.ebuild
metadata/layout.conf
profiles/repo_name
```

Репозиторий использует `masters = gentoo` и тонкие манифесты. Предварительно
сгенерированный каталог `metadata/md5-cache/` не хранится в Git.

## Подключение оверлея к Portage

Создайте `/etc/portage/repos.conf/zed-overlay.conf`:

```ini
[zed-overlay]
location = /var/db/repos/zed-overlay
sync-type = git
sync-uri = https://github.com/vovanbl411/zed-overlay.git
auto-sync = yes
```

Синхронизируйте репозиторий и создайте внешний кеш метаданных Portage:

```sh
sudo emaint sync -r zed-overlay
sudo egencache --repo=zed-overlay --update --external-cache-only
```

Проверьте план установки и установите текущую версию пакета:

```sh
emerge -pv =app-editors/zed-1.15.0::zed-overlay
sudo emerge -av =app-editors/zed-1.15.0::zed-overlay
```

Устанавливаются исполняемые файлы `/usr/bin/zedit` и
`/usr/libexec/zed-editor`.

## Политика Wayland-only

Downstream-патч сохраняет Wayland и удаляет X11 из графа возможностей рабочей
сборки. Проверено, что установленный исполняемый файл запускается без `DISPLAY`
и не имеет runtime-зависимостей от `libX11`, `libxcb` или `xkbcommon-x11`.

Локальная демонстрация экрана в Linux намеренно отключена в этой сборке. Zed
1.15.0 не использует её в интерфейсе Wayland, а включение `scap/wayland`
добавило бы устаревшую цепочку зависимостей `pipewire-rs 0.8` и
`zed-scap 0.0.8`.
