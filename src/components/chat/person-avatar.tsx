"use client";

import { createContext, useContext } from "react";
import { avatarColor, initialsOf } from "@/lib/avatar";
import { cn } from "@/lib/utils";

// Somebody's face: their photo if they have one, their initials on their
// colour if they do not.
//
// The initials are drawn in place rather than fetched. A task card can carry
// several people, and none of their faces should wait on the network or arrive
// after the card has been laid out — which is also why a photo is laid *over*
// the initials in the same box rather than replacing them: the circle is the
// right size and colour from the first paint, and the photo fills it when it
// arrives. A photo that fails to load leaves the initials showing, which is
// the correct answer to a file that has gone missing rather than a broken
// image icon.

// Faces for a whole screenful of people at once.
//
// A chat message and a meeting card's attendee list hold a member key and a
// copied name — never a face, because a face is a current fact about a person
// and a copy of one goes stale (lib/faces.ts says why). Passing a map down
// through every message row and every card would be a prop on a dozen
// components for one picture, so the conversation resolves the faces once and
// publishes them here. Anything below reads its own by key.
//
// Default empty: every use outside a provider keeps drawing initials, which is
// what every server-rendered screen that passes `photo` directly does anyway.
const FacesContext = createContext<Record<string, string | null>>({});

export function FacesProvider({
  faces,
  children,
}: {
  faces: Record<string, string | null>;
  children: React.ReactNode;
}) {
  return <FacesContext.Provider value={faces}>{children}</FacesContext.Provider>;
}

export function PersonAvatar({
  name,
  photo,
  personKey,
  color,
  size = 28,
  className,
}: {
  name: string;
  /** The picture, when the caller already has it. Wins over the map. */
  photo?: string | null;
  /** Who this is, for a caller that holds a key rather than a picture. */
  personKey?: string | null;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const faces = useContext(FacesContext);
  // `photo` given as null is an answer — "this person has none" — so only an
  // absent one falls through to the map.
  const face = photo !== undefined ? photo : personKey ? (faces[personKey] ?? null) : null;

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white",
        className
      )}
      style={{ width: size, height: size, backgroundColor: avatarColor(color), fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name)}
      {face && (
        // Not next/image: these are a handful of 512px squares from our own
        // storage, drawn at 22–88px, and <Image> is used `unoptimized`
        // throughout anyway — so it would add a component and change nothing.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={face}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}
