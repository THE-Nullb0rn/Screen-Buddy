#!/usr/bin/env python3
"""
Build script for headphone sprite strips.
Slices source Gemini sheets by detecting individual cats, merging props,
validating frame counts, scaling uniformly by median cat height,
anchoring baselines consistently per row, and checking strict margins.
Supports full builds as well as partial / remake builds via --remake or --src-dir.
Cleans Gemini corner watermark sparkles and unifies headphone earcup colours to reference purple.
"""

import os
import sys
import json
import argparse
import colorsys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import label, distance_transform_edt, binary_opening, binary_dilation

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC_DIR = "/home/itachi_06/Projects/Cat/NewFramesHeadphones"
PREVIEW_DIR = os.path.join(SRC_DIR, "_preview")
REPORT_DIR = os.path.join(SRC_DIR, "_reports")
OUTPUT_DIR = os.path.join(REPO_ROOT, "src", "renderer", "src", "assets", "cat-sprite", "anims", "headphones")
ORIG_DIR = os.path.join(REPO_ROOT, "src", "renderer", "src", "assets", "cat-sprite", "anims")
OLD_SHEET_PATH = os.path.join(REPO_ROOT, "src", "renderer", "src", "assets", "cat-sprite", "spritesheet.png")
ANIMS_JSON = os.path.join(REPO_ROOT, "src", "renderer", "src", "assets", "cat-sprite", "anims", "anims.json")

sys.path.insert(0, os.path.join(REPO_ROOT, "tools"))
from importlib.machinery import SourceFileLoader
build_sprites = SourceFileLoader("build_sprites", os.path.join(REPO_ROOT, "tools", "build-sprites.py")).load_module()
remove_background = build_sprites.remove_background

FILE_TO_ANIM = {
    "crouch-pounce.png": "crouchpounce",
    "curious.png": "curious",
    "drag.png": "drag",
    "drink.png": "drink",
    "eat.png": "eat",
    "gift.png": "gift",
    "groom.png": "groom",
    "idle.png": "idle",
    "jump.png": "jump",
    "knockoff.png": "knockoff",
    "lookaround.png": "lookaround",
    "old_idle_final.png": "idle-old",
    "proud.png": "proud",
    "purr.png": "purr",
    "run.png": "run",
    "sad.png": "sad",
    "standidle.png": "standidle",
    "standup.png": "standup",
    "strech.png": "stretch",
    "tail-flick.png": "tailflick",
    "talk.png": "talk",
    "toyplay.png": "toyplay",
    "typingfast.png": "typingfast",
    "typing.png": "typing",
    "walk.png": "walk",
    "yawn.png": "yawn"
}

REMAKE_IDS = {"drink", "knockoff", "proud", "purr", "standidle", "standup", "toyplay"}


def get_orig_metrics(anim_id, num_frames):
    if anim_id == "idle-old":
        sheet = Image.open(OLD_SHEET_PATH).convert("RGBA")
        arr = np.array(sheet)
        heights = []
        baselines = []
        cxs = []
        for f in range(2):
            col = f % 4
            row = f // 4
            crop = arr[row*300:(row+1)*300, col*210:(col+1)*210]
            ys, xs = np.where(crop[:, :, 3] > 0)
            heights.append(ys.max() - ys.min() + 1)
            baselines.append(ys.max())
            cxs.append((xs.min() + xs.max()) / 2.0)
        return float(np.median(heights)), float(np.median(baselines)), float(np.median(cxs))

    orig_path = os.path.join(ORIG_DIR, f"{anim_id}.png")
    im = Image.open(orig_path).convert("RGBA")
    arr = np.array(im)
    heights = []
    baselines = []
    cxs = []
    for f in range(num_frames):
        crop = arr[:, f*210:(f+1)*210]
        ys, xs = np.where(crop[:, :, 3] > 0)
        if len(ys) > 0:
            heights.append(ys.max() - ys.min() + 1)
            baselines.append(ys.max())
            cxs.append((xs.min() + xs.max()) / 2.0)
    return float(np.median(heights)), float(np.median(baselines)), float(np.median(cxs))


