"""Importable, lightweight subprocess targets for cancellation regressions."""
import subprocess
import sys
import time
from pathlib import Path


def blocked():
    time.sleep(60)


def spawn_descendant(path):
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
    Path(path).write_text(str(child.pid), encoding='ascii')
    time.sleep(60)


def echo(value):
    return value
