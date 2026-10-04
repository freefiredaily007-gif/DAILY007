import React from "react";

type IconProps = { size?: number };

function SocialIcon({ size = 24 }: IconProps) {
  return <span aria-hidden="true" style={{ display: "inline-block", width: size, height: size }} />;
}

export const WhatsAppIcon = SocialIcon;
export const InstagramIcon = SocialIcon;
export const YouTubeIcon = SocialIcon;