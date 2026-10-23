include $(TOPDIR)/rules.mk
PKG_NAME:=faketraffic
PKG_VERSION:=0.2.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0-or-later
FAKETRAFFIC_SOURCE_DIR?=$(realpath $(CURDIR)/../..)
include $(INCLUDE_DIR)/package.mk

define Package/faketraffic
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Integrated TCP and UDP camouflage service
  URL:=https://github.com/alzpqm/FakeTraffic
  DEPENDS:=+libnetfilter-queue +libnfnetlink +libmnl +kmod-nfnetlink-queue +kmod-nft-queue +nftables-json
endef

define Package/faketraffic/conffiles
/etc/config/faketraffic
endef

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/fakehttp $(PKG_BUILD_DIR)/fakesip
	$(CP) $(FAKETRAFFIC_SOURCE_DIR)/components/fakehttp/Makefile $(FAKETRAFFIC_SOURCE_DIR)/components/fakehttp/src $(FAKETRAFFIC_SOURCE_DIR)/components/fakehttp/include $(PKG_BUILD_DIR)/fakehttp/
	$(CP) $(FAKETRAFFIC_SOURCE_DIR)/components/fakesip/Makefile $(FAKETRAFFIC_SOURCE_DIR)/components/fakesip/src $(FAKETRAFFIC_SOURCE_DIR)/components/fakesip/include $(PKG_BUILD_DIR)/fakesip/
endef

define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR)/fakehttp CC="$(TARGET_CC)" STRIP="$(TARGET_STRIP)" CFLAGS="$(TARGET_CFLAGS) $(TARGET_CPPFLAGS)" LDFLAGS="$(TARGET_LDFLAGS)" VERSION=99.3-r1
	$(MAKE) -C $(PKG_BUILD_DIR)/fakesip CC="$(TARGET_CC)" STRIP="$(TARGET_STRIP)" CFLAGS="$(TARGET_CFLAGS) $(TARGET_CPPFLAGS)" LDFLAGS="$(TARGET_LDFLAGS)" VERSION=0.9.1-openwrt
endef

define Package/faketraffic/install
	$(INSTALL_DIR) $(1)/usr/libexec/faketraffic $(1)/etc/config $(1)/etc/init.d
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/fakehttp/build/fakehttp $(1)/usr/libexec/faketraffic/fakehttp
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/fakesip/build/fakesip $(1)/usr/libexec/faketraffic/fakesip
	$(INSTALL_BIN) ./files/etc/init.d/faketraffic $(1)/etc/init.d/faketraffic
	$(INSTALL_CONF) ./files/etc/config/faketraffic $(1)/etc/config/faketraffic
endef

# Installation deliberately does not enable/start any service.
define Package/faketraffic/postinst
#!/bin/sh
exit 0
endef

define Package/faketraffic/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/faketraffic stop
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/faketraffic disable
exit 0
endef

$(eval $(call BuildPackage,faketraffic))
