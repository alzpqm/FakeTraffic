include $(TOPDIR)/rules.mk
PKG_NAME:=luci-app-faketraffic
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0-or-later
PKGARCH:=all
include $(INCLUDE_DIR)/package.mk

define Package/luci-app-faketraffic
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=FakeTraffic TCP and UDP management entry
  DEPENDS:=+luci-base +luci-app-fakehttp +luci-app-fakesip
  EXTRA_DEPENDS:=fakehttp (=99.3-r1), fakesip (=0.9.1-r23), luci-app-fakehttp (=99.3-r1), luci-app-fakesip (=0.9.1-r23)
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
