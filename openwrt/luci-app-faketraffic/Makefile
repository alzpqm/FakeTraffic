include $(TOPDIR)/rules.mk
PKG_NAME:=luci-app-faketraffic
PKG_VERSION:=0.2.0
PKG_RELEASE:=3
PKG_LICENSE:=GPL-3.0-or-later
PKGARCH:=all
include $(INCLUDE_DIR)/package.mk

define Package/luci-app-faketraffic
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=FakeTraffic unified TCP and UDP configuration
  DEPENDS:=+luci-base +rpcd-mod-file +faketraffic
  EXTRA_DEPENDS:=faketraffic (=0.2.0-r2)
  PKGARCH:=all
endef

define Build/Compile
endef

define Package/luci-app-faketraffic/install
	$(CP) ./root/* $(1)/
	find $(1)/usr -type d -exec chmod 0755 {} +
	find $(1)/usr -type f -exec chmod 0644 {} +
endef

$(eval $(call BuildPackage,luci-app-faketraffic))
