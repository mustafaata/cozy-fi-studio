"""Read-only YouTube lookup in a bounded worker, with no download capability."""
import yt_dlp
from isolated_task import run_isolated


class QuietLogger:
    def debug(self,message):pass
    def warning(self,message):pass
    def error(self,message):pass


def _lookup(query,options):
    with yt_dlp.YoutubeDL({**options,'logger':QuietLogger(),'socket_timeout':10,'retries':0,
                          'extractor_retries':0,'noplaylist':True,'playlistend':24}) as client:
        return client.sanitize_info(client.extract_info(query,download=False))


class SearchClient:
    def __init__(self,options):self.options={key:value for key,value in options.items() if key!='logger'}
    def __enter__(self):return self
    def __exit__(self,*exc):return False
    def extract_info(self,query,download=False):
        if download:raise ValueError('Arama istemcisi dosya indiremez.')
        return run_isolated(_lookup,(query,self.options),timeout=30)
