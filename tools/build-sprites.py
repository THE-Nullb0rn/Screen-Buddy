#!/usr/bin/env python3
"""
Sprite build script for Screen Buddy.
Processes raw redrawn Gemini sprite grids into individual animation strips.
"""

import os
import sys
import argparse
import json
from collections import Counter
from PIL import Image
import numpy as np
from scipy.ndimage import label, binary_dilation, distance_transform_edt

AUTO_SRC_CANDIDATES = [
    '/home/itachi_06/Pictures/Cats-IL/Cat',
    '/home/itachi_06/Projects/Cat/NewFrames',
    '/home/itachi_06/Projects/Cat'
]

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CONFIG_PATH = os.path.join(REPO_ROOT, 'tools', 'sprites', 'animations.json')
OLD_SHEET_PATH = os.path.join(REPO_ROOT, 'src', 'renderer', 'src', 'assets', 'cat-sprite', 'spritesheet.png')
OLD_MANIFEST_PATH = os.path.join(REPO_ROOT, 'src', 'renderer', 'src', 'assets', 'cat-sprite', 'manifest.json')
OUTPUT_DIR = os.path.join(REPO_ROOT, 'src', 'renderer', 'src', 'assets', 'cat-sprite', 'anims')

CELL_WIDTH = 210
CELL_HEIGHT = 300
MARGIN = 4
MAX_FRAME_W = CELL_WIDTH - 2 * MARGIN  # 202
MAX_FRAME_H = CELL_HEIGHT - 2 * MARGIN # 292


def detect_src_dir(passed_src=None):
    if passed_src:
        if os.path.isdir(passed_src) and os.path.isfile(os.path.join(passed_src, 'curious.png')):
            return os.path.abspath(passed_src)
        print(f"Error: Specified --src '{passed_src}' does not exist or does not contain curious.png", file=sys.stderr)
        sys.exit(1)

    for path in AUTO_SRC_CANDIDATES:
        if os.path.isdir(path) and os.path.isfile(os.path.join(path, 'curious.png')):
            return os.path.abspath(path)

    print("Error: Could not auto-detect source art directory. Checked folders:", file=sys.stderr)
    for p in AUTO_SRC_CANDIDATES:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)


