import { useEffect, useState } from "react";

import { bucketForWidth, type DeviceBucket } from "@/lib/breakpoints";

/**
 * Reactive device bucket hook. SSR-safe: initial render is `"phone"`
 * (iPhone-first), then upgrades on mount.
 */
export function useBreakpoint(): DeviceBucket {
  const [bucket, setBucket] = useState<DeviceBucket>("phone");

  useEffect(() => {
    const update = () => setBucket(bucketForWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return bucket;
}
