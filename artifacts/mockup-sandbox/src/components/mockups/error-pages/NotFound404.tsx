import "./_group.css";

export function NotFound404() {
  return (
    <main
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden p-6 text-white"
      style={{
        background:
          "radial-gradient(circle at top left, rgba(255, 0, 51, 0.14), transparent 30%), radial-gradient(circle at bottom right, rgba(0, 180, 255, 0.1), transparent 30%), linear-gradient(180deg, #06070d 0%, #02030a 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)",
          backgroundSize: "8px 8px",
        }}
      />

      <section
        aria-labelledby="not-found-title"
        className="relative z-10 w-full max-w-2xl rounded-3xl border-2 border-white/10 px-5 py-8 text-center sm:px-8 sm:py-11"
        style={{
          background:
            "linear-gradient(180deg, rgba(18, 21, 34, 0.96), rgba(8, 10, 18, 0.98))",
          boxShadow:
            "0 18px 50px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(255, 0, 51, 0.18), 0 0 36px rgba(255, 0, 51, 0.12)",
        }}
      >
        <div
          className="mb-4 inline-block rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider text-white"
          style={{
            background: "#ff123d",
            boxShadow: "0 8px 24px rgba(255, 18, 61, 0.35)",
            animation: "nf-pulse-badge 2s ease-in-out infinite",
          }}
        >
          404 Error
        </div>

        <div className="mb-4 flex justify-center">
          <img
            src="/__mockup/images/mcv-logo.png"
            alt="Marvelous Card Vault"
            className="h-auto w-40 max-w-[62vw] sm:w-48"
            style={{
              filter:
                "drop-shadow(0 10px 24px rgba(255, 0, 51, 0.28)) drop-shadow(0 0 18px rgba(255, 255, 255, 0.08))",
              animation: "nf-float-logo 3.5s ease-in-out infinite",
            }}
          />
        </div>

        <h1
          id="not-found-title"
          className="mb-1 text-4xl font-black leading-none tracking-tight text-white sm:text-5xl"
        >
          Oh no...
        </h1>

        <h2
          className="mb-4 text-xl font-black leading-tight sm:text-2xl"
          style={{ color: "#ff294f" }}
        >
          My only weakness: a 404 page.
        </h2>

        <p className="mx-auto mb-2 max-w-xl text-base leading-relaxed text-white/90">
          The page you were looking for either flew off to another universe,
          got lost in the vault, or doesn&apos;t exist anymore.
        </p>

        <p className="mx-auto mb-7 max-w-xl text-base leading-relaxed text-white/70">
          Try refreshing the page or head back home and keep building your
          collection.
        </p>

        <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            className="min-w-[140px] cursor-pointer rounded-xl border-0 px-5 py-3.5 text-sm font-black text-white transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background: "linear-gradient(180deg, #ff234b, #d60f35)",
              boxShadow: "0 10px 24px rgba(255, 35, 75, 0.36)",
            }}
          >
            Back Home
          </button>

          <button
            type="button"
            className="min-w-[140px] cursor-pointer rounded-xl border border-white/15 bg-white/10 px-5 py-3.5 text-sm font-black text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/15 active:translate-y-0"
          >
            Refresh
          </button>
        </div>
      </section>
    </main>
  );
}
