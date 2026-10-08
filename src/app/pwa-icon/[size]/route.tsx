import { ImageResponse } from "next/og";

const OWL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<path d="M24 30 L22 14 L36 24 Z" fill="#9d86f0"/><path d="M76 30 L78 14 L64 24 Z" fill="#9d86f0"/>
<ellipse cx="50" cy="58" rx="32" ry="34" fill="#C8B6FF"/><ellipse cx="50" cy="68" rx="20" ry="20" fill="#FFF4E8"/>
<circle cx="38" cy="44" r="11" fill="#fff"/><circle cx="62" cy="44" r="11" fill="#fff"/>
<circle cx="39" cy="45" r="5.5" fill="#2d2a3e"/><circle cx="63" cy="45" r="5.5" fill="#2d2a3e"/>
<circle cx="41" cy="42" r="1.8" fill="#fff"/><circle cx="65" cy="42" r="1.8" fill="#fff"/>
<path d="M45 52 L55 52 L50 60 Z" fill="#FFB86B"/>
<ellipse cx="27" cy="55" rx="5" ry="3" fill="#FFADAD"/><ellipse cx="73" cy="55" rx="5" ry="3" fill="#FFADAD"/>
<circle cx="50" cy="76" r="7" fill="#FFD6A5" stroke="#e8964a" stroke-width="1.5"/><path d="M47 76 h6" stroke="#e8964a" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const SIZES = new Set([180, 192, 512]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: raw } = await params;
  const size = SIZES.has(Number(raw)) ? Number(raw) : 192;
  const inner = Math.round(size * 0.78);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #FFF4E8 0%, #FFC6D9 60%, #C8B6FF 100%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img width={inner} height={inner} src={`data:image/svg+xml;base64,${Buffer.from(OWL).toString("base64")}`} alt="" />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
