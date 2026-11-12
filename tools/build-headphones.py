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
from scipy.ndimage import label, distance_transform_edt

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
    "old_idle.png": "idle-old",
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


def recolour_teal_to_purple(arr, sorted_cats, lbl):
    """
    Measures earcup colours in the head region of each cat blob.
    Maps teal/blue-grey earcup pixels (hue 165-205 deg, sat >= 0.25, val >= 0.35)
    to reference purple from eat.png (hue ~300 deg), preserving Saturation and Value / lightness.
    Restricted to cat head area (y <= top + 0.55 * h) of cat blobs (never props/water bowls).
    """
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

    h_target = 300.0 / 360.0  # reference purple from eat.png earcups
    for y, x in zip(teal_ys, teal_xs):
        s_val = sat[y, x]
        v_val = val[y, x]
        r_new, g_new, b_new = colorsys.hsv_to_rgb(h_target, s_val, v_val)
        arr[y, x, 0] = int(round(r_new * 255))
        arr[y, x, 1] = int(round(g_new * 255))
        arr[y, x, 2] = int(round(b_new * 255))

    return arr, recoloured_count


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
        all_remake_files = sorted([f for f in os.listdir(src_dir) if f.endswith("_1.png")])
        for fname in all_remake_files:
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
        # For REMAKE_IDS, remake/*_1.png overrides main folder
        is_partial = bool(args.ids)
        remake_dir = os.path.join(SRC_DIR, "remake")
        for fname, aid in sorted(FILE_TO_ANIM.items()):
            if target_ids and aid not in target_ids:
                continue
            if aid in REMAKE_IDS:
                rname = f"{aid}_1.png"
                rpath = os.path.join(remake_dir, rname)
                if os.path.exists(rpath):
                    files_to_process.append((rname, aid, rpath))
                    continue
            files_to_process.append((fname, aid, os.path.join(SRC_DIR, fname)))

    installed = []
    not_installed = []

    for fname, anim_id, img_path in files_to_process:
        expected_frames = 2 if anim_id == "idle-old" else anims_manifest["animations"][anim_id]["frames"]

        im = Image.open(img_path).convert("RGBA")
        arr = np.array(im)
        h_img, w_img, _ = arr.shape

        # Step 1: Remove background
        if fname == "old_idle.png":
            r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
            near_white = (r > 220) & (g > 220) & (b > 220)
            border_mask = np.zeros(near_white.shape, dtype=bool)
            border_mask[0, :] = border_mask[-1, :] = border_mask[:, 0] = border_mask[:, -1] = True
            lbl, num = label(near_white)
            border_lbls = np.unique(lbl[border_mask])
            border_lbls = border_lbls[border_lbls > 0]
            bg_mask = np.isin(lbl, border_lbls)
            mask = ~bg_mask
            removed_sparkles = []
        else:
            anim_key = anim_id
            if anim_key == "strech":
                anim_key = "stretch"
            mask = remove_background(arr, anim_name=anim_key)
            arr, mask, removed_sparkles = cleanup_sparkles(arr, mask, anim_id)

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

        # Step 3: Frame count validation
        if len(cat_blobs) != expected_frames:
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
        arr, recoloured_count = recolour_teal_to_purple(arr, sorted_cats, lbl)

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

        # Scale factor
        cat_heights = [c["h"] for c in sorted_cats]
        hp_med_h = float(np.median(cat_heights))
        orig_med_h, orig_med_bottom, orig_med_cx = get_orig_metrics(anim_id, expected_frames)
        scale = orig_med_h / hp_med_h

        anchor_type = "top" if anim_id == "drag" else ("center" if anim_id == "fall" else "ground")
        target_ground_y = 291.0 if anchor_type == "ground" else orig_med_bottom

        # Check clipping
        clipped = False
        overflows = []
        frame_placement_info = []

        for idx, c in enumerate(sorted_cats):
            f_mask = full_frame_masks[idx]
            f_ys, f_xs = np.where(f_mask)
            min_y, max_y = int(f_ys.min()), int(f_ys.max())
            min_x, max_x = int(f_xs.min()), int(f_xs.max())

            scaled_w = max(1, int(round((max_x - min_x + 1) * scale)))
            scaled_h = max(1, int(round((max_y - min_y + 1) * scale)))

            body_rel_cx = (c["bbox_cx"] - min_x) * scale
            target_x = 105.0 - body_rel_cx
            dest_x0 = int(round(target_x))
            dest_x1 = dest_x0 + scaled_w - 1

            r_idx = cat_to_row_idx[idx]
            if anchor_type == "top":
                row_top = row_top_ys[r_idx]
                target_y = 8.0 + (min_y - row_top) * scale
            elif anchor_type == "center":
                row_cy = (row_top_ys[r_idx] + row_ground_ys[r_idx]) / 2.0
                target_y = 150.0 + (min_y - row_cy) * scale
            else:
                row_ground = row_ground_ys[r_idx]
                target_y = target_ground_y + (min_y - row_ground) * scale

            dest_y0 = int(round(target_y))
            dest_y1 = dest_y0 + scaled_h - 1

            if dest_x0 < 1 or dest_x1 > 208 or dest_y0 < 1 or dest_y1 > 298:
                clipped = True
                overflow_details = {
                    "frame": idx,
                    "bbox": [dest_x0, dest_y0, scaled_w, scaled_h],
                    "overflow_left": max(0, 1 - dest_x0),
                    "overflow_right": max(0, dest_x1 - 208),
                    "overflow_top": max(0, 1 - dest_y0),
                    "overflow_bottom": max(0, dest_y1 - 298)
                }
                overflows.append(overflow_details)

            frame_placement_info.append({
                "min_x": min_x, "max_x": max_x,
                "min_y": min_y, "max_y": max_y,
                "dest_x0": dest_x0, "dest_y0": dest_y0,
                "scaled_w": scaled_w, "scaled_h": scaled_h,
                "mask": f_mask[min_y:max_y+1, min_x:max_x+1]
            })

        if clipped:
            not_installed.append({
                "file": fname,
                "anim_id": anim_id,
                "expected": expected_frames,
                "detected": len(cat_blobs),
                "scale": scale,
                "baseline_y": target_ground_y,
                "reason": f"Clipping overflow ({len(overflows)} frame(s) overflow 210x300 cell)",
                "cat_blobs": cat_blobs,
                "clipping_overflows": overflows,
                "removed_sparkles": removed_sparkles,
                "recoloured_pixels": recoloured_count
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
            "baseline_y": target_ground_y,
            "status": "INSTALLED",
            "removed_sparkles": removed_sparkles,
            "recoloured_pixels": recoloured_count,
            "last_frame_props_count": last_frame_prop_count
        })

    installed_anim_ids = set([item["anim_id"] for item in installed])

    if not is_partial:
        # Full run: remove uninstalled strips from OUTPUT_DIR
        for f in os.listdir(OUTPUT_DIR):
            if f.endswith(".png"):
                aid = f.replace(".png", "")
                if aid not in installed_anim_ids and aid != "sitdown":
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
