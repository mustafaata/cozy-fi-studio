"""A failed thread launch returns its lease and staged resources to the caller."""
import threading
from contextlib import contextmanager


@contextmanager
def media_slot(slot):
    if not slot.acquire(blocking=False):raise ValueError('Bir medya işlemi sürüyor; tamamlandığında yeniden deneyin.')
    try:yield
    finally:slot.release()


def start_worker(target,slot,rollback):
    try:
        thread=threading.Thread(target=target,daemon=True)
        thread.start()
        return thread
    except Exception:
        try:rollback()
        finally:slot.release()
        raise
