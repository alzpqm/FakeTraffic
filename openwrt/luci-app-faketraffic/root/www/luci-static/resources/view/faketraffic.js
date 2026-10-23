'use strict';
'require view';
'require rpc';

var listService = rpc.declare({
	object: 'service', method: 'list', params: [ 'name' ], expect: { '': {} }
});

function state(reply, name) {
	if (!reply || reply.failed) return '狀態查詢失敗 / Status unavailable';
	var instances = (reply[name] || {}).instances || {};
	return Object.keys(instances).some(function(key) { return instances[key].running === true; })
		? '執行中 / Running' : '未執行 / Not running';
}

return view.extend({
	load: function() {
		return Promise.all([ 'fakehttp', 'fakesip' ].map(function(name) {
			return listService(name).catch(function() { return { failed: true }; });
		}));
	},
	render: function(data) {
		var engines = [
			{ name: 'fakehttp', title: 'TCP — FakeHTTP', detail: 'HTTP / TLS 偽裝', page: 'fakehttp' },
			{ name: 'fakesip', title: 'UDP — FakeSIP', detail: 'SIP profiles / 自訂載荷', page: 'fakesip' }
		];
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ 'FakeTraffic' ]),
			E('p', {}, [ 'TCP 與 UDP 統一管理入口。保留各引擎原設定與獨立服務；此頁只讀取狀態，不套用設定。' ]),
			E('p', {}, [ '狀態為載入頁面時的快照；重新整理可更新。' ]),
			E('div', { 'class': 'cbi-section' }, engines.map(function(engine, i) {
				return E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, [ engine.title ]),
					E('p', {}, [ engine.detail + ' · ' + state(data[i], engine.name) ]),
					E('a', { 'class': 'cbi-button cbi-button-action',
						href: L.url('admin', 'services', engine.page) }, [ '開啟設定 / Configure' ])
				]);
			})),
			E('p', {}, [ 'FakeTraffic 0.1.0 · 維護整合版，保留兩個 NFQUEUE 引擎。' ])
		]);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
