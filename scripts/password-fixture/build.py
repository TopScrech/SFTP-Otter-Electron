from pathlib import Path
import os
import shutil
import subprocess

fixture = Path(__file__).resolve().parent
def configured_path(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f'Set {name} to the matching prebuilt Swift dependency directory')
    result = Path(value).expanduser().resolve()
    if not result.is_dir():
        raise SystemExit(f'{name} must point to an existing directory')
    return result

products = configured_path('TIDE_FIXTURE_PRODUCTS')
checkouts = configured_path('TIDE_FIXTURE_CHECKOUTS')
modulemaps = configured_path('TIDE_FIXTURE_MODULEMAPS')
build = fixture / '.build'
build.mkdir(exist_ok=True)
common = ['-I', str(products)]
for file in modulemaps.glob('*.modulemap'):
    common += ['-Xcc', '-fmodule-map-file=' + str(file)]
for file in checkouts.rglob('module.modulemap'):
    if 'Benchmarks' not in str(file):
        common += ['-Xcc', '-fmodule-map-file=' + str(file)]

# Cached NIOSSH reserves a four-byte SSH string prefix by moving writerIndex,
# which traps when the KEX buffer lands within four bytes of its capacity
# Patch only the fixture copy; neither the application nor its checkout changes
nio_source = checkouts / 'swift-nio-ssh/Sources/NIOSSH'
patched = build / 'ByteBuffer+SSH.swift'
source = (nio_source / 'ByteBuffer+SSH.swift').read_text()
needle = 'let originalWriterIndex = self.writerIndex\n        self.moveWriterIndex(forwardBy: 4)'
assert needle in source
patched.write_text(source.replace(needle, 'let originalWriterIndex = self.writerIndex\n        self.writeInteger(UInt32(0))'))
files = [str(patched if p.name == patched.name else p) for p in nio_source.rglob('*.swift')]
subprocess.run(['swiftc', '-parse-as-library', '-swift-version', '5', '-module-name', 'NIOSSH', '-whole-module-optimization', '-c', *common, *files, '-o', str(build / 'NIOSSH.o')], check=True)
args = ['swiftc', '-parse-as-library', '-swift-version', '6', *common]
args += [str(p) for p in fixture.glob('*.swift')]
args += [str(p) for p in products.glob('*.o') if p.stem not in ['ScrechKit', 'NIOSSH']]
args += [str(build / 'NIOSSH.o'), '-o', str(fixture / 'server')]
subprocess.run(args, check=True)
