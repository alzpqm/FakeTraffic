.PHONY: all test packages
all:
	$(MAKE) -C components/fakehttp VERSION=99.3-r1
	$(MAKE) -C components/fakesip VERSION=0.9.1-openwrt

test: all
	node tools/verify-sources.mjs
	$(MAKE) -C components/fakehttp test VERSION=99.3-r1
	cd components/fakehttp && sh scripts/smoke-openwrt-package.sh
	sh components/fakesip/tools/core-regression-test.sh
	sh components/fakesip/tools/openwrt-package-smoke-test.sh
	node --test tests/integration.test.mjs

packages:
	@test -n "$(SDK)" || { echo 'Set SDK=/absolute/path/to/matching-sdk' >&2; exit 1; }
	sh tools/build-packages.sh "$(SDK)"