def cleanup_sparkles(arr, mask, anim_id):
    """
    Detects and removes Gemini watermark sparkles in the bottom-right corner region:
    - Right-most 15% and bottom-most 22% of the image.
    - Grey semi-transparent 4-point star overlapping cat body: inpaint with surrounding cat body coat.
    - White / pale pink / lavender 4-point star in the very corner: dropped from mask.
    Returns: arr, mask, removed_blobs
    """
    h, w, _ = arr.shape
    removed_blobs = []

    y0 = int(0.78 * h)
    x0 = int(0.85 * w)

    r = arr[:, :, 0].astype(int)
    g = arr[:, :, 1].astype(int)
    b = arr[:, :, 2].astype(int)
    val = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    sat = (val - minc) / (val + 1e-5)
    diff = val - minc

    corner_zone = np.zeros_like(mask)
    corner_zone[y0:, x0:] = True

    # 1. Grey semi-transparent star (overlaps cat body)
    gx0, gx1 = int(w * 0.86), int(w * 0.96)
    gy0, gy1 = int(h * 0.79), int(h * 0.94)
    grey_zone = np.zeros_like(mask)
    grey_zone[gy0:gy1, gx0:gx1] = True

    is_grey_star = mask & grey_zone & (val >= 60) & (val <= 175) & (sat < 0.22) & (diff < 25)
    lbl_g, num_g = label(is_grey_star)
    sizes_g = np.bincount(lbl_g.ravel())
    grey_star_mask = np.zeros_like(mask)
    for i in range(1, num_g + 1):
        if sizes_g[i] >= 150:
            ys, xs = np.where(lbl_g == i)
            box_w, box_h = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
            if box_w <= 120 and box_h <= 120:
                grey_star_mask |= (lbl_g == i)
                mean_rgb = [int(arr[ys, xs, c].mean()) for c in range(3)]
                removed_blobs.append({
                    "type": "grey_star_inpaint",
                    "bbox": [int(xs.min()), int(ys.min()), box_w, box_h],
                    "size": int(sizes_g[i]),
                    "color": mean_rgb
                })

    if np.any(grey_star_mask):
        valid_bg = mask & (~grey_star_mask)
        _, indices = distance_transform_edt(~valid_bg, return_indices=True)
        gy_idx, gx_idx = np.where(grey_star_mask)
        for c in range(3):
            arr[gy_idx, gx_idx, c] = arr[indices[0][gy_idx, gx_idx], indices[1][gy_idx, gx_idx], c]

    # 2. Corner star (white / pale pink / lavender / pastel star in very corner)
    is_corner_star = mask & corner_zone & (~grey_star_mask) & (val >= 135) & (
        (sat < 0.38) | ((r > g + 12) & (b > g + 12))
    )
    lbl_c, num_c = label(is_corner_star)
    sizes_c = np.bincount(lbl_c.ravel())
    for i in range(1, num_c + 1):
        if sizes_c[i] >= 10:
            ys, xs = np.where(lbl_c == i)
            box_w, box_h = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
            if box_w <= 120 and box_h <= 120:
                mean_rgb = [int(arr[ys, xs, c].mean()) for c in range(3)]
                removed_blobs.append({
                    "type": "corner_star_drop",
                    "bbox": [int(xs.min()), int(ys.min()), box_w, box_h],
                    "size": int(sizes_c[i]),
                    "color": mean_rgb
                })
                mask[lbl_c == i] = False

    # Also drop small isolated non-cat fragments in extreme corner
    lbl_all, num_all = label(mask)
    sizes_all = np.bincount(lbl_all.ravel())
    for i in range(1, num_all + 1):
        if 5 < sizes_all[i] < 1000:
            ys, xs = np.where(lbl_all == i)
            if xs.mean() >= 0.93 * w and ys.mean() >= 0.90 * h:
                mean_rgb = [int(arr[ys, xs, c].mean()) for c in range(3)]
                box_w, box_h = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
                removed_blobs.append({
                    "type": "extreme_corner_prop_drop",
                    "bbox": [int(xs.min()), int(ys.min()), box_w, box_h],
                    "size": int(sizes_all[i]),
                    "color": mean_rgb
                })
                mask[lbl_all == i] = False

    return arr, mask, removed_blobs




def get_reference_purple(eat_path):
    """
    Measures reference purple earcup median HSV from eat.png in the cat head area:
    head_region & hue in [250, 320] & sat >= 0.25 & val >= 0.35.
    """
    im = Image.open(eat_path).convert("RGBA")
    arr = np.array(im)
    mask = remove_background(arr, anim_name="eat")
    lbl, num = label(mask)
    sizes = np.bincount(lbl.ravel())
    cat_blobs = [i for i in range(1, num + 1) if sizes[i] > 25000]

    h_img, w_img, _ = arr.shape
    head_mask = np.zeros((h_img, w_img), dtype=bool)
    y_coords = np.arange(h_img)[:, None]
    for b_lbl in cat_blobs:
        ys, _ = np.where(lbl == b_lbl)
        top = int(ys.min())
        h = int(ys.max() - ys.min() + 1)
        head_bottom = top + int(0.55 * h)
        head_mask |= (lbl == b_lbl) & (y_coords <= head_bottom)

    r = arr[:, :, 0].astype(float) / 255.0
    g = arr[:, :, 1].astype(float) / 255.0
    b = arr[:, :, 2].astype(float) / 255.0
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    diff = maxc - minc
    nz_diff = diff > 1e-5

    hue = np.zeros_like(maxc)
    r_is_max = (r == maxc) & nz_diff
    g_is_max = (g == maxc) & nz_diff
    b_is_max = (b == maxc) & nz_diff
    hue[r_is_max] = ((g[r_is_max] - b[r_is_max]) / diff[r_is_max]) % 6.0
    hue[g_is_max] = ((b[g_is_max] - r[g_is_max]) / diff[g_is_max]) + 2.0
    hue[b_is_max] = ((r[b_is_max] - g[b_is_max]) / diff[b_is_max]) + 4.0
    hue = (hue * 60.0) % 360.0

    sat = np.zeros_like(maxc)
    nz = maxc > 1e-5
    sat[nz] = diff[nz] / maxc[nz]
    val = maxc

    purp_in_head = head_mask & (hue >= 250) & (hue <= 320) & (sat >= 0.25) & (val >= 0.35)
    ref_h = float(np.median(hue[purp_in_head]))
    ref_s = float(np.median(sat[purp_in_head]))
    ref_v = float(np.median(val[purp_in_head]))
    return ref_h, ref_s, ref_v


