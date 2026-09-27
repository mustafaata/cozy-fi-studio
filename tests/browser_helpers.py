"""Poll through the automation protocol without injecting eval under strict CSP."""
import time


def wait_for_browser(page, expression, *, arg=None, timeout=30000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        # Coerce in JavaScript: AudioBuffer and other browser objects serialize as {}.
        predicate = "arg => { const value = (" + expression + "); return Boolean(typeof value === 'function' ? value(arg) : value); }"
        if page.evaluate(predicate, arg):
            return
        time.sleep(0.05)
    raise AssertionError(f"Browser condition timed out: {expression}")
