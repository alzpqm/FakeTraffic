'use strict';
'require baseclass';

function decimal(value) {
	return typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) &&
		(value.length < 20 || value <= '18446744073709551615') ? value : null;
}

// Decimal string subtraction: never round cumulative uint64 counters through JS Number.
function subtract(a, b) {
	if (decimal(a) == null || decimal(b) == null || a.length < b.length || (a.length === b.length && a < b)) return null;
	var carry = 0, result = '', j = b.length - 1;
	for (var i = a.length - 1; i >= 0; i--, j--) {
		var digit = Number(a.charAt(i)) - (j >= 0 ? Number(b.charAt(j)) : 0) - carry;
		carry = digit < 0 ? 1 : 0;
		result = String(digit + (carry ? 10 : 0)) + result;
	}
	return result.replace(/^0+(?=[0-9])/, '');
}

function observations(name) {
	return name === 'tcp' ? [ [ 'tcp_syn_seen', _('TCP SYN observations') ],
		[ 'tcp_synack_eligible', _('TCP eligible SYN-ACK observations') ] ] :
		[ [ 'udp_new_flow', _('UDP new-flow observations') ], [ 'udp_early_seen', _('UDP early-window observations') ] ];
}

function counterLines(counters, names) {
	return names.map(function(item) {
		var value = decimal(counters[item[0]]);
		return item[1] + ': ' + (value == null ? _('Unavailable') : value);
	});
}
function templateCount(value) {
	return Number.isInteger(value) && value >= 0 && value <= 16 ? String(value) : _('Unavailable');
}

