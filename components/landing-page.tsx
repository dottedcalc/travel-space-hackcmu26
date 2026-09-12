import { ArrowRight } from "lucide-react";
import { AppHeader } from "@/components/app-header";

const tables = [[105, 135], [245, 110], [515, 155], [125, 250], [265, 220], [400, 275], [515, 250], [120, 365], [275, 350], [435, 395], [600, 330]];

function JourneyDiagram({ exploratory = false }: { exploratory?: boolean }) {
  const id = exploratory ? "exploratory" : "directed";
  return (
    <svg className="journey-diagram" viewBox="0 0 800 570" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{exploratory ? "Exploratory circulation and emergent encounters" : "Directed movement"}</title>
      <desc id={`${id}-description`}>{exploratory ? "Overlapping orange visitor paths weave through the café, showing exploration and chance encounters." : "An orange dashed path travels from the lower left entrance to the upper exit of a café floor plan."}</desc>
      <defs>
        <marker id="journey-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9Z" fill="#e7853c" /></marker>
      </defs>
      <path d="M130 475H70V90H555 M615 90H670V210H755V490H555V530H325V490H200V475H190" fill="#fff" stroke="#28384f" strokeWidth="5" strokeLinejoin="miter" />
      <path d="M555 90V60M615 90V60M130 475V442M190 475V442" fill="none" stroke="#71808d" strokeWidth="1.5" />
      <path d="M555 60Q585 60 585 90Q585 60 615 60M130 442Q160 442 160 475Q160 442 190 442" fill="none" stroke="#99a5ae" strokeWidth="1" strokeDasharray="3 3" />
      <g fill="#f7f9fc" stroke="#a7b3bf" strokeWidth="1">
        {tables.map(([x, y], index) => (
          <g key={index}>
            {[8, 28, 48, 68].map((offset) => <rect key={offset} x={x + offset} y={y - 10} width="12" height="14" rx="4" />)}
            <rect x={x} y={y} width="88" height="44" />
          </g>
        ))}
        <path d="M687 212V310H755M687 245H731M687 277H731" fill="none" />
        {[235, 266, 295].map((y) => <ellipse key={y} cx="702" cy={y} rx="6" ry="8" />)}
        {[[655, 414], [690, 438], [724, 407]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="10" />)}
      </g>
      <g fill="#647487" fontSize="12" fontFamily="inherit" letterSpacing="2">
        <text x="396" y="208">CAFÉ</text><text x="716" y="266" fontSize="10">WC</text><text x="418" y="504">STAGE</text>
      </g>
      {exploratory ? (
        <g fill="none" stroke="#e7853c" strokeWidth="3" strokeLinecap="round" opacity=".85">
          <path d="M160 470C90 410 92 310 180 300S370 390 450 350S620 200 615 155S410 115 380 175S230 340 155 265S170 155 260 175S590 305 645 270S740 235 735 300S620 395 550 355S320 220 275 280S245 445 355 445S585 390 620 430S500 480 430 505" />
          <path d="M170 465C230 400 100 320 145 230S320 145 410 235S535 400 615 355S735 340 725 275S640 310 600 290S605 150 550 145S360 270 280 235S215 110 320 125S530 205 470 280S235 390 220 330S280 195 395 215S575 330 545 390S390 460 365 405S355 310 420 345S455 475 510 480" />
          <path d="M160 460C115 380 205 400 260 365S505 345 485 225S300 100 235 185S225 310 350 305S650 175 610 130S415 140 405 190S550 230 585 280S655 440 570 435S350 375 310 430S350 505 465 490" />
        </g>
      ) : (
        <>
          <path className="journey-trail" d="M100 520L585 70L631 27" fill="none" stroke="#e7853c" strokeWidth="6" strokeDasharray="15 12" markerEnd="url(#journey-arrow)" />
          <circle cx="160" cy="464" r="7" fill="#e7853c" stroke="#fff" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}

export function LandingPage() {
  return (
    <div className="app-shell landing-shell">
      <AppHeader />
      <main className="landing-main">
        <section className="landing-intro" aria-labelledby="landing-title">
          <h1 id="landing-title">Shape the space.<br />Guide the <em>flow.</em></h1>
          <p className="landing-description">Planning a club fair or exhibition? Your layout shapes how people travel through the space. With TravelSpace, try different arrangements and see where crowds build up before the doors open.</p>
          <a className="landing-cta" href="/workspaces">Choose a venue <ArrowRight size={18} aria-hidden="true" /></a>
        </section>
        <div className="landing-visuals">
          <div className="landing-movement-comparison">
            <figure className="landing-movement">
              <JourneyDiagram />
              <figcaption>Directed movement</figcaption>
            </figure>
            <span className="landing-plus" aria-label="plus">+</span>
            <figure className="landing-movement">
              <JourneyDiagram exploratory />
              <figcaption>Exploratory circulation<br />+ emergent encounters</figcaption>
            </figure>
          </div>
          <span className="landing-equals" aria-label="equals">=</span>
          <figure className="landing-simulation">
            {/* The supplied capture is intentionally shown in full. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/visitor-simulation.png" width="1468" height="1312" alt="Visitor simulation showing crowd density and overlapping journeys between exhibition booths, the café, entrances and exit." />
          </figure>
        </div>
      </main>
    </div>
  );
}
