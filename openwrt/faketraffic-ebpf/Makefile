include $(TOPDIR)/rules.mk
PKG_NAME:=faketraffic-ebpf
PKG_VERSION:=0.4.0
PKG_RELEASE:=4
PKG_LICENSE:=GPL-2.0-only
PKG_BUILD_DEPENDS:=bpf-headers
FAKETRAFFIC_SOURCE_DIR?=$(realpath $(CURDIR)/../..)
include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/bpf.mk

define Package/faketraffic-ebpf
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Experimental TCX backend for the single FakeTraffic service
  DEPENDS:=+faketraffic +libbpf +libelf +zlib +libgcc +ip-full +tc-full +kmod-sched-bpf +kmod-tun $(BPF_DEPENDS)
  EXTRA_DEPENDS:=faketraffic (=0.4.0-r4)
endef

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) $(FAKETRAFFIC_SOURCE_DIR)/components/fakeflow/ebpf $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_CPPFLAGS) -Wall -Wextra -I$(PKG_BUILD_DIR)/ebpf/include $(PKG_BUILD_DIR)/ebpf/user/*.c $(TARGET_LDFLAGS) -lbpf -lelf -lz -o $(PKG_BUILD_DIR)/ebpf-backend
	$(call CompileBPF,$(PKG_BUILD_DIR)/ebpf/bpf/observer.bpf.c,-mcpu=v3 -I$(PKG_BUILD_DIR)/ebpf/include -I$(PKG_BUILD_DIR)/ebpf/bpf)
endef

define Package/faketraffic-ebpf/install
	$(INSTALL_DIR) $(1)/usr/libexec/faketraffic $(1)/usr/lib/faketraffic $(1)/usr/share/licenses/faketraffic-ebpf
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/ebpf-backend $(1)/usr/libexec/faketraffic/ebpf
	$(INSTALL_BIN) ./pre-deinstall $(1)/usr/libexec/faketraffic/ebpf-pre-deinstall
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/ebpf/bpf/observer.bpf.o $(1)/usr/lib/faketraffic/ebpf.bpf.o
	$(INSTALL_DATA) $(FAKETRAFFIC_SOURCE_DIR)/components/fakeflow/LICENSE $(1)/usr/share/licenses/faketraffic-ebpf/LICENSE
endef

# No independent init script or auto-start. The core manager is the only owner.
define Package/faketraffic-ebpf/prerm
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
    /usr/libexec/faketraffic/ebpf-pre-deinstall || exit 1
fi
exit 0
endef

$(eval $(call BuildPackage,faketraffic-ebpf))
