"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function BodyClass() {
  const pathname = usePathname();

  useEffect(() => {
    const isHome = pathname === "/";
    document.body.classList.toggle("homepage", isHome);
    document.body.classList.toggle("app-page", !isHome);
  }, [pathname]);

  return null;
}
