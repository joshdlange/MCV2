import {
  type ImgHTMLAttributes,
  useEffect,
  useState,
} from "react";

import { getBadgeImageUrl } from "@/lib/badgeImages";

interface BadgeImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes"> {
  iconUrl: string;
  displaySize: number;
  eager?: boolean;
}

export function BadgeImage({
  iconUrl,
  displaySize,
  eager = false,
  onError,
  ...props
}: BadgeImageProps) {
  const [useOriginal, setUseOriginal] = useState(false);
  const thumbnailUrl = getBadgeImageUrl(iconUrl, "thumbs");
  const largeUrl = getBadgeImageUrl(iconUrl, "large");
  const hasDerivatives = !useOriginal && thumbnailUrl !== iconUrl;

  useEffect(() => {
    setUseOriginal(false);
  }, [iconUrl]);

  return (
    <img
      {...props}
      src={hasDerivatives ? thumbnailUrl : iconUrl}
      srcSet={hasDerivatives ? `${thumbnailUrl} 192w, ${largeUrl} 512w` : undefined}
      sizes={`${displaySize}px`}
      width={displaySize}
      height={displaySize}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={(event) => {
        if (hasDerivatives) setUseOriginal(true);
        onError?.(event);
      }}
    />
  );
}