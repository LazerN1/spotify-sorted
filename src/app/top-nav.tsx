"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AccountMenu from "./account-menu";

const steps = [
  { label: "Get started", href: "/" },
  { label: "Select songs", href: "/my-songs" },
  { label: "Select playlists", href: "/sorter" },
  { label: "Sort!", href: "/sorter/play" },
];

export default function TopNav() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  const currentIndex = steps.findIndex((step) => {
    if (step.href === "/") return pathname === "/";
    if (step.href === "/sorter") return pathname === "/sorter";
    return pathname.startsWith(step.href);
  });

  return (
    <nav className="top-nav">
      <div className="top-nav-inner">
        <div className="top-nav-brand">
          <h1 className="sorted-nav">Sorted&nbsp;</h1>
          <h2 className="for-nav">for&nbsp;</h2>
          <img className='spotifyLogoNav' src="/spotify_logo.svg" />
        </div>
        <div className="top-nav-steps" aria-label="Progress">
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex;
            const isVisited = index < currentIndex;
            const className = isCurrent
              ? "step current"
              : isVisited
              ? "step visited"
              : "step";

            return (
              <div key={step.href} className="step-group">
                {isVisited ? (
                  <Link href={step.href} className={className}>
                    {step.label}
                  </Link>
                ) : (
                  <span className={className} aria-disabled={!isVisited}>
                    {step.label}
                  </span>
                )}
                {index < steps.length - 1 ? (
                  <span className="step-sep">&gt;</span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="top-nav-account">
          <AccountMenu />
        </div>
      </div>
    </nav>
  );
}
