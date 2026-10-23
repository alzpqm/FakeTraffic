'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require poll';
'require tools.widgets as widgets';

var STATUS_RUNNING = 'running';
var STATUS_STOPPED = 'stopped';
var STATUS_UNKNOWN = 'unknown';

function asList(value) {
	if (Array.isArray(value))
		return value.filter(function(item) { return String(item).length > 0; });

	if (value == null || value === '')
		return [];

	return [ String(value) ];
}

function effectiveInterfaceMode(value, networks, interfaces) {
	if (value === 'network' || value === 'device' || value === 'auto')
		return value;

	if (asList(networks).length && asList(interfaces).length)
		return 'auto';
	if (asList(networks).length)
		return 'network';
	if (asList(interfaces).length)
		return 'device';

	return 'network';
}

function networkL3DeviceName(network) {
	var device;

	if (!network || typeof network.getL3Device !== 'function')
		return null;

	device = network.getL3Device();
	return device && typeof device.getName === 'function'
		? device.getName()
		: null;
}

function isRedundantIpv6Network(networks, name) {
	var baseName, baseNetwork, ipv6Network;

	name = String(name == null ? '' : name);
	if (!name.match(/_6$/))
		return false;

	baseName = name.slice(0, -2);
	for (var i = 0; i < networks.length; i++) {
		if (networks[i].getName() === baseName)
			baseNetwork = networks[i];
		else if (networks[i].getName() === name)
			ipv6Network = networks[i];
	}

	if (!baseNetwork || !ipv6Network)
		return false;

	baseName = networkL3DeviceName(baseNetwork);
	name = networkL3DeviceName(ipv6Network);
	return baseName != null && name != null && baseName === name;
}

function utf8ByteLength(value) {
	var bytes = 0;

	value = String(value);
	for (var i = 0; i < value.length; i++) {
		var code = value.charCodeAt(i);

		if (code <= 0x7f)
			bytes++;
		else if (code <= 0x7ff)
			bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff &&
			 i + 1 < value.length &&
			 value.charCodeAt(i + 1) >= 0xdc00 &&
			 value.charCodeAt(i + 1) <= 0xdfff) {
			bytes += 4;
			i++;
		}
		else
			bytes += 3;
	}

	return bytes;
}

function parseServiceStatus(result) {
	var output;

	if (!result || typeof result !== 'object')
		return { state: STATUS_UNKNOWN, output: '' };

	output = [ result.stdout || '', result.stderr || '' ].join(' ').trim();
	if (result.code === 3 || result.code === 5 ||
	    output.match(/active with no instances|inactive|stopped|not running/i))
		return { state: STATUS_STOPPED, output: output };

	if (result.code === 0 && output.match(/running/i))
		return { state: STATUS_RUNNING, output: output };

	return { state: STATUS_UNKNOWN, output: output };
}

function parseUint32(value) {
	var number;

	value = String(value == null ? '' : value).trim();
	if (!value.match(/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/))
		return null;

	number = Number(value);
	if (!Number.isInteger(number) || number < 1 || number > 4294967295)
		return null;

	return number;
}

function validateUint32(sectionId, value) {
	return parseUint32(value) != null ||
		_('Enter a non-zero 32-bit decimal or hexadecimal value.');
}

function validateFirewallMask(sectionId, value) {
	var mark = parseUint32(this.section.formvalue(sectionId, 'fwmark'));
	var mask = parseUint32(value);

	if (mask == null)
		return _('Enter a non-zero 32-bit decimal or hexadecimal value.');

	if (mark != null && ((mark & mask) >>> 0) !== mark)
		return _('The firewall mark must be fully contained in the mask.');

	return true;
}

function validateEnabledTargets(sectionId, value) {
	var interfaces = asList(this.section.formvalue(sectionId, 'interface'));
	var networks = asList(this.section.formvalue(sectionId, 'network'));
	var mode;

	if (String(value) !== '1' ||
	    String(this.section.formvalue(sectionId, 'all_interfaces')) === '1')
		return true;

	mode = effectiveInterfaceMode(
		this.section.formvalue(sectionId, 'interface_mode'),
		networks, interfaces);
	if (mode === 'network' && networks.length)
		return true;
	if (mode === 'device' && interfaces.length)
		return true;
	if (mode === 'auto' && (networks.length || interfaces.length))
		return true;

	return mode === 'auto'
		? _('Select at least one OpenWrt network or Linux device.')
		: mode === 'device'
		? _('Select at least one Linux device.')
		: _('Select at least one OpenWrt network.');
}

