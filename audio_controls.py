"""Shared project-clock level and Web Audio stereo-pan controls."""
import math
import numpy as np
from parameter_curves import curve_values


def stereo_pan(samples, pan):
    if pan <= 0:
        angle = (pan+1)*math.pi/2
        return np.stack((samples[0]+samples[1]*math.cos(angle), samples[1]*math.sin(angle)))
    angle = pan*math.pi/2
    return np.stack((samples[0]*math.cos(angle), samples[1]+samples[0]*math.sin(angle)))


def apply_channel_controls(samples, channel, times, envelope=1):
    automation = channel.get('automation', {})
    block = samples.copy()
    block *= envelope*curve_values(automation.get('volume', []), times, channel['volume'])/100
    points = automation.get('pan', [])
    if not points:
        return stereo_pan(block, channel['pan'])
    pan = curve_values(points, times, channel['pan'])
    left, right = block
    a, b = pan < 0, pan >= 0
    out_left, out_right = np.zeros_like(left), np.zeros_like(right)
    angle_left, angle_right = (pan[a]+1)*math.pi/2, pan[b]*math.pi/2
    out_left[a] = left[a]+right[a]*np.cos(angle_left)
    out_right[a] = right[a]*np.sin(angle_left)
    out_left[b] = left[b]*np.cos(angle_right)
    out_right[b] = right[b]+left[b]*np.sin(angle_right)
    return np.stack((out_left, out_right))
