#!/usr/bin/env python3
"""
인물 사진을 한 틀에 맞춘다 — 얼굴 크기와 눈높이가 전원 같아지게.

  python3 scripts/fit-portrait.py <입력.jpg|png|heic> <출력.jpg> [--ref public/images/pi.jpg]

증명사진은 사람마다 프레임·얼굴 크기·눈높이가 다르다. 그대로 나란히 놓으면
한 사람은 크고 한 사람은 작아 명단이 아니라 짜깁기로 보인다. 이 스크립트는
얼굴을 검출해 **기준 사진(교수님)** 과 같은 얼굴 폭·눈높이가 되도록 확대·축소하고
같은 3:4 틀로 잘라 낸다. 얼굴에 맞춰 배율을 정하니 몸(어깨)도 그 사람의 비율
그대로 따라간다 — 얼굴만 키우거나 어깨만 좁히는 일이 없다.

틀을 벗어나는 자리는 **가장자리 픽셀을 늘려** 채우고 그 띠만 흐린다 — 단색으로
채웠더니 증명사진 배경의 미세한 그라디언트와 어긋나 이음새가 선으로 보였다.

얼굴·눈은 macOS Vision(`scripts/face-metrics.swift`, 로컬)으로 잰다. OpenCV Haar
상자는 머리카락·이마가 섞여 사람마다 편차가 커서(같은 사진을 다시 재도 10% 넘게
흔들렸다) 얼굴 크기를 맞추는 기준으로는 못 썼다. Vision 이 없으면 Haar 로 물러난다.

기준값은 `--ref` 사진에서 매번 다시 잰다 — 숫자를 박아 두면 기준 사진을 바꿀 때
어긋난다. 단, 지금 사이트의 넷은 `--face 0.53 --eye 0.34` 로 맞췄다: 교수님 원본은
얼굴이 틀의 0.375 로 여유롭게 찍혔고 학생 사진들은 0.41~0.49 로 타이트해서, 교수님
기준으로 맞추면 학생 사진을 **축소**해야 하고 가슴 아래에 없는 부분을 채워야 했다
(늘린 정장이 줄무늬가 된다). 넷 중 가장 타이트한 사진이 채움 없이 들어가는 값이
0.53 이고, 교수님 사진은 그만큼 더 확대·크롭했다. 새 구성원도 같은 값으로 낸다.

`--bg #f3f2f0` 을 주면 배경을 그 색으로 통일한다(Vision 인물 분리, `person-mask.swift`).
증명사진의 배경은 흰색·회색·라벤더로 제각각이라 나란히 놓으면 얼룩이 됐다.
"""
import argparse
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np

OUT_W, OUT_H = 960, 1280  # 3:4 — 사이트의 DotPortrait 비율

CASC = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
EYES = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")


def load(path: str) -> np.ndarray:
    im = cv2.imread(path)
    if im is None:
        # HEIC 나 확장자만 jpeg 인 파일 — macOS sips 로 PNG 를 거친다.
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False).name
        subprocess.run(["sips", "-s", "format", "png", path, "--out", tmp], check=True, capture_output=True)
        im = cv2.imread(tmp)
        os.unlink(tmp)
    if im is None:
        sys.exit(f"읽을 수 없는 사진: {path}")
    return im


