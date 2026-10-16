"""Use the Web Audio speaker matrix for the stereo project bus."""
import json
import math
import subprocess
import numpy as np
from media_assets import ffprobe_bin

AUDIO_INPUT_FORMATS='wav,mp3,flac,ogg,aac,mov,matroska,aiff,asf,ape,wv'


def source_audio_info(path,ffmpeg):
    try:
        result=subprocess.run([ffprobe_bin(ffmpeg),'-v','error','-protocol_whitelist','file,pipe',
            '-format_whitelist',AUDIO_INPUT_FORMATS,'-select_streams','a:0','-show_entries','stream=channels,duration:format=duration','-of','json',str(path)],
            capture_output=True,text=True,timeout=20,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    except subprocess.TimeoutExpired:
        raise ValueError('Ses kanalları okunurken zaman aşımına uğradı.') from None
    if result.returncode:
        raise ValueError('Ses kanalları okunamadı.')
    try:
        info=json.loads(result.stdout);stream=info['streams'][0];channels=stream['channels']
        duration=float(stream.get('duration') or info.get('format',{}).get('duration'))
    except (ValueError,KeyError,IndexError,TypeError):raise ValueError('Dosyada geçerli ses kanalı bulunamadı.') from None
    if type(channels) is not int or not 1<=channels<=32:
        raise ValueError('Kaynak kanal sayısı desteklenmiyor.')
    if not math.isfinite(duration) or duration<=0:raise ValueError('Kaynak ses süresi okunamadı.')
    return dict(channels=channels,duration=duration)


def source_channels(path,ffmpeg):
    return source_audio_info(path,ffmpeg)['channels']


def stereo_pan_filter(channels):
    if channels==1:return 'pan=stereo|FL=c0|FR=c0'
    if channels==4:return 'pan=stereo|FL=0.5*c0+0.5*c2|FR=0.5*c1+0.5*c3'
    if channels==6:
        weight=math.sqrt(.5)
        return f'pan=stereo|FL=c0+{weight}*c2+{weight}*c4|FR=c1+{weight}*c2+{weight}*c5'
    return 'pan=stereo|FL=c0|FR=c1'


def speaker_stereo(samples):
    channels=samples.shape[0]
    if channels==1:return np.repeat(samples,2,axis=0)
    if channels==4:return np.stack((.5*(samples[0]+samples[2]),.5*(samples[1]+samples[3])))
    if channels==6:return np.stack((samples[0]+math.sqrt(.5)*(samples[2]+samples[4]),samples[1]+math.sqrt(.5)*(samples[2]+samples[5])))
    return samples[:2]
