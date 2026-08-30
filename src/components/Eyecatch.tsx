import { type ArtStyle, CATEGORY_ART_SLUG, createArtwork, type Shape } from '@/lib/art';

/**
 * 記事ごとのアイキャッチ。`seed` が同じなら必ず同じ絵になる。
 * 色は CSS 変数（--art-bg / --art-1..3）で解決するので、ダークモードにも自動で追従する。
 * 装飾なので aria-hidden。意味は見出し・要約・出典が持つ。
 */
export default function Eyecatch({
  seed,
  category,
  intensity = 0.5,
  width = 400,
  height = 150,
  styles,
  style,
  className = '',
}: {
  seed: string;
  category?: string;
  intensity?: number;
  width?: number;
  height?: number;
  /** 使ってよい構図。省略時は全構図から選ぶ */
  styles?: readonly ArtStyle[];
  /** 構図を外から指定する（assignStyles の結果） */
  style?: ArtStyle;
  className?: string;
}) {
  const art = createArtwork(seed, intensity, { width, height }, styles, style);
  const slug = category ? (CATEGORY_ART_SLUG[category] ?? 'other') : 'brand';
  // gradient の id は SVG が同一ページに複数出るので必ず一意にする
  const gid = `eg-${slug}-${Math.abs(hash(seed)).toString(36)}`;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      role="presentation"
      aria-hidden="true"
      data-art={slug}
    >
      <defs>
        <linearGradient id={gid} gradientTransform={`rotate(${art.gradientAngle} 0.5 0.5)`}>
          <stop offset="0%" stopColor="var(--art-bg)" />
          <stop offset="100%" stopColor="var(--art-bg-2)" />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#${gid})`} />
      <g>{art.shapes.map((shape, i) => renderShape(shape, i))}</g>
    </svg>
  );
}

function tone(n: number): string {
  return `var(--art-${(n % 3) + 1})`;
}

function renderShape(shape: Shape, key: number) {
  switch (shape.kind) {
    case 'circle':
      return (
        <circle
          key={key}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill={tone(shape.tone)}
          opacity={round(shape.opacity)}
        />
      );
    case 'ring':
      return (
        <circle
          key={key}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill="none"
          stroke={tone(shape.tone)}
          strokeWidth={round(shape.width)}
          opacity={round(shape.opacity)}
        />
      );
    case 'arc':
      return (
        <circle
          key={key}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill="none"
          stroke={tone(shape.tone)}
          strokeWidth={round(shape.width)}
          opacity={round(shape.opacity)}
        />
      );
    case 'rect':
      return (
        <rect
          key={key}
          x={round(shape.x)}
          y={round(shape.y)}
          width={round(shape.w)}
          height={round(shape.h)}
          fill={tone(shape.tone)}
          opacity={round(shape.opacity)}
          transform={
            shape.rotate
              ? `rotate(${shape.rotate} ${round(shape.x + shape.w / 2)} ${round(shape.y + shape.h / 2)})`
              : undefined
          }
        />
      );
    case 'path':
      return (
        <path
          key={key}
          d={shape.d}
          fill={shape.fill ? tone(shape.tone) : 'none'}
          stroke={shape.fill ? 'none' : tone(shape.tone)}
          strokeWidth={shape.fill ? undefined : round(shape.width ?? 1)}
          strokeLinecap={shape.fill ? undefined : 'round'}
          opacity={round(shape.opacity)}
        />
      );
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
