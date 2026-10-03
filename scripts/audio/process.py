#!/usr/bin/env python3
"""
Builds public/audio/ from downloaded source packs (see CREDITS.md for where
each pack comes from). Usage:

    python3 scripts/audio/process.py <sources dir>

Every output is an MP3 (plays in every browser). Sound effects are mono,
trimmed, leading silence removed and loudness-matched; music and ambience
loops are stereo with a crossfaded loop point so they repeat seamlessly.
"""
import json, os, re, subprocess, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'audio')

_index = None
def find(name):
    """Locate a source file by (unique) basename anywhere under SRC."""
    global _index
    if _index is None:
        _index = {}
        for root, _, files in os.walk(SRC):
            for f in files:
                _index.setdefault(f, os.path.join(root, f))
    if name not in _index:
        raise SystemExit(f'missing source: {name}')
    return _index[name]

def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'ffmpeg failed: {" ".join(args)}\n{r.stderr[-1500:]}')
    return r.stderr

def stats(path):
    """RMS and peak level (dBFS) of the loud part of a file."""
    err = run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'astats=metadata=0:reset=0', '-f', 'null', '-'])
    rms = float(re.findall(r'RMS level dB: (-?[0-9.]+|-inf)', err)[-1].replace('-inf', '-90'))
    peak = float(re.findall(r'Peak level dB: (-?[0-9.]+|-inf)', err)[-1].replace('-inf', '-90'))
    return rms, peak

def sfx(out, name, start=0.0, dur=None, fade=None, rate=1.0, gain_db=0.0, layers=(), rms_target=-17.0, cap=None):
    """One-shot: trim, drop leading silence, fade, mono, loudness-match.
    `layers` = [(file, delay_s, gain_db)] mixed on top (e.g. reload clicks)."""
    tmp = '/tmp/_sfx.wav'
    inputs = ['-i', find(name)]
    chains = []
    f = f'[0:a]atrim=start={start},asetpts=PTS-STARTPTS'
    f += ',silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.004'
    if dur:
        f += f',atrim=duration={dur},asetpts=PTS-STARTPTS'
    if rate != 1.0:
        f += f',asetrate=44100*{rate},aresample=44100'
    f += ',aformat=channel_layouts=mono,aresample=44100[a0]'
    chains.append(f)
    labels = ['[a0]']
    for i, (lf, delay, lg) in enumerate(layers, start=1):
        inputs += ['-i', find(lf)]
        chains.append(f'[{i}:a]silenceremove=start_periods=1:start_threshold=-48dB,aformat=channel_layouts=mono,aresample=44100,volume={lg}dB,adelay={int(delay*1000)}[a{i}]')
        labels.append(f'[a{i}]')
    if len(labels) > 1:
        chains.append(f'{"".join(labels)}amix=inputs={len(labels)}:normalize=0[m]')
        last = '[m]'
    else:
        last = '[a0]'
    run(['ffmpeg', '-y', '-hide_banner', *inputs, '-filter_complex', ';'.join(chains), '-map', last, tmp])
    # Fade the tail and match loudness (RMS target, peaks kept below -1 dBFS).
    length = probe(tmp)
    if cap:
        length = min(length, cap)
    fd = fade if fade is not None else min(0.25, length * 0.35)
    rms, peak = stats(tmp)
    g = min(rms_target - rms, -1.0 - peak) + gain_db
    os.makedirs(os.path.dirname(out), exist_ok=True)
    run(['ffmpeg', '-y', '-hide_banner', '-i', tmp, '-af', f'atrim=duration={length},volume={g}dB,afade=t=out:st={max(0, length - fd)}:d={fd}',
         '-ac', '1', '-ar', '44100', '-b:a', '96k', out])

def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True)
    return float(r.stdout.strip())