function validateRequiredPair(sectionId, value, otherOption, message) {
	if (String(value) === '1' ||
	    String(this.section.formvalue(sectionId, otherOption)) === '1')
		return true;

	return message;
}

function validateInterfaceList(sectionId, value) {
	var values = Array.isArray(value) ? asList(value) :
		String(value == null ? '' : value).trim().split(/\s+/).filter(Boolean);

	for (var i = 0; i < values.length; i++) {
		if (utf8ByteLength(values[i]) > 15 ||
		    !values[i].match(/^[A-Za-z0-9_.-]+$/))
			return _('Interface names must use letters, digits, dot, underscore or hyphen and be at most 15 bytes.');
	}

	return true;
}

function validateSipUri(sectionId, value) {
	if (!String(value).match(/^sip:[^\s]+$/))
		return _('SIP URIs must start with "sip:" and contain no whitespace.');

	if (utf8ByteLength(value) > 120)
		return _('SIP URIs must be at most 120 bytes.');

	return true;
}

function validateSipProfile(sectionId, value) {
	if (value !== 'custom' ||
	    asList(this.section.formvalue(sectionId, 'sip_uri')).length)
		return true;

	return _('Add at least one SIP URI for the custom profile.');
}

function validateAbsolutePath(sectionId, value) {
	if (value == null || value === '')
		return true;

	if (String(value).charAt(0) !== '/')
		return _('Use an absolute path.');

	if (utf8ByteLength(value) > 4095)
		return _('The path is too long.');

	return true;
}

function validateHopSettings(sectionId, value) {
	var dynamicPct = Number(this.section.formvalue(sectionId, 'dynamic_pct') || 0);

	if (String(value) === '1' && dynamicPct > 0)
		return _('Disable dynamic TTL before disabling hop estimation.');

	return true;
}

function getSectionOptionUIElement(section, sectionId, optionName) {
	var element;

	if (section && typeof section.getUIElement === 'function')
		element = section.getUIElement(sectionId, optionName);

	if (element && typeof element.triggerValidation === 'function')
		return element;

	/* LuCI 19.07 exposes option UI elements through section children. */
	if (section && Array.isArray(section.children)) {
		for (var i = 0; i < section.children.length; i++) {
			var child = section.children[i];
			if (child.option === optionName &&
			    typeof child.getUIElement === 'function')
				return child.getUIElement(sectionId);
		}
	}

	return null;
}

function triggerValidation(section, sectionId, optionNames) {
	optionNames.forEach(function(optionName) {
		var element = getSectionOptionUIElement(section, sectionId, optionName);
		if (element && typeof element.triggerValidation === 'function')
			element.triggerValidation();
	});
}

function notifyServiceSuccess(message) {
	var node = E('p', message);

	if (typeof ui.addTimeLimitedNotification === 'function')
		ui.addTimeLimitedNotification(null, node, 5000, 'info');
	else
		ui.addNotification(null, node, 'info');
}

function revalidate(section, optionNames) {
	return function(ev, sectionId) {
		triggerValidation(section, sectionId, optionNames);
	};
}

function sleep(milliseconds) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, milliseconds);
	});
}

