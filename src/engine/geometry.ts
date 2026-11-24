import {
  centerSubPathsAtOrigin,
  clamp,
  cloneSubPaths,
  computeSubPathsBBox,
} from '../core/math';
import type {
  AnchorPoint,
  Point2D,
  SmartShapeOptions,
  SubPath,
} from '../core/types';

export const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

export function createRng(seed?: number): () => number {
  if (seed === undefined) {
    return Math.random;
  }
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSharpAnchor(x: number, y: number): AnchorPoint {
  return {
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    smooth: false,
  };
}

export function createEllipseSubPaths(width: number, height: number): SubPath[] {
  const rx = Math.max(1, Math.abs(width)) / 2;
  const ry = Math.max(1, Math.abs(height)) / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;

  return [
    {
      closed: true,
      anchors: [
        {
          x: 0,
          y: -ry,
          handleIn: { x: -kx, y: 0 },
          handleOut: { x: kx, y: 0 },
          smooth: true,
        },
        {
          x: rx,
          y: 0,
          handleIn: { x: 0, y: -ky },
          handleOut: { x: 0, y: ky },
          smooth: true,
        },
        {
          x: 0,
          y: ry,
          handleIn: { x: kx, y: 0 },
          handleOut: { x: -kx, y: 0 },
          smooth: true,
        },
        {
          x: -rx,
          y: 0,
          handleIn: { x: 0, y: ky },
          handleOut: { x: 0, y: -ky },
          smooth: true,
        },
      ],
    },
  ];
}

export function createRectSubPaths(
  width: number,
  height: number,
  cornerRadius = 0
): SubPath[] {
  const w = Math.max(1, Math.abs(width));
  const h = Math.max(1, Math.abs(height));
  const hw = w / 2;
  const hh = h / 2;
  const r = clamp(cornerRadius, 0, Math.min(hw, hh));

  if (r <= 1e-4) {
    return [
      {
        closed: true,
        anchors: [
          makeSharpAnchor(-hw, -hh),
          makeSharpAnchor(hw, -hh),
          makeSharpAnchor(hw, hh),
          makeSharpAnchor(-hw, hh),
        ],
      },
    ];
  }

  const k = r * KAPPA;
  return [
    {
      closed: true,
      anchors: [
        {
          x: -hw + r,
          y: -hh,
          handleIn: { x: -k, y: 0 },
          handleOut: { x: 0, y: 0 },
          smooth: false,
        },
        {
          x: hw - r,
          y: -hh,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: k, y: 0 },
          smooth: false,
        },
        {
          x: hw,
          y: -hh + r,
          handleIn: { x: 0, y: -k },
          handleOut: { x: 0, y: 0 },
          smooth: false,
        },
        {
          x: hw,
          y: hh - r,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: k },
          smooth: false,
        },
        {
          x: hw - r,
          y: hh,
          handleIn: { x: k, y: 0 },
          handleOut: { x: 0, y: 0 },
          smooth: false,
        },
        {
          x: -hw + r,
          y: hh,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: -k, y: 0 },
          smooth: false,
        },
        {
          x: -hw,
          y: hh - r,
          handleIn: { x: 0, y: k },
          handleOut: { x: 0, y: 0 },
          smooth: false,
        },
        {
          x: -hw,
          y: -hh + r,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: -k },
          smooth: false,
        },
      ],
    },
  ];
}

export function createPolygonSubPaths(
  width: number,
  height: number,
  points: number
): SubPath[] {
  const n = clamp(Math.round(points), 3, 24);
  const w = Math.max(1, Math.abs(width));
  const h = Math.max(1, Math.abs(height));

  const unitAnchors: AnchorPoint[] = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / n;
    unitAnchors.push(makeSharpAnchor(Math.cos(angle), Math.sin(angle)));
  }

  const rawBox = computeSubPathsBBox([{ closed: true, anchors: unitAnchors }]);
  const sx = rawBox.width > 1e-6 ? w / rawBox.width : w / 2;
  const sy = rawBox.height > 1e-6 ? h / rawBox.height : h / 2;

  const scaled: SubPath[] = [
    {
      closed: true,
      anchors: unitAnchors.map((a) => makeSharpAnchor(a.x * sx, a.y * sy)),
    },
  ];

  return centerSubPathsAtOrigin(scaled).subpaths;
}

export function createStarSubPaths(
  width: number,
  height: number,
  points: number,
  innerRadiusRatio: number
): SubPath[] {
  const n = clamp(Math.round(points), 3, 24);
  const ratio = clamp(innerRadiusRatio, 0.1, 0.9);
  const w = Math.max(1, Math.abs(width));
  const h = Math.max(1, Math.abs(height));

  const unitAnchors: AnchorPoint[] = [];
  const total = n * 2;
  for (let i = 0; i < total; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / total;
    const radius = i % 2 === 0 ? 1 : ratio;
    unitAnchors.push(
      makeSharpAnchor(Math.cos(angle) * radius, Math.sin(angle) * radius)
    );
  }

  const rawBox = computeSubPathsBBox([{ closed: true, anchors: unitAnchors }]);
  const sx = rawBox.width > 1e-6 ? w / rawBox.width : w / 2;
  const sy = rawBox.height > 1e-6 ? h / rawBox.height : h / 2;

  const scaled: SubPath[] = [
    {
      closed: true,
      anchors: unitAnchors.map((a) => makeSharpAnchor(a.x * sx, a.y * sy)),
    },
  ];

  return centerSubPathsAtOrigin(scaled).subpaths;
}

