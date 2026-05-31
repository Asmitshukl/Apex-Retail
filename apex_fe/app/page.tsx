import Link from "next/link";

const workflow = [
  "Upload Footage",
  "AI Detection",
  "Event Stream",
  "Store Metrics",
  "Live Dashboard",
];

const features = [
  {
    title: "Multi-camera upload",
    body: "Process entry, floor, billing, and aisle angles together as one store session.",
  },
  {
    title: "Customer and staff split",
    body: "LICM classification separates all-black staff uniforms from shoppers before metrics are computed.",
  },
  {
    title: "Zone intelligence",
    body: "Track aisle visits, dwell time, queue joins, abandonment, and movement across store zones.",
  },
  {
    title: "Live event stream",
    body: "Batched ingest and SSE updates keep charts, logs, and counters moving during processing.",
  },
];

const events = [
  ["08:00:12", "ENTRY", "VIS_102 entered from CAM_ENTRY_01"],
  ["08:01:44", "ZONE_ENTER", "VIS_102 moved into aisle_3"],
  ["08:03:09", "BILLING_QUEUE_JOIN", "Queue depth changed to 2"],
  ["08:05:32", "EXIT", "VIS_102 completed session"],
];

function MiniLineChart() {
  return (
    <div className="relative h-52 overflow-hidden rounded-lg border border-slate-100 bg-white p-4">
      <div className="absolute inset-4 rounded bg-[linear-gradient(#e5e7eb_1px,transparent_1px)] bg-[length:100%_40px]" />
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-400">Customer activity</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">+18 visitors</p>
        </div>
        <span className="soft-badge live-pulse px-3 py-2 text-xs font-bold">LIVE</span>
      </div>
      <svg className="relative mt-3 h-32 w-full" viewBox="0 0 420 150" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M0 120 C35 108 45 72 82 82 C120 94 126 44 165 50 C205 56 214 112 255 92 C292 74 298 35 335 45 C374 56 386 25 420 38"
          fill="none"
          stroke="#059669"
          strokeWidth="5"
          strokeLinecap="round"
          className="landing-flow-line"
        />
        <path
          d="M0 120 C35 108 45 72 82 82 C120 94 126 44 165 50 C205 56 214 112 255 92 C292 74 298 35 335 45 C374 56 386 25 420 38"
          fill="none"
          stroke="#a7f3d0"
          strokeWidth="18"
          strokeLinecap="round"
          opacity="0.35"
        />
        {[82, 165, 255, 335, 420].map((cx, index) => (
          <circle
            key={cx}
            cx={cx}
            cy={[82, 50, 92, 45, 38][index]}
            r="5"
            fill="#ffffff"
            stroke="#059669"
            strokeWidth="4"
            className="landing-chart-dot"
            style={{ animationDelay: `${index * 0.45}s` }}
          />
        ))}
      </svg>
    </div>
  );
}

