#!/usr/bin/env python3
"""Run the actual LuCI Build/Compile + install recipes with private SDK fixtures.

FT_PO2LMO is the existing SDK host executable. No SDK tree is modified and no
package is installed. Optionally compare FT_EXPECTED_LMO extracted from the APK.
"""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SDKLuCI(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('FT_PO2LMO') and shutil.which('msgcat'), 'SDK po2lmo and msgcat required')
    def test_native_recipe_installs_same_translation_as_apk(self):
        with tempfile.TemporaryDirectory(prefix='faketraffic-sdk-luci-') as temp:
            base = Path(temp)
            host = base / 'host/bin'
            host.mkdir(parents=True)
            os.symlink(os.environ['FT_PO2LMO'], host / 'po2lmo')
            os.symlink(shutil.which('msgcat'), host / 'msgcat')
            stage = base / 'stage'
            stage.mkdir()
            recipe = (ROOT / 'openwrt/luci-app-faketraffic/Makefile').read_text()
            recipe = re.sub(r'^include .*\n|^\$\(eval .*\n', '', recipe, flags=re.M)
            makefile = base / 'Makefile'
            makefile.write_text('INSTALL_DIR=install -d -m0755\nINSTALL_DATA=install -m0644\nCP=cp -r\n' + recipe +
                                '\n.PHONY: verify\nverify:\n\t$(Build/Compile)\n\t$(call Package/luci-app-faketraffic/install,' + str(stage) + ')\n')
            result = subprocess.run(['make', '-f', str(makefile), 'verify',
                                     'PKG_BUILD_DIR=' + str(base / 'build'),
                                     'STAGING_DIR_HOSTPKG=' + str(base / 'host'),
                                     'FAKETRAFFIC_SOURCE_DIR=' + str(ROOT)],
                                    cwd=ROOT / 'openwrt/luci-app-faketraffic', capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            lmo = stage / 'usr/lib/lua/luci/i18n/faketraffic.zh-tw.lmo'
            self.assertGreater(lmo.stat().st_size, 0)
            self.assertEqual(lmo.stat().st_mode & 0o777, 0o644)
            if os.environ.get('FT_EXPECTED_LMO'):
                self.assertEqual(lmo.read_bytes(), Path(os.environ['FT_EXPECTED_LMO']).read_bytes())


if __name__ == '__main__':
    unittest.main(verbosity=2)
