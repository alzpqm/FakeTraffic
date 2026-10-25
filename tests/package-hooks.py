#!/usr/bin/env python3
"""Exercise removal hooks against real jsonfilter, fake procd and private files.

No installed service/package is changed. Run on OpenWrt or set FT_JSONFILTER to
the lab's real jsonfilter. Missing tools are reported as skips, never passes.
"""
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
JSONFILTER = os.environ.get('FT_JSONFILTER') or shutil.which('jsonfilter')


class Hooks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='faketraffic-hooks-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=str(self.bin) + ':' + os.environ['PATH'],
                        FT_TEST=str(self.root), FT_BEFORE='{}', FT_AFTER='{}',
                        FT_EXE='/usr/libexec/faketraffic/ebpf', FT_STOP='0', FT_BUS='0',
                        IPKG_INSTROOT='')
        self.write('bin/ubus', '#!/bin/sh\n[ "$FT_BUS" = 0 ] || exit 1\n'
                   'if [ -e "$FT_TEST/stopped" ]; then printf "%s" "$FT_AFTER"; '
                   'else printf "%s" "$FT_BEFORE"; fi\n')
        self.write('bin/readlink', '#!/bin/sh\nprintf "%s" "$FT_EXE"\n')
        self.write('bin/sleep', '#!/bin/sh\nexit 0\n')
        self.init = self.write('init', '#!/bin/sh\nprintf "%s\\n" "$1" >> "$FT_TEST/actions"\n'
                              'if [ "$1" = stop ]; then touch "$FT_TEST/stopped"; exit "$FT_STOP"; fi\n')
        if JSONFILTER:
            os.symlink(JSONFILTER, self.bin / 'jsonfilter')

    def write(self, name, text):
        path = self.root / name
        path.write_text(text)
        path.chmod(0o755)
        return path

    def run_hook(self, path, **environment):
        source = path.read_text().replace('/etc/init.d/faketraffic', str(self.init))
        source = source.replace('/var/run/faketraffic', str(self.root / 'runtime'))
        self.env.update(environment)
        return subprocess.run(['sh', '-s'], input=source, text=True, capture_output=True,
                              env=self.env, timeout=5)

    def actions(self):
        path = self.root / 'actions'
        return path.read_text().splitlines() if path.exists() else []

    def core(self):
        return ROOT / 'openwrt/faketraffic/pre-deinstall'

    def ebpf(self):
        if not JSONFILTER:
            self.skipTest('real jsonfilter required (FT_JSONFILTER)')
        return ROOT / 'openwrt/faketraffic-ebpf/pre-deinstall'

    def test_core_stop_failure_prevents_disable(self):
        self.assertNotEqual(self.run_hook(self.core(), FT_STOP='1').returncode, 0)
        self.assertEqual(self.actions(), ['stop'])

    def test_core_offline_root_has_no_actions(self):
        self.assertEqual(self.run_hook(self.core(), IPKG_INSTROOT='/offline').returncode, 0)
        self.assertEqual(self.actions(), [])

    def test_sdk_core_prerm_propagates_stop_failure(self):
        recipe = (ROOT / 'openwrt/faketraffic/Makefile').read_text()
        body = re.search(r'define Package/faketraffic/prerm\n(.*?)\nendef', recipe, re.S)[1]
        hook = self.write('sdk-prerm', body.replace('$$', '$'))
        self.assertNotEqual(self.run_hook(hook, FT_STOP='1', pkgname='faketraffic').returncode, 0)
        self.assertEqual(self.actions(), ['stop'])

    def test_sdk_core_postinst_and_default_prerm_do_not_control_service(self):
        rc = os.environ.get('FT_RC_COMMON')
        if not rc:
            self.skipTest('vendor rc.common required (FT_RC_COMMON)')
        (self.root / 'lib/functions').mkdir(parents=True)
        self.write('lib/functions.sh', '')
        self.write('lib/functions/service.sh', '')
        init = ROOT / 'openwrt/faketraffic/files/etc/init.d/faketraffic'
        for action in ['start', 'enable', 'stop', 'disable', 'restart', 'reload']:
            result = subprocess.run(['sh', rc, str(init), action], text=True, capture_output=True,
                                    env=dict(self.env, IPKG_INSTROOT=str(self.root), pkgname='faketraffic'), timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, '')
            self.assertEqual(result.stderr, '')

    def test_ebpf_absent_or_stopped_allows_removal(self):
        for data in [{}, {'faketraffic': {}}, {'faketraffic': {'instances': {}}},
                     {'faketraffic': {'instances': {'ebpf': {'running': False}}}}]:
            with self.subTest(data=data):
                self.assertEqual(self.run_hook(self.ebpf(), FT_BEFORE=json.dumps(data)).returncode, 0)
                self.assertEqual(self.actions(), [])

    def test_ebpf_offline_root_has_no_actions(self):
        self.assertEqual(self.run_hook(self.ebpf(), IPKG_INSTROOT='/offline', FT_BUS='1').returncode, 0)
        self.assertEqual(self.actions(), [])

    def test_ebpf_query_or_schema_error_refuses_removal(self):
        for raw in ['', '{broken', '[]', 'null', '{"faketraffic":false}',
                    '{"faketraffic":{"instances":{"ebpf":{"running":true}}}}',
                    '{"faketraffic":{"instances":{"ebpf":{"pid":"42"}}}}']:
            with self.subTest(raw=raw):
                self.assertNotEqual(self.run_hook(self.ebpf(), FT_BEFORE=raw).returncode, 0)
        self.assertNotEqual(self.run_hook(self.ebpf(), FT_BUS='1').returncode, 0)
        self.assertEqual(self.actions(), [])

    def test_ebpf_owned_live_backend_stops_then_absence_succeeds(self):
        live = '{"faketraffic":{"instances":{"ebpf":{"running":true,"pid":42}}}}'
        result = self.run_hook(self.ebpf(), FT_BEFORE=live)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.actions(), ['stop'])

    def test_ebpf_foreign_exe_is_untouched(self):
        live = '{"faketraffic":{"instances":{"ebpf":{"running":true,"pid":42}}}}'
        self.assertNotEqual(self.run_hook(self.ebpf(), FT_BEFORE=live, FT_EXE='/unrelated').returncode, 0)
        self.assertEqual(self.actions(), [])

    def test_ebpf_failed_stop_or_still_running_refuses_removal(self):
        live = '{"faketraffic":{"instances":{"ebpf":{"running":true,"pid":42}}}}'
        self.assertNotEqual(self.run_hook(self.ebpf(), FT_BEFORE=live, FT_STOP='1').returncode, 0)
        (self.root / 'stopped').unlink()
        self.assertNotEqual(self.run_hook(self.ebpf(), FT_BEFORE=live, FT_STOP='0', FT_AFTER=live).returncode, 0)

    def test_ebpf_recovery_checkpoint_refuses_removal(self):
        path = self.root / 'runtime/ebpf-runtime'
        path.mkdir(parents=True)
        (path / 'filters').symlink_to(path / 'missing')
        self.assertNotEqual(self.run_hook(self.ebpf()).returncode, 0)
        self.assertEqual(self.actions(), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
