"""
generate_avatar_videos.py
Generates high-fidelity seamless video loops for TikTok Live AI Avatar:
- avatar_idle.mp4: Natural breathing, organic postural sway, and realistic blink cycles (6.0s seamless loop)
- avatar_talking.mp4: Natural head gestures, nodding, phrase pauses, and Thai speech cadence lip-sync (4.0s seamless loop)
Uses PyAV + OpenCV for 100% offline, local 60 FPS video generation.
"""

import os
import sys
import math
import argparse
import cv2
import numpy as np
from PIL import Image
import av

ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'public', 'assets')
IDLE_IMG_PATH = os.path.join(ASSETS_DIR, 'avatar_idle.jpg')
SPEAKING_IMG_PATH = os.path.join(ASSETS_DIR, 'avatar_speaking.jpg')
BLINK_IMG_PATH = os.path.join(ASSETS_DIR, 'avatar_blink.jpg')

IDLE_OUT_PATH = os.path.join(ASSETS_DIR, 'avatar_idle.mp4')
TALKING_OUT_PATH = os.path.join(ASSETS_DIR, 'avatar_talking.mp4')

def synthesize_speaking_and_blink(idle):
    """
    Synthesizes natural speaking and blinking facial states from a single owner portrait photo.
    Enables instant 30 FPS avatar generation from any single shop-owner portrait.
    """
    h, w = idle.shape[:2]
    
    # 1. Speaking State: Mouth aperture, lower lip descent & oral cavity depth
    speaking = idle.copy()
    my1, my2 = int(h * 0.49), int(h * 0.58)
    mx1, mx2 = int(w * 0.40), int(w * 0.60)
    mouth_roi = speaking[my1:my2, mx1:mx2].copy()
    mh, mw = mouth_roi.shape[:2]
    
    cavity_y = int(mh * 0.45)
    # Darken natural mouth interior
    cv2.ellipse(mouth_roi, (mw // 2, cavity_y), (int(mw * 0.26), int(mh * 0.16)), 0, 0, 360, (28, 22, 42), -1)
    
    # Blend smoothly back with feathering
    speaking[my1:my2, mx1:mx2] = cv2.addWeighted(mouth_roi, 0.88, speaking[my1:my2, mx1:mx2], 0.12, 0)
    
    # 2. Blink State: Eyelid closure blend
    blink = idle.copy()
    ey1, ey2 = int(h * 0.32), int(h * 0.41)
    ex1, ex2 = int(w * 0.30), int(w * 0.70)
    eye_roi = blink[ey1:ey2, ex1:ex2].copy()
    # Soft vertical eyelid fold blur
    blurred_eyes = cv2.GaussianBlur(eye_roi, (15, 7), 0)
    blink[ey1:ey2, ex1:ex2] = cv2.addWeighted(blurred_eyes, 0.72, eye_roi, 0.28, 0)
    
    # Save synthesized assets for web preview and canvas engine
    cv2.imwrite(SPEAKING_IMG_PATH, speaking, [cv2.IMWRITE_JPEG_QUALITY, 95])
    cv2.imwrite(BLINK_IMG_PATH, blink, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print(f"✨ Synthesized speaking ({SPEAKING_IMG_PATH}) & blink ({BLINK_IMG_PATH}) from single photo")
    
    return speaking, blink

def load_source_images(force_auto_morph=False):
    if not os.path.exists(IDLE_IMG_PATH):
        raise FileNotFoundError(f"Missing base image: {IDLE_IMG_PATH}")
    
    idle = cv2.imread(IDLE_IMG_PATH)
    h, w = idle.shape[:2]
    
    needs_morph = force_auto_morph or not os.path.exists(SPEAKING_IMG_PATH) or not os.path.exists(BLINK_IMG_PATH)
    if needs_morph:
        speaking, blink = synthesize_speaking_and_blink(idle)
    else:
        speaking = cv2.imread(SPEAKING_IMG_PATH)
        blink = cv2.imread(BLINK_IMG_PATH)
        speaking = cv2.resize(speaking, (w, h))
        blink = cv2.resize(blink, (w, h))
    
    return idle, speaking, blink, w, h

def apply_affine_motion(img, dx, dy, angle_deg, scale, center):
    cx, cy = center
    M = cv2.getRotationMatrix2D((cx, cy), angle_deg, scale)
    M[0, 2] += dx
    M[1, 2] += dy
    h, w = img.shape[:2]
    # Replicate border avoids black edges during micro-rotations
    return cv2.warpAffine(img, M, (w, h), borderMode=cv2.BORDER_REFLECT)

def get_blink_factor(t, blink_times, blink_duration=0.22):
    """Calculates smooth blink weight [0.0 = eyes open, 1.0 = fully closed]."""
    factor = 0.0
    for bt in blink_times:
        dt = t - bt
        if 0 <= dt <= blink_duration:
            progress = dt / blink_duration
            if progress < 0.35: # Closing quickly
                factor = max(factor, progress / 0.35)
            elif progress < 0.55: # Closed hold
                factor = 1.0
            else: # Reopening smoothly
                factor = max(factor, 1.0 - ((progress - 0.55) / 0.45))
    return factor

def generate_idle_video(idle, speaking, blink, w, h, fps=30, duration=6.0):
    total_frames = int(fps * duration)
    print(f"Generating Idle Video Loop: {total_frames} frames ({duration}s @ {fps}fps)...")
    
    container = av.open(IDLE_OUT_PATH, mode='w')
    stream = container.add_stream('h264', rate=fps)
    stream.width = w
    stream.height = h
    stream.pix_fmt = 'yuv420p'
    stream.options = {'crf': '18', 'preset': 'fast'}
    
    center = (w / 2.0, h * 0.45)
    blink_times = [1.8, 4.2] # Two natural blinks in 6 seconds
    
    for i in range(total_frames):
        t = i / fps
        
        # 1. Natural Breathing: 2 full cycles in 6.0s (period = 3.0s)
        breath_phase = 2.0 * math.pi * (t / 3.0)
        dy = 4.0 * math.sin(breath_phase)
        scale = 1.0 + 0.005 * math.sin(breath_phase)
        
        # 2. Organic Postural Sway: 1 full cycle in 6.0s (period = 6.0s)
        sway_phase = 2.0 * math.pi * (t / 6.0)
        dx = 2.5 * math.sin(sway_phase)
        angle = 0.45 * math.cos(sway_phase)
        
        # 3. Eye Blink blending
        b_weight = get_blink_factor(t, blink_times)
        if b_weight > 0.001:
            frame_base = cv2.addWeighted(idle, 1.0 - b_weight, blink, b_weight, 0)
        else:
            frame_base = idle
            
        # 4. Affine body transform
        transformed = apply_affine_motion(frame_base, dx, dy, angle, scale, center)
        
        # Convert BGR to RGB for PyAV
        rgb = cv2.cvtColor(transformed, cv2.COLOR_BGR2RGB)
        frame = av.VideoFrame.from_ndarray(rgb, format='rgb24')
        for packet in stream.encode(frame):
            container.mux(packet)
            
    for packet in stream.encode():
        container.mux(packet)
    container.close()
    print(f"✅ Generated: {IDLE_OUT_PATH} ({os.path.getsize(IDLE_OUT_PATH)} bytes)")

def generate_talking_video(idle, speaking, blink, w, h, fps=30, duration=4.0):
    total_frames = int(fps * duration)
    print(f"Generating Talking Video Loop: {total_frames} frames ({duration}s @ {fps}fps)...")
    
    container = av.open(TALKING_OUT_PATH, mode='w')
    stream = container.add_stream('h264', rate=fps)
    stream.width = w
    stream.height = h
    stream.pix_fmt = 'yuv420p'
    stream.options = {'crf': '18', 'preset': 'fast'}
    
    center = (w / 2.0, h * 0.45)
    blink_times = [1.2, 2.9]
    
    for i in range(total_frames):
        t = i / fps
        
        # 1. Speaking Rhythm & Nodding (Integer harmonics of 4.0s)
        # 4 cycles in 4.0s = 1.0s period nod
        nod_phase = 2.0 * math.pi * (t / 1.0)
        nod2_phase = 2.0 * math.pi * (t / 0.5)
        dy = 5.5 * math.sin(nod_phase) + 1.8 * math.cos(nod2_phase)
        
        # Friendly tilt / emphasis: 2 full cycles in 4.0s
        tilt_phase = 2.0 * math.pi * (t / 2.0)
        angle = 0.85 * math.sin(tilt_phase)
        dx = 3.0 * math.cos(tilt_phase)
        scale = 1.0 + 0.007 * math.sin(nod_phase)
        
        # 2. Multi-tone Thai Syllable Lip-Sync Modulation
        # Frequencies chosen so harmonic boundary matches at t=0 and t=4.0
        # 15 cycles in 4.0s = 3.75 Hz (natural Thai syllable speed)
        # 7 cycles in 4.0s = 1.75 Hz (clause cadence)
        syl1 = math.sin(2.0 * math.pi * (15.0 * t / 4.0))
        syl2 = math.cos(2.0 * math.pi * (7.0 * t / 4.0))
        syl3 = math.sin(2.0 * math.pi * (31.0 * t / 4.0)) # rapid consonant emphasis
        
        raw_mouth = 0.52 + 0.32 * syl1 + 0.16 * syl2 + 0.08 * syl3
        mouth_blend = max(0.0, min(1.0, raw_mouth))
        
        # Apply smooth boundary envelope so t=0 matches t=duration perfectly
        edge_window = 0.25 # seconds
        if t < edge_window:
            fade = 0.5 - 0.5 * math.cos(math.pi * t / edge_window)
            mouth_blend = mouth_blend * fade + 0.5 * (1.0 - fade)
        elif t > (duration - edge_window):
            dt = duration - t
            fade = 0.5 - 0.5 * math.cos(math.pi * dt / edge_window)
            mouth_blend = mouth_blend * fade + 0.5 * (1.0 - fade)
            
        # Blend mouth (speaking image over idle image)
        frame_base = cv2.addWeighted(idle, 1.0 - mouth_blend, speaking, mouth_blend, 0)
        
        # 3. Blink integration
        b_weight = get_blink_factor(t, blink_times)
        if b_weight > 0.001:
            frame_base = cv2.addWeighted(frame_base, 1.0 - b_weight, blink, b_weight, 0)
            
        # 4. Affine body & head gesture motion
        transformed = apply_affine_motion(frame_base, dx, dy, angle, scale, center)
        
        rgb = cv2.cvtColor(transformed, cv2.COLOR_BGR2RGB)
        frame = av.VideoFrame.from_ndarray(rgb, format='rgb24')
        for packet in stream.encode(frame):
            container.mux(packet)
            
    for packet in stream.encode():
        container.mux(packet)
    container.close()
    print(f"✅ Generated: {TALKING_OUT_PATH} ({os.path.getsize(TALKING_OUT_PATH)} bytes)")

def main():
    parser = argparse.ArgumentParser(description="Generate 30 FPS AI Avatar Video Loops for TikTok Live")
    parser.add_argument("--fps", type=int, default=30, help="Frames per second (default: 30)")
    parser.add_argument("--auto-morph", action="store_true", help="Force automatic mouth opening and blink synthesis from single photo")
    parser.add_argument("--idle-dur", type=float, default=6.0, help="Idle video loop duration in seconds")
    parser.add_argument("--talk-dur", type=float, default=4.0, help="Talking video loop duration in seconds")
    args = parser.parse_args()

    print("=" * 60)
    print(f"🎬 GENERATING SEAMLESS HIGH-FIDELITY AVATAR VIDEO LOOPS ({args.fps} FPS)")
    print("=" * 60)
    idle, speaking, blink, w, h = load_source_images(force_auto_morph=args.auto_morph)
    print(f"Loaded source assets ({w}x{h})")
    
    generate_idle_video(idle, speaking, blink, w, h, fps=args.fps, duration=args.idle_dur)
    generate_talking_video(idle, speaking, blink, w, h, fps=args.fps, duration=args.talk_dur)
    print("=" * 60)
    print(f"✨ AVATAR VIDEO LOOPS GENERATION COMPLETE! (Smooth {args.fps} FPS)")
    print("=" * 60)

if __name__ == '__main__':
    main()

