"""Keep temporary transfers alive until the WSGI server closes all readers."""
import logging
import tempfile
import threading
from flask import send_file
from werkzeug.wsgi import ClosingIterator

logger=logging.getLogger(__name__)


class TemporaryMedia:
    def __init__(self,prefix):
        self.temp=tempfile.TemporaryDirectory(prefix=prefix)
        self.name=self.temp.name
        self.lock=threading.RLock();self.readers=0;self.discarded=False;self.retry=None

    def cleanup(self):
        with self.lock:
            self.discarded=True
            if self.readers or self.retry:return
            try:self.temp.cleanup()
            except OSError as error:
                # Windows readers/antivirus may temporarily retain a file handle.
                logger.warning('Temporary media cleanup deferred (%s)',type(error).__name__)
                self.retry=threading.Timer(5,self._retry);self.retry.daemon=True;self.retry.start()

    def _retry(self):
        with self.lock:self.retry=None
        self.cleanup()

    def send(self,path,**options):
        with self.lock:
            if self.discarded:raise FileNotFoundError('Aktarım kapatıldı.')
            self.readers+=1
        released=False
        def release():
            nonlocal released
            with self.lock:
                if released:return
                released=True
                self.readers-=1
                if self.discarded:self.cleanup()
        try:
            response=send_file(path,**options)
            # direct_passthrough bypasses Response.call_on_close, so own the iterator.
            response.response=ClosingIterator(response.response,[release])
            return response
        except Exception:
            release();raise