def loop(out, name, start=0.0, dur=60.0, xfade=3.0, lufs=-18.0, bitrate='112k', mono=False):
    """Seamless loop: the tail is crossfaded into the head, so the file can
    repeat without a seam. Loudness-normalized (EBU R128)."""
    seg, body, head, tmp = '/tmp/_seg.wav', '/tmp/_body.wav', '/tmp/_head.wav', '/tmp/_loop.wav'
    run(['ffmpeg', '-y', '-hide_banner', '-ss', str(start), '-t', str(dur), '-i', find(name), '-ar', '44100', seg])
    c = min(xfade, probe(seg) / 4)
    run(['ffmpeg', '-y', '-hide_banner', '-ss', str(c), '-i', seg, body])
    run(['ffmpeg', '-y', '-hide_banner', '-t', str(c), '-i', seg, head])
    run(['ffmpeg', '-y', '-hide_banner', '-i', body, '-i', head, '-filter_complex', f'[0:a][1:a]acrossfade=d={c}:c1=qsin:c2=qsin[o]', '-map', '[o]', tmp])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    run(['ffmpeg', '-y', '-hide_banner', '-i', tmp, '-af', f'loudnorm=I={lufs}:TP=-1.5:LRA=11',
         '-ac', '1' if mono else '2', '-ar', '44100', '-b:a', bitrate, out])

def S(n): return os.path.join(OUT, 'sfx', n + '.mp3')
def M(n): return os.path.join(OUT, 'music', n + '.mp3')
def A(n): return os.path.join(OUT, 'amb', n + '.mp3')

GUN = 'G_31P.wav'          # Carl Gustav M45 (9mm SMG), single shot, near
RIFLE = 'T_27P.wav'        # Savage 10 .300 Blackout, near
JOBS = []
def job(fn, *a, **k): JOBS.append((fn, a, k))

# ---- Weapons ----
job(sfx, S('smgShot'), GUN, dur=0.55, fade=0.3, rms_target=-14, cap=0.5)
job(sfx, S('smgShot2'), GUN, dur=0.55, fade=0.3, rate=1.06, rms_target=-14, cap=0.5)
job(sfx, S('rifleShot'), RIFLE, dur=1.6, fade=1.0, rms_target=-12, layers=[('impactMetal_heavy_000.ogg', 0.0, -14)])
job(sfx, S('dryFire'), 'click_002.ogg')
job(sfx, S('reloadSmg'), 'impactMetal_light_001.ogg', layers=[('impactPlate_light_002.ogg', 0.55, -2), ('switch_003.ogg', 1.15, -4)])
job(sfx, S('reloadRifle'), 'impactMetal_medium_000.ogg', layers=[('impactPlate_medium_001.ogg', 0.9, -2), ('impactMetal_light_004.ogg', 1.7, 0)])
job(sfx, S('swap'), 'impactPlate_light_003.ogg', layers=[('switch10.ogg', 0.12, -6)])
job(sfx, S('meleeSwing'), 'fs_389590.mp3', rms_target=-20)
job(sfx, S('meleeHit'), 'impactPunch_heavy_002.ogg', layers=[('impactMetal_medium_002.ogg', 0.0, -8)])
# Enemy bolts (crew carry energy weapons).
for i in (1, 2, 3):
    job(sfx, S(f'gruntShot{i}'), f'Laser Pistol {i}.wav', dur=0.6, rms_target=-18)
for i in (1, 2, 3):
    job(sfx, S(f'trooperShot{i}'), f'Laser Rifle {i}.wav', dur=0.7, rms_target=-18)
for i in (4, 5):
    job(sfx, S(f'heavyShot{i}'), f'Laser Rifle {i}.wav', dur=0.5, rate=0.82, rms_target=-18)
job(sfx, S('enemyCharge'), 'phaserUp3.ogg', rms_target=-22)
job(sfx, S('heavyWindup'), 'engineCircular_000.ogg', dur=1.0, rms_target=-20)
job(sfx, S('whizz'), 'phaserDown1.ogg', dur=0.3, rms_target=-24)
# ---- Hits ----
for i in range(5):
    job(sfx, S(f'impact{i}'), f'impactGeneric_light_00{i}.ogg', rms_target=-22)
