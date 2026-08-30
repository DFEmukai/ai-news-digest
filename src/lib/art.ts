/**
 * アイキャッチ用の抽象画を「決まった入力から必ず同じ絵」になるように組み立てる。
 *
 * 外部の画像を使わない理由:
 * - 元記事の og:image を持ってくるのは他社素材の再配布になる（本文を保存しない方針と矛盾する）
 * - 生成画像をリポジトリに置くと日次コミットで肥大化する
 * - 外部CDNに置くとオフラインで壊れ、GitHub Pages 以外に依存が増える
 *
 * そこで記事IDをシードにした手続き生成にしている。外部リクエストは0、
 * 再ビルドしても同じ記事は同じ絵、1枚あたり1〜2KBのインラインSVGで済む。
 */

export const ART_STYLES = ['arcs', 'bauhaus', 'flow', 'strata', 'orbits', 'lattice'] as const;
export type ArtStyle = (typeof ART_STYLES)[number];

/** FNV-1a。文字列から32bitのシードを作る。 */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32。軽量で分布が十分な決定的PRNG。 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rand {
  /** min 以上 max 未満の実数 */
  range: (min: number, max: number) => number;
  /** min 以上 max 以下の整数 */
  int: (min: number, max: number) => number;
  /** 配列から1つ選ぶ */
  pick: <T>(items: readonly T[]) => T;
  /** 確率 p で true */
  chance: (p: number) => boolean;
}

export function createRand(seed: number): Rand {
  const rng = createRng(seed);
  const range = (min: number, max: number) => min + rng() * (max - min);
  return {
    range,
    int: (min, max) => Math.floor(range(min, max + 1)),
    pick: (items) => items[Math.floor(rng() * items.length)],
    chance: (p) => rng() < p,
  };
}

/**
 * SVG の要素をそのまま配列で持つ。React 側は種類で分岐して描くだけにする。
 * 色は 0〜2 のパレット番号で持ち、実際の色は CSS 変数（テーマ連動）で解決する。
 */
export type Shape =
  | { kind: 'circle'; cx: number; cy: number; r: number; tone: number; opacity: number }
  | { kind: 'ring'; cx: number; cy: number; r: number; width: number; tone: number; opacity: number }
  | {
      kind: 'arc';
      cx: number;
      cy: number;
      r: number;
      width: number;
      from: number;
      to: number;
      tone: number;
      opacity: number;
    }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rotate: number; tone: number; opacity: number }
  | { kind: 'path'; d: string; tone: number; opacity: number; fill: boolean; width?: number };

export interface Artwork {
  style: ArtStyle;
  width: number;
  height: number;
  shapes: Shape[];
  /** 背景に薄いグラデーションを敷くか */
  gradient: boolean;
  /** グラデーションの角度（度） */
  gradientAngle: number;
}

const TAU = Math.PI * 2;

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

