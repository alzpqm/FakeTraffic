'use strict';
'require view';
'require form';
'require rpc';
'require fs';
'require ui';
'require poll';
'require faketraffic.tcp as tcp';
'require faketraffic.udp as udp';
'require faketraffic.diagnostics as diagnostics';

var listService = rpc.declare({ object: 'service', method: 'list', params: [ 'name' ], expect: { '': {} } });
var readStatus = rpc.declare({ object: 'faketraffic', method: 'status', expect: { '': {} } });
var readPreflight = rpc.declare({ object: 'faketraffic', method: 'preflight', expect: { '': {} } });

function engineState(reply, name) {
	var observed = diagnostics.protocol(reply, name);
	if (observed) return observed.state;
	var instance = ((reply.faketraffic || {}).instances || {})[name];
	return instance && instance.running === true ? _('Running') : _('Stopped');
}

return view.extend({
	load: function() {
		return Promise.all([
			listService('faketraffic').catch(function() { return { failed: true }; }),
			readStatus().catch(function() { return {}; })
		]).then(function(results) { results[0].diagnostics = results[1]; return results[0]; });
	},

	checkPreflight: function() {
		return readPreflight().then(L.bind(function(result) {
			this.preflightNode.textContent = diagnostics.preflight(result);
			var blocked = result && Array.isArray(result.errors) && result.errors.length > 0;
			this.preflightWarning.textContent = blocked ? _('Saved settings are blocked; the running service has not been changed.') + ' ' + result.errors.join(', ') :
				_('Saved settings only. A successful preflight does not prove BPF load/attach or apply unsaved edits.');
			if (blocked && result.errors.some(function(code) { return /^(TCP|UDP)_TEMPLATE_(LIMIT_EXCEEDED|REQUIRED)$/.test(code); }))
				this.preflightWarning.textContent += ' ' + _('eBPF supports 1–16 templates per enabled protocol. Adjust the list or select NFQUEUE before applying.');
			this.preflightWarning.setAttribute('class', 'ft-notice' + (blocked ? ' ft-notice-warning' : ''));
		}, this)).catch(L.bind(function() {
			this.preflightNode.textContent = _('Preflight unavailable');
			this.preflightWarning.textContent = _('Preflight unavailable');
			this.preflightWarning.setAttribute('class', 'ft-notice ft-notice-warning');
		}, this));
	},

	showCounters: function(reply) {
		this.backendNode.textContent = diagnostics.backend(reply.diagnostics);
		[ 'tcp', 'udp', 'ebpf' ].forEach(L.bind(function(name) {
			var current = (reply.diagnostics || {})[name];
			var observed = name !== 'ebpf' && diagnostics.protocol(reply, name);
			this.counterNodes[name].textContent = observed ? observed.summary : diagnostics.summary(current, this.previousCounters[name]);
			this.previousCounters[name] = !observed && current && current.available === true ? current : null;
			var card = diagnostics.card(reply, name);
			this.metricNodes[name].textContent = card.value;
			this.metricLabels[name].textContent = card.label;
			this.cardStates[name].textContent = card.state;
			this.cardStates[name].setAttribute('class', 'ft-status ft-status-' + card.tone);
		}, this));
		var result = reply.diagnostics || {};
		this.errorWarning.textContent = diagnostics.alerts(result);
		this.errorWarning.hidden = !this.errorWarning.textContent;
		this.backendNode.setAttribute('class', 'ft-notice' +
			(result.backend_mismatch === true || result.recovery_required === true || result.actual_backend === 'conflict' ? ' ft-notice-warning' : ''));
	},

	refresh: function() {
		return this.load().then(L.bind(function(reply) {
			[ 'tcp', 'udp' ].forEach(L.bind(function(name) {
				this.statusNodes[name].textContent = name.toUpperCase() + ' · ' + engineState(reply, name);
			}, this));
			this.showCounters(reply);
			return reply;
		}, this));
	},

	command: function(action) {
		if (this.busy || this.map.readonly || [ 'start', 'restart', 'stop' ].indexOf(action) < 0)
			return Promise.resolve();
		this.busy = true;
		this.buttons.forEach(function(button) { button.disabled = true; });
		return fs.exec('/etc/init.d/faketraffic', [ action ]).then(function(result) {
			if (!result || result.code !== 0) throw new Error((result && result.stderr) || _('Service command failed'));
			ui.addNotification(null, E('p', {}, _('Command submitted. Check actual TCP/UDP states below; unsaved settings are not applied.')), 'info');
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, error.message), 'error');
		}).finally(L.bind(function() {
			this.busy = false;
			this.buttons.forEach(L.bind(function(button) { button.disabled = !!this.map.readonly; }, this));
			return this.refresh();
		}, this));
	},

	render: function(reply) {
		var m = this.map = new form.Map('faketraffic', _('Configuration'),
			_('Configure TCP and UDP here. One service, one configuration and one Save & Apply. Packet engines remain independent internal components.'));
		var backend = m.section(form.NamedSection, 'globals', 'globals', _('Processing backend'));
		var option = backend.option(form.ListValue, 'backend', _('Backend'));
		option.value('nfqueue', _('NFQUEUE (current stable path)'));
		option.value('ebpf', _('eBPF (experimental; requires successful preflight)'));
		option.default = 'nfqueue'; option.rmempty = false;
		option = backend.option(form.Flag, 'accept_ebpf_semantics', _('Accept native eBPF semantics'));
		option.default = '0'; option.depends('backend', 'ebpf'); option.rmempty = false;
		option.description = _('Explicitly accepts changed UDP trigger/window, native loop isolation instead of default NFQUEUE marks, and generated templates. Custom bypass policy and unsupported settings remain blocked.');
		option = backend.option(form.ListValue, 'udp_trigger', _('eBPF UDP trigger'));
		option.value('egress', _('Egress')); option.value('both', _('Both, after prior egress'));
		option.default = 'egress'; option.depends('backend', 'ebpf'); option.rmempty = false;
		option = backend.option(form.ListValue, 'ebpf_interface_mode', _('eBPF interface mode'));
		option.value('l3', _('Logical PPP / L3 TUN')); option.value('ethernet', _('Ethernet')); option.value('pppoe', _('Physical PPPoE'));
		option.default = 'l3'; option.depends('backend', 'ebpf'); option.rmempty = false;
		tcp.addFields(m);
		udp.addFields(m);
		var reset = m.reset.bind(m);
		m.reset = function() {
			return reset().then(function(result) {
				ui.hideTooltip({ target: null, relatedTarget: null });
				return result;
			});
		};
		var parse = m.parse.bind(m);
		m.parse = function() {
			function value(section, option) {
				var field = m.lookupOption(option, section)[0];
				return field && field.formvalue(section);
			}
			var tq = value('advanced', 'queue_number'), uq = value('main', 'queue_num');
			if (value('globals', 'enabled') === '1' && value('advanced', 'disable_estimation') === '1' &&
				Number(value('advanced', 'pct')) > 0)
				return Promise.reject(new Error(_('Disable dynamic TTL before disabling hop estimation.')));
			if (value('globals', 'backend') !== 'ebpf' && value('globals', 'enabled') === '1' && value('main', 'enabled') === '1' &&
				Number(tq == null || tq === '' || tq === '-1' ? 512 : tq) === Number(uq))
				return Promise.reject(new Error(_('TCP and UDP must use different NFQUEUE numbers.')));
			return parse();
		};
		return m.render().then(L.bind(function(node) {
			this.busy = false;
			this.statusNodes = {};
			this.counterNodes = {};
			this.metricNodes = {};
			this.metricLabels = {};
			this.cardStates = {};
			this.previousCounters = {};
			this.buttons = [];
			var states = [ 'tcp', 'udp' ].map(L.bind(function(name) {
				return this.statusNodes[name] = E('span', { 'class': 'ft-protocol-label' }, name.toUpperCase() + ' · ' + engineState(reply, name));
			}, this));
			var buttons = [ [ 'start', _('Start') ], [ 'restart', _('Restart') ], [ 'stop', _('Stop') ] ].map(L.bind(function(item) {
				var button = E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-action ft-action ft-action-' + item[0],
					'click': L.bind(function() { return this.command(item[0]); }, this) }, item[1]);
				// HTML boolean attributes remain true even when their string is "false".
				button.disabled = !!m.readonly;
				this.buttons.push(button);
				return button;
			}, this));
			var counters = [ 'tcp', 'udp', 'ebpf' ].map(L.bind(function(name) {
				var title = name === 'tcp' ? _('TCP camouflage') : name === 'udp' ? _('UDP / SIP camouflage') : _('Injection activity');
				return E('section', { 'class': 'ft-card' }, [
					E('div', { 'class': 'ft-card-top' }, [ E('h3', {}, title),
						this.cardStates[name] = E('span', { 'class': 'ft-status' }, '') ]),
					this.metricNodes[name] = E('div', { 'class': 'ft-metric' }, '—'),
					this.metricLabels[name] = E('div', { 'class': 'ft-metric-label' }, ''),
					E('details', { 'class': 'ft-details' }, [
						E('summary', {}, name === 'ebpf' ? _('eBPF shared TCP/UDP counters') : _('Protocol diagnostics')),
						this.counterNodes[name] = E('pre', { 'class': 'ft-counter-text' }, '')
					])
				]);
			}, this));
			this.preflightNode = E('pre', {}, _('Preflight has not been requested.'));
			this.preflightWarning = E('p', { 'class': 'ft-notice' }, _('Preflight has not been requested.'));
			this.backendNode = E('p', { 'class': 'ft-notice' }, '');
			this.errorWarning = E('p', { 'class': 'ft-notice ft-notice-warning' }, '');
			var preflightButton = E('button', { 'type': 'button', 'class': 'cbi-button',
				'click': L.bind(this.checkPreflight, this) }, _('Read-only compatibility preflight'));
			this.showCounters(reply);
			poll.add(L.bind(this.refresh, this), 5);
			var dashboard = E('div', { 'class': 'ft-app' }, [
				E('link', { 'rel': 'stylesheet', 'href': L.resource('faketraffic/dashboard.css') }),
				E('section', { 'class': 'ft-overview' }, [
					E('div', { 'class': 'ft-toolbar' }, [ E('div', {}, [
						E('p', { 'class': 'ft-eyebrow' }, _('Runtime overview')),
						E('h2', { 'class': 'ft-title' }, 'FakeTraffic'),
						E('p', { 'class': 'ft-subtitle' }, _('One service. TCP and UDP/SIP, together.'))
					]), E('div', { 'class': 'ft-actions', 'role': 'group', 'aria-label': _('FakeTraffic service') }, buttons) ]),
					E('div', { 'class': 'ft-protocols' }, states),
					E('p', { 'class': 'ft-sampling' }, _('Live samples every 5 seconds; not a continuous health guarantee.')),
					this.backendNode, this.errorWarning, E('div', { 'class': 'ft-grid' }, counters),
					E('p', { 'class': 'ft-footnote' }, _('Socket acceptance is local only; it does not prove remote delivery or DPI effectiveness. Counters reset with each engine instance.')),
					E('p', { 'class': 'ft-footnote' }, _('TCP payload selection does not disable UDP/SIP. The selected backend handles both enabled protocols.'))
				]),
				E('section', { 'class': 'ft-preflight' }, [
					E('div', { 'class': 'ft-toolbar' }, [ E('h3', {}, _('Compatibility preflight')), preflightButton ]),
					this.preflightWarning,
					E('details', { 'class': 'ft-details' }, [ E('summary', {}, _('Preflight details')),
						E('p', {}, _('Checks saved settings only, not unsaved form values. No BPF attach or network changes are performed.')), this.preflightNode ])
				]), node
			]);
			// One read-only saved-config check per render, never per poll or form edit.
			return this.checkPreflight().then(function() { return dashboard; });
		}, this));
	}
});
