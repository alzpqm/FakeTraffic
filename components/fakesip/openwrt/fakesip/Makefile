include $(TOPDIR)/rules.mk

PKG_NAME:=fakesip
PKG_VERSION:=0.9.1
PKG_RELEASE:=23

PKG_LICENSE:=GPL-3.0-or-later
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=MikeWang000000

ifneq ($(FAKESIP_SRC_DIR),)
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)
else
PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/alzpqm/FakeSIP.git
PKG_SOURCE_VERSION:=74442cb4ea8a7f6737efaac538ca3e973a21f318
PKG_MIRROR_HASH:=skip
endif

include $(INCLUDE_DIR)/package.mk

define Package/fakesip
  SECTION:=net
  CATEGORY:=Network
  TITLE:=UDP SIP camouflage using Netfilter Queue
  URL:=https://github.com/alzpqm/FakeSIP
  DEPENDS:=+libnetfilter-queue +libnfnetlink +libmnl +kmod-nfnetlink-queue \
    +PACKAGE_firewall4:nftables-json +PACKAGE_firewall4:kmod-nft-queue \
    +PACKAGE_firewall:iptables-mod-nfqueue \
    +PACKAGE_firewall:iptables-mod-conntrack-extra
endef

define Package/fakesip/description
 FakeSIP disguises UDP traffic as SIP protocol traffic and routes packets
 through NFQUEUE. This package includes a UCI configuration file and procd
 service script for OpenWrt.
endef

define Package/fakesip/conffiles
/etc/config/fakesip
endef

ifneq ($(FAKESIP_SRC_DIR),)
define Build/Prepare
	$(RM) -r $(PKG_BUILD_DIR)
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) $(FAKESIP_SRC_DIR)/. $(PKG_BUILD_DIR)/
	$(RM) -r $(PKG_BUILD_DIR)/build
	find $(PKG_BUILD_DIR) \( -name '._*' -o -name '.DS_Store' \) -print0 | xargs -r -0 rm -rf
endef
endif

ifneq ($(FAKESIP_SRC_DIR),)
define Build/Compile
	$(MAKE) -C $(FAKESIP_SRC_DIR) clean
	$(MAKE) -C $(FAKESIP_SRC_DIR) \
		CC="$(TARGET_CC)" \
		STRIP="$(TARGET_STRIP)" \
		CFLAGS="$(TARGET_CFLAGS) $(TARGET_CPPFLAGS)" \
		LDFLAGS="$(TARGET_LDFLAGS)" \
		VERSION="$(PKG_VERSION)-openwrt"
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/build
	$(CP) $(FAKESIP_SRC_DIR)/build/fakesip $(PKG_BUILD_DIR)/build/fakesip
endef
else
define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR) clean
	$(MAKE) -C $(PKG_BUILD_DIR) \
		CC="$(TARGET_CC)" \
		STRIP="$(TARGET_STRIP)" \
		CFLAGS="$(TARGET_CFLAGS) $(TARGET_CPPFLAGS)" \
		LDFLAGS="$(TARGET_LDFLAGS)" \
		VERSION="$(PKG_VERSION)-openwrt"
endef
endif

define Package/fakesip/install
	$(INSTALL_DIR) $(1)/usr/bin
ifneq ($(FAKESIP_SRC_DIR),)
	$(INSTALL_BIN) $(FAKESIP_SRC_DIR)/build/fakesip $(1)/usr/bin/fakesip
else
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/build/fakesip $(1)/usr/bin/fakesip
endif
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/fakesip.config $(1)/etc/config/fakesip
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/fakesip.init $(1)/etc/init.d/fakesip
endef

$(eval $(call BuildPackage,fakesip))
