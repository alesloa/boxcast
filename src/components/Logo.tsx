import { useState } from "react";
import { initials, monogramGradient } from "../lib/monogram";

export function Logo({
  src,
  name,
  size = 40,
  radius = 8,
}: {
  src?: string | null;
  name: string;
  size?: number;
  radius?: number;
}) {
  const [broken, setBroken] = useState(false);
  const showImg = src && !broken;

  return (
    <div
      className="flex flex-none place-items-center items-center justify-center overflow-hidden font-extrabold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.32),
        letterSpacing: "-.5px",
        background: showImg ? "var(--c-monogram)" : monogramGradient(name),
      }}
    >
      {showImg ? (
        <img
          src={src!}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        initials(name)
      )}
    </div>
  );
}
