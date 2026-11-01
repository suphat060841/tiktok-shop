import sys
import os
import json
import asyncio
import hashlib
import time
import threading

# Suppress pygame prompt
os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = '1'
import pygame
import edge_tts

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BASE_DIR, 'cache')
SOUNDS_DIR = os.path.join(BASE_DIR, 'sounds')

os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(SOUNDS_DIR, exist_ok=True)

# Initialize Pygame Mixer
SPEECH_CHANNEL = None
SFX_CHANNEL = None
BGM_CHANNEL = None

try:
    pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=1024)
    pygame.mixer.set_num_channels(8)
    SPEECH_CHANNEL = pygame.mixer.Channel(0)
    SFX_CHANNEL = pygame.mixer.Channel(1)
    BGM_CHANNEL = pygame.mixer.Channel(2)
except Exception as e:
    sys.stderr.write(f"[tts_mixer] Pygame mixer init warning: {e}\n")

# State
bgm_sound = None
bgm_enabled = False
target_bgm_volume = 0.25
current_bgm_volume = 0.25
is_speech_active = False

sfx_cache = {}

def load_sfx(name):
    if name in sfx_cache:
        return sfx_cache[name]
    for ext in ['.wav', '.mp3']:
        p = os.path.join(SOUNDS_DIR, name + ext)
        if os.path.exists(p):
            try:
                snd = pygame.mixer.Sound(p)
                sfx_cache[name] = snd
                return snd
            except Exception:
                pass
    return None

def send_event(event, **kwargs):
    payload = {'event': event, **kwargs}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + '\n')
    sys.stdout.flush()

async def synthesize_speech(text, voice, rate, filepath):
    communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
    await communicate.save(filepath)

def get_cache_path(text, voice, rate):
    key = f"{text}_{voice}_{rate}".encode('utf-8')
    h = hashlib.md5(key).hexdigest()
    return os.path.join(CACHE_DIR, f"{h}.mp3")

# Background thread for BGM loop & smooth Auto-Ducking
def audio_manager_thread():
    global current_bgm_volume
    while True:
        try:
            if BGM_CHANNEL:
                if is_speech_active:
                    effective_target = target_bgm_volume * 0.20 # Duck to 20%
                else:
                    effective_target = target_bgm_volume

                if bgm_enabled:
                    if current_bgm_volume < effective_target:
                        current_bgm_volume = min(effective_target, current_bgm_volume + 0.02)
                    elif current_bgm_volume > effective_target:
                        current_bgm_volume = max(effective_target, current_bgm_volume - 0.03)

                    BGM_CHANNEL.set_volume(current_bgm_volume)

                    if not BGM_CHANNEL.get_busy() and bgm_sound:
                        BGM_CHANNEL.play(bgm_sound, loops=-1)
                else:
                    if BGM_CHANNEL.get_busy():
                        BGM_CHANNEL.stop()
        except Exception:
            pass
        time.sleep(0.05)

threading.Thread(target=audio_manager_thread, daemon=True).start()

async def handle_speak(data):
    global is_speech_active
    text = data.get('text', '').strip()
    speech_id = data.get('id', str(time.time()))
    voice = data.get('voice', 'th-TH-PremwadeeNeural')
    rate = data.get('rate', '+0%')

    if not text:
        send_event('speech_finished', id=speech_id)
        return

    filepath = get_cache_path(text, voice, rate)
    filename = os.path.basename(filepath)
    audio_url = f"/cache/{filename}"

    # Check if a valid audio file is already cached (> 1000 bytes)
    has_valid_cache = os.path.exists(filepath) and os.path.getsize(filepath) > 1000

    if not has_valid_cache:
        # Delete empty or corrupted file if present
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception:
                pass

        tmp_path = filepath + f".{os.getpid()}.tmp"
        try:
            # 8-second timeout for TTS synthesis
            await asyncio.wait_for(synthesize_speech(text, voice, rate, tmp_path), timeout=8.0)
            if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 1000:
                os.replace(tmp_path, filepath)
                has_valid_cache = True
            else:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
        except Exception as e:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            sys.stderr.write(f"[tts_mixer] TTS synthesis warning: {e}. Switching to browser fallback.\n")
            send_event('speech_fallback', id=speech_id, text=text, error=str(e))
            return

    # Play local audio via Pygame if available (skip physical playback if headless dummy driver)
    is_dummy = os.environ.get('SDL_AUDIODRIVER') == 'dummy'
    played_locally = False
    if has_valid_cache and SPEECH_CHANNEL and not is_dummy:
        try:
            sound = pygame.mixer.Sound(filepath)
            SPEECH_CHANNEL.stop()
            is_speech_active = True
            SPEECH_CHANNEL.play(sound)
            played_locally = True
            send_event('speech_started', id=speech_id, text=text, audio_url=audio_url, played_locally=True)

            while SPEECH_CHANNEL.get_busy():
                await asyncio.sleep(0.04)

            is_speech_active = False
            send_event('speech_finished', id=speech_id)
        except Exception as e:
            is_speech_active = False
            sys.stderr.write(f"[tts_mixer] Pygame playback error: {e}\n")

    if not played_locally:
        if has_valid_cache:
            # File exists, stream to browser
            send_event('speech_started', id=speech_id, text=text, audio_url=audio_url, played_locally=False)
            duration = max(2.0, min(15.0, len(text) * 0.12))
            await asyncio.sleep(duration)
            send_event('speech_finished', id=speech_id)
        else:
            send_event('speech_fallback', id=speech_id, text=text)

def main():
    global bgm_sound, bgm_enabled, target_bgm_volume, is_speech_active

    # Load BGM sound
    for ext in ['.wav', '.mp3']:
        bgm_path = os.path.join(SOUNDS_DIR, 'bgm' + ext)
        if os.path.exists(bgm_path):
            try:
                bgm_sound = pygame.mixer.Sound(bgm_path)
                break
            except Exception:
                pass

    send_event('ready')

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            try:
                cmd_data = json.loads(line)
            except Exception:
                continue

            command = cmd_data.get('command')

            if command == 'speak':
                try:
                    asyncio.run(handle_speak(cmd_data))
                except Exception as e:
                    send_event('speech_fallback', id=cmd_data.get('id', ''), text=cmd_data.get('text', ''), error=str(e))

            elif command == 'stop_speech':
                if SPEECH_CHANNEL:
                    SPEECH_CHANNEL.stop()
                is_speech_active = False
                send_event('speech_stopped')

            elif command == 'play_sfx':
                name = cmd_data.get('name', 'ding')
                vol = float(cmd_data.get('volume', 0.8))
                snd = load_sfx(name)
                if snd and SFX_CHANNEL:
                    snd.set_volume(min(1.0, max(0.0, vol)))
                    SFX_CHANNEL.play(snd)
                    send_event('sfx_played', name=name)

            elif command == 'set_bgm':
                bgm_enabled = bool(cmd_data.get('enabled', False))
                if 'volume' in cmd_data:
                    target_bgm_volume = float(cmd_data['volume'])
                send_event('bgm_state', enabled=bgm_enabled, volume=target_bgm_volume)

            elif command == 'set_bgm_volume':
                target_bgm_volume = float(cmd_data.get('volume', 0.25))
                send_event('bgm_state', enabled=bgm_enabled, volume=target_bgm_volume)

            elif command == 'ping':
                send_event('pong')
        except Exception as e:
            sys.stderr.write(f"[tts_mixer] Main loop error: {e}\n")

if __name__ == '__main__':
    main()
