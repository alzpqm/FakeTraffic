'use strict';

const fs = require('fs');

const viewPath = process.argv[2];
const aclPath = process.argv[3];

if (!viewPath || !aclPath)
	throw new Error('usage: test_luci_fakesip.js VIEW_PATH ACL_PATH');

const source = fs.readFileSync(viewPath, 'utf8');
const helperStart = source.indexOf('var STATUS_RUNNING');
const helperEnd = source.indexOf('\nreturn view.extend', helperStart);

if (helperStart < 0 || helperEnd < 0)
	throw new Error('could not locate LuCI helper functions');

const translate = function(value) { return value; };
const helpers = Function('_', source.slice(helperStart, helperEnd) + '\n' +
	'return {' +
		'STATUS_RUNNING: STATUS_RUNNING,' +
		'STATUS_STOPPED: STATUS_STOPPED,' +
		'STATUS_UNKNOWN: STATUS_UNKNOWN,' +
		'effectiveInterfaceMode: effectiveInterfaceMode,' +
		'networkL3DeviceName: networkL3DeviceName,' +
		'isRedundantIpv6Network: isRedundantIpv6Network,' +
		'utf8ByteLength: utf8ByteLength,' +
		'parseServiceStatus: parseServiceStatus,' +
		'parseUint32: parseUint32,' +
		'validateFirewallMask: validateFirewallMask,' +
		'validateEnabledTargets: validateEnabledTargets,' +
		'validateRequiredPair: validateRequiredPair,' +
		'validateInterfaceList: validateInterfaceList,' +
		'validateSipUri: validateSipUri,' +
		'validateSipProfile: validateSipProfile,' +
		'validateAbsolutePath: validateAbsolutePath,' +
		'validateHopSettings: validateHopSettings,' +
		'getSectionOptionUIElement: getSectionOptionUIElement' +
	'};')(translate);
const {
	STATUS_RUNNING,
	STATUS_STOPPED,
	STATUS_UNKNOWN,
	effectiveInterfaceMode,
	networkL3DeviceName,
	isRedundantIpv6Network,
	utf8ByteLength,
	parseServiceStatus,
	parseUint32,
	validateFirewallMask,
	validateEnabledTargets,
	validateRequiredPair,
	validateInterfaceList,
	validateSipUri,
	validateSipProfile,
	validateAbsolutePath,
	validateHopSettings,
	getSectionOptionUIElement
} = helpers;

function assert(condition, message) {
	if (!condition)
		throw new Error(message);
}

function context(values) {
	return {
		section: {
			formvalue: function(sectionId, option) {
				return values[option];
			}
		}
	};
}

function mockNetwork(name, deviceName) {
	return {
		getName: function() { return name; },
		getL3Device: function() {
			return deviceName == null ? null : {
				getName: function() { return deviceName; }
			};
		}
	};
}

assert(parseServiceStatus({ code: 0, stdout: 'running\n' }).state === STATUS_RUNNING,
	'running status was not recognized');
assert(parseServiceStatus({ code: 3, stdout: 'inactive\n' }).state === STATUS_STOPPED,
	'inactive status was not recognized');
assert(parseServiceStatus({ code: 5, stdout: 'not running\n' }).state === STATUS_STOPPED,
	'not-running status was not recognized');
assert(parseServiceStatus({ code: 0, stdout: 'active with no instances\n' }).state === STATUS_STOPPED,
	'empty procd service was not recognized as stopped');
assert(parseServiceStatus({ code: 0, stdout: '' }).state === STATUS_UNKNOWN,
	'ambiguous status must remain unknown');

assert(effectiveInterfaceMode('network', [], [ 'pppoe-wan' ]) === 'network',
	'an explicit network mode was not preserved');
assert(effectiveInterfaceMode('device', [ 'wan' ], []) === 'device',
	'an explicit device mode was not preserved');
assert(effectiveInterfaceMode('auto', [ 'wan' ], [ 'pppoe-wan' ]) === 'auto',
	'an explicit legacy-combined mode was not preserved');
assert(effectiveInterfaceMode(undefined, [ 'wan' ], [ 'pppoe-wan' ]) === 'auto',
	'a mixed legacy configuration did not preserve combined mode');
assert(effectiveInterfaceMode(undefined, [], [ 'pppoe-wan' ]) === 'device',
	'a legacy device-only configuration did not infer device mode');
assert(effectiveInterfaceMode(undefined, [], []) === 'network',
	'an empty configuration did not default to network mode');

const sharedPppNetworks = [
	mockNetwork('wan', 'pppoe-wan'),
	mockNetwork('wan_6', 'pppoe-wan')
];
assert(networkL3DeviceName(sharedPppNetworks[0]) === 'pppoe-wan',
	'logical network L3 device was not detected');