function PieChartPreview() {
  return (
    <div className="flex min-h-52 flex-col justify-between gap-5 rounded-lg border border-slate-100 bg-white p-4 sm:flex-row sm:items-center">
      <div className="relative mx-auto h-32 w-32 shrink-0 rounded-full landing-donut">
        <div className="absolute inset-6 grid place-items-center rounded-full bg-white text-center">
          <span className="text-xl font-bold text-slate-950">70%</span>
          <span className="text-[11px] font-semibold text-slate-400">customers</span>
        </div>
      </div>
      <div className="space-y-3 text-sm sm:min-w-32">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-emerald-600" />
          <span className="font-medium text-slate-700">Customers 70%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-blue-600" />
          <span className="font-medium text-slate-700">Staff 17%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-slate-200" />
          <span className="font-medium text-slate-700">Other 13%</span>
        </div>
      </div>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="card landing-preview-card p-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Live store session</p>
          <h2 className="mt-1 text-xl font-bold">Brigade Road Analytics</h2>
        </div>
        <span className="soft-badge live-pulse px-3 py-2 text-xs font-bold">STREAMING</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Visitors", "44"],
          ["Staff", "6"],
          ["Queue", "2"],
          ["Zones", "9"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-100 bg-white p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <MiniLineChart />
        <PieChartPreview />
      </div>
      <div className="mt-5 overflow-hidden rounded-lg border border-emerald-100 bg-emerald-50 py-3">
        <div className="landing-ticker flex gap-8 whitespace-nowrap text-sm font-semibold text-emerald-800">
          <span>ENTRY VIS_102</span>
          <span>ZONE_ENTER aisle_3</span>
          <span>QUEUE depth 2</span>
          <span>STAFF detected</span>
          <span>EXIT VIS_102</span>
          <span>ENTRY VIS_108</span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f8] text-slate-950">
      <div className="border-b border-emerald-100 bg-emerald-50/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-2 text-xs text-slate-600">
          <span className="font-medium text-emerald-700">Apex Retail Intelligence</span>
          <span>support@apex-retail.local</span>
        </div>
      </div>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-600 font-bold text-white">
              AI
            </span>
            <span>
              <span className="block text-lg font-semibold tracking-tight">Apex Retail</span>
              <span className="block text-xs text-slate-500">CCTV intelligence</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            {[
              ["Overview", "#overview"],
              ["Workflow", "#workflow"],
              ["Features", "#features"],
              ["Dashboard", "/dashboard"],
              ["Add Video", "/add-video"],
            ].map(([label, href]) => (
              <Link
                key={label}
                href={href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              >
                {label}
              </Link>
            ))}
          </nav>
          <Link
            href="/add-video"
            className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white"
          >
            Upload Footage
          </Link>
        </div>
      </header>

      <section id="overview" className="mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div>
          <span className="soft-badge inline-flex px-3 py-2 text-xs font-bold uppercase tracking-wider">
            Offline store analytics
          </span>
          <h1 className="mt-6 max-w-3xl text-5xl font-bold tracking-tight text-slate-950 md:text-6xl">
            Turn CCTV footage into live store intelligence.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Upload multi-camera retail footage and get real-time visitor analytics, staff detection, queue insights, and zone-level movement in one operational dashboard.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/add-video" className="rounded-lg bg-emerald-600 px-5 py-4 text-sm font-bold text-white">
              Start Analysis
            </Link>
            <Link href="/dashboard" className="rounded-lg border border-slate-300 bg-white px-5 py-4 text-sm font-bold text-slate-800">
              Open Dashboard
            </Link>
          </div>
          <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3 border-t border-slate-200 pt-6">
            {[
              ["5", "camera roles"],
              ["500", "event batches"],
              ["SSE", "live updates"],
            ].map(([value, label]) => (
              <div key={label}>
                <p className="text-2xl font-bold text-slate-950">{value}</p>
                <p className="mt-1 text-sm text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <DashboardPreview />
      </section>

      <section id="workflow" className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12">
          <div className="mb-8 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">From CCTV to decisions</h2>
              <p className="mt-2 text-slate-600">A complete processing chain built for uploaded store footage.</p>
            </div>
            <Link href="/analytics" className="text-sm font-bold text-emerald-700">
              View analytics
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {workflow.map((step, index) => (
              <div key={step} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <span className="text-xs font-bold text-emerald-700">0{index + 1}</span>
                <p className="mt-3 font-semibold">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-5 py-16">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Built for multi-camera retail intelligence</h2>
            <p className="mt-4 leading-7 text-slate-600">
              Apex joins camera angles, identity tracking, staff filtering, event ingest, and analytics so store teams can review behavior instead of raw footage.
            </p>
            <div className="mt-6 grid gap-3">
              {["Docker-ready", "PostgreSQL-backed", "YOLOv8 + LICM", "Batch ingest", "SSE live dashboard"].map((badge) => (
                <span key={badge} className="soft-badge w-fit px-3 py-2 text-sm font-semibold">
                  {badge}
                </span>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {features.map((feature) => (
              <article key={feature.title} className="card p-5">
                <h3 className="text-lg font-bold">{feature.title}</h3>
                <p className="mt-3 leading-6 text-slate-600">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 pb-20 lg:grid-cols-[1fr_0.85fr]">
        <div className="card p-6">
          <h2 className="text-2xl font-bold">Realtime event feed</h2>
          <p className="mt-2 text-slate-600">A clean stream of what the pipeline is detecting during processing.</p>
          <div className="mt-6 divide-y divide-slate-100">
            {events.map(([time, type, message]) => (
              <div key={`${time}-${type}`} className="grid grid-cols-[82px_150px_1fr] gap-3 py-4 text-sm">
                <span className="text-slate-400">{time}</span>
                <span className="font-bold text-emerald-700">{type}</span>
                <span className="text-slate-700">{message}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-6">
          <h2 className="text-2xl font-bold">Camera coverage</h2>
          <p className="mt-2 text-slate-600">One upload session can combine different viewpoints.</p>
          <div className="mt-6 grid gap-3">
            {["Entry camera", "Floor camera", "Billing camera", "Live camera setup"].map((camera) => (
              <div key={camera} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-4">
                <span className="font-semibold">{camera}</span>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-emerald-700">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 px-5 py-12 text-white md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-bold">Ready to turn store footage into intelligence?</h2>
            <p className="mt-3 text-emerald-50">Upload clips, watch the charts move, and review the final store analytics.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/add-video" className="rounded-lg bg-white px-5 py-4 text-sm font-bold text-emerald-700">
              Upload Footage
            </Link>
            <Link href="/live" className="rounded-lg border border-emerald-200 px-5 py-4 text-sm font-bold text-white">
              Live Camera Setup
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-slate-950">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-5 py-8 text-sm text-slate-400 md:flex-row">
          <span>Apex Retail Intelligence</span>
          <span>Offline CCTV analytics for real stores.</span>
        </div>
      </footer>
    </main>
  );
}
