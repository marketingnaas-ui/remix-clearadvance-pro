import React, { useEffect, useState } from "react";
import { User } from "lucide-react";

interface ProfileImageProps {
  photoURL?: string;
  image?: string;
  name: string;
  className?: string;
  updatedAt?: { seconds: number };
}

export default function ProfileImage({ photoURL, image, name, className, updatedAt }: ProfileImageProps) {
  const [error, setError] = useState(false);

  const src = photoURL
    ? photoURL.startsWith("data:")
      ? photoURL
      : `${photoURL}${photoURL.includes("?") ? "&" : "?"}v=${updatedAt?.seconds || ""}`
    : image;

  useEffect(() => {
    setError(false);
  }, [src]);

  if (!src || error) {
    return (
      <div className={`flex items-center justify-center bg-stone-900 text-stone-50 font-bold font-mono ${className}`}>
        {name.charAt(0)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="profile"
      className={className}
      onError={() => setError(true)}
    />
  );
}
