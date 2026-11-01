import wave
import math
import struct
import os

SAMPLE_RATE = 44100

def create_wav(filename, samples):
    with wave.open(filename, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        for s in samples:
            val = max(-32767, min(32767, int(s * 32767)))
            wf.writeframes(struct.pack('<h', val))

def generate_ding(filename):
    duration = 0.8
    total_samples = int(SAMPLE_RATE * duration)
    samples = []
    freq1 = 1567.98 # G6
    freq2 = 2093.00 # C7
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        envelope = math.exp(-t * 5.0)
        s = 0.6 * math.sin(2 * math.pi * freq1 * t) + 0.4 * math.sin(2 * math.pi * freq2 * t)
        samples.append(s * envelope)
    create_wav(filename, samples)

def generate_cash(filename):
    duration = 0.6
    total_samples = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        # Two fast upward arpeggios
        if t < 0.2:
            f = 987.77 # B5
            env = math.exp(-t * 12.0)
        elif t < 0.4:
            f = 1318.51 # E6
            env = math.exp(-(t - 0.2) * 10.0)
        else:
            f = 1975.53 # B6
            env = math.exp(-(t - 0.4) * 8.0)
        s = math.sin(2 * math.pi * f * t)
        samples.append(s * env)
    create_wav(filename, samples)

def generate_cheer(filename):
    # Celebration celebratory chime chord
    duration = 1.2
    total_samples = int(SAMPLE_RATE * duration)
    samples = []
    chord = [523.25, 659.25, 783.99, 1046.50] # C major
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        env = math.exp(-t * 2.5) * (1.0 + 0.1 * math.sin(2 * math.pi * 6.0 * t))
        s = sum(0.25 * math.sin(2 * math.pi * f * t) for f in chord)
        samples.append(s * env)
    create_wav(filename, samples)

def generate_bell(filename):
    duration = 0.9
    total_samples = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        env = math.exp(-t * 4.0)
        s = 0.5 * math.sin(2 * math.pi * 880 * t) + 0.3 * math.sin(2 * math.pi * 1760 * t) + 0.2 * math.sin(2 * math.pi * 2640 * t)
        samples.append(s * env)
    create_wav(filename, samples)

def generate_bgm(filename):
    # Gentle 8-second ambient acoustic lo-fi chord loop
    duration = 8.0
    total_samples = int(SAMPLE_RATE * duration)
    samples = []
    # Chords: Cmaj7, Am7, Fmaj7, G7 (2s each)
    prog = [
        ([261.63, 329.63, 392.00, 493.88], 2.0), # Cmaj7
        ([220.00, 261.63, 329.63, 392.00], 2.0), # Am7
        ([174.61, 261.63, 329.63, 349.23], 2.0), # Fmaj7
        ([196.00, 246.94, 293.66, 349.23], 2.0), # G7
    ]
    cur_t = 0
    chord_idx = 0
    t_in_chord = 0
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        chord_idx = int(t / 2.0) % 4
        notes = prog[chord_idx][0]
        # Gentle tremolo and fade
        trem = 0.85 + 0.15 * math.sin(2 * math.pi * 2.0 * t)
        s = sum(0.2 * math.sin(2 * math.pi * f * t) for f in notes)
        samples.append(s * trem * 0.4) # Soft background volume
    create_wav(filename, samples)

sounds_dir = 'e:/TikTok Shop/tiktok-live-ai/sounds'
public_sounds_dir = 'e:/TikTok Shop/tiktok-live-ai/public/sounds'

for d in [sounds_dir, public_sounds_dir]:
    os.makedirs(d, exist_ok=True)
    generate_ding(os.path.join(d, 'ding.wav'))
    generate_cash(os.path.join(d, 'cash.wav'))
    generate_cheer(os.path.join(d, 'cheer.wav'))
    generate_bell(os.path.join(d, 'bell.wav'))
    generate_bgm(os.path.join(d, 'bgm.wav'))

print('All 5 sound files generated in sounds/ and public/sounds/!')