export function smoothSubPaths(subpaths: SubPath[], factor = 1): SubPath[] {
  const f = clamp(factor, 0, 1);

  return subpaths.map((sp) => {
    const { anchors, closed } = sp;
    const count = anchors.length;
    if (count < 2) {
      return {
        closed,
        anchors: anchors.map((a) => ({
          ...a,
          handleIn: { ...a.handleIn },
          handleOut: { ...a.handleOut },
        })),
      };
    }

    const nextAnchors: AnchorPoint[] = anchors.map((cur, i) => {
      let targetIn: Point2D = { x: 0, y: 0 };
      let targetOut: Point2D = { x: 0, y: 0 };

      if (!closed && i === 0) {
        const next = anchors[1];
        const dx = next.x - cur.x;
        const dy = next.y - cur.y;
        targetOut = { x: dx / 3, y: dy / 3 };
      } else if (!closed && i === count - 1) {
        const prev = anchors[count - 2];
        const dx = prev.x - cur.x;
        const dy = prev.y - cur.y;
        targetIn = { x: dx / 3, y: dy / 3 };
      } else {
        const prev = anchors[(i - 1 + count) % count];
        const next = anchors[(i + 1) % count];
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const tLen = Math.hypot(tx, ty);
        if (tLen > 1e-6) {
          const ux = tx / tLen;
          const uy = ty / tLen;
          const dPrev = Math.hypot(cur.x - prev.x, cur.y - prev.y);
          const dNext = Math.hypot(next.x - cur.x, next.y - cur.y);
          targetIn = { x: -ux * (dPrev / 3), y: -uy * (dPrev / 3) };
          targetOut = { x: ux * (dNext / 3), y: uy * (dNext / 3) };
        }
      }

      return {
        x: cur.x,
        y: cur.y,
        handleIn: {
          x: cur.handleIn.x + (targetIn.x - cur.handleIn.x) * f,
          y: cur.handleIn.y + (targetIn.y - cur.handleIn.y) * f,
        },
        handleOut: {
          x: cur.handleOut.x + (targetOut.x - cur.handleOut.x) * f,
          y: cur.handleOut.y + (targetOut.y - cur.handleOut.y) * f,
        },
        smooth: f > 0 && (closed || (i > 0 && i < count - 1)),
      };
    });

    return {
      closed,
      anchors: nextAnchors,
    };
  });
}

export function createBlobSubPaths(
  width: number,
  height: number,
  points: number,
  wobble: number,
  seed?: number
): SubPath[] {
  const n = clamp(Math.round(points), 3, 24);
  const w = clamp(wobble, 0, 1);
  const rx = Math.max(1, Math.abs(width)) / 2;
  const ry = Math.max(1, Math.abs(height)) / 2;
  const rng = createRng(seed);

  const anchors: AnchorPoint[] = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / n;
    const radialFactor = 1 + (rng() * 2 - 1) * w * 0.42;
    anchors.push(
      makeSharpAnchor(
        rx * radialFactor * Math.cos(angle),
        ry * radialFactor * Math.sin(angle)
      )
    );
  }

  const smoothed = smoothSubPaths([{ closed: true, anchors }], 1);
  return centerSubPathsAtOrigin(smoothed).subpaths;
}

export function randomizeAnchors(
  subpaths: SubPath[],
  intensity: number,
  seed?: number
): SubPath[] {
  if (intensity <= 0) {
    return cloneSubPaths(subpaths);
  }
  const rng = createRng(seed);

  const perturbed = subpaths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => {
      const dx = (rng() * 2 - 1) * intensity;
      const dy = (rng() * 2 - 1) * intensity;
      const jx = (rng() * 2 - 1) * intensity * 0.35;
      const jy = (rng() * 2 - 1) * intensity * 0.35;

      const outX = a.handleOut.x + jx;
      const outY = a.handleOut.y + jy;

      let inX = a.handleIn.x + (rng() * 2 - 1) * intensity * 0.35;
      let inY = a.handleIn.y + (rng() * 2 - 1) * intensity * 0.35;

      if (a.smooth) {
        const outLen = Math.hypot(outX, outY);
        const inLen = Math.hypot(a.handleIn.x, a.handleIn.y);
        if (outLen > 1e-6 && inLen > 1e-6) {
          inX = -(outX / outLen) * inLen;
          inY = -(outY / outLen) * inLen;
        }
      }

      return {
        x: a.x + dx,
        y: a.y + dy,
        handleIn: { x: inX, y: inY },
        handleOut: { x: outX, y: outY },
        smooth: a.smooth,
      };
    }),
  }));

  return centerSubPathsAtOrigin(perturbed).subpaths;
}

export function generateSmartShape(
  width: number,
  height: number,
  options: SmartShapeOptions,
  seed?: number
): SubPath[] {
  switch (options.preset) {
    case 'ellipse':
      return createEllipseSubPaths(width, height);
    case 'rect':
      return createRectSubPaths(width, height, options.cornerRadius);
    case 'polygon':
      return createPolygonSubPaths(width, height, options.points);
    case 'star':
      return createStarSubPaths(
        width,
        height,
        options.points,
        options.innerRadiusRatio
      );
    case 'blob':
    default:
      return createBlobSubPaths(
        width,
        height,
        options.points,
        options.wobble,
        seed
      );
  }
}