/** 円弧を描く path の d を作る（塗りなしのストローク用）。 */
function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > Math.PI ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** 上端が波打つ帯。地層スタイルに使う。 */
function stratumPath(w: number, h: number, baseY: number, amp: number, phase: number, segments: number): string {
  const step = w / segments;
  let d = `M 0 ${(baseY + Math.sin(phase) * amp).toFixed(1)}`;
  for (let i = 1; i <= segments; i++) {
    const x = step * i;
    const y = baseY + Math.sin(phase + (i / segments) * TAU * 1.2) * amp;
    const cx = x - step / 2;
    const cy = baseY + Math.sin(phase + ((i - 0.5) / segments) * TAU * 1.2) * amp;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${w} ${h} L 0 ${h} Z`;
  return d;
}

/** 横に走る波線。 */
function wavePath(w: number, y: number, amp: number, phase: number, cycles: number): string {
  const segments = 24;
  const step = w / segments;
  let d = `M 0 ${(y + Math.sin(phase) * amp).toFixed(1)}`;
  for (let i = 1; i <= segments; i++) {
    const x = step * i;
    const yy = y + Math.sin(phase + (i / segments) * TAU * cycles) * amp;
    d += ` L ${x.toFixed(1)} ${yy.toFixed(1)}`;
  }
  return d;
}

/**
 * 抽象画を1枚作る。
 *
 * @param seedInput シード文字列（記事IDなど）。同じ値なら必ず同じ絵になる
 * @param intensity 0〜1。要素数と濃さのスケール。記事の importance から渡す
 * @param size      描画領域
 * @param allowedStyles 使ってよい構図。横長のヒーローでは面構成を外して線構成に絞る
 * @param forcedStyle  構図を外から指定する。assignStyles() が隣接重複を潰した結果を渡す
 */
export function createArtwork(
  seedInput: string,
  intensity = 0.5,
  size: { width: number; height: number } = { width: 400, height: 150 },
  allowedStyles: readonly ArtStyle[] = ART_STYLES,
  forcedStyle?: ArtStyle,
): Artwork {
  const { width: w, height: h } = size;
  const rand = createRand(hashSeed(seedInput));
  const pool = allowedStyles.length > 0 ? allowedStyles : ART_STYLES;
  // 乱数は構図の選択で必ず1回消費する。forcedStyle の有無で後続の形が変わらないようにするため。
  const drawn = pool[Math.floor(rand.range(0, pool.length))];
  const style = forcedStyle ?? drawn;
  const shapes: Shape[] = [];
  // 濃さは 0.55〜1.0 に収める。薄すぎると何も見えず、濃すぎると文字と競合する
  const k = 0.55 + Math.max(0, Math.min(1, intensity)) * 0.45;

  switch (style) {
    case 'arcs': {
      // 画面外に中心を置いた同心円の一部。余白が大きく取れて上品になる
      const cx = rand.chance(0.5) ? rand.range(-0.2, 0.25) * w : rand.range(0.75, 1.2) * w;
      const cy = rand.chance(0.6) ? rand.range(1.0, 1.5) * h : rand.range(-0.5, -0.05) * h;
      const count = rand.int(4, 7);
      const base = rand.range(0.35, 0.6) * w;
      const gap = rand.range(0.09, 0.16) * w;
      for (let i = 0; i < count; i++) {
        shapes.push({
          kind: 'ring',
          cx,
          cy,
          r: base + gap * i,
          width: rand.range(1.5, 10) * (i % 2 === 0 ? 1 : 0.5),
          tone: i % 3,
          opacity: (0.9 - i * 0.09) * k,
        });
      }
      // 差し色の小さな塗り円をひとつ
      shapes.push({
        kind: 'circle',
        cx: rand.range(0.15, 0.85) * w,
        cy: rand.range(0.2, 0.8) * h,
        r: rand.range(6, 14),
        tone: 2,
        opacity: 0.95 * k,
      });
      break;
    }

    case 'bauhaus': {
      // グリッドに幾何形を置く。1セル1形にして密度を上げすぎない
      const cols = rand.int(3, 4);
      const rows = 2;
      const cw = w / cols;
      const ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand.chance(0.28)) continue; // 意図的に抜いて余白を作る
          const cx = cw * (c + 0.5);
          const cy = ch * (r + 0.5);
          const s = Math.min(cw, ch) * rand.range(0.42, 0.78);
          const tone = rand.int(0, 2);
          const opacity = rand.range(0.5, 0.95) * k;
          const form = rand.int(0, 3);
          if (form === 0) {
            shapes.push({ kind: 'circle', cx, cy, r: s / 2, tone, opacity });
          } else if (form === 1) {
            shapes.push({
              kind: 'rect',
              x: cx - s / 2,
              y: cy - s / 2,
              w: s,
              h: s,
              rotate: rand.pick([0, 0, 45]),
              tone,
              opacity,
            });
          } else if (form === 2) {
            // 四分円
            const q = rand.int(0, 3);
            const [ox, oy] = [cx - s / 2, cy - s / 2];
            const corners: [number, number][] = [
              [ox, oy],
              [ox + s, oy],
              [ox + s, oy + s],
              [ox, oy + s],
            ];
            const [px, py] = corners[q];
            const [ax, ay] = corners[(q + 1) % 4];
            const [bx, by] = corners[(q + 3) % 4];
            shapes.push({
              kind: 'path',
              d: `M ${px.toFixed(1)} ${py.toFixed(1)} L ${ax.toFixed(1)} ${ay.toFixed(1)} A ${s} ${s} 0 0 ${q % 2 === 0 ? 1 : 0} ${bx.toFixed(1)} ${by.toFixed(1)} Z`,
              tone,
              opacity,
              fill: true,
            });
          } else {
            shapes.push({
              kind: 'ring',
              cx,
              cy,
              r: s / 2,
              width: rand.range(2, 5),
              tone,
              opacity,
            });
          }
        }
      }
      break;
    }

    case 'flow': {
      // 等高線のような平行波。線だけなので軽く、文字を邪魔しない
      const count = rand.int(7, 12);
      const cycles = rand.range(0.7, 1.9);
      const phase = rand.range(0, TAU);
      const amp = rand.range(8, 22);
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        shapes.push({
          kind: 'path',
          d: wavePath(w, h * (0.12 + t * 0.78), amp * (0.5 + t * 0.9), phase + i * rand.range(0.1, 0.35), cycles),
          tone: i % 3 === 0 ? 2 : i % 2,
          opacity: (0.25 + t * 0.6) * k,
          fill: false,
          width: i % 4 === 0 ? rand.range(2, 3.5) : rand.range(0.8, 1.6),
        });
      }
      break;
    }

    case 'strata': {
      // 下から積み上げる地層。面で見せるので一番「絵」に近い
      const layers = rand.int(3, 5);
      for (let i = 0; i < layers; i++) {
        const t = i / layers;
        shapes.push({
          kind: 'path',
          d: stratumPath(w, h, h * (0.3 + t * 0.55), rand.range(5, 16), rand.range(0, TAU), 5),
          tone: i % 3,
          opacity: (0.35 + t * 0.5) * k,
          fill: true,
        });
      }
      // 地平線の上に円をひとつ置くと構図が締まる
      shapes.push({
        kind: 'circle',
        cx: rand.range(0.2, 0.8) * w,
        cy: rand.range(0.12, 0.3) * h,
        r: rand.range(10, 24),
        tone: 2,
        opacity: 0.85 * k,
      });
      break;
    }

    case 'orbits': {
      // 細い軌道と、その上に乗る点。余白が多く上品
      const cx = rand.range(0.3, 0.7) * w;
      const cy = rand.range(0.35, 0.65) * h;
      const orbits = rand.int(2, 4);
      for (let i = 0; i < orbits; i++) {
        const r = rand.range(0.2, 0.52) * w * (0.6 + i * 0.35);
        const from = rand.range(0, TAU);
        const to = from + rand.range(1.2, TAU);
        shapes.push({
          kind: 'path',
          d: arcPath(cx, cy, r, from, to),
          tone: i % 3,
          opacity: (0.5 - i * 0.08) * k,
          fill: false,
          width: rand.range(0.8, 1.8),
        });
        const dots = rand.int(1, 3);
        for (let d = 0; d < dots; d++) {
          const a = rand.range(from, to);
          const [px, py] = polar(cx, cy, r, a);
          shapes.push({
            kind: 'circle',
            cx: px,
            cy: py,
            r: rand.range(2.5, 7),
            tone: (i + d) % 3,
            opacity: 0.9 * k,
          });
        }
      }
      shapes.push({ kind: 'circle', cx, cy, r: rand.range(5, 11), tone: 2, opacity: 0.95 * k });
      break;
    }

    case 'lattice': {
      // 斜めの格子と、そこに嵌る三角形
      const step = rand.range(20, 34);
      const dir = rand.chance(0.5) ? 1 : -1;
      for (let x = -h; x < w + h; x += step) {
        shapes.push({
          kind: 'path',
          d: `M ${x.toFixed(1)} 0 L ${(x + dir * h).toFixed(1)} ${h}`,
          tone: 0,
          opacity: 0.28 * k,
          fill: false,
          width: 1,
        });
      }
      const fills = rand.int(2, 4);
      for (let i = 0; i < fills; i++) {
        const x = rand.range(0, w - step * 2);
        const y = rand.range(0, h - step);
        shapes.push({
          kind: 'path',
          d: `M ${x.toFixed(1)} ${y.toFixed(1)} L ${(x + step * 2).toFixed(1)} ${y.toFixed(1)} L ${(x + step * (dir > 0 ? 2 : 0)).toFixed(1)} ${(y + step).toFixed(1)} Z`,
          tone: (i % 2) + 1,
          opacity: rand.range(0.45, 0.85) * k,
          fill: true,
        });
      }
      shapes.push({
        kind: 'circle',
        cx: rand.range(0.2, 0.8) * w,
        cy: rand.range(0.25, 0.75) * h,
        r: rand.range(8, 18),
        tone: 2,
        opacity: 0.8 * k,
      });
      break;
    }
  }

  return {
    style,
    width: w,
    height: h,
    shapes,
    gradient: true,
    gradientAngle: rand.int(0, 3) * 45,
  };
}

/**
 * セクション内の記事に構図を割り当てる。
 *
 * 同じカテゴリのカードは配色が同じなので、構図まで被ると並べたときに見分けがつかない。
 * 基本は記事IDから決まる構図を使い、直前と同じになったときだけ次の構図へずらす。
 * これで「隣接重複ゼロ」を保証しつつ、大半のカードはID由来の構図のままにできる。
 */
export function assignStyles(seeds: readonly string[], pool: readonly ArtStyle[] = ART_STYLES): ArtStyle[] {
  const out: ArtStyle[] = [];
  for (const seed of seeds) {
    const preferred = hashSeed(seed) % pool.length;
    let index = preferred;
    if (out.length > 0 && pool[index] === out[out.length - 1]) {
      index = (index + 1) % pool.length;
    }
    out.push(pool[index]);
  }
  return out;
}

/**
 * 横長の帯（ヒーロー）で成立する構図だけ。
 * bauhaus / strata は正方形に近いセルを前提にしているため、
 * 幅1200・高さ300で slice すると形が大きく切れて構図が壊れる。
 */
export const WIDE_STYLES: readonly ArtStyle[] = ['flow', 'arcs', 'orbits', 'lattice'];

/** カテゴリ名 → CSS で配色を切り替えるためのスラッグ。 */
export const CATEGORY_ART_SLUG: Record<string, string> = {
  'モデル/研究': 'model',
  プロダクト: 'product',
  'ビジネス/資金調達': 'business',
  '規制/政策': 'policy',
  開発ツール: 'tools',
  その他: 'other',
};
