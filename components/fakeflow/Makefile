CLANG ?= clang
CC ?= cc
ARCH_INCLUDE ?= /usr/include/$(shell $(CC) -dumpmachine)
CFLAGS ?= -O2 -g -Wall -Wextra -Werror
BPF_CFLAGS = -O2 -g -target bpf -I$(ARCH_INCLUDE) -Iebpf/include -Iebpf/bpf
LIBS = $(shell pkg-config --libs libbpf) -lelf -lz

.PHONY: all clean test install
# This vendored subset contains the backend/config tests, not upstream's VM
# harness. Root tests/ebpf-netns.py is the explicit isolated-lab integration gate.
all: build/ebpf.bpf.o build/ebpf
build:
	mkdir -p $@
build/ebpf.bpf.o: ebpf/bpf/observer.bpf.c $(wildcard ebpf/bpf/*.h) ebpf/bpf/builder.bpf.c ebpf/include/abi.h | build
	$(CLANG) $(BPF_CFLAGS) -mcpu=v3 -c $< -o $@
build/ebpf: $(wildcard ebpf/user/*.c) $(wildcard ebpf/user/*.h) ebpf/include/abi.h | build
	$(CC) $(CFLAGS) -Iebpf/include $(wildcard ebpf/user/*.c) -o $@ $(LIBS)
build/config_test: tests/config_test.c ebpf/user/config.c ebpf/user/templates.c | build
	$(CC) $(CFLAGS) -fsanitize=address,undefined -fno-omit-frame-pointer $^ -o $@
test: build/config_test
	build/config_test
install: build/ebpf build/ebpf.bpf.o
	install -Dm755 build/ebpf $(DESTDIR)/usr/libexec/faketraffic/ebpf
	install -Dm644 build/ebpf.bpf.o $(DESTDIR)/usr/lib/faketraffic/ebpf.bpf.o
clean:
	rm -rf build
