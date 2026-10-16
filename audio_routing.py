"""Flat group buses and post-fader sends. Returns never feed other channels."""
import numpy as np
from audio_controls import apply_channel_controls
from track_effects import FeedbackDelay, StereoReverb, TrackEffectProcessor, reverb_impulse, track_effects_active
from project import track_audible, audio_channel_order, audio_bus_audible


class AudioReturnProcessor:
    def __init__(self, channel, sample_rate):
        self.channel = channel
        self.predelay = None
        if channel['type'] == 'reverb':
            self.effect = StereoReverb(reverb_impulse(sample_rate, channel['decay']))
            if round(channel['predelay']*sample_rate):
                self.predelay = FeedbackDelay(dict(delayTime=channel['predelay'],delayFeedback=0,delayMix=100),sample_rate)
        else:
            self.effect = FeedbackDelay(dict(delayTime=channel['delayTime'],delayFeedback=channel['feedback'],delayMix=100),sample_rate)

    def process(self, samples):
        if self.predelay is not None:
            samples = self.predelay.process(samples)-samples*.5
        if self.channel['type'] == 'reverb':
            return self.effect.process(samples, np.ones(samples.shape[1],dtype=np.float32))-samples*.5
        return self.effect.process(samples)-samples*.5


class AudioRoutingProcessor:
    def __init__(self, project, sample_rate, cancel=None):
        self.project, self.sample_rate = project, sample_rate
        self.order = audio_channel_order(project)
        self.buses = {bus['id']: bus for bus in project['audioBuses']}
        active = [track for kind,track in project['tracks'].items() if (kind=='main' or track['source']) and track_audible(project,kind)]
        audible_buses = {track['bus'] for track in active if track['bus']} | {bus['id'] for bus in project['audioBuses'] if bus['sidechain']['enabled'] and bus['sidechain']['listen'] and not bus['muted']}
        self.bus_effects = {bus['id']: TrackEffectProcessor(bus,sample_rate,bpm=project['rhythm']['bpm'],cancel=cancel) for bus in project['audioBuses'] if bus['id'] in audible_buses and track_effects_active(bus)}
        sends = {identifier for channel in [*active,*(b for b in project['audioBuses'] if b['id'] in audible_buses)] for identifier,value in channel['sends'].items() if value>0}
        self.returns = {channel['id']: AudioReturnProcessor(channel,sample_rate) for channel in project['audioReturns'] if channel['id'] in sends and not channel['muted']}

    def process(self, blocks, first, count, produce=None, tap=None):
        mix = np.zeros((2,count),dtype=np.float32)
        buses = {identifier: np.zeros_like(mix) for identifier in self.buses}
        sends = {identifier: np.zeros_like(mix) for identifier in self.returns}
        times = np.arange(first,first+count)/self.sample_rate
        def send(channel, samples):
            for identifier, level in channel['sends'].items():
                if identifier in sends:
                    sends[identifier] += samples*(level/100)
        outputs = {}
        silence = np.zeros_like(mix)
        for key in self.order:
            identifier = key[2:]
            channel = self.project['tracks'][identifier] if key.startswith('t:') else self.buses[identifier]
            detector = outputs.get(channel['sidechain']['source'],silence)
            if key.startswith('t:'):
                if (identifier=='main' or channel['source']) and track_audible(self.project,identifier):
                    samples = produce(identifier,detector) if produce else blocks.get(identifier,silence)
                else:
                    samples = silence
                if channel['bus']:
                    buses[channel['bus']] += samples
                else:
                    mix += samples
            else:
                samples = buses[identifier]
                if tap and audio_bus_audible(self.project,channel):tap(key,'pre',samples,first)
                if identifier in self.bus_effects:
                    samples = self.bus_effects[identifier].process(samples,first,detector)
                if tap and audio_bus_audible(self.project,channel):tap(key,'post',samples,first)
                samples = apply_channel_controls(samples,channel,times) if audio_bus_audible(self.project,channel) else silence
                mix += samples
            outputs[key] = samples
            send(channel,samples)
        for identifier, processor in self.returns.items():
            channel = processor.channel
            wet = processor.process(sends[identifier])
            if not channel['muted']:
                mix += apply_channel_controls(wet,channel,times)
        return mix
