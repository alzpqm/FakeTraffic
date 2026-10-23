.PHONY: all test packages test-unified
all:
	$(MAKE) -C components/fakehttp VERSION=99.3-r1
	$(MAKE) -C components/fakesip VERSION=0.9.1-openwrt

test: all
	node tools/verify-sources.mjs
	$(MAKE) -C components/fakehttp test VERSION=99.3-r1
	cd components/fakehttp && sh scripts/smoke-openwrt-package.sh
	bash components/fakesip/tools/core-regression-test.sh
	bash components/fakesip/tools/openwrt-package-smoke-test.sh
	node tools/sync-unified-adapters.mjs --check
	node --test tests/unified.test.mjs
	sh tests/unified-init.sh

test-unified:
	node tools/verify-sources.mjs
	node tools/sync-unified-adapters.mjs --check
	node --test tests/unified.test.mjs
	sh tests/unified-init.sh

packages:
	@test -n "$(SDK)" || { echo 'Set SDK=/absolute/path/to/matching-sdk' >&2; exit 1; }
	sh tools/build-unified-apk.sh "$(SDK)"