def recolour_teal_to_purple(arr, sorted_cats, lbl, ref_hsv):
    """
    Measures earcup colours in the head region of each cat blob.
    Maps teal/blue-grey earcup pixels (hue 165-205 deg, sat >= 0.25, val >= 0.35)
    to reference purple median HSV from eat.png:
      hue = ref_median_hue
      saturation = np.clip(original_sat, ref_median_sat * 0.85, ref_median_sat * 1.10)
      value = np.clip(original_val * (ref_median_val / cur_median_val), 0.0, 1.0)
    Restricted to cat head area (y <= top + 0.55 * h) of cat blobs (never props/water bowls).
    """
    ref_h, ref_s, ref_v = ref_hsv
    h_img, w_img, _ = arr.shape
    rgb = arr[:, :, :3].astype(float) / 255.0
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    diff = maxc - minc
    nz_diff = diff > 1e-5

    hue = np.zeros_like(maxc)
    r_is_max = (r == maxc) & nz_diff
    g_is_max = (g == maxc) & nz_diff
    b_is_max = (b == maxc) & nz_diff
    hue[r_is_max] = ((g[r_is_max] - b[r_is_max]) / diff[r_is_max]) % 6.0
    hue[g_is_max] = ((b[g_is_max] - r[g_is_max]) / diff[g_is_max]) + 2.0
    hue[b_is_max] = ((r[b_is_max] - g[b_is_max]) / diff[b_is_max]) + 4.0
    hue = (hue * 60.0) % 360.0

    sat = np.zeros_like(maxc)
    nz = maxc > 1e-5
    sat[nz] = diff[nz] / maxc[nz]
    val = maxc

    teal = (hue >= 165) & (hue <= 205) & (sat >= 0.25) & (val >= 0.35)

    head_mask = np.zeros((h_img, w_img), dtype=bool)
    y_coords = np.arange(h_img)[:, None]

    for c in sorted_cats:
        cat_blob_mask = (lbl == c["lbl"])
        top = c["top"]
        h = c["h"]
        head_bottom = top + int(0.55 * h)
        head_mask |= cat_blob_mask & (y_coords <= head_bottom)

    teal_in_head = teal & head_mask
    teal_ys, teal_xs = np.where(teal_in_head)
    recoloured_count = len(teal_ys)

    if recoloured_count == 0:
        return arr, 0, None

    cur_med_v = float(np.median(val[teal_in_head]))
    val_scale = ref_v / cur_med_v if cur_med_v > 1e-5 else 1.0

    s_min = ref_s * 0.85
    s_max = ref_s * 1.10
    h_target = ref_h / 360.0

    new_hues = []
    new_sats = []
    new_vals = []

    for y, x in zip(teal_ys, teal_xs):
        s_val = float(np.clip(sat[y, x], s_min, s_max))
        v_val = float(np.clip(val[y, x] * val_scale, 0.0, 1.0))
        r_new, g_new, b_new = colorsys.hsv_to_rgb(h_target, s_val, v_val)
        arr[y, x, 0] = int(round(r_new * 255))
        arr[y, x, 1] = int(round(g_new * 255))
        arr[y, x, 2] = int(round(b_new * 255))
        new_hues.append(ref_h)
        new_sats.append(s_val)
        new_vals.append(v_val)

    recoloured_median_hsv = [
        float(np.median(new_hues)),
        float(np.median(new_sats)),
        float(np.median(new_vals))
    ]

    return arr, recoloured_count, recoloured_median_hsv