return view.extend({
	getServiceStatus: function() {
		return L.resolveDefault(
			fs.exec('/etc/init.d/fakesip', [ 'status' ]), null
		).then(parseServiceStatus);
	},

	load: function() {
		return this.getServiceStatus();
	},

	statusLabel: function(state) {
		if (state === STATUS_RUNNING)
			return { text: _('Running'), cssClass: 'label success' };
		if (state === STATUS_STOPPED)
			return { text: _('Stopped'), cssClass: 'label' };
		return { text: _('Unknown'), cssClass: 'label warning' };
	},

	updateServiceStatus: function(status) {
		var label;

		this.serviceStatus = status || { state: STATUS_UNKNOWN, output: '' };
		if (!this.statusNode)
			return;

		label = this.serviceBusy
			? { text: _('Working...'), cssClass: 'label notice' }
			: this.statusLabel(this.serviceStatus.state);
		this.statusNode.className = label.cssClass;
		this.statusNode.textContent = label.text;

		if (this.actionButtons) {
			var locked = this.serviceBusy || this.serviceReadonly;
			this.actionButtons.start.disabled = locked ||
				this.serviceStatus.state === STATUS_RUNNING;
			this.actionButtons.stop.disabled = locked ||
				this.serviceStatus.state === STATUS_STOPPED;
			this.actionButtons.restart.disabled = locked ||
				this.serviceStatus.state !== STATUS_RUNNING;
		}
	},

	refreshServiceStatus: function() {
		if (this.serviceBusy)
			return Promise.resolve(this.serviceStatus);

		return this.getServiceStatus().then(L.bind(function(status) {
			this.updateServiceStatus(status);
			return status;
		}, this));
	},

	waitForServiceState: function(targetState, attempts) {
		return this.getServiceStatus().then(L.bind(function(status) {
			this.serviceStatus = status;
			if (status.state === targetState || attempts <= 1)
				return status;

			return sleep(500).then(L.bind(function() {
				return this.waitForServiceState(targetState, attempts - 1);
			}, this));
		}, this));
	},

	serviceCommand: function(action) {
		var targetState = action === 'stop' ? STATUS_STOPPED : STATUS_RUNNING;

		if (this.serviceBusy || this.serviceReadonly)
			return Promise.resolve();

		this.serviceBusy = true;
		this.updateServiceStatus(this.serviceStatus);

		return fs.exec('/etc/init.d/fakesip', [ action ]).then(L.bind(function(result) {
			if (!result || result.code !== 0)
				throw new Error(result && (result.stderr || result.stdout) ||
					_('Service command failed.'));

			return this.waitForServiceState(targetState, 8);
		}, this)).then(L.bind(function(status) {
			if (status.state !== targetState) {
				if (status.state === STATUS_UNKNOWN)
					throw new Error(_('The service state could not be verified.'));
				throw new Error(targetState === STATUS_RUNNING
					? _('FakeSIP did not start.')
					: _('FakeSIP did not stop.'));
			}

			notifyServiceSuccess(targetState === STATUS_RUNNING
				? _('FakeSIP is running.')
				: _('FakeSIP is stopped.'));
		}, this)).catch(function(error) {
			ui.addNotification(null,
				E('p', _('Service command failed: %s').format(error.message)),
				'danger');
		}).finally(L.bind(function() {
			this.serviceBusy = false;
			return this.refreshServiceStatus();
		}, this));
	},

	actionButton: function(label, title, action, cssClass) {
		var button = E('button', {
			'type': 'button',
			'class': 'btn cbi-button %s'.format(cssClass),
			'data-action': action,
			'aria-label': title,
			'title': title,
			'click': L.bind(function(ev) {
				ev.preventDefault();
				return this.serviceCommand(action);
			}, this)
		}, label);

		this.actionButtons[action] = button;
		return button;
	},

	renderStatusPanel: function(status) {
		this.actionButtons = {};
		this.statusNode = E('span', {
			'class': 'label',
			'aria-live': 'polite'
		});

		var panel = E('div', { 'class': 'cbi-section' }, [
			E('h3', _('Service')),
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('Status')),
					E('div', { 'class': 'cbi-value-field' }, this.statusNode)
				]),
				E('div', {
					'id': 'fakesip_service_buttons',
					'class': 'cbi-page-actions'
				}, [
					this.actionButton(_('Start'), _('Start FakeSIP'),
						'start', 'cbi-button-positive important'),
					' ',
					this.actionButton(_('Restart'), _('Restart FakeSIP'),
						'restart', 'cbi-button-apply'),
					' ',
					this.actionButton(_('Stop'), _('Stop FakeSIP'),
						'stop', 'cbi-button-negative important')
				])
			])
		]);

		this.updateServiceStatus(status);
		return panel;
	},

		render: function(status) {
		var m, mapReset, s, o;
		var enabledOption, modeOption, networkOption, interfaceOption, allInterfacesOption;
		var outboundOption, inboundOption, ipv4Option, ipv6Option;
		var markOption, maskOption, dynamicOption, noHopOption;
		var profileOption, sipUriOption;

		m = new form.Map('fakesip');
		mapReset = m.reset.bind(m);
		m.reset = function() {
			return mapReset().then(function(result) {
				ui.hideTooltip({ target: null, relatedTarget: null });
				return result;
			});
		};

		s = m.section(form.NamedSection, 'main', 'fakesip', _('Configuration'));

		s.tab('basic', _('Basic'));
		s.tab('traffic', _('Traffic'));
		s.tab('advanced', _('Advanced'));
		s.tab('payload', _('Payload'));

		enabledOption = s.taboption('basic', form.Flag, 'enabled', _('Enabled'));
		enabledOption.default = '0';
		enabledOption.validate = validateEnabledTargets;

		allInterfacesOption = s.taboption('basic', form.Flag, 'all_interfaces', _('All interfaces'));
		allInterfacesOption.default = '0';
		allInterfacesOption.onchange = revalidate(s, [ 'enabled' ]);

		modeOption = s.taboption('basic', form.ListValue, 'interface_mode', _('WAN selection method'));
		modeOption.value('network', _('OpenWrt networks (recommended)'));
		modeOption.value('device', _('Linux devices (advanced)'));
		modeOption.value('auto', _('Legacy combined'));
		modeOption.default = 'network';
		modeOption.rmempty = false;
		modeOption.description = _('OpenWrt networks resolve to their active PPPoE devices automatically.');
		modeOption.depends('all_interfaces', '0');
		modeOption.cfgvalue = function(sectionId) {
			return effectiveInterfaceMode(
				this.map.data.get('fakesip', sectionId, 'interface_mode'),
				this.map.data.get('fakesip', sectionId, 'network'),
				this.map.data.get('fakesip', sectionId, 'interface'));
		};
		modeOption.onchange = revalidate(s, [ 'enabled' ]);

		networkOption = s.taboption('basic', widgets.NetworkSelect, 'network', _('WAN networks'));
		networkOption.multiple = true;
		networkOption.nocreate = true;
		networkOption.rmempty = true;
		networkOption.retain = true;
		networkOption.description = _('IPv6 companion networks that share the same PPP device are included automatically.');
		networkOption.filter = function(sectionId, value) {
			var configured = asList(this.map.data.get('fakesip', sectionId, 'network'));

			return configured.indexOf(value) >= 0 ||
				!isRedundantIpv6Network(this.networks, value);
		};
		networkOption.depends({ all_interfaces: '0', interface_mode: 'network' });
		networkOption.depends({ all_interfaces: '0', interface_mode: 'auto' });
		networkOption.onchange = revalidate(s, [ 'enabled' ]);

		interfaceOption = s.taboption('basic', widgets.DeviceSelect, 'interface', _('Linux devices'));
		interfaceOption.multiple = true;
		interfaceOption.noaliases = true;
		interfaceOption.nocreate = false;
		interfaceOption.rmempty = true;
		interfaceOption.retain = true;
		interfaceOption.description = _('Use direct device names only for unusual or legacy configurations.');
		interfaceOption.depends({ all_interfaces: '0', interface_mode: 'device' });
		interfaceOption.depends({ all_interfaces: '0', interface_mode: 'auto' });
		interfaceOption.validate = validateInterfaceList;
		interfaceOption.onchange = revalidate(s, [ 'enabled' ]);

		outboundOption = s.taboption('traffic', form.Flag, 'outbound', _('Outbound traffic'));
		outboundOption.default = '1';
		outboundOption.onchange = revalidate(s, [ 'inbound' ]);

		inboundOption = s.taboption('traffic', form.Flag, 'inbound', _('Inbound traffic'));
		inboundOption.default = '0';
		inboundOption.validate = function(sectionId, value) {
			return validateRequiredPair.call(this, sectionId, value, 'outbound',
				_('Enable inbound or outbound traffic.'));
		};

		ipv4Option = s.taboption('traffic', form.Flag, 'ipv4', _('IPv4'));
		ipv4Option.default = '1';
		ipv4Option.onchange = revalidate(s, [ 'ipv6' ]);

		ipv6Option = s.taboption('traffic', form.Flag, 'ipv6', _('IPv6'));
		ipv6Option.default = '1';
		ipv6Option.validate = function(sectionId, value) {
			return validateRequiredPair.call(this, sectionId, value, 'ipv4',
				_('Enable IPv4 or IPv6.'));
		};

		o = s.taboption('advanced', form.Value, 'queue_num', _('NFQUEUE number'));
		o.datatype = 'range(1,65535)';
		o.default = '513';
		o.rmempty = false;

		markOption = s.taboption('advanced', form.Value, 'fwmark', _('Firewall mark'));
		markOption.default = '0x10000';
		markOption.rmempty = false;
		markOption.validate = validateUint32;
		markOption.onchange = revalidate(s, [ 'fwmask' ]);

		maskOption = s.taboption('advanced', form.Value, 'fwmask', _('Firewall mark mask'));
		maskOption.default = '0x10000';
		maskOption.rmempty = false;
		maskOption.validate = validateFirewallMask;

		o = s.taboption('advanced', form.Value, 'repeat', _('Fake packet repeats'));
		o.datatype = 'range(1,10)';
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'ttl', _('Fake packet TTL'));
		o.datatype = 'range(1,255)';
		o.default = '3';
		o.rmempty = false;

		dynamicOption = s.taboption('advanced', form.Value, 'dynamic_pct', _('Dynamic TTL percent'));
		dynamicOption.datatype = 'range(0,99)';
		dynamicOption.default = '0';
		dynamicOption.rmempty = false;
		dynamicOption.onchange = revalidate(s, [ 'no_hop_estimate' ]);

		noHopOption = s.taboption('advanced', form.Flag, 'no_hop_estimate', _('Disable hop estimation'));
		noHopOption.default = '0';
		noHopOption.validate = validateHopSettings;

		o = s.taboption('advanced', form.Flag, 'skip_firewall', _('Skip firewall rules'));
		o.default = '0';

		o = s.taboption('advanced', form.Flag, 'use_iptables', _('Use iptables instead of nft'));
		o.default = '0';

		o = s.taboption('advanced', form.Flag, 'silent', _('Silent mode'));
		o.default = '1';

		o = s.taboption('advanced', form.Value, 'log_file', _('Log file'));
		o.placeholder = '/tmp/fakesip.log';
		o.rmempty = true;
		o.validate = validateAbsolutePath;

		profileOption = s.taboption('payload', form.ListValue, 'sip_profile', _('SIP camouflage profile'));
		profileOption.value('standard', _('Standard SIP'));
		profileOption.value('china_mobile', _('China Mobile IMS'));
		profileOption.value('china_unicom', _('China Unicom IMS'));
		profileOption.value('china_telecom', _('China Telecom IMS'));
		profileOption.value('china_all', _('Rotate Chinese carrier IMS'));
		profileOption.value('china_sip_observed', _('Rotate observed SIP/RCS 5260 (experimental)'));
		profileOption.value('custom', _('Custom SIP URI'));
		profileOption.default = 'china_all';
		profileOption.validate = validateSipProfile;

		sipUriOption = s.taboption('payload', form.DynamicList, 'sip_uri', _('SIP URI'));
		sipUriOption.placeholder = 'sip:10086@example.com';
		sipUriOption.rmempty = true;
		sipUriOption.retain = true;
		sipUriOption.depends('sip_profile', 'custom');
		sipUriOption.validate = validateSipUri;
		sipUriOption.onchange = revalidate(s, [ 'sip_profile' ]);

		o = s.taboption('payload', form.DynamicList, 'payload_file', _('Payload file'));
		o.placeholder = '/etc/fakesip/payload.bin';
		o.rmempty = true;
		o.validate = validateAbsolutePath;

		return m.render().then(L.bind(function(node) {
			this.serviceReadonly = !!m.readonly;
			this.serviceBusy = false;

			this.statusPoll = L.bind(this.refreshServiceStatus, this);
			poll.add(this.statusPoll, 5);
			return E('div', {}, [
				E('h2', { 'name': 'content' }, _('FakeSIP')),
				E('div', { 'class': 'cbi-map-descr' },
					_('Disguise UDP traffic as SIP protocol traffic using Netfilter Queue.')),
				this.renderStatusPanel(status),
				node
			]);
		}, this));
	}
});
