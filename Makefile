.PHONY: all test packages test-unified test-telemetry test-ebpf-config test-template-publication
all:
	$(MAKE) -C components/fakehttp VERSION=99.3-r1
	$(MAKE) -C components/fakesip VERSION=0.9.1-openwrt

test: all test-telemetry test-ebpf-config
	python3 tests/hop-estimate.py
	node tools/verify-sources.mjs
	$(MAKE) -C components/fakehttp test VERSION=99.3-r1
	cd components/fakehttp && sh scripts/smoke-openwrt-package.sh
	bash components/fakesip/tools/core-regression-test.sh
	bash components/fakesip/tools/openwrt-package-smoke-test.sh
	node tools/sync-unified-adapters.mjs --check
	node --test tests/*.test.mjs
	sh tests/unified-init.sh
	sh tests/preflight.sh
	python3 tests/package-hooks.py
	python3 tests/sdk-luci.py

test-unified: test-ebpf-config
	node tools/verify-sources.mjs
	node tools/sync-unified-adapters.mjs --check
	node --test tests/*.test.mjs
	sh tests/unified-init.sh
	sh tests/preflight.sh
	python3 tests/package-hooks.py
	python3 tests/sdk-luci.py

packages:
	@test -n "$(SDK)" || { echo 'Set SDK=/absolute/path/to/matching-sdk' >&2; exit 1; }
	sh tools/build-unified-apk.sh "$(SDK)"

test-telemetry:
	mkdir -p build
	$(CC) -std=c99 -pedantic -Wall -Wextra -Werror -Icomponents/fakehttp/include tests/test-telemetry.c components/fakehttp/src/telemetry.c -Wl,--wrap=write -o build/test-telemetry
	./build/test-telemetry
	cmp components/fakehttp/src/telemetry.c components/fakesip/src/telemetry.c
	cmp components/fakehttp/include/telemetry.h components/fakesip/include/telemetry.h

test-ebpf-config:
	$(MAKE) -C components/fakeflow test

# Modern libbpf headers required; BPF_INCLUDE can name an existing private SDK
# development prefix. This test mocks map syscalls and does not require root.
test-template-publication:
	mkdir -p build
	$(CC) -O2 -Wall -Wextra -Werror -ffunction-sections -fdata-sections $(if $(BPF_INCLUDE),-I$(BPF_INCLUDE)) tests/test-template-publication.c -Wl,--gc-sections -o build/test-template-publication
	./build/test-template-publication
	$(CC) -O2 -Wall -Wextra -Werror -ffunction-sections -fdata-sections $(if $(BPF_INCLUDE),-I$(BPF_INCLUDE)) tests/test-ebpf-stats.c -Wl,--gc-sections -o build/test-ebpf-stats
	./build/test-ebpf-stats
