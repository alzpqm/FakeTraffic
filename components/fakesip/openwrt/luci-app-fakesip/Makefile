include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fakesip
PKG_VERSION:=0.9.1
PKG_RELEASE:=23
PKGARCH:=all
PKG_BUILD_DEPENDS:=luci-base/host

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-fakesip
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for FakeSIP
  DEPENDS:=+fakesip +luci-base +rpcd-mod-file
  PKGARCH:=all
endef

define Package/luci-app-fakesip/description
 LuCI web interface for configuring and controlling the FakeSIP OpenWrt
 service.
endef

define Build/Compile
endef

define Package/luci-app-fakesip/install
	$(CP) ./root/* $(1)/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(STAGING_DIR_HOSTPKG)/bin/po2lmo ./po/zh_Hant/fakesip.po \
		$(1)/usr/lib/lua/luci/i18n/fakesip.zh-tw.lmo
endef

$(eval $(call BuildPackage,luci-app-fakesip))