return baseclass.extend({
	decimal: decimal,
	subtract: subtract,
	alerts: function(result) {
		var names = result && result.actual_backend === 'ebpf' ? [ 'ebpf' ] :
			result && result.actual_backend === 'nfqueue' ? [ 'tcp', 'udp' ] : [];
		var found = [];
		names.forEach(function(name) {
			var current = result[name];
			if (!current || current.available !== true || !current.snapshot) return;
			var counters = current.snapshot.counters || {};
			var keys = name === 'ebpf' ? [ 'clone_failed', 'builder_failed', 'map_insert_failed', 'request_expired', 'tfo_failed' ] :
				[ 'fake_send_errors_total', 'fake_send_short_total', 'verdict_errors_total' ];
			keys.forEach(function(key) {
				var value = decimal(counters[key]);
				if (value != null && value !== '0') found.push(name.toUpperCase() + ' ' + key + ': ' + value);
			});
		});
		return found.length ? _('Recorded engine errors; inspect diagnostics. These are cumulative counters, not a failure rate.') + ' ' + found.join(' · ') : '';
	},
	// Compact cards deliberately do not aggregate NFQUEUE protocols or infer delivery.
	card: function(reply, name) {
		var result = (reply || {}).diagnostics || {}, ebpf = result.actual_backend === 'ebpf';
		var observed = this.protocol(reply, name === 'ebpf' ? 'udp' : name);
		var valid = reply && !reply.failed && result.actual_backend !== 'conflict';
		var current = result[ebpf ? 'ebpf' : name], snapshot = current && current.snapshot;
		var state = observed ? observed.state : _('Unknown'), tone = 'unknown';
		if (ebpf) {
			valid = valid && observed && observed.observed === true;
			if (name === 'ebpf') valid = valid && this.protocol(reply, 'tcp').observed === true;
			if (valid) tone = snapshot[name === 'ebpf' ? 'udp_enabled' : name + '_enabled'] ? 'running' : 'disabled';
		} else {
			var instance = (((reply || {}).faketraffic || {}).instances || {})[name];
			valid = valid && result.actual_backend === 'nfqueue' && !observed && current && current.available === true &&
				snapshot && snapshot.backend === 'nfqueue' && instance && instance.running === true;
			if (valid) { state = _('Running'); tone = 'running'; }
		}
		var key = ebpf ? (name === 'tcp' ? 'tcp_syn_seen' : name === 'udp' ? 'udp_new_flow' : 'fake_submit_ok') : 'fake_send_accepted_total';
		var label = ebpf ? (name === 'tcp' ? _('TCP SYN observations') : name === 'udp' ? _('UDP new-flow observations') : _('Local clone-path accepted')) : _('Socket accepted');
		if (name === 'ebpf') { state = ebpf && valid ? _('Shared TCP/UDP') : result.actual_backend === 'nfqueue' ? _('Separate NFQUEUE counters') : _('Unknown'); tone = 'unknown'; }
		return { state: state, tone: tone, label: label,
			value: valid && snapshot && decimal((snapshot.counters || {})[key]) || '—' };
	},
	// Use observed processes/metrics, never the saved backend or unsaved form values.
	protocol: function(reply, name) {
		if (!reply || reply.failed)
			return { state: _('Unknown'), summary: _('Counters unavailable') + ' · BACKEND_STATE_UNKNOWN' };
		var instances = (reply.faketraffic || {}).instances || {}, result = reply.diagnostics || {};
		var running = instances.ebpf && instances.ebpf.running === true;
		var legacy = [ 'tcp', 'udp' ].some(function(key) { return instances[key] && instances[key].running === true; });
		if (result.actual_backend === 'conflict' ||
			((running || result.actual_backend === 'ebpf') && legacy) ||
			(running && result.actual_backend === 'nfqueue'))
			return { state: _('Unknown (backend conflict)'), summary: _('Counters unavailable') + ' · BACKEND_CONFLICT' };
		if (!running && result.actual_backend !== 'ebpf') return null;
		var current = result.ebpf || {}, snapshot = current.snapshot;
		if (!running || result.actual_backend !== 'ebpf' || current.available !== true ||
			!snapshot || snapshot.backend !== 'ebpf' || typeof snapshot[name + '_enabled'] !== 'boolean')
			return { state: _('Unknown (eBPF state incomplete)'),
				summary: _('Counters unavailable') + ' · ' + (current.reason || 'EBPF_STATE_INCOMPLETE') };
		var state = snapshot[name + '_enabled'] ? _('Running via eBPF') : _('Disabled via eBPF');
		return { state: state, observed: true, summary: [ state, _('No separate NFQUEUE process is expected.') ]
			.concat([ _('Active templates') + ': ' + templateCount(snapshot[name + '_template_count']) ])
			.concat(counterLines(snapshot.counters || {}, observations(name)))
			.concat([ _('See shared TCP/UDP eBPF counters below.'), _('Observer counts are not per-protocol delivery totals.') ]).join('\n') };
	},
	summary: function(current, previous) {
		if (!current || current.available !== true || !current.snapshot)
			return _('Counters unavailable') + ' · ' + ((current && current.reason) || 'NOT_AVAILABLE');
		var snapshot = current.snapshot, counters = snapshot.counters || {};
		var ebpf = snapshot.backend === 'ebpf';
		var names = [ [ 'queued_total', _('Queued') ], [ 'fake_send_attempts_total', _('Fake send attempts') ],
			[ 'fake_send_accepted_total', _('Socket accepted') ], [ 'fake_send_errors_total', _('Send errors') ],
			[ 'fake_send_short_total', _('Short sends') ], [ 'verdict_errors_total', _('Verdict errors') ],
			[ 'skip_direction_total', _('Direction skips') ], [ 'skip_hop_total', _('Hop-limit skips') ] ];
		if (ebpf) names = [ [ 'fake_attempt', _('Clone attempts') ], [ 'fake_submit_ok', _('Local clone-path accepted') ],
			[ 'clone_failed', _('Clone errors') ], [ 'builder_failed', _('Builder errors') ],
			[ 'rate_limited', _('Rate limited') ], [ 'skip_gso', _('GSO skips (overlap possible)') ],
			[ 'skip_layout', _('Layout skips (overlap possible)') ], [ 'request_expired', _('Request expired') ] ];
		var lines = counterLines(counters, names);
		var rate = null;
		if (previous && previous.available === true && previous.snapshot && current.instance === previous.instance &&
			snapshot.backend === previous.snapshot.backend &&
			!snapshot.saturated && !previous.snapshot.saturated) {
			var now = decimal(snapshot.sample_mono_ms), before = decimal(previous.snapshot.sample_mono_ms);
			var elapsed = now && before && subtract(now, before);
			var acceptedKey = ebpf ? 'fake_submit_ok' : 'fake_send_accepted_total';
			var delta = subtract(counters[acceptedKey], (previous.snapshot.counters || {})[acceptedKey]);
			if (elapsed && elapsed !== '0' && elapsed.length < 16 && delta != null &&
				(delta.length < 16 || (delta.length === 16 && delta <= '9007199254740991')))
				rate = (Number(delta) / Number(elapsed) * 1000).toFixed(2);
		}
		lines.push(_('Accepted per second') + ': ' + (rate == null ? '—' : rate));
		if (snapshot.saturated) lines.push(_('Counter saturated; rates unavailable'));
		if (current.queue && current.queue.available) lines.push(_('Queue backlog / kernel drops / user drops') + ': ' +
			[ current.queue.backlog, current.queue.kernel_drops, current.queue.user_drops ].map(function(v) { return decimal(v) || '—'; }).join(' / '));
		lines.push(_('Counters may overlap; do not sum them as a failure rate.'));
		if (ebpf) lines.push(_('Injection totals and acceptance rates are shared across TCP/UDP, not per-protocol delivery totals.'));
		return lines.join('\n');
	},
	backend: function(result) {
		if (!result || !result.configured_backend || !result.actual_backend) return _('Backend state unavailable');
		return _('Saved backend') + ': ' + result.configured_backend + ' · ' + _('Observed backend') + ': ' + result.actual_backend +
			(result.backend_mismatch === true ? ' · ' + _('Warning: saved and running backends differ; settings may not be applied.') : '') +
			(result.recovery_required === true ? ' · ' + _('Recovery checkpoint present; manual ownership review required. Do not delete it blindly.') : '') +
			' · ' + _('Sampled state; not an atomic or continuous health guarantee.');
	},
	preflight: function(result) {
		if (!result || result.schema_version !== 1) return _('Preflight unavailable');
		return _('Saved configuration only; BPF load/attach is not tested.') + '\n' +
			_('May attempt experimental backend') + ': ' + (result.can_attempt === true ? _('Yes') : _('No')) + '\n' +
			_('Saved TCP / UDP templates (limit 16 each)') + ': ' + templateCount(result.tcp_template_count) + ' / ' + templateCount(result.udp_template_count) + '\n' +
			_('Blockers') + ': ' + (Array.isArray(result.errors) && result.errors.length ? result.errors.join(', ') : '—') + '\n' +
			_('Warnings') + ': ' + (Array.isArray(result.warnings) ? result.warnings.join(', ') : '—');
	}
});
