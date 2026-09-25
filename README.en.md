# zed-overlay

English | [Русский](README.md)

`zed-overlay` is a Gentoo overlay for building Zed natively with Portage. Its
ebuild is based on the official Gentoo ebuild and adapted for a Wayland-only
build.

## Repository layout

```text
app-editors/zed/
contrib/portage/repo.postsync.d/50-zed-overlay-cache
metadata/layout.conf
profiles/repo_name
```

The repository uses `masters = gentoo` and thin manifests. Generated
`metadata/md5-cache/` files are kept outside Git.

## Add the overlay to Portage

Create `/etc/portage/repos.conf/zed-overlay.conf`:

```ini
[zed-overlay]
location = /var/db/repos/zed-overlay
sync-type = git
sync-uri = https://github.com/vovanbl411/zed-overlay.git
auto-sync = yes
sync-hooks-only-on-change = yes
```

The post-sync hook is optional. To install it once, run:

```sh
sudo install -Dm755 \
  /var/db/repos/zed-overlay/contrib/portage/repo.postsync.d/50-zed-overlay-cache \
  /etc/portage/repo.postsync.d/50-zed-overlay-cache
```

When installed, Portage runs the hook after syncing `zed-overlay`. It refreshes
the external metadata cache with:

```sh
egencache --repo=zed-overlay --update --external-cache-only
```

The hook does not write `metadata/md5-cache/` into the Git checkout. After
setup, use the usual `emerge --sync` command to update the overlay.

The ebuild has the testing keyword `~amd64`. On a stable amd64 system, add this
line to `/etc/portage/package.accept_keywords` or to a separate file inside
that directory:

```text
app-editors/zed::zed-overlay ~amd64
```

No separate entry is needed if your system already accepts `~amd64`.

For the initial installation, use an unversioned package atom so Portage adds
Zed to the selected world set:

```sh
sudo emerge -av app-editors/zed::zed-overlay
```

The regular update workflow is:

```sh
sudo emerge --sync
emerge -pvuDN @world
sudo emerge -avuDN @world
```

## Scope and validation

The patch removes X11 from Zed's production features and disables local screen
capture on Linux. Do not enable `scap/wayland` without a separate decision that
accounts for its PipeWire/scap dependency chain.

CI checks release preparation, dependencies, and patch application. It does not
build Zed or check runtime behavior. A new release still needs a manual Gentoo
build, linkage checks with `scanelf` and `lddtree`, and a native Wayland startup
check before it is considered runtime-validated.

Version 1.21.0 passed these checks on amd64. The arm64 build and runtime have
not been tested, although the ebuild carries the `~arm64` keyword.

See [CI and security](docs/CI_AND_SECURITY.en.md) for the automated release checks
and their validation limits.