job(sfx, S('impactHeavy'), 'impactMetal_heavy_002.ogg', rms_target=-18)
job(sfx, S('hitFlesh'), 'impactPunch_medium_000.ogg', rms_target=-20)
job(sfx, S('hitShield'), 'zap1.ogg', dur=0.25, rms_target=-22)
job(sfx, S('hitShield2'), 'zap2.ogg', dur=0.25, rms_target=-22)
job(sfx, S('hitArmor'), 'impactMetal_light_000.ogg', rms_target=-20)
job(sfx, S('hitArmor2'), 'impactMetal_light_002.ogg', rms_target=-20)
job(sfx, S('hitCrit'), 'impactGlass_light_000.ogg', rms_target=-20)
job(sfx, S('killConfirm'), 'pepSound1.ogg', rms_target=-22)
job(sfx, S('shieldBreak'), 'forceField_004.ogg', dur=1.2, rms_target=-16)
job(sfx, S('armorBreak'), 'impactMetal_heavy_003.ogg', layers=[('impactMetal_002.ogg', 0.05, -3)], rms_target=-15)
job(sfx, S('shieldBreakPlayer'), 'lowDown.ogg', rms_target=-16)
job(sfx, S('playerHitShield'), 'zapTwoTone.ogg', dur=0.3, rms_target=-20)
job(sfx, S('playerHitHealth'), 'impactPunch_heavy_000.ogg', rms_target=-17)
job(sfx, S('playerDeath'), 'phaserDown3.ogg', layers=[('lowFrequency_explosion_000.ogg', 0.1, -10)], rms_target=-16)
job(sfx, S('deathGrunt'), 'impactSoft_heavy_002.ogg', rms_target=-18)
job(sfx, S('deathHeavy'), 'impactMetal_heavy_001.ogg', layers=[('explosionCrunch_003.ogg', 0.05, -6)], rms_target=-15)
# ---- Movement ----
for i in range(5):
    job(sfx, S(f'footstep{i}'), f'footstep_concrete_00{i}.ogg', rms_target=-24)
job(sfx, S('land'), 'impactSoft_heavy_000.ogg', rms_target=-19)
job(sfx, S('jump'), 'thrusterFire_001.ogg', dur=0.45, rms_target=-20)
job(sfx, S('dash'), 'fs_60013.mp3', layers=[('thrusterFire_000.ogg', 0.0, -8)], rms_target=-17, cap=0.6)
job(sfx, S('coverIn'), 'impactSoft_medium_001.ogg', rms_target=-21)
# ---- Powers and combos ----
job(sfx, S('castPull'), 'phaserUp2.ogg', rms_target=-18)
job(sfx, S('castThrow'), 'laserLarge_001.ogg', rms_target=-17)
job(sfx, S('castCharge'), 'powerUp5.ogg', layers=[('fs_237980.mp3', 0.0, -6)], rms_target=-16, cap=1.3)
job(sfx, S('pullHit'), 'forceField_002.ogg', dur=0.8, rms_target=-17)
job(sfx, S('throwHit'), 'explosionCrunch_000.ogg', rms_target=-15)
job(sfx, S('chargeImpact'), 'lowFrequency_explosion_000.ogg', layers=[('impactPunch_heavy_004.ogg', 0.0, -2)], rms_target=-13)
job(sfx, S('powerFizzle'), 'spaceTrash1.ogg', rms_target=-21)
job(sfx, S('powerBlocked'), 'error_004.ogg', layers=[('impactMetal_light_003.ogg', 0.0, -6)], rms_target=-18)
job(sfx, S('combo'), 'lowFrequency_explosion_001.ogg', layers=[('explosionCrunch_002.ogg', 0.03, -2), ('forceField_000.ogg', 0.0, -8)], rms_target=-12)
job(sfx, S('explosion'), 'fs_136765.mp3', layers=[('lowFrequency_explosion_001.ogg', 0.0, -4)], rms_target=-12, cap=2.5)
job(sfx, S('grenadeBounce'), 'impactMetal_light_004.ogg', rms_target=-20)
job(sfx, S('grenadeBeep'), 'tick_002.ogg', rms_target=-20)
job(sfx, S('stomp'), 'lowFrequency_explosion_000.ogg', layers=[('impactMining_000.ogg', 0.0, -2)], rms_target=-14)
# ---- Boss ----
job(sfx, S('bossSlam'), 'lowFrequency_explosion_001.ogg', layers=[('impactMining_003.ogg', 0.0, 0), ('explosionCrunch_004.ogg', 0.02, -6)], rms_target=-12)
job(sfx, S('bossCharge'), 'spaceEngineLarge_000.ogg', dur=1.2, rms_target=-16)
job(sfx, S('bossVolley'), 'Laser Beam 1.wav', dur=0.9, rms_target=-15)
job(sfx, S('bossOrb'), 'phaseJump2.ogg', rms_target=-18)
job(sfx, S('bossDrag'), 'forceField_003.ogg', dur=1.0, rms_target=-15)
job(sfx, S('phaseChange'), 'zapThreeToneDown.ogg', layers=[('lowFrequency_explosion_000.ogg', 0.0, -8)], rms_target=-15)
# ---- World ----
job(sfx, S('doorOpen'), 'fs_402500.mp3', layers=[('doorOpen_001.ogg', 0.0, -6)], rms_target=-16)
job(sfx, S('pickupAmmo'), 'impactMetal_light_003.ogg', layers=[('confirmation_003.ogg', 0.08, -4)], rms_target=-18)
job(sfx, S('pickupHealth'), 'powerUp2.ogg', rms_target=-18)
job(sfx, S('holoLog'), 'phaseJump5.ogg', layers=[('maximize_003.ogg', 0.1, -6)], rms_target=-17)
job(sfx, S('bubbles'), 'fs_539823.mp3', rms_target=-24, cap=2.5)
# ---- UI ----
job(sfx, S('uiMove'), 'rollover2.ogg', rms_target=-24)
job(sfx, S('uiSelect'), 'click3.ogg', rms_target=-20)
job(sfx, S('uiBack'), 'back_001.ogg', rms_target=-21)
job(sfx, S('uiDeny'), 'error_002.ogg', rms_target=-21)
job(sfx, S('typeBlip'), 'tick_001.ogg', rms_target=-28)
job(sfx, S('checkpoint'), 'threeTone2.ogg', rms_target=-18)
job(sfx, S('objective'), 'confirmation_004.ogg', rms_target=-18)

