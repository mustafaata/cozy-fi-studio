"""A cancellation request also covers an upload that has not registered yet."""
from contextlib import contextmanager
import threading
import time
import uuid
from flask import Blueprint,jsonify


class MediaOperations:
    def __init__(self):
        self.lock=threading.RLock();self.entries={}
        self.api=Blueprint('media_operations',__name__)
        self.api.add_url_rule('/api/media/operations/<identifier>',view_func=self.cancel,methods=['DELETE'])

    def key(self,identifier):
        try:return uuid.UUID(identifier).hex
        except (ValueError,TypeError,AttributeError):raise ValueError('Medya işlem kimliği geçersiz.') from None

    @contextmanager
    def operation(self,identifier):
        identifier=self.key(identifier) if identifier else uuid.uuid4().hex
        with self.lock:
            entry=self.entries.get(identifier)
            if entry and entry['active']:raise ValueError('Bu medya işlemi zaten çalışıyor.')
            event=entry['event'] if entry else threading.Event()
            self.entries[identifier]=dict(event=event,active=True,at=time.monotonic())
        try:
            if event.is_set():raise ValueError('İşlem iptal edildi.')
            yield event
        finally:
            with self.lock:self.entries.pop(identifier,None)

    def cancel(self,identifier):
        try:identifier=self.key(identifier)
        except ValueError as error:return jsonify(message=str(error)),400
        with self.lock:
            now=time.monotonic()
            for key,entry in list(self.entries.items()):
                if not entry['active'] and now-entry['at']>300:self.entries.pop(key)
            pending=[key for key,entry in self.entries.items() if not entry['active']]
            for key in pending[:-63]:self.entries.pop(key)
            entry=self.entries.setdefault(identifier,dict(event=threading.Event(),active=False,at=now))
            entry['event'].set()
        return '',204