assert(isRedundantIpv6Network(sharedPppNetworks, 'wan_6') === true,
	'an IPv6 companion sharing the parent PPP device was not collapsed');
assert(isRedundantIpv6Network(sharedPppNetworks, 'wan') === false,
	'a parent WAN network was incorrectly collapsed');
assert(isRedundantIpv6Network([
	mockNetwork('wan', 'pppoe-wan'),
	mockNetwork('wan_6', 'eth9')
], 'wan_6') === false, 'a distinct IPv6 L3 device was hidden');
assert(isRedundantIpv6Network([
	mockNetwork('custom_6', 'eth9')
], 'custom_6') === false, 'an IPv6 network without a parent was hidden');

assert(parseUint32('1') === 1, 'decimal uint32 parsing failed');
assert(parseUint32('0x10000') === 65536, 'hexadecimal uint32 parsing failed');
assert(parseUint32('010') === 10, 'leading-zero decimal parsing failed');
assert(parseUint32('018') === 18, 'decimal parsing incorrectly used octal rules');
assert(parseUint32('4294967295') === 4294967295, 'UINT32_MAX parsing failed');
assert(parseUint32('0') === null, 'zero must be rejected');
assert(parseUint32('4294967296') === null, 'uint32 overflow must be rejected');
assert(parseUint32('12junk') === null, 'trailing junk must be rejected');

assert(validateFirewallMask.call(context({ fwmark: '0x10000' }), 'main', '0x10000') === true,
	'a matching firewall mask was rejected');
assert(validateFirewallMask.call(context({ fwmark: '0x10001' }), 'main', '0x10000') !== true,
	'a firewall mark outside the mask was accepted');

assert(validateEnabledTargets.call(context({
	all_interfaces: '0', interface_mode: 'network', network: [], interface: []
}), 'main', '1') !== true, 'enabled service without targets was accepted');
assert(validateEnabledTargets.call(context({
	all_interfaces: '1', interface_mode: 'network', network: [], interface: []
}), 'main', '1') === true, 'all-interface mode was rejected');
assert(validateEnabledTargets.call(context({
	all_interfaces: '0', interface_mode: 'network', network: [ 'wan' ], interface: []
}), 'main', '1') === true, 'selected logical network was rejected');
assert(validateEnabledTargets.call(context({
	all_interfaces: '0', interface_mode: 'network', network: [], interface: [ 'pppoe-wan' ]
}), 'main', '1') !== true, 'network mode accepted only a retained Linux device');
assert(validateEnabledTargets.call(context({
	all_interfaces: '0', interface_mode: 'device', network: [ 'wan' ], interface: []
}), 'main', '1') !== true, 'device mode accepted only a retained OpenWrt network');
assert(validateEnabledTargets.call(context({
	all_interfaces: '0', interface_mode: 'device', network: [], interface: [ 'pppoe-wan' ]
}), 'main', '1') === true, 'selected Linux device was rejected');
assert(validateEnabledTargets.call(context({
	all_interfaces: '0', interface_mode: 'auto', network: [ 'wan' ], interface: [ 'pppoe-wan' ]
}), 'main', '1') === true, 'legacy combined targets were rejected');

assert(validateRequiredPair.call(context({ outbound: '0' }),
	'main', '0', 'outbound', 'missing') !== true,
	'an empty traffic direction pair was accepted');
assert(validateRequiredPair.call(context({ outbound: '1' }),
	'main', '0', 'outbound', 'missing') === true,
	'a valid traffic direction pair was rejected');

assert(validateInterfaceList('main', [ 'pppoe-wan', 'eth0.1' ]) === true,
	'common interface names were rejected');
assert(validateInterfaceList('main', 'pppoe-wan eth0.1') === true,
	'a valid LuCI multiple-device value was rejected');
assert(validateInterfaceList('main', [ 'bad interface' ]) !== true,
	'interface name containing whitespace was accepted');
assert(validateInterfaceList('main', [ 'abcdefghijklmnop' ]) !== true,
	'16-byte interface name was accepted');

assert(validateSipUri('main', 'sip:user@example.com') === true,
	'a valid SIP URI was rejected');
assert(validateSipUri('main', 'http://example.com') !== true,
	'a non-SIP URI was accepted');
assert(validateSipUri('main', 'sip:user@example.com\r\nHeader: value') !== true,
	'a SIP URI containing whitespace was accepted');
assert(validateSipUri('main', 'sip:' + 'a'.repeat(116)) === true,
	'a 120-byte SIP URI was rejected');
assert(validateSipUri('main', 'sip:' + 'a'.repeat(117)) !== true,
	'a SIP URI longer than 120 bytes was accepted');
assert(utf8ByteLength('A\u6e2c') === 4, 'UTF-8 byte counting failed');

