#!/usr/bin/env python3
"""Synthesises the call tones in Resources/Sounds — an original motif, made
here, so the app ships no sound it has no right to.

    python3 tools/make-call-tones.py   (then it converts to .caf with afconvert)

A bright, bouncy mallet: a sine with a quick upward "pop" at the attack, a
soft octave and a fast-fading fourth partial, so it reads as playful rather
than as a telephone.
"""
import math, os, struct, subprocess, wave

RATE = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "Resources", "Sounds")

def note(freq, length=0.42, gain=1.0):
    n = int(RATE * length)
    out = []
    phase1 = phase2 = phase4 = 0.0
    for i in range(n):
        t = i / RATE
        # The pop: pitch starts 5% sharp and settles within ~25 ms.
        f = freq * (1.0 + 0.05 * math.exp(-t / 0.012))
        phase1 += 2 * math.pi * f / RATE
        phase2 += 2 * math.pi * 2 * f / RATE
        phase4 += 2 * math.pi * 3.98 * f / RATE
        attack = min(1.0, t / 0.004)
        body = math.exp(-t / 0.16)
        v = (math.sin(phase1) * body
             + 0.22 * math.sin(phase2) * math.exp(-t / 0.09)
             + 0.18 * math.sin(phase4) * math.exp(-t / 0.035))
        out.append(v * attack * gain)
    return out

def mix(track, start, samples):
    s = int(start * RATE)
    need = s + len(samples)
    if len(track) < need:
        track.extend([0.0] * (need - len(track)))
    for i, v in enumerate(samples):
        track[s + i] += v

def motif(track, at, gain=1.0):
    # G5 B5 D6 G6, then a little answer D6 G6 — up and bright.
    steps = [(784.0, 0.00), (987.8, 0.11), (1174.7, 0.22), (1568.0, 0.33),
             (1174.7, 0.62), (1568.0, 0.73)]
    for freq, offset in steps:
        mix(track, at + offset, note(freq, gain=gain * (1.15 if freq > 1500 else 1.0)))

def write(name, track, peak):
    top = max(abs(v) for v in track) or 1.0
    frames = b"".join(struct.pack("<h", int(max(-1, min(1, v / top * peak)) * 32767)) for v in track)
    wav = os.path.join(OUT, name + ".wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(frames)
    caf = os.path.join(OUT, name + ".caf")
    subprocess.run(["afconvert", "-f", "caff", "-d", "LEI16", wav, caf], check=True)
    os.remove(wav)
    print(caf, round(len(track) / RATE, 2), "s")

# The ringtone on the phone being called: the motif twice, then a breath.
ring = []
motif(ring, 0.0)
motif(ring, 1.25)
mix(ring, 3.6, [0.0])  # silence to the end of the loop
write("neon-ringtone", ring, 0.85)

# What the caller hears while it rings: the same motif, softer, once every
# three seconds — it loops.
back = []
motif(back, 0.0, gain=0.8)
mix(back, 3.0, [0.0])
write("neon-ringback", back, 0.7)
