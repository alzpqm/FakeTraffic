'use strict';
'require view';
'require form';
'require rpc';
'require fs';
'require ui';
'require poll';
'require faketraffic.tcp as tcp';
'require faketraffic.udp as udp';

var listService = rpc.declare({ object: 'service', method: 'list', params: [ 'name' ], expect: { '': {} } });

function engineState(reply, name) {
	if (!reply || reply.failed) return _('Unknown');
	var instance = ((reply.faketraffic || {}).instances || {})[name];
	return instance && instance.running === true ? _('Running') : _('Stopped');
}

return view.extend({
	load: function() { return listService('faketraffic').catch(function() { return { failed: true }; }); },

	refresh: function() {
		return this.load().then(L.bind(function(reply) {
			[ 'tcp', 'udp' ].forEach(L.bind(function(name) {
				this.statusNodes[name].textContent = name.toUpperCase() + ' · ' + engineState(reply, name);
			}, this));
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
		var m = this.map = new form.Map('faketraffic', 'FakeTraffic',
			_('Configure TCP and UDP here. One service, one configuration and one Save & Apply. Packet engines remain independent internal components.'));
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
			if (value('globals', 'enabled') === '1' && value('main', 'enabled') === '1' &&
				Number(tq == null || tq === '' || tq === '-1' ? 512 : tq) === Number(uq))
				return Promise.reject(new Error(_('TCP and UDP must use different NFQUEUE numbers.')));
			return parse();
		};
		return m.render().then(L.bind(function(node) {
			this.busy = false;
			this.statusNodes = {};
			this.buttons = [];
			var states = [ 'tcp', 'udp' ].map(L.bind(function(name) {
				return this.statusNodes[name] = E('span', { 'class': 'label' }, name.toUpperCase() + ' · ' + engineState(reply, name));
			}, this));
			var buttons = [ [ 'start', _('Start') ], [ 'restart', _('Restart') ], [ 'stop', _('Stop') ] ].map(L.bind(function(item) {
				var button = E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-action',
					'disabled': !!m.readonly, 'click': L.bind(function() { return this.command(item[0]); }, this) }, item[1]);
				this.buttons.push(button);
				return button;
			}, this));
			poll.add(L.bind(this.refresh, this), 5);
			return E('div', {}, [ E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('FakeTraffic service')), E('p', {}, states), E('div', {}, buttons)
			]), node ]);
		}, this));
	}
});
