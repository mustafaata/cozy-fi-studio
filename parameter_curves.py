"""Vectorized evaluation of the shared, bounded project-time curve contract."""
import numpy as np


def cubic_coordinate(t, a, b):
    s = 1 - t
    return 3*s*s*t*a + 3*s*t*t*b + t*t*t


def ease_base(progress, descriptor):
    p = np.clip(progress, 0, 1)
    kind = descriptor.get('type', 'linear')
    if kind == 'ease-in':
        return p*p
    if kind == 'ease-out':
        return p*(2-p)
    if kind == 'smooth':
        return p*p*(3-2*p)
    if kind == 'hold':
        return np.where(p < 1, 0., 1.)
    if kind == 'bezier':
        x1, y1, x2, y2 = descriptor['control']
        lo, hi = np.zeros_like(p), np.ones_like(p)
        for _ in range(32):
            mid = (lo+hi)/2
            below = cubic_coordinate(mid, x1, x2) < p
            lo, hi = np.where(below, mid, lo), np.where(below, hi, mid)
        return np.where(p <= 0, 0., np.where(p >= 1, 1., cubic_coordinate((lo+hi)/2, y1, y2)))
    return p


def ease(progress, descriptor):
    if 'domain' not in descriptor or descriptor.get('type') == 'hold':
        return ease_base(progress, descriptor)
    a, b = descriptor['domain']
    low, high = ease_base(a, descriptor), ease_base(b, descriptor)
    if high-low < 1e-12:
        return progress
    return (ease_base(a+(b-a)*progress, descriptor)-low)/(high-low)


def curve_values(points, times, fallback):
    times = np.asarray(times, dtype=np.float64)
    if not points:
        return np.full_like(times, fallback)
    stamps = np.array([p[0] for p in points], dtype=np.float64)
    values = np.array([p[1] for p in points], dtype=np.float64)
    # The linear fast path also preserves existing projects' performance.
    if all(len(p) == 2 or p[2]['type'] == 'linear' for p in points):
        return np.interp(times, stamps, values)
    indices = np.searchsorted(stamps, times, side='right')-1
    result = values[np.clip(indices, 0, len(points)-1)].copy()
    for index in np.unique(indices):
        if index < 0 or index >= len(points)-1:
            continue
        descriptor = points[index][2] if len(points[index]) == 3 else {}
        if descriptor.get('type') == 'hold':
            continue
        mask = indices == index
        progress = (times[mask]-stamps[index])/(stamps[index+1]-stamps[index])
        result[mask] += (values[index+1]-values[index])*ease(progress, descriptor)
    return result