assert(validateSipProfile.call(context({ sip_uri: [] }), 'main', 'custom') !== true,
	'an empty custom SIP profile was accepted');
assert(validateSipProfile.call(context({ sip_uri: [ 'sip:user@example.com' ] }),
	'main', 'custom') === true, 'a populated custom SIP profile was rejected');

assert(validateAbsolutePath('main', '/tmp/fakesip.log') === true,
	'an absolute path was rejected');
assert(validateAbsolutePath('main', 'tmp/fakesip.log') !== true,
	'a relative path was accepted');

assert(validateHopSettings.call(context({ dynamic_pct: '10' }), 'main', '1') !== true,
	'dynamic TTL with disabled hop estimation was accepted');
assert(validateHopSettings.call(context({ dynamic_pct: '0' }), 'main', '1') === true,
	'valid hop settings were rejected');

const legacySection = {
	children: [ {
		option: 'enabled',
		getUIElement: function() {
			return { triggerValidation: function() {} };
		}
	} ]
};
assert(getSectionOptionUIElement(legacySection, 'main', 'enabled') != null,
	'19.07 section child UI fallback was not found');

const startButton = source.indexOf("this.actionButton(_('Start')");
const restartButton = source.indexOf("this.actionButton(_('Restart')");
const stopButton = source.indexOf("this.actionButton(_('Stop')");
assert(startButton >= 0 && startButton < restartButton && restartButton < stopButton,
	'service buttons must be ordered Start, Restart, Stop');
assert(/this\.actionButton\(_\('Start'\), _\('Start FakeSIP'\),\s*'start', 'cbi-button-positive important'\)/.test(source),
	'Start button is missing the dark-mode-aware positive style');
assert(/this\.actionButton\(_\('Restart'\), _\('Restart FakeSIP'\),\s*'restart', 'cbi-button-apply'\)/.test(source),
	'Restart button does not match the FakeHTTP apply style');
assert(/this\.actionButton\(_\('Stop'\), _\('Stop FakeSIP'\),\s*'stop', 'cbi-button-negative important'\)/.test(source),
	'Stop button is missing the dark-mode-aware negative style');
assert(source.indexOf("cssClass: 'label success'") >= 0,
	'running status is missing the theme-aware success label');
assert(source.indexOf("cssClass: 'label warning'") >= 0,
	'unknown status is missing the theme-aware warning label');
assert(source.indexOf("cssClass: 'label notice'") >= 0,
	'working status is missing the theme-aware notice label');
assert(source.indexOf('ifacebadge-active') < 0,
	'status must not use the fixed black active badge border');
assert(source.indexOf("'id': 'fakesip_service_buttons'") >= 0,
	'service action group is missing its stable responsive identifier');
assert(source.indexOf("'class': 'cbi-section-node'") >= 0,
	'service panel is missing the standard LuCI section body');
assert(source.indexOf("'aria-live': 'polite'") >= 0,
	'service status changes are not announced accessibly');
assert(source.indexOf("form.ListValue, 'interface_mode'") >= 0,
	'WAN selection mode is missing from LuCI');
assert(source.indexOf("interface_mode: 'network'") >= 0,
	'OpenWrt network selection is not tied to network mode');
assert(source.indexOf("interface_mode: 'device'") >= 0,
	'Linux device selection is not tied to device mode');
assert(source.indexOf("modeOption.value('auto', _('Legacy combined'))") >= 0,
	'legacy mixed configurations cannot be represented honestly');
assert(source.indexOf("modeOption.value('network', _('OpenWrt networks (recommended)'))") >= 0,
	'OpenWrt network selection is not presented as the recommended path');
assert(source.indexOf("modeOption.value('device', _('Linux devices (advanced)'))") >= 0,
	'direct Linux device selection is not presented as advanced');
assert(source.indexOf("widgets.NetworkSelect, 'network', _('WAN networks')") >= 0,
	'OpenWrt network selector is not clearly labeled');
assert(source.indexOf('isRedundantIpv6Network(this.networks, value)') >= 0,
	'redundant IPv6 companion networks are not filtered');
assert(source.indexOf("profileOption.value('china_sip_observed'") >= 0,
	'observed carrier SIP rotation profile is missing from LuCI');
assert(source.indexOf("profileOption.default = 'china_all'") >= 0,
	'experimental SIP profiles must not replace the production default');

const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['luci-app-fakesip'];
const readCommands = Object.keys(acl.read.file || {});
const writeCommands = Object.keys(acl.write.file || {});

assert(readCommands.indexOf('/etc/init.d/fakesip status') >= 0,
	'status command must remain readable');
