include $(TOPDIR)/rules.mk
PKG_NAME:=luci-app-faketraffic
PKG_VERSION:=0.4.0
PKG_RELEASE:=2
PKG_LICENSE:=GPL-3.0-or-later
PKGARCH:=all
PKG_BUILD_DEPENDS:=luci-base/host gettext-full/host
FAKETRAFFIC_SOURCE_DIR?=$(realpath $(CURDIR)/../..)
include $(INCLUDE_DIR)/package.mk

define Package/luci-app-faketraffic
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=FakeTraffic unified TCP and UDP configuration
  DEPENDS:=+luci-base +rpcd-mod-file +faketraffic
  EXTRA_DEPENDS:=faketraffic (=0.4.0-r2)
  PKGARCH:=all
endef

define Build/Compile
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(STAGING_DIR_HOSTPKG)/bin/msgcat --use-first \
		./po/zh_Hant/faketraffic.po \
		$(FAKETRAFFIC_SOURCE_DIR)/components/fakehttp/openwrt/luci-app-fakehttp/po/zh_Hant/fakehttp.po \
		$(FAKETRAFFIC_SOURCE_DIR)/components/fakesip/openwrt/luci-app-fakesip/po/zh_Hant/fakesip.po \
		-o $(PKG_BUILD_DIR)/faketraffic.po
	$(STAGING_DIR_HOSTPKG)/bin/po2lmo $(PKG_BUILD_DIR)/faketraffic.po $(PKG_BUILD_DIR)/faketraffic.zh-tw.lmo
endef

define Package/luci-app-faketraffic/install
	$(CP) ./root/* $(1)/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/faketraffic.zh-tw.lmo $(1)/usr/lib/lua/luci/i18n/faketraffic.zh-tw.lmo
	find $(1)/usr -type d -exec chmod 0755 {} +
	find $(1)/usr -type f -exec chmod 0644 {} +
endef

$(eval $(call BuildPackage,luci-app-faketraffic))
