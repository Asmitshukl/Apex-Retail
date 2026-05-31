type Point = {
  label: string;
  value: number;
};

type LineChartProps = {
  title: string;
  subtitle: string;
  points: Point[];
  color?: string;
  valueLabel?: string;
  valueHint?: string;
};

function buildPath(points: Point[], width: number, height: number) {
  const max = Math.max(1, ...points.map((point) => point.value));
  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - (point.value / max) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function LineChart({ title, subtitle, points, color = "#00a878", valueLabel = "0", valueHint = "current" }: LineChartProps) {
  const width = 640;
  const height = 230;
  const safePoints = points.length > 0 ? points : [{ label: "Now", value: 0 }];
  const path = buildPath(safePoints, width, height);
  const maxValue = Math.max(1, ...safePoints.map((point) => point.value));
  const yAxis = [maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0];
  const tickEvery = Math.max(1, Math.ceil(safePoints.length / 6));

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold" style={{ color }}>{valueLabel}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{valueHint}</p>
        </div>
      </div>
      <div className="mt-6 overflow-hidden">
        <svg viewBox={`0 0 ${width + 48} ${height + 34}`} className="h-72 w-full">
          {[0, 1, 2, 3, 4].map((line) => {
            const y = (line / 4) * height;
            return (
              <g key={line}>
                <text x="0" y={y + 4} fontSize="12" fill="#94a3b8">
                  {Math.round(yAxis[line])}
                </text>
                <line
                  x1="44"
                  x2={width + 44}
                  y1={y}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeDasharray="4 6"
                />
              </g>
            );
          })}
          <g transform="translate(44 0)">
          <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill={color} opacity="0.08" />
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-all duration-700 ease-out"
          />
          {safePoints.map((point, index) => {
            const max = Math.max(1, ...safePoints.map((item) => item.value));
            const x = safePoints.length === 1 ? width / 2 : (index / (safePoints.length - 1)) * width;
            const y = height - (point.value / max) * height;
            const showLabel = index === 0 || index === safePoints.length - 1 || index % tickEvery === 0;
            return (
              <g key={`${point.label}-${index}`}>
                <circle cx={x} cy={y} r={showLabel ? "5" : "3"} fill="#fff" stroke={color} strokeWidth={showLabel ? "3" : "2"} />
                {showLabel ? (
                  <text x={x} y={height + 28} textAnchor="middle" fontSize="12" fill="#94a3b8">
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          </g>
        </svg>
      </div>
    </section>
  );
}