# ---- Continuous loops (hover jets, low-health heartbeat) ----
job(loop, A('hoverJets'), 'thrusterFire_002.ogg', start=0.05, dur=1.6, xfade=0.4, lufs=-24, bitrate='64k', mono=True)
job(loop, A('heartbeat'), 'fs_21409.mp3', start=2.0, dur=8.0, xfade=0.5, lufs=-20, bitrate='64k', mono=True)
# ---- Ambience ----
job(loop, A('dome'), 'fs_366159.mp3', start=5.0, dur=75.0, xfade=4.0, lufs=-30, bitrate='80k')
job(loop, A('deepSea'), 'fs_193822.mp3', start=3.0, dur=60.0, xfade=4.0, lufs=-28, bitrate='80k')
job(loop, A('crowdMarket'), 'fs_816185.mp3', start=20.0, dur=70.0, xfade=4.0, lufs=-26, bitrate='80k')
job(loop, A('crowdWalla'), 'fs_653920.mp3', start=1.0, dur=24.0, xfade=3.0, lufs=-28, bitrate='80k')

# ---- Music (Void by dancramp, CC-BY 4.0; OpenGameArt CC0) ----
V = 'dancramp - Void - '
job(loop, M('title'), V + '10 Title Music for an Imaginary Sci-Fi Platformer.wav', start=0.0, dur=150.0, xfade=4.0)
job(loop, M('dock'), V + '09 Pods.wav', start=0.0, dur=150.0, xfade=4.0)
job(loop, M('explore'), V + '03 Maps.wav', start=0.0, dur=150.0, xfade=4.0)
job(loop, M('combat'), V + '05 Cyber Side Scroller.wav', start=0.0, dur=150.0, xfade=3.0, lufs=-16)
job(loop, M('boss'), V + "12 We're Not Done Here Yet.wav", start=0.0, dur=170.0, xfade=3.0, lufs=-16)
job(loop, M('victory'), V + '13 Finale.wav', start=0.0, dur=150.0, xfade=4.0)
job(loop, M('gallery'), V + '08 Caves.wav', start=0.0, dur=150.0, xfade=4.0, lufs=-20)
job(loop, M('heist'), V + '07 Heist.wav', start=0.0, dur=150.0, xfade=4.0)
job(loop, M('shrine'), V + '04 Facilitated Conversation.wav', start=0.0, dur=150.0, xfade=4.0, lufs=-20)
job(loop, M('club'), 'EasternArcticDubstep.mp3', start=0.0, dur=150.0, xfade=3.0, lufs=-15)
job(loop, M('market'), 'desert_loop.mp3', start=0.0, dur=64.0, xfade=0.5, lufs=-19)

if __name__ == '__main__':
    only = sys.argv[2] if len(sys.argv) > 2 else None
    done = []
    for fn, a, k in JOBS:
        out = a[0]
        if only and only not in out:
            continue
        fn(*a, **k)
        done.append({'file': os.path.relpath(out, OUT), 'bytes': os.path.getsize(out)})
        print('ok', os.path.relpath(out, OUT), os.path.getsize(out))
    total = sum(d['bytes'] for d in done)
    print(f'{len(done)} files, {total / 1e6:.1f} MB')