def main():
    parser = argparse.ArgumentParser(description="Build headphone sprite strips.")
    parser.add_argument("--remake", action="store_true", help="Process sheets from remake/ folder")
    parser.add_argument("--src-dir", type=str, default=None, help="Override source art directory")
    parser.add_argument("--ids", type=str, default=None, help="Comma-separated list of animation IDs to process")
    args = parser.parse_args()

    os.makedirs(PREVIEW_DIR, exist_ok=True)
    os.makedirs(REPORT_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(ANIMS_JSON, "r", encoding="utf-8") as f:
        anims_manifest = json.load(f)

    target_ids = set(args.ids.split(",")) if args.ids else None

    # Determine files to process
    files_to_process = []
    if args.remake:
        src_dir = os.path.join(SRC_DIR, "remake")
        is_partial = True
        all_remake_files = sorted([f for f in os.listdir(src_dir) if f.endswith("_1.png") or f == "old_idle_final.png"])
        for fname in all_remake_files:
            if fname == "old_idle_final.png":
                aid = "idle-old"
            else:
                aid = fname.replace("_1.png", "")
            if target_ids and aid not in target_ids:
                continue
            files_to_process.append((fname, aid, os.path.join(src_dir, fname)))
    elif args.src_dir:
        src_dir = os.path.abspath(args.src_dir)
        is_partial = True
        all_files = sorted([f for f in os.listdir(src_dir) if f.endswith(".png") and not f.startswith("_")])
        for fname in all_files:
            aid = fname.replace("_1.png", "") if fname.endswith("_1.png") else FILE_TO_ANIM.get(fname)
            if not aid:
                continue
            if target_ids and aid not in target_ids:
                continue
            files_to_process.append((fname, aid, os.path.join(src_dir, fname)))
    else:
        # Full build: all 26 animations
        # For REMAKE_IDS, remake/*_1.png overrides main folder; idle-old uses remake/old_idle_final.png
        is_partial = bool(args.ids)
        remake_dir = os.path.join(SRC_DIR, "remake")
        for fname, aid in sorted(FILE_TO_ANIM.items()):
            if target_ids and aid not in target_ids:
                continue
            if aid == "idle-old":
                rpath = os.path.join(remake_dir, "old_idle_final.png")
                if os.path.exists(rpath):
                    files_to_process.append(("old_idle_final.png", aid, rpath))
                    continue
            elif aid in REMAKE_IDS:
                rname = f"{aid}_1.png"
                rpath = os.path.join(remake_dir, rname)
                if os.path.exists(rpath):
                    files_to_process.append((rname, aid, rpath))
                    continue
            files_to_process.append((fname, aid, os.path.join(SRC_DIR, fname)))

    installed = []
    not_installed = []

    # Measure reference purple earcup HSV from eat.png
    eat_source_path = os.path.join(SRC_DIR, "eat.png")
    ref_hsv = get_reference_purple(eat_source_path)
    print(f"Measured reference purple from eat.png: Hue={ref_hsv[0]:.2f} deg, Sat={ref_hsv[1]:.4f}, Val={ref_hsv[2]:.4f}")

    for fname, anim_id, img_path in files_to_process:
        expected_frames = 2 if anim_id == "idle-old" else anims_manifest["animations"][anim_id]["frames"]

        im = Image.open(img_path).convert("RGBA")
        arr = np.array(im)
        h_img, w_img, _ = arr.shape

        # Step 1: Remove background
        anim_key = anim_id
        if anim_key == "strech":
            anim_key = "stretch"
        if anim_id == "idle-old":
            bg_corner = tuple(arr[0, 0][:3])
            print(f"{anim_id}: detected background colour RGB={bg_corner}")
        mask = remove_background(arr, anim_name=anim_key)
        arr, mask, removed_sparkles = cleanup_sparkles(arr, mask, anim_id)
        if anim_id == "idle-old":
            print(f"{anim_id}: removed sparkle blobs={len(removed_sparkles)}")

        # Step 2: Detect cats & props from cleaned mask
        lbl, num = label(mask)
        sizes = np.bincount(lbl.ravel())

        all_blobs_info = []
        for b_lbl in range(1, num + 1):
            if sizes[b_lbl] > 5:
                ys, xs = np.where(lbl == b_lbl)
                all_blobs_info.append({
                    "lbl": int(b_lbl),
                    "size": int(sizes[b_lbl]),
                    "bbox": [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
                    "is_cat": bool(sizes[b_lbl] > 25000)
                })

        cat_blobs = [b for b in all_blobs_info if b["is_cat"]]
        if anim_id == "idle-old":
            print(f"{anim_id}: number of cat blobs found={len(cat_blobs)} (expected {expected_frames})")

        # Step 3: Frame count validation
        if len(cat_blobs) != expected_frames:
            if anim_id == "idle-old":
                print(f"{anim_id}: frame count mismatch ({len(cat_blobs)} detected vs {expected_frames} expected) - keeping previous idle-old.png")
            not_installed.append({
                "file": fname,
                "anim_id": anim_id,
                "expected": expected_frames,
                "detected": len(cat_blobs),
                "scale": None,
                "baseline_y": None,
                "reason": f"Frame count mismatch ({len(cat_blobs)} detected vs {expected_frames} expected)",
                "cat_blobs": cat_blobs,
                "clipping_overflows": [],
                "removed_sparkles": removed_sparkles,
                "recoloured_pixels": 0
            })
            continue

        cats = []
        for c in cat_blobs:
            b_lbl = c["lbl"]
            ys, xs = np.where(lbl == b_lbl)
            cats.append({
                "lbl": b_lbl,
                "min_y": int(ys.min()), "max_y": int(ys.max()),
                "min_x": int(xs.min()), "max_x": int(xs.max()),
                "cy": float(ys.mean()), "cx": float(xs.mean()),
                "bbox_cx": float((xs.min() + xs.max()) / 2.0),
                "h": int(ys.max() - ys.min() + 1),
                "w": int(xs.max() - xs.min() + 1),
                "bottom": int(ys.max()), "top": int(ys.min())
            })

        # Cluster cats into rows
        cats_by_cy = sorted(cats, key=lambda c: c["cy"])
        rows = []
        current_row = [cats_by_cy[0]]
        for c in cats_by_cy[1:]:
            if c["cy"] - current_row[-1]["cy"] > 120:
                rows.append(current_row)
                current_row = [c]
            else:
                current_row.append(c)
        rows.append(current_row)

        sorted_cats = []
        cat_to_row_idx = {}
        for r_idx, r in enumerate(rows):
            r.sort(key=lambda c: c["cx"])
            for c in r:
                cat_to_row_idx[len(sorted_cats)] = r_idx
                sorted_cats.append(c)

        row_dividers = [max(c["bottom"] for c in r) for r in rows[:-1]]
        row_ground_ys = [max(c["bottom"] for c in r) for r in rows]
        row_top_ys = [min(c["top"] for c in r) for r in rows]

        # Step 4: Recolour teal earcups to purple in head area of cat blobs
        arr, recoloured_count, recoloured_median_hsv = recolour_teal_to_purple(arr, sorted_cats, lbl, ref_hsv)
        if recoloured_count > 0:
            print(f"{anim_id}: recoloured {recoloured_count} teal earcup pixels to purple (median HSV: H={recoloured_median_hsv[0]:.2f}, S={recoloured_median_hsv[1]:.4f}, V={recoloured_median_hsv[2]:.4f})")
        else:
            print(f"{anim_id}: 0 teal earcup pixels recoloured")

        # Merge props per row
        full_frame_masks = {idx: (lbl == c["lbl"]) for idx, c in enumerate(sorted_cats)}
        prop_lbls = [i for i in range(1, num + 1) if 5 < sizes[i] <= 25000]
        cat_props_map = {idx: [] for idx in range(len(sorted_cats))}
        for p_lbl in prop_lbls:
            p_ys, p_xs = np.where(lbl == p_lbl)
            p_cy = p_ys.mean()
            p_cx = p_xs.mean()

            r_idx = 0
            for div in row_dividers:
                if p_cy > div:
                    r_idx += 1
                else:
                    break
            r_idx = min(r_idx, len(rows) - 1)
            row_cats = rows[r_idx]
            dists = [np.hypot(p_cx - c["cx"], p_cy - c["cy"]) for c in row_cats]
            best_cat = row_cats[np.argmin(dists)]
            best_idx = sorted_cats.index(best_cat)
            full_frame_masks[best_idx] |= (lbl == p_lbl)
            cat_props_map[best_idx].append(int(p_lbl))

        if anim_id == "idle-old":
            for f_i in range(len(sorted_cats)):
                print(f"{anim_id}: frame {f_i} note blobs count={len(cat_props_map[f_i])}")

        # Scale factor
        cat_heights = [c["h"] for c in sorted_cats]
        hp_med_h = float(np.median(cat_heights))
        orig_med_h, orig_med_bottom, orig_med_cx = get_orig_metrics(anim_id, expected_frames)
        computed_scale = orig_med_h / hp_med_h
        if anim_id == "idle-old":
            print(f"{anim_id}: scale={computed_scale:.4f}")

        anchor_type = "top" if anim_id == "drag" else ("center" if anim_id == "fall" else "ground")
        target_ground_y = 291.0 if anchor_type == "ground" else orig_med_bottom

        def test_placement_with_scale(s):
            overflow_list = []
            info_list = []
            for idx, c in enumerate(sorted_cats):
                f_mask = full_frame_masks[idx]
                f_ys, f_xs = np.where(f_mask)
                min_y, max_y = int(f_ys.min()), int(f_ys.max())
                min_x, max_x = int(f_xs.min()), int(f_xs.max())

                scaled_w = max(1, int(round((max_x - min_x + 1) * s)))
                scaled_h = max(1, int(round((max_y - min_y + 1) * s)))

                body_rel_cx = (c["bbox_cx"] - min_x) * s
                target_x = 105.0 - body_rel_cx
                dest_x0 = int(round(target_x))
                dest_x1 = dest_x0 + scaled_w - 1

                r_idx = cat_to_row_idx[idx]
                if anchor_type == "top":
                    row_top = row_top_ys[r_idx]
                    target_y = 8.0 + (min_y - row_top) * s
                elif anchor_type == "center":
                    row_cy = (row_top_ys[r_idx] + row_ground_ys[r_idx]) / 2.0
                    target_y = 150.0 + (min_y - row_cy) * s
                else:
                    row_ground = row_ground_ys[r_idx]
                    target_y = target_ground_y + (min_y - row_ground) * s

                dest_y0 = int(round(target_y))
                dest_y1 = dest_y0 + scaled_h - 1

                # Fallback (a): Horizontal shift within cell if scaled_w <= 208
                shift_x = 0
                if scaled_w <= 208:
                    if dest_x0 < 1:
                        shift_x = 1 - dest_x0
                    elif dest_x1 > 208:
                        shift_x = 208 - dest_x1

                dest_x0_s = dest_x0 + shift_x
                dest_x1_s = dest_x1 + shift_x

                if dest_x0_s < 1 or dest_x1_s > 208 or dest_y0 < 1 or dest_y1 > 298:
                    overflow_list.append({
                        "frame": idx,
                        "bbox": [dest_x0_s, dest_y0, scaled_w, scaled_h],
                        "overflow_left": max(0, 1 - dest_x0_s),
                        "overflow_right": max(0, dest_x1_s - 208),
                        "overflow_top": max(0, 1 - dest_y0),
                        "overflow_bottom": max(0, dest_y1 - 298)
                    })

                info_list.append({
                    "frame": idx,
                    "min_x": min_x, "max_x": max_x,
                    "min_y": min_y, "max_y": max_y,
                    "dest_x0": dest_x0_s, "dest_y0": dest_y0,
                    "scaled_w": scaled_w, "scaled_h": scaled_h,
                    "shift_x": shift_x,
                    "mask": f_mask[min_y:max_y+1, min_x:max_x+1]
                })

            return overflow_list, info_list

        overflows, frame_placement_info = test_placement_with_scale(computed_scale)
        scale = computed_scale
        scale_reduction_applied = False

        if len(overflows) > 0:
            # Fallback (b): reduce uniform scale by minimum needed, capped at computed_scale * 0.97
            min_allowed_scale = computed_scale * 0.97
            # Search for highest scale in [min_allowed_scale, computed_scale]
            best_s = None
            best_info = None
            for cand_s in np.linspace(computed_scale, min_allowed_scale, 301):
                c_overflows, c_info = test_placement_with_scale(cand_s)
                if len(c_overflows) == 0:
                    best_s = cand_s
                    best_info = c_info
                    break

            if best_s is not None:
                scale = best_s
                frame_placement_info = best_info
                overflows = []
                scale_reduction_applied = True
                print(f"{anim_id}: Fallback (b) scale reduction: {computed_scale:.4f} -> {scale:.4f} ({(1.0 - scale/computed_scale)*100:.2f}% reduction)")

        shifts_applied = [
            {"frame": f["frame"], "shift_x": f["shift_x"]}
            for f in frame_placement_info if f["shift_x"] != 0
        ]
        if shifts_applied:
            print(f"{anim_id}: Fallback (a) shifts applied: {shifts_applied}")

        if anim_id == "idle-old":
            for p in frame_placement_info:
                f_idx = p["frame"]
                x0 = p["dest_x0"]
                y0 = p["dest_y0"]
                w_s = p["scaled_w"]
                h_s = p["scaled_h"]
                x1 = x0 + w_s - 1
                y1 = y0 + h_s - 1
                print(f"{anim_id}: frame {f_idx} destination bbox=[{x0}, {y0}, {w_s}, {h_s}], margins: left={x0}, right={209-x1}, top={y0}, bottom={299-y1}")

        if len(overflows) > 0:
            if anim_id == "idle-old":
                print(f"{anim_id}: margin validation failed ({len(overflows)} frame(s) overflow) - keeping previous idle-old.png")
            not_installed.append({
                "file": fname,
                "anim_id": anim_id,
                "expected": expected_frames,
                "detected": len(cat_blobs),
                "scale": scale,
                "computed_scale": computed_scale,
                "baseline_y": target_ground_y,
                "reason": f"Clipping overflow ({len(overflows)} frame(s) overflow 210x300 cell)",
                "cat_blobs": cat_blobs,
                "clipping_overflows": overflows,
                "removed_sparkles": removed_sparkles,
                "recoloured_pixels": recoloured_count,
                "recoloured_median_hsv": recoloured_median_hsv,
                "reference_median_hsv": list(ref_hsv),
                "shifts_applied": shifts_applied,
                "scale_reduction_applied": scale_reduction_applied
            })
            continue

        # Step 5: Repack clean strip
        strip_canvas = np.zeros((300, expected_frames * 210, 4), dtype=np.uint8)

        for idx, pinfo in enumerate(frame_placement_info):
            raw_crop = arr[pinfo["min_y"]:pinfo["max_y"]+1, pinfo["min_x"]:pinfo["max_x"]+1].copy()
            raw_crop[~pinfo["mask"]] = 0

            crop_pil = Image.fromarray(raw_crop)
            scaled_pil = crop_pil.resize((pinfo["scaled_w"], pinfo["scaled_h"]), resample=Image.Resampling.NEAREST)
            scaled_arr = np.array(scaled_pil)

            # Binary alpha
            scaled_arr[scaled_arr[:, :, 3] < 128, 3] = 0
            scaled_arr[scaled_arr[:, :, 3] >= 128, 3] = 255
            scaled_arr[scaled_arr[:, :, 3] == 0] = [0, 0, 0, 0]


            cell_x0 = idx * 210 + pinfo["dest_x0"]
            cell_y0 = pinfo["dest_y0"]
            sw = pinfo["scaled_w"]
            sh = pinfo["scaled_h"]

            strip_canvas[cell_y0:cell_y0+sh, cell_x0:cell_x0+sw] = scaled_arr

        # Verify margin
        for idx in range(expected_frames):
            c_crop = strip_canvas[:, idx*210:(idx+1)*210]
            assert not np.any(c_crop[0, :, 3] > 0), f"{anim_id} frame {idx} touches y=0"
            assert not np.any(c_crop[299, :, 3] > 0), f"{anim_id} frame {idx} touches y=299"
            assert not np.any(c_crop[:, 0, 3] > 0), f"{anim_id} frame {idx} touches x=0"
            assert not np.any(c_crop[:, 209, 3] > 0), f"{anim_id} frame {idx} touches x=209"

        if anim_id == "idle-old":
            # Verification for idle-old (Gemini sheet pipeline)
            print("Verification for idle-old:")
            for f_idx in range(expected_frames):
                frame = strip_canvas[:, f_idx*210:(f_idx+1)*210]
                alpha = frame[:, :, 3] > 0
                r_f = frame[:, :, 0].astype(int)
                g_f = frame[:, :, 1].astype(int)
                b_f = frame[:, :, 2].astype(int)

                # Count opaque pixels near magenta bg colour (~216,42,216)
                near_bg = alpha & (np.abs(r_f - 216) < 50) & (g_f < 80) & (np.abs(b_f - 216) < 50)
                near_bg_count = int(np.count_nonzero(near_bg))

                # Connected components
                lbl_f, num_f = label(alpha)
                sizes_f = np.bincount(lbl_f.ravel())
                cats_f = sum(1 for i in range(1, num_f + 1) if sizes_f[i] > 500)
                notes_f = sum(1 for i in range(1, num_f + 1) if 5 < sizes_f[i] <= 500)

                # Black/white fringe check: pixels adjacent to transparent with
                # min(r,g,b) >= 200 or max(r,g,b) <= 8
                min_rgb_f = np.minimum(np.minimum(r_f, g_f), b_f)
                max_rgb_f = np.maximum(np.maximum(r_f, g_f), b_f)
                dist_f = distance_transform_edt(alpha)
                edge_px = alpha & (dist_f <= 1.5)
                white_fringe = edge_px & (min_rgb_f >= 200)
                black_fringe = edge_px & (max_rgb_f <= 8)
                wf_count = int(np.count_nonzero(white_fringe))
                bf_count = int(np.count_nonzero(black_fringe))

                print(f"  Frame {f_idx}: near-bg pixels={near_bg_count} (MUST BE 0), "
                      f"components: {cats_f} cat+{notes_f} notes, "
                      f"white_fringe={wf_count}, black_fringe={bf_count}")

            # Generate 4x nearest-neighbour zoomed preview on light and dark backgrounds
            strip_pil = Image.fromarray(strip_canvas)
            zoom_w, zoom_h = expected_frames * 210 * 4, 300 * 4
            zoom_strip = strip_pil.resize((zoom_w, zoom_h), resample=Image.Resampling.NEAREST)

            for bg_name, bg_color in [("light", (245, 245, 245, 255)), ("dark", (24, 24, 28, 255))]:
                zoom_bg = Image.new("RGBA", (zoom_w, zoom_h), bg_color)
                zoom_bg.alpha_composite(zoom_strip, (0, 0))
                p = os.path.join(PREVIEW_DIR, f"idle-old_final_{bg_name}.png")
                zoom_bg.save(p, format="PNG")
                print(f"idle-old 4x {bg_name} preview saved to: {p}")

            # Generate side-by-side: idle-old frames next to 6 idle frames, 3x nearest, light bg
            idle_new_path = os.path.join(OUTPUT_DIR, "idle.png")
            if os.path.exists(idle_new_path):
                idle_new_im = Image.open(idle_new_path).convert("RGBA")
                idle_new_frames = min(6, idle_new_im.width // 210)
                total_cmp_frames = expected_frames + idle_new_frames
                cmp_w = total_cmp_frames * 210 * 3
                cmp_h = 300 * 3
                cmp_bg = Image.new("RGBA", (cmp_w, cmp_h), (245, 245, 245, 255))

                for fi in range(expected_frames):
                    f_crop = strip_pil.crop((fi * 210, 0, (fi + 1) * 210, 300))
                    f_zoom = f_crop.resize((210 * 3, 300 * 3), resample=Image.Resampling.NEAREST)
                    cmp_bg.alpha_composite(f_zoom, (fi * 210 * 3, 0))

                for fi in range(idle_new_frames):
                    f_crop = idle_new_im.crop((fi * 210, 0, (fi + 1) * 210, 300))
                    f_zoom = f_crop.resize((210 * 3, 300 * 3), resample=Image.Resampling.NEAREST)
                    cmp_bg.alpha_composite(f_zoom, ((expected_frames + fi) * 210 * 3, 0))

                draw_cmp = ImageDraw.Draw(cmp_bg)
                sep_x = expected_frames * 210 * 3
                draw_cmp.line([(sep_x, 0), (sep_x, cmp_h)], fill=(120, 120, 120, 255), width=2)
                draw_cmp.text((10, 10), "idle-old", fill=(60, 60, 60, 255))
                draw_cmp.text((sep_x + 10, 10), "idle (new)", fill=(60, 60, 60, 255))

                cmp_path = os.path.join(PREVIEW_DIR, "idle-old_vs_idle.png")
                cmp_bg.save(cmp_path, format="PNG")
                print(f"idle-old vs idle comparison saved to: {cmp_path}")

        out_strip_path = os.path.join(OUTPUT_DIR, f"{anim_id}.png")
        out_im = Image.fromarray(strip_canvas)
        out_im.save(out_strip_path, format="PNG", optimize=True)

        # Step 6: Contact sheet preview
        if anim_id == "idle-old":
            sheet = Image.open(OLD_SHEET_PATH).convert("RGBA")
            s_arr = np.array(sheet)
            orig_top = np.zeros((300, 2 * 210, 4), dtype=np.uint8)
            for f in range(2):
                col = f % 4
                row = f // 4
                orig_top[:, f*210:(f+1)*210] = s_arr[row*300:(row+1)*300, col*210:(col+1)*210]
            top_im = Image.fromarray(orig_top)
        else:
            orig_path = os.path.join(ORIG_DIR, f"{anim_id}.png")
            top_im = Image.open(orig_path).convert("RGBA")

        preview_canvas = Image.new("RGBA", (expected_frames * 210, 600), (30, 30, 30, 255))
        for cy in range(0, 600, 20):
            for cx in range(0, expected_frames * 210, 20):
                if ((cx // 20) + (cy // 20)) % 2 == 1:
                    ImageDraw.Draw(preview_canvas).rectangle([cx, cy, cx+19, cy+19], fill=(42, 42, 42, 255))

        preview_canvas.alpha_composite(top_im, (0, 0))
        preview_canvas.alpha_composite(out_im, (0, 300))

        draw = ImageDraw.Draw(preview_canvas)
        for k in range(1, expected_frames):
            draw.line([(k * 210, 0), (k * 210, 600)], fill=(120, 120, 120, 120), width=1)
        draw.line([(0, 300), (expected_frames * 210, 300)], fill=(180, 180, 180, 180), width=1)

        preview_path = os.path.join(PREVIEW_DIR, f"{anim_id}_preview.png")
        preview_canvas.save(preview_path, format="PNG")

        last_frame_prop_count = len(cat_props_map[expected_frames - 1])

        installed.append({
            "file": fname,
            "anim_id": anim_id,
            "expected": expected_frames,
            "detected": len(cat_blobs),
            "scale": scale,
            "computed_scale": computed_scale,
            "baseline_y": target_ground_y,
            "status": "INSTALLED",
            "removed_sparkles": removed_sparkles,
            "recoloured_pixels": recoloured_count,
            "recoloured_median_hsv": recoloured_median_hsv,
            "reference_median_hsv": list(ref_hsv),
            "shifts_applied": shifts_applied,
            "scale_reduction_applied": scale_reduction_applied,
            "last_frame_props_count": last_frame_prop_count
        })

    installed_anim_ids = set([item["anim_id"] for item in installed])

    if not is_partial:
        # Full run: remove uninstalled strips from OUTPUT_DIR
        for f in os.listdir(OUTPUT_DIR):
            if f.endswith(".png"):
                aid = f.replace(".png", "")
                if aid not in installed_anim_ids and aid != "sitdown" and aid != "idle-old":
                    os.remove(os.path.join(OUTPUT_DIR, f))
                    print(f"Removed uninstalled strip: {f}")
        hp_manifest = {}
    else:
        # Partial run: preserve existing entries in headphones manifest
        hp_manifest = dict(anims_manifest.get("headphones", {}))

    for item in installed:
        aid = item["anim_id"]
        if aid == "idle-old":
            hp_manifest[aid] = {
                "name": "idle-old",
                "frames": 2,
                "fps": 2,
                "mode": "loop",
                "anchor": "ground",
                "cellWidth": 210,
                "cellHeight": 300
            }
        else:
            orig_meta = anims_manifest["animations"][aid]
            hp_manifest[aid] = {
                "name": aid,
                "frames": orig_meta["frames"],
                "fps": orig_meta["fps"],
                "mode": orig_meta["mode"],
                "anchor": orig_meta["anchor"],
                "cellWidth": 210,
                "cellHeight": 300
            }

    if is_partial:
        for item in not_installed:
            aid = item["anim_id"]
            if aid in hp_manifest:
                del hp_manifest[aid]

    # Handle derived sitdown if standup was installed
    if "standup" in installed_anim_ids:
        standup_path = os.path.join(OUTPUT_DIR, "standup.png")
        standup_im = Image.open(standup_path).convert("RGBA")
        standup_arr = np.array(standup_im)
        num_frames = anims_manifest["animations"]["standup"]["frames"]
        sitdown_arr = np.zeros_like(standup_arr)
        for f in range(num_frames):
            rev_f = num_frames - 1 - f
            sitdown_arr[:, f * 210:(f + 1) * 210] = standup_arr[:, rev_f * 210:(rev_f + 1) * 210]
        sitdown_path = os.path.join(OUTPUT_DIR, "sitdown.png")
        sit_im = Image.fromarray(sitdown_arr)
        sit_im.save(sitdown_path, format="PNG", optimize=True)

        orig_sit_meta = anims_manifest["animations"]["sitdown"]
        hp_manifest["sitdown"] = {
            "name": "sitdown",
            "frames": orig_sit_meta["frames"],
            "fps": orig_sit_meta["fps"],
            "mode": orig_sit_meta["mode"],
            "anchor": orig_sit_meta["anchor"],
            "cellWidth": 210,
            "cellHeight": 300
        }

        orig_sit_path = os.path.join(ORIG_DIR, "sitdown.png")
        orig_sit_im = Image.open(orig_sit_path).convert("RGBA")
        preview_canvas = Image.new("RGBA", (num_frames * 210, 600), (30, 30, 30, 255))
        preview_canvas.alpha_composite(orig_sit_im, (0, 0))
        preview_canvas.alpha_composite(sit_im, (0, 300))
        draw = ImageDraw.Draw(preview_canvas)
        for k in range(1, num_frames):
            draw.line([(k * 210, 0), (k * 210, 600)], fill=(120, 120, 120, 120), width=1)
        draw.line([(0, 300), (num_frames * 210, 300)], fill=(180, 180, 180, 180), width=1)
        preview_canvas.save(os.path.join(PREVIEW_DIR, "sitdown_preview.png"), format="PNG")
        print("Derived and installed sitdown headphone strip.")
    elif is_partial and "standup" in [item["anim_id"] for item in not_installed]:
        if "sitdown" in hp_manifest:
            del hp_manifest["sitdown"]
        sit_path = os.path.join(OUTPUT_DIR, "sitdown.png")
        if os.path.exists(sit_path):
            os.remove(sit_path)

    anims_manifest["headphones"] = hp_manifest
    with open(ANIMS_JSON, "w", encoding="utf-8") as f:
        json.dump(anims_manifest, f, indent=2)
        f.write('\n')

    report_file = "headphones_remake_report.json" if is_partial else "headphones_build_report.json"
    report_data = {
        "installed": installed,
        "not_installed": not_installed
    }
    with open(os.path.join(REPORT_DIR, report_file), "w") as f:
        json.dump(report_data, f, indent=2, default=lambda o: int(o) if isinstance(o, (np.integer,)) else (float(o) if isinstance(o, (np.floating,)) else (bool(o) if isinstance(o, (np.bool_,)) else str(o))))

    inst_ids = [x["anim_id"] for x in installed]
    if "standup" in installed_anim_ids:
        inst_ids.append("sitdown")
    not_inst_ids = [x["anim_id"] for x in not_installed]
    print(f"Done. Installed {len(inst_ids)} strips ({sorted(inst_ids)}). Not installed {len(not_installed)} ({sorted(not_inst_ids)}).")
    print(f"Report written to: {os.path.join(REPORT_DIR, report_file)}")


if __name__ == "__main__":
    main()