def face_of_vision(path: str):
    """Vision 으로 (중심 x, 눈높이 y, 얼굴 폭). 실패하면 None."""
    here = os.path.dirname(os.path.abspath(__file__))
    r = subprocess.run(["swift", os.path.join(here, "face-metrics.swift"), path], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    import json

    d = json.loads(r.stdout.strip().splitlines()[-1])
    f = d["face"]
    le, re = d.get("leftEye"), d.get("rightEye")
    eye_y = (le["y"] + re["y"]) / 2 if le and re else f["y"] + f["h"] * 0.4
    return f["x"] + f["w"] / 2, eye_y, float(f["w"])


def face_of(im: np.ndarray, path: str | None = None):
    """가장 큰 얼굴의 (중심 x, 눈높이 y, 얼굴 폭). Vision 우선, 없으면 Haar."""
    if path is not None:
        v = face_of_vision(path)
        if v is not None:
            return v
    h, w = im.shape[:2]
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    faces = sorted(CASC.detectMultiScale(g, 1.05, 6, minSize=(w // 8, w // 8)), key=lambda r: -r[2] * r[3])
    if not faces:
        sys.exit("얼굴을 찾지 못했다")
    x, y, fw, fh = faces[0]
    eyes = [e for e in EYES.detectMultiScale(g[y : y + fh, x : x + fw], 1.05, 5, minSize=(fw // 10, fw // 10)) if e[1] < fh * 0.6]
    eye_y = (sum(e[1] + e[3] / 2 for e in eyes) / len(eyes) + y) if eyes else y + fh * 0.4
    return x + fw / 2, eye_y, float(fw)


def background(im: np.ndarray) -> tuple:
    """위쪽 모서리 두 군데의 중앙값 — 증명사진의 배경색."""
    h, w = im.shape[:2]
    pad = max(4, w // 40)
    patch = np.concatenate([im[pad : pad * 3, pad : pad * 3].reshape(-1, 3), im[pad : pad * 3, w - pad * 3 : w - pad].reshape(-1, 3)])
    return tuple(int(v) for v in np.median(patch, axis=0))


def person_mask(path: str, shape) -> np.ndarray | None:
    """Vision 인물 분리 마스크(0~1, 사진 크기). 실패하면 None."""
    here = os.path.dirname(os.path.abspath(__file__))
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False).name
    r = subprocess.run(["swift", os.path.join(here, "person-mask.swift"), path, tmp], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    m = cv2.imread(tmp, cv2.IMREAD_GRAYSCALE)
    os.unlink(tmp)
    if m is None:
        return None
    m = cv2.resize(m, (shape[1], shape[0]), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
    # 머리카락 가장자리를 몇 px 부드럽게 — 칼로 오린 듯한 윤곽을 피한다
    k = max(3, (min(shape[:2]) // 300) | 1)
    return cv2.GaussianBlur(m, (k, k), 0)


def replace_background(im: np.ndarray, path: str, hex_color: str) -> np.ndarray:
    """사람만 남기고 배경을 한 색으로. 증명사진 배경이 사람마다 달라서 명단이 얼룩졌다."""
    m = person_mask(path, im.shape)
    if m is None:
        sys.exit("인물 분리에 실패했다 — Vision 이 없는 환경이면 --bg 를 빼고 돌려라")
    c = hex_color.lstrip("#")
    bgr = np.array([int(c[4:6], 16), int(c[2:4], 16), int(c[0:2], 16)], dtype=np.float32)
    a = m[..., None]
    return (im.astype(np.float32) * a + bgr * (1 - a)).astype(np.uint8)


def fit(im: np.ndarray, face_w_rel: float, eye_rel: float, path: str) -> np.ndarray:
    cx, eye_y, fw = face_of(im, path)
    s = (face_w_rel * OUT_W) / fw  # 배율 — 얼굴 폭을 기준에 맞춘다
    win_w, win_h = OUT_W / s, OUT_H / s
    left = cx - win_w / 2
    top = eye_y - eye_rel * win_h
    # 틀이 사진 밖으로 나가는 만큼 배경색으로 덧댄다
    h, w = im.shape[:2]
    pad_l = max(0, int(np.ceil(-left)))
    pad_t = max(0, int(np.ceil(-top)))
    pad_r = max(0, int(np.ceil(left + win_w - w)))
    pad_b = max(0, int(np.ceil(top + win_h - h)))
    if pad_l or pad_t or pad_r or pad_b:
        # 가장자리를 늘려 채우고, 늘린 띠만 흐려 줄무늬를 지운다. 원본 영역은 건드리지 않는다.
        padded = cv2.copyMakeBorder(im, pad_t, pad_b, pad_l, pad_r, cv2.BORDER_REPLICATE)
        k = max(31, (min(h, w) // 12) | 1)
        blurred = cv2.GaussianBlur(padded, (k, k), 0)
        mask = np.ones(padded.shape[:2], dtype=np.uint8)
        mask[pad_t : pad_t + h, pad_l : pad_l + w] = 0
        # 원본과 만나는 자리가 뚝 끊기지 않게 마스크 경계도 부드럽게
        soft = cv2.GaussianBlur(mask.astype(np.float32), (k, k), 0)[..., None]
        im = (padded.astype(np.float32) * (1 - soft) + blurred.astype(np.float32) * soft).astype(np.uint8)
        left += pad_l
        top += pad_t
    crop = im[int(round(top)) : int(round(top + win_h)), int(round(left)) : int(round(left + win_w))]
    interp = cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC
    return cv2.resize(crop, (OUT_W, OUT_H), interpolation=interp)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--ref", default="public/images/pi.jpg", help="얼굴 폭·눈높이의 기준 사진")
    ap.add_argument("--quality", type=int, default=86)
    ap.add_argument("--face", type=float, help="틀 폭 대비 얼굴 폭. 주면 --ref 대신 이 값")
    ap.add_argument("--eye", type=float, help="틀 높이 대비 눈높이. 주면 --ref 대신 이 값")
    ap.add_argument("--bg", help="배경을 이 색(#rrggbb)으로 통일한다 — 사람만 남기고 바꾼다")
    a = ap.parse_args()

    if a.face is not None and a.eye is not None:
        face_w_rel, eye_rel = a.face, a.eye
    else:
        ref = load(a.ref)
        rh, rw = ref.shape[:2]
        _, ref_eye, ref_fw = face_of(ref, a.ref)
        # 기준 사진을 같은 3:4 틀로 볼 때의 비율 — 폭은 가로 기준, 눈높이는 3:4 높이 기준.
        ref_win_h = rw * OUT_H / OUT_W
        face_w_rel = a.face if a.face is not None else ref_fw / rw
        eye_rel = a.eye if a.eye is not None else ref_eye / ref_win_h

    src = load(a.src)
    if a.bg:
        src = replace_background(src, a.src, a.bg)
    out = fit(src, face_w_rel, eye_rel, a.src)
    os.makedirs(os.path.dirname(os.path.abspath(a.dst)), exist_ok=True)
    cv2.imwrite(a.dst, out, [cv2.IMWRITE_JPEG_QUALITY, a.quality])
    cx, ey, fw = face_of(out, a.dst)
    print(f"{a.dst}: {OUT_W}×{OUT_H} · 얼굴 폭 {fw / OUT_W:.3f} (기준 {face_w_rel:.3f}) · 눈높이 {ey / OUT_H:.3f} (기준 {eye_rel:.3f})")


if __name__ == "__main__":
    main()
