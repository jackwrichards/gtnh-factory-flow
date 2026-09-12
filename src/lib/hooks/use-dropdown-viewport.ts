"use client";

import { useEffect, useState } from "react";

function readViewport() {
  if (typeof window === "undefined") return { left: 0, top: 0, width: 0, height: 0 };
  const visual = window.visualViewport;
  return {
    left: visual?.offsetLeft ?? 0,
    top: visual?.offsetTop ?? 0,
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
  };
}

/** Only mounted menus subscribe. A mobile keyboard often shrinks just the
 * visual viewport, leaving window.innerHeight and the layout unchanged. */
export function useDropdownViewport() {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const update = () => setViewport(readViewport());
    const visual = window.visualViewport;
    window.addEventListener("resize", update);
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
    };
  }, []);
  return viewport;
}