[ 'start', 'stop', 'restart' ].forEach(function(action) {
	const command = '/etc/init.d/fakesip ' + action;
	assert(readCommands.indexOf(command) < 0, action + ' command leaked into read ACL');
	assert(writeCommands.indexOf(command) >= 0, action + ' command is missing from write ACL');
});

if (!String.prototype.format) {
	Object.defineProperty(String.prototype, 'format', {
		value: function(value) { return this.replace('%s', value); },
		configurable: true
	});
}

function instantiateView(exec, notifications, timedNotifications) {
	const viewMock = { extend: function(definition) { return definition; } };
	const luciMock = {
		bind: function(fn, self) {
			return fn.bind.apply(fn, [ self ].concat(Array.prototype.slice.call(arguments, 2)));
		},
		resolveDefault: function(value, fallback) {
			return Promise.resolve(value).catch(function() { return fallback; });
		}
	};
	const uiMock = {
		addNotification: function(title, node, type) {
			notifications.push({ node: node, type: type });
		}
	};
	if (timedNotifications !== false)
		uiMock.addTimeLimitedNotification = function(title, node, timeout, type) {
			notifications.push({ node: node, timeout: timeout, type: type });
		};
	const elementMock = function(tag, attrs, children) {
		return { tag: tag, attrs: attrs, children: children };
	};
	const windowMock = {
		setTimeout: function(callback) { callback(); }
	};

	return Function('view', 'form', 'fs', 'ui', 'poll', 'widgets',
		'L', 'E', 'window', '_', source)(
			viewMock, {}, { exec: exec }, uiMock, { add: function() {} }, {},
			luciMock, elementMock, windowMock, translate);
}

async function testServiceActions() {
	let notifications = [];
	let actionCalls = 0;
	let statusCalls = 0;
	let instance = instantiateView(function(path, args) {
		if (args[0] === 'status') {
			statusCalls++;
			return Promise.resolve({ code: 0, stdout: 'running\n' });
		}
		actionCalls++;
		return Promise.resolve({ code: 0, stdout: '' });
	}, notifications);

	instance.serviceReadonly = false;
	instance.serviceBusy = false;
	instance.serviceStatus = { state: STATUS_STOPPED, output: '' };
	await instance.serviceCommand('start');
	assert(actionCalls === 1, 'start action was not executed exactly once');
	assert(statusCalls >= 1, 'start action did not verify service status');
	assert(notifications.some(function(item) { return item.type === 'info'; }),
		'a verified start did not report success');
	assert(!notifications.some(function(item) { return item.type === 'danger'; }),
		'a verified start reported failure');

	notifications = [];
	actionCalls = 0;
	statusCalls = 0;
	instance = instantiateView(function(path, args) {
		if (args[0] === 'status') {
			statusCalls++;
			return Promise.resolve({ code: 3, stdout: 'inactive\n' });
		}
		actionCalls++;
		return Promise.resolve({ code: 0, stdout: '' });
	}, notifications);

	instance.serviceReadonly = false;
	instance.serviceBusy = false;
	instance.serviceStatus = { state: STATUS_STOPPED, output: '' };
	await instance.serviceCommand('start');
	assert(actionCalls === 1, 'false-success start action was not executed exactly once');
	assert(statusCalls >= 8, 'false-success start did not exhaust status retries');
	assert(notifications.some(function(item) { return item.type === 'danger'; }),
		'a start without a procd instance was reported as successful');
	assert(!notifications.some(function(item) { return item.type === 'info'; }),
		'a start without a procd instance emitted a success notification');

	notifications = [];
	actionCalls = 0;
	instance = instantiateView(function(path, args) {
		if (args[0] !== 'status')
			actionCalls++;
		return Promise.resolve({ code: 0, stdout: 'running\n' });
	}, notifications);
	instance.serviceStatus = { state: STATUS_RUNNING, output: '' };
	instance.serviceReadonly = true;
	instance.serviceBusy = false;
	await instance.serviceCommand('stop');
	assert(actionCalls === 0, 'readonly service control executed a command');

	instance.serviceReadonly = false;
	instance.serviceBusy = true;
	await instance.serviceCommand('restart');
	assert(actionCalls === 0, 'busy service control executed a duplicate command');

	notifications = [];
	instance = instantiateView(function(path, args) {
		if (args[0] === 'status')
			return Promise.resolve({ code: 0, stdout: 'running\n' });
		return Promise.resolve({ code: 0, stdout: '' });
	}, notifications, false);
	instance.serviceReadonly = false;
	instance.serviceBusy = false;
	instance.serviceStatus = { state: STATUS_STOPPED, output: '' };
	await instance.serviceCommand('start');
	assert(notifications.some(function(item) { return item.type === 'info'; }),
		'legacy LuCI notification fallback did not report success');
}

testServiceActions().then(function() {
	console.log('LuCI behavior tests passed.');
}).catch(function(error) {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