def measure_old_reference():
    with open(OLD_MANIFEST_PATH, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    old_sheet = Image.open(OLD_SHEET_PATH).convert('RGBA')

    def get_old_frame_metrics(anim_name, frame_in_anim=0):
        frame_idx = manifest['animations'][anim_name]['frames'][frame_in_anim]
        row = frame_idx // 4
        col = frame_idx % 4
        crop = old_sheet.crop((col * CELL_WIDTH, row * CELL_HEIGHT, (col + 1) * CELL_WIDTH, (row + 1) * CELL_HEIGHT))
        arr = np.array(crop)
        opaque = arr[:, :, 3] > 0
        lbl, num = label(opaque)
        if num == 0:
            return 144, 291, 112, 8
        sizes = [np.sum(lbl == i) for i in range(1, num + 1)]
        max_lbl = np.argmax(sizes) + 1
        ys, xs = np.where(lbl == max_lbl)
        h = int(ys.max() - ys.min() + 1)
        bottom = int(ys.max())
        top = int(ys.min())
        # Measure bottom 3 rows of opaque pixels for ground level x center
        bot_xs = xs[ys >= bottom - 2]
        cx = float((bot_xs.min() + bot_xs.max()) / 2.0)
        return h, bottom, cx, top

    idle_h, idle_bottom, idle_cx, _ = get_old_frame_metrics('idle', 0)
    metrics = {
        'idle_h': idle_h,
        'idle_bottom': idle_bottom,
        'idle_cx': idle_cx,
        'anims': {}
    }
    for anim_name in ['walk', 'sleep', 'typing', 'typingfast', 'drag', 'fall']:
        if anim_name in manifest['animations']:
            h, bottom, cx, top = get_old_frame_metrics(anim_name, 0)
            metrics['anims'][anim_name] = {'h': h, 'bottom': bottom, 'cx': cx, 'top': top}
    return metrics


def remove_background(img_arr):
    """
    Step 2:
    - Flood-fill from borders for pixels close to magenta (tolerance ~70 per channel)
    - Delete remaining magenta-ish (R>190, B>190, G<110) including pink fringes
    - Remove Gemini sparkle watermark in bottom-right corner
    """
    h, w, _ = img_arr.shape
    r = img_arr[:, :, 0].astype(int)
    g = img_arr[:, :, 1].astype(int)
    b = img_arr[:, :, 2].astype(int)

    # Magenta distance <= 70
    dist_r = np.abs(r - 255)
    dist_g = np.abs(g - 0)
    dist_b = np.abs(b - 255)
    near_mag = (dist_r <= 70) & (dist_g <= 70) & (dist_b <= 70)

    # Flood fill from image borders
    border_mask = np.zeros((h, w), dtype=bool)
    border_mask[0, :] = True
    border_mask[-1, :] = True
    border_mask[:, 0] = True
    border_mask[:, -1] = True

    lbl, num = label(near_mag)
    border_labels = np.unique(lbl[border_mask])
    border_labels = border_labels[border_labels > 0]
    bg_mask = np.isin(lbl, border_labels)

    # Delete remaining magenta-ish
    is_mag = (r > 190) & (b > 190) & (g < 110)
    bg_mask |= is_mag

    # Watermark removal: Gemini sparkle in bottom-right 180x180 px
    # Color: light pink / white / light grey
    corner_y0 = max(0, h - 180)
    corner_x0 = max(0, w - 180)
    cr = r[corner_y0:h, corner_x0:w]
    cg = g[corner_y0:h, corner_x0:w]
    cb = b[corner_y0:h, corner_x0:w]

    is_pink_wm = (cr > 190) & (cb > 190) & (cg >= 100)
    is_white_wm = (cr > 200) & (cg > 200) & (cb > 200)
    is_grey_wm = (np.abs(cr - cg) < 25) & (np.abs(cg - cb) < 25) & (cr >= 115)
    wm_mask = is_pink_wm | is_white_wm | is_grey_wm

    # Only remove components in this corner that are detached from large objects or isolated
    # To be safe, any wm_mask pixel in the bottom-right corner is cleared:
    bg_mask[corner_y0:h, corner_x0:w][wm_mask] = True

    # Pink fringes next to outlines: boundary pixels bordering bg that are pinkish
    dilated_bg = binary_dilation(bg_mask)
    fringe = (~bg_mask) & dilated_bg & (r > 175) & (b > 175) & (g < 125)
    bg_mask |= fringe

    # Additional passes of halo removal directly on raw input
    struct4 = np.array([[0, 1, 0],
                        [1, 1, 1],
                        [0, 1, 0]], dtype=bool)
    for _ in range(3):
        dilated_bg = binary_dilation(bg_mask, structure=struct4)
        halo = (~bg_mask) & dilated_bg & (r > g + 25) & (b > g + 25) & (np.abs(r - b) < 70)
        if not np.any(halo):
            break
        bg_mask |= halo

    non_bg_mask = ~bg_mask
    return non_bg_mask


def slice_into_frames(img_arr, non_bg_mask, cols, rows, total_frames):
    """
    Step 1:
    - Split image into cols x rows cells
    - Connected components of non_bg_mask assigned to cell of centroid
    """
    h, w, _ = img_arr.shape
    cell_w = w / float(cols)
    cell_h = h / float(rows)

    labeled, num_features = label(non_bg_mask)

    frame_masks = [np.zeros((h, w), dtype=bool) for _ in range(total_frames)]

    for comp_id in range(1, num_features + 1):
        ys, xs = np.where(labeled == comp_id)
        if len(xs) == 0:
            continue
        cx = np.mean(xs)
        cy = np.mean(ys)
        col_idx = int(np.clip(cx // cell_w, 0, cols - 1))
        row_idx = int(np.clip(cy // cell_h, 0, rows - 1))
        f_idx = row_idx * cols + col_idx
        if f_idx < total_frames:
            frame_masks[f_idx][ys, xs] = True

    # Crop each frame into cell coordinates [0..cell_w, 0..cell_h]
    # We preserve relative positions: rel_x = x - col * cell_w, rel_y = y - row * cell_h
    raw_frames = []
    for f in range(total_frames):
        c = f % cols
        r = f // cols
        orig_x0 = int(round(c * cell_w))
        orig_y0 = int(round(r * cell_h))
        cw = int(round((c + 1) * cell_w)) - orig_x0
        ch = int(round((r + 1) * cell_h)) - orig_y0

        f_mask = frame_masks[f]
        ys, xs = np.where(f_mask)
        if len(xs) == 0:
            frame_rgba = np.zeros((ch, cw, 4), dtype=np.uint8)
            raw_frames.append({'rgba': frame_rgba, 'body_bbox': None, 'cx': cw / 2, 'bottom': ch})
            continue

        min_gx = xs.min()
        max_gx = xs.max()
        min_gy = ys.min()
        max_gy = ys.max()

        # Canvas bounds accommodating crossing pixels
        min_cx = min(0, min_gx - orig_x0)
        max_cx = max(cw, max_gx - orig_x0 + 1)
        min_cy = min(0, min_gy - orig_y0)
        max_cy = max(ch, max_gy - orig_y0 + 1)

        canv_w = max_cx - min_cx
        canv_h = max_cy - min_cy
        canv_rgba = np.zeros((canv_h, canv_w, 4), dtype=np.uint8)

        # Place pixels
        local_x = xs - orig_x0 - min_cx
        local_y = ys - orig_y0 - min_cy
        canv_rgba[local_y, local_x, :3] = img_arr[ys, xs, :3]
        canv_rgba[local_y, local_x, 3] = 255

        # Measure body (largest dark component)
        dark_pixels = (canv_rgba[:, :, 3] > 0) & (canv_rgba[:, :, 0] < 125) & (canv_rgba[:, :, 1] < 125) & (canv_rgba[:, :, 2] < 125)
        d_lbl, d_num = label(dark_pixels)
        if d_num > 0:
            d_sizes = [np.sum(d_lbl == i) for i in range(1, d_num + 1)]
            m_lbl = np.argmax(d_sizes) + 1
            by, bx = np.where(d_lbl == m_lbl)
            body_bbox = (bx.min(), by.min(), bx.max(), by.max())
            body_cx = float((bx.min() + bx.max()) / 2.0)
            body_bottom = int(by.max())
            body_top = int(by.min())
        else:
            by, bx = np.where(canv_rgba[:, :, 3] > 0)
            body_bbox = (bx.min(), by.min(), bx.max(), by.max())
            body_cx = float((bx.min() + bx.max()) / 2.0)
            body_bottom = int(by.max())
            body_top = int(by.min())

        raw_frames.append({
            'rgba': canv_rgba,
            'body_bbox': body_bbox,
            'body_cx': body_cx,
            'body_bottom': body_bottom,
            'body_top': body_top,
            'offset_origin': (min_cx, min_cy)
        })

    return raw_frames


def compute_scale(raw_frames, ref_str, old_metrics):
    """
    Step 4: Scale calculation based on ref_str
    """
    if ref_str.startswith('idle:'):
        target_h = old_metrics['idle_h']
        canon_idx = int(ref_str.split(':')[1])
    elif ref_str.startswith('old:'):
        old_name = ref_str.split(':')[1]
        target_h = old_metrics['anims'].get(old_name, {}).get('h', old_metrics['idle_h'])
        canon_idx = 0
    else:
        target_h = old_metrics['idle_h']
        canon_idx = 0

    canon_frame = raw_frames[min(canon_idx, len(raw_frames) - 1)]
    if canon_frame['body_bbox'] is not None:
        min_x, min_y, max_x, max_y = canon_frame['body_bbox']
        source_h = max_y - min_y + 1
    else:
        source_h = canon_frame['rgba'].shape[0]

    if source_h <= 0:
        source_h = 1

    scale = target_h / float(source_h)
    return scale


def check_and_apply_shrink(raw_frames, scale):
    """
    Ensure every frame fits in 210x300 with 4px margin (202x292)
    Only considers the cat body (the largest connected component per frame);
    small detached parts (sparks, motion lines, floating bits, area < 15% of the body)
    must never cause shrinking, they are simply clipped at the canvas edge.
    """
    max_w = 0
    max_h = 0
    for f in raw_frames:
        rgba = f['rgba']
        opaque = rgba[:, :, 3] > 0
        lbl, num = label(opaque)
        if num == 0:
            continue
        sizes = [np.sum(lbl == i) for i in range(1, num + 1)]
        max_size = max(sizes)
        keep_mask = np.zeros_like(opaque)
        for i in range(1, num + 1):
            if sizes[i - 1] >= 0.15 * max_size:
                keep_mask |= (lbl == i)

        ys, xs = np.where(keep_mask)
        if len(xs) > 0:
            fw = int(np.ceil((xs.max() - xs.min() + 1) * scale))
            fh = int(np.ceil((ys.max() - ys.min() + 1) * scale))
            if fw > max_w:
                max_w = fw
            if fh > max_h:
                max_h = fh

    shrink_factor = 1.0
    if max_w > MAX_FRAME_W or max_h > MAX_FRAME_H:
        shrink_w = MAX_FRAME_W / float(max_w) if max_w > MAX_FRAME_W else 1.0
        shrink_h = MAX_FRAME_H / float(max_h) if max_h > MAX_FRAME_H else 1.0
        shrink_factor = min(shrink_w, shrink_h)

    final_scale = scale * shrink_factor
    return final_scale, shrink_factor


def process_animation(anim_name, entry, src_dir, old_metrics, computed_scales=None):
    """
    Processes one animation and returns strip image and metrics.
    """
    source_rel = entry['source']
    source_path = os.path.join(src_dir, source_rel)
    if not os.path.isfile(source_path):
        # Fallback to top level of SRC_DIR if under Upgrade/
        base_name = os.path.basename(source_rel)
        alt_path = os.path.join(src_dir, base_name)
        if os.path.isfile(alt_path):
            source_path = alt_path
        else:
            return None, f"File missing: {source_rel}"

    cols, rows = map(int, entry['grid'].split('x'))
    total_frames = entry['frames']
    anchor = entry.get('anchor', 'ground')
    ref = entry.get('ref', 'idle:0')

    img = Image.open(source_path).convert('RGB')
    arr = np.array(img)

    # 1. Background removal
    non_bg_mask = remove_background(arr)

    # 2. Slice into frames
    raw_frames = slice_into_frames(arr, non_bg_mask, cols, rows, total_frames)

    # 3. Scale calculation & shrink factor
    same_scale_name = entry.get('sameScaleAs')
    if same_scale_name and computed_scales and same_scale_name in computed_scales:
        final_scale = computed_scales[same_scale_name]
        shrink_factor = 1.0
    else:
        base_scale = compute_scale(raw_frames, ref, old_metrics)
        final_scale, shrink_factor = check_and_apply_shrink(raw_frames, base_scale)

    if computed_scales is not None:
        computed_scales[anim_name] = final_scale

    # 4. Scale each frame with NEAREST
    scaled_frames = []
    for f in raw_frames:
        rgba = f['rgba']
        pil_im = Image.fromarray(rgba, 'RGBA')
        new_w = max(1, int(round(pil_im.width * final_scale)))
        new_h = max(1, int(round(pil_im.height * final_scale)))
        scaled_pil = pil_im.resize((new_w, new_h), resample=Image.Resampling.NEAREST)
        s_arr = np.array(scaled_pil)

        # Binary alpha
        s_arr[s_arr[:, :, 3] < 128, 3] = 0
        s_arr[s_arr[:, :, 3] >= 128, 3] = 255
        # Zero RGB where A == 0
        s_arr[s_arr[:, :, 3] == 0] = [0, 0, 0, 0]

        # Re-compute body metrics on scaled frame
        ys, xs = np.where(s_arr[:, :, 3] > 0)
        if len(xs) > 0:
            dark_pixels = (s_arr[:, :, 3] > 0) & (s_arr[:, :, 0] < 125) & (s_arr[:, :, 1] < 125) & (s_arr[:, :, 2] < 125)
            d_lbl, d_num = label(dark_pixels)
            if d_num > 0:
                d_sizes = [np.sum(d_lbl == i) for i in range(1, d_num + 1)]
                m_lbl = np.argmax(d_sizes) + 1
                by, bx = np.where(d_lbl == m_lbl)
                body_bbox = (int(bx.min()), int(by.min()), int(bx.max()), int(by.max()))
                body_bottom = int(by.max())
                body_top = int(by.min())
                body_cx = float((bx.min() + bx.max()) / 2.0)
            else:
                body_bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
                body_bottom = int(ys.max())
                body_top = int(ys.min())
                body_cx = float((xs.min() + xs.max()) / 2.0)
            full_bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
        else:
            body_bbox = (0, 0, 0, 0)
            body_bottom = 0
            body_top = 0
            body_cx = new_w / 2.0
            full_bbox = (0, 0, 0, 0)

        scaled_frames.append({
            'arr': s_arr,
            'body_bbox': body_bbox,
            'body_bottom': body_bottom,
            'body_top': body_top,
            'body_cx': body_cx,
            'full_bbox': full_bbox
        })

    # 5. Positioning in 210x300
    target_ground_y = old_metrics['idle_bottom']  # 291
    target_ground_cx = old_metrics['idle_cx']      # 105

    body_bottoms = [f['body_bottom'] for f in scaled_frames]
    median_bottom = float(np.median(body_bottoms)) if len(body_bottoms) > 0 else 0.0

    # Determine grounded vs airborne
    # Only jump and crouchpounce have airborne frames where the cat leaps
    is_grounded = []
    if anim_name in ['jump', 'crouchpounce']:
        max_bottom = float(np.max(body_bottoms)) if len(body_bottoms) > 0 else 0.0
        grounded_candidates = [b for b in body_bottoms if b >= max_bottom * 0.88]
        median_ground_bottom = float(np.median(grounded_candidates)) if len(grounded_candidates) > 0 else max_bottom
        for f in scaled_frames:
            if f['body_bottom'] < median_ground_bottom * 0.88:
                is_grounded.append(False)
            else:
                is_grounded.append(True)
    else:
        median_ground_bottom = median_bottom
        is_grounded = [True] * len(scaled_frames)

    placed_cells = []
    for idx, f in enumerate(scaled_frames):
        canvas = np.zeros((CELL_HEIGHT, CELL_WIDTH, 4), dtype=np.uint8)
        s_arr = f['arr']
        sw = s_arr.shape[1]
        sh = s_arr.shape[0]

        if anchor == 'top':
            # Align top of body to old drag top (8)
            top_y = old_metrics['anims'].get('drag', {}).get('top', 8)
            py = int(round(top_y - f['body_top']))
            px = int(round(target_ground_cx - f['body_cx']))
        elif anchor == 'center':
            # Align bbox center to canvas center (105, 150)
            min_x, min_y, max_x, max_y = f['full_bbox']
            center_x = (min_x + max_x) / 2.0
            center_y = (min_y + max_y) / 2.0
            px = int(round(CELL_WIDTH / 2.0 - center_x))
            py = int(round(CELL_HEIGHT / 2.0 - center_y))
        else:  # 'ground'
            if is_grounded[idx]:
                py = int(round(target_ground_y - f['body_bottom']))
                # Horizontal alignment: use body position so cat never jitters sideways
                px = int(round(target_ground_cx - f['body_cx']))
            else:
                # Airborne frame: keep drawn offset relative to median ground bottom
                py = int(round(target_ground_y - median_ground_bottom))
                px = int(round(target_ground_cx - f['body_cx']))

        # Clamp px and py so full bounding box never violates 4px margin or touches edge
        fx0, fy0, fx1, fy1 = f['full_bbox']
        min_px = MARGIN - fx0
        max_px = (CELL_WIDTH - 1 - MARGIN) - fx1
        if min_px <= max_px:
            px = int(round(np.clip(px, min_px, max_px)))

        min_py = MARGIN - fy0
        max_py = (CELL_HEIGHT - 1 - MARGIN) - fy1
        if min_py <= max_py:
            py = int(round(np.clip(py, min_py, max_py)))

        # Ensure inside canvas bounds and strictly clipped 1px inside border
        # so Edge (touching edge 0 or CELL-1) is 0
        min_canvas_x = 1
        max_canvas_x = CELL_WIDTH - 2
        min_canvas_y = 1
        max_canvas_y = CELL_HEIGHT - 2

        dst_x0 = max(min_canvas_x, px)
        dst_y0 = max(min_canvas_y, py)
        src_x0 = dst_x0 - px
        src_y0 = dst_y0 - py

        dst_x1 = min(max_canvas_x + 1, px + sw)
        dst_y1 = min(max_canvas_y + 1, py + sh)
        copy_w = dst_x1 - dst_x0
        copy_h = dst_y1 - dst_y0

        if copy_w > 0 and copy_h > 0:
            canvas[dst_y0:dst_y0 + copy_h, dst_x0:dst_x0 + copy_w] = s_arr[src_y0:src_y0 + copy_h, src_x0:src_x0 + copy_w]

        placed_cells.append(canvas)

    # 6. Quantize each frame/strip to <= 48 colours, NO dithering, binary alpha
    strip_w = total_frames * CELL_WIDTH
    strip_h = CELL_HEIGHT
    strip_arr = np.zeros((strip_h, strip_w, 4), dtype=np.uint8)
    for i, c in enumerate(placed_cells):
        strip_arr[:, i * CELL_WIDTH:(i + 1) * CELL_WIDTH] = c

    # Purple halo pixels: after background removal and BEFORE quantization, run up to 3 passes:
    # for every opaque pixel that touches (4-neighbour) a transparent pixel,
    # delete it (alpha 0) if R > G+25 and B > G+25 and |R-B| < 70
    struct4 = np.array([[0, 1, 0],
                        [1, 1, 1],
                        [0, 1, 0]], dtype=bool)

    for _ in range(3):
        r = strip_arr[:, :, 0].astype(int)
        g = strip_arr[:, :, 1].astype(int)
        b = strip_arr[:, :, 2].astype(int)
        a = strip_arr[:, :, 3]
        is_opaque = a > 0
        is_trans = a == 0
        touches_trans = binary_dilation(is_trans, structure=struct4) & is_opaque
        halo = touches_trans & (r > g + 25) & (b > g + 25) & (np.abs(r - b) < 70)
        if not np.any(halo):
            break
        strip_arr[halo, 3] = 0
        strip_arr[halo, :3] = 0

    strip_pil = Image.fromarray(strip_arr, 'RGBA')
    # Quantize to <= 48 colors with NO dithering
    quantized = strip_pil.quantize(colors=48, dither=Image.Dither.NONE).convert('RGBA')
    final_arr = np.array(quantized)

    # Enforce binary alpha & purge any residual magenta-ish pixel
    # Residual magenta: R>190, B>190, G<110
    residual_mag = (final_arr[:, :, 0] > 190) & (final_arr[:, :, 2] > 190) & (final_arr[:, :, 1] < 110)
    final_arr[residual_mag, 3] = 0

    final_arr[final_arr[:, :, 3] < 128, 3] = 0
    final_arr[final_arr[:, :, 3] >= 128, 3] = 255

    # Ensure post-quantization edges also have halo removed
    while True:
        r = final_arr[:, :, 0].astype(int)
        g = final_arr[:, :, 1].astype(int)
        b = final_arr[:, :, 2].astype(int)
        a = final_arr[:, :, 3]
        is_opaque = a > 0
        is_trans = a == 0
        touches_trans = binary_dilation(is_trans, structure=struct4) & is_opaque
        halo = touches_trans & (r > g + 25) & (b > g + 25) & (np.abs(r - b) < 70)
        if not np.any(halo):
            break
        final_arr[halo, 3] = 0

    # Validation check: Fringe count (must be 0)
    r = final_arr[:, :, 0].astype(int)
    g = final_arr[:, :, 1].astype(int)
    b = final_arr[:, :, 2].astype(int)
    a = final_arr[:, :, 3]
    is_opaque = a > 0
    is_trans = a == 0
    touches_trans = binary_dilation(is_trans, structure=struct4) & is_opaque
    fringe_mask = touches_trans & (r > g + 25) & (b > g + 25) & (np.abs(r - b) < 70)
    fringe_count = int(np.sum(fringe_mask))

    # Hidden magenta under transparent pixels:
    # set the RGB of EVERY fully transparent pixel to the RGB of the nearest opaque pixel
    opaque_mask = final_arr[:, :, 3] > 0
    if np.any(opaque_mask):
        _, indices = distance_transform_edt(~opaque_mask, return_indices=True)
        trans_mask = final_arr[:, :, 3] == 0
        final_arr[trans_mask, :3] = final_arr[indices[0][trans_mask], indices[1][trans_mask], :3]

    final_strip = Image.fromarray(final_arr, 'RGBA')

    # Validation checks
    # 1. Pixels still magenta-ish
    r = final_arr[:, :, 0].astype(int)
    g = final_arr[:, :, 1].astype(int)
    b = final_arr[:, :, 2].astype(int)
    a = final_arr[:, :, 3]
    still_mag = int(np.sum((a > 0) & (r > 190) & (b > 190) & (g < 110)))

    # 2. TrMag: count of fully transparent pixels whose RGB is magenta-ish R>190,B>190,G<110, must be 0
    trmag_mask = (a == 0) & (r > 190) & (b > 190) & (g < 110)
    trmag_count = int(np.sum(trmag_mask))

    # 3. Empty frames & edge touching
    empty_frames = 0
    edge_touching = 0
    body_cxs = []
    for i in range(total_frames):
        f_crop = final_arr[:, i * CELL_WIDTH:(i + 1) * CELL_WIDTH]
        ys, xs = np.where(f_crop[:, :, 3] > 0)
        if len(xs) == 0:
            empty_frames += 1
            continue
        if xs.min() == 0 or xs.max() == CELL_WIDTH - 1 or ys.min() == 0 or ys.max() == CELL_HEIGHT - 1:
            edge_touching += 1
        body_cxs.append((xs.min() + xs.max()) / 2.0)

    # Max body jitter between consecutive grounded frames
    max_jitter = 0.0
    for i in range(len(body_cxs) - 1):
        if is_grounded[i] and is_grounded[i + 1]:
            diff = abs(body_cxs[i + 1] - body_cxs[i])
            if diff > max_jitter:
                max_jitter = diff

    metrics = {
        'frames': total_frames,
        'scale': final_scale,
        'shrink_factor': shrink_factor,
        'max_jitter': max_jitter,
        'edge_touching': edge_touching,
        'still_magenta': still_mag,
        'fringe': fringe_count,
        'tr_mag': trmag_count,
        'empty_frames': empty_frames
    }

    # Generate preview contact sheet
    preview_dir = os.path.join(src_dir, '_preview')
    os.makedirs(preview_dir, exist_ok=True)
    contact_w = strip_w
    contact_h = CELL_HEIGHT * 2
    contact = Image.new('RGBA', (contact_w, contact_h), (0, 0, 0, 0))
    # Row 1: dark #1b1b22
    row1_bg = Image.new('RGBA', (contact_w, CELL_HEIGHT), (0x1b, 0x1b, 0x22, 255))
    contact.paste(row1_bg, (0, 0))
    contact.paste(final_strip, (0, 0), final_strip)

    # Row 2: light #e8e8e8 checker
    # Create checker pattern
    checker = Image.new('RGBA', (contact_w, CELL_HEIGHT), (0xe8, 0xe8, 0xe8, 255))
    ch_arr = np.array(checker)
    sq = 14
    for y in range(0, CELL_HEIGHT, sq):
        for x in range(0, contact_w, sq):
            if ((x // sq) + (y // sq)) % 2 == 1:
                ch_arr[y:y + sq, x:x + sq] = [0xff, 0xff, 0xff, 255]
    checker = Image.fromarray(ch_arr, 'RGBA')
    contact.paste(checker, (0, CELL_HEIGHT))
    contact.paste(final_strip, (0, CELL_HEIGHT), final_strip)

    preview_path = os.path.join(preview_dir, f"{anim_name}_preview.png")
    contact.save(preview_path, format='PNG')

    return final_strip, metrics


def main():
    parser = argparse.ArgumentParser(description="Build sprite strips for Screen Buddy")
    parser.add_argument('--src', type=str, default=None, help="Path to source art directory")
    parser.add_argument('names', nargs='*', help="Names of animations to build (default: all)")
    args = parser.parse_args()

    src_dir = detect_src_dir(args.src)
    print(f"Using SRC_DIR: {src_dir}")

    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = json.load(f)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    old_metrics = measure_old_reference()

    selected_names = args.names if len(args.names) > 0 else list(config.keys())

    manifest_output_path = os.path.join(OUTPUT_DIR, 'anims.json')
    if os.path.isfile(manifest_output_path):
        try:
            with open(manifest_output_path, 'r', encoding='utf-8') as f:
                runtime_manifest = json.load(f)
        except Exception:
            runtime_manifest = {
                'cellWidth': CELL_WIDTH,
                'cellHeight': CELL_HEIGHT,
                'animations': {}
            }
    else:
        runtime_manifest = {
            'cellWidth': CELL_WIDTH,
            'cellHeight': CELL_HEIGHT,
            'animations': {}
        }

    reports = []
    skipped = []
    computed_scales = {}

    # Order selected_names so sameScaleAs dependencies are computed first
    ordered_names = []
    visited = set()

    def add_anim(aname):
        if aname in visited or aname not in config:
            return
        dep = config[aname].get('sameScaleAs')
        if dep and dep in config:
            add_anim(dep)
        visited.add(aname)
        ordered_names.append(aname)

    for n in selected_names:
        add_anim(n)

    for name in ordered_names:
        if name not in config:
            print(f"Warning: Unknown animation '{name}', skipping.", file=sys.stderr)
            continue
        entry = config[name]
        strip, res = process_animation(name, entry, src_dir, old_metrics, computed_scales)
        if strip is None:
            skipped.append((name, res))
            print(f"Skipping {name}: {res}")
            continue

        out_png = os.path.join(OUTPUT_DIR, f"{name}.png")
        strip.save(out_png, format='PNG')

        runtime_manifest['animations'][name] = {
            'name': name,
            'frames': entry['frames'],
            'fps': entry['fps'],
            'mode': entry['mode'],
            'anchor': entry['anchor'],
            'cellWidth': CELL_WIDTH,
            'cellHeight': CELL_HEIGHT
        }

        reports.append((name, res))

    with open(manifest_output_path, 'w', encoding='utf-8') as f:
        json.dump(runtime_manifest, f, indent=2)

    # Print validation table
    print("\n" + "=" * 89)
    print("ANIMATION VALIDATION REPORT")
    print("=" * 89)
    print(f"{'Animation':14} | {'Frames':6} | {'Scale':7} | {'Shrink':6} | {'Jitter':6} | {'Edge':4} | {'MagPx':5} | {'Fringe':6} | {'TrMag':5} | {'Empty':5}")
    print("-" * 89)
    for name, r in reports:
        print(f"{name:14} | {r['frames']:6} | {r['scale']:7.4f} | {r['shrink_factor']:6.4f} | {r['max_jitter']:5.1f}p | {r['edge_touching']:4} | {r['still_magenta']:5} | {r['fringe']:6} | {r['tr_mag']:5} | {r['empty_frames']:5}")

    if skipped:
        print("\nSKIPPED / MISSING FILES:")
        for name, reason in skipped:
            print(f"  - {name}: {reason}")
    else:
        print("\nSkipped/missing files: None")
    print("=" * 89)


if __name__ == '__main__':
    main()
