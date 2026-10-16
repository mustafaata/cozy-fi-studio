"""Shared source-clock integrals for video editing and nested sequences."""
import bisect
import numpy as np


def primitive(value, curve):
    return value**3-value**4/2 if curve == 'smooth' else value*0 if curve == 'hold' else value**2/2


class SourceClock:
    """Exact reciprocal-speed integrals and bounded inverses, matching video-time.js."""
    def __init__(self, clip, duration, rate):
        self.start, self.stop = clip['start'], clip['end'] if clip['end'] is not None else duration
        if self.stop > duration+.001 or self.start >= duration or self.stop-self.start < .05-1e-8:
            raise ValueError('Video kesiti dosyanın dışında.')
        self.remap, self.rate = clip['timeRemap'], rate
        points = self.remap['ramp']
        bounds = sorted({self.start, self.stop, *(p[0] for p in points if self.start < p[0] < self.stop)})
        self.segments, self.cumulative = [], [0.0]
        for start, stop in zip(bounds, bounds[1:]):
            index = bisect.bisect_right([p[0] for p in points], start)-1
            left = points[index] if index >= 0 else None
            right = points[index+1] if index+1 < len(points) else None
            pace = 1/(left[1] if left else points[0][1]) if points else 1
            change = 1/right[1]-pace if left and right else 0
            origin, width, curve = (left[0], right[0]-left[0], left[2]) if left and right else (start, 1, 'hold')
            segment = (start, stop, pace, change, origin, width, curve)
            self.segments.append(segment)
            self.cumulative.append(self.cumulative[-1]+self.integral(segment, stop))
        self.duration = self.remap['freezeDuration'] if self.remap['freezeAt'] is not None else self.cumulative[-1]/rate

    @staticmethod
    def integral(segment, source):
        start, _, pace, change, origin, width, curve = segment
        return (source-start)*pace+width*change*(primitive((source-origin)/width, curve)-primitive((start-origin)/width, curve))

    def positions(self, elapsed):
        elapsed = np.asarray(elapsed, dtype=np.float64)
        if self.remap['freezeAt'] is not None:
            return np.full_like(elapsed, self.remap['freezeAt'])
        target = np.clip((self.duration-elapsed if self.remap['reverse'] else elapsed)*self.rate, 0, self.cumulative[-1])
        indices = np.minimum(len(self.segments)-1, np.searchsorted(self.cumulative, target, side='right')-1)
        result = np.empty_like(target)
        for index, segment in enumerate(self.segments):
            mask = indices == index
            if not np.any(mask):
                continue
            remaining = target[mask]-self.cumulative[index]
            start, stop, pace, change, *_ = segment
            if not change or segment[-1] == 'hold':
                result[mask] = start+remaining/pace
            else:
                lo, hi = np.full_like(remaining, start), np.full_like(remaining, stop)
                for _ in range(40):
                    mid = (lo+hi)/2
                    lower = self.integral(segment, mid) < remaining
                    lo, hi = np.where(lower, mid, lo), np.where(lower, hi, mid)
                result[mask] = (lo+hi)/2
        return result

    def elapsed_at(self, source):
        total = sum(self.integral(segment, min(source, segment[1]))
            for segment in self.segments if source > segment[0])
        return (self.cumulative[-1]-total if self.remap['reverse'] else total)/self.rate
